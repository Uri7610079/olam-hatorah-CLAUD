import { fetchAll } from "@/lib/fetchAll";
import { supabase } from "./supabase";
import { parseImportFile, hashFile, classifyRows, isLegacyXls, type ClassifiedRow, type ParsedFile } from "./importParsing";
import {
  isTalmudPaymentReport,
  parseTalmudPaymentReport,
  mergeStudentRows,
  toImportRow,
} from "./talmudPaymentReport";
import { safeStorageKey } from "./storagePath";

export class DuplicateImportError extends Error {
  constructor(public existingBatchId: string) {
    super("קובץ זה כבר יובא בעבר");
  }
}

interface CreateBatchParams {
  file: File;
  profileKey: string;
  organizationId?: string | null;
  periodMonth?: string | null;
  storageBucket?: string;
}

interface CreateBatchResult {
  batchId: string;
  rows: ClassifiedRow[];
}

async function getProfileId(profileKey: string): Promise<string> {
  const { data, error } = await supabase.from("import_profiles").select("id").eq("key", profileKey).single();
  if (error || !data) throw new Error(`פרופיל יבוא לא נמצא: ${profileKey}`);
  return data.id;
}

// שלב 1: בדיקת קובץ כפול לפני שמפרסרים בכלל - זול ומהיר יותר מלנתח קובץ שממילא יידחה.
export async function checkDuplicateFile(file: File): Promise<string | null> {
  const hash = await hashFile(file);
  const { data } = await supabase.from("import_batches").select("id").eq("file_hash", hash).maybeSingle();
  return data?.id ?? null;
}

export function legacyXlsWarning(file: File): boolean {
  return isLegacyXls(file);
}

// מה שזוהה בדוח תלמוד, להצגה ולמילוי אוטומטי של העמותה והחודש. קיים רק
// כשהקובץ הוא דוח כזה; לכל שאר סוגי היבוא הוא undefined.
export interface TalmudImportInfo {
  orgNumber: string | null;
  /** כמה עמותות שונות בקובץ. יותר מאחת - הקובץ אינו ניתן לקליטה כאצווה אחת. */
  orgCount: number;
  orgName: string | null;
  month: string | null;
  branchCount: number;
  sourceRowCount: number;
  mergedRowCount: number;
  eligibleCount: number;
  totalAmount: number;
  declaredTotal: number | null;
  transfers: string[];
  ambiguousBranch: string[];
  exactDuplicates: string[];
  problems: string[];
}

export interface AnalyzeFileResult {
  rows: ClassifiedRow[];
  headerRowIndex: number;
  headerConfidence: "high" | "low";
  previewRows: string[][];
  talmud?: TalmudImportInfo;
}

// headerRowIndex: מועבר רק אחרי שהמשתמשת אישרה/בחרה שורת כותרות דרך HeaderRowConfirm
// (headerConfidence="low" בקריאה הראשונה) - קריאה שנייה עם השורה שנבחרה, לא ניחוש חוזר.
export async function analyzeFile(file: File, headerRowIndex?: number): Promise<AnalyzeFileResult> {
  const parsed = await parseImportFile(file, headerRowIndex);

  // "דוח דרישת תשלום" מתלמוד עובר תרגום כאן, לפני כל דבר אחר.
  //
  // שתי סיבות שההמרה יושבת דווקא בנקודה הזו:
  //
  // 1. התצוגה. הכותרות בדוח המקורי אנגליות (StudentIdentity, ReasonLevelName),
  //    ולמשתמשת אין שום סיבה לראות אותן. מרגע זה כל מה שזורם הלאה - תצוגה
  //    מקדימה, שורות שנשמרות, והודעות שגיאה - הוא בעברית בלבד.
  //
  // 2. אין צורך לגעת בפונקציית הקליטה שבמסד, שכבר עובדת בייצור וקוראת
  //    מפתחות בעברית. התרגום כאן פירושו שהיא ממשיכה לקבל בדיוק את מה
  //    שהיא מכירה.
  const talmud = maybeParseTalmudReport(parsed);
  if (talmud) {
    return {
      rows: classifyRows(talmud.rows),
      headerRowIndex: parsed.headerRowIndex,
      headerConfidence: "high",
      previewRows: parsed.previewRows,
      talmud: talmud.info,
    };
  }

  return {
    rows: classifyRows(parsed.rows),
    headerRowIndex: parsed.headerRowIndex,
    headerConfidence: parsed.headerConfidence,
    previewRows: parsed.previewRows,
  };
}

// מזהה דוח תשלום מתלמוד וממיר אותו לשורות בעברית. מחזיר null לכל קובץ אחר,
// כך ששאר סוגי היבוא אינם מושפעים כלל.
function maybeParseTalmudReport(parsed: ParsedFile): { rows: Record<string, string>[]; info: TalmudImportInfo } | null {
  if (!isTalmudPaymentReport(parsed.headers)) return null;

  const { rows, summary } = parseTalmudPaymentReport(parsed.rows, parsed.previewRows);
  const { merged, exactDuplicates, transfers, ambiguousBranch } = mergeStudentRows(rows);

  return {
    rows: merged.map(toImportRow),
    info: {
      orgNumber: summary.orgNumbers[0] ?? null,
      orgCount: summary.orgNumbers.length,
      orgName: merged[0]?.orgName ?? null,
      month: summary.month,
      branchCount: summary.branches.length,
      sourceRowCount: summary.rowCount,
      mergedRowCount: merged.length,
      eligibleCount: summary.eligibleCount,
      totalAmount: summary.totalAmount,
      declaredTotal: summary.declaredOrgTotal,
      transfers,
      ambiguousBranch,
      exactDuplicates,
      problems: summary.problems,
    },
  };
}

// שלב 2: יצירת האצווה בפועל (upload + import_batches + import_rows) - זהה למרכז היבוא
// הכללי, רק פרמטרי ע"י profileKey כדי לשמש גם זכאות וגם שגויים בלי לשכפל את הלוגיקה.
export async function createImportBatch(params: CreateBatchParams, rows: ClassifiedRow[]): Promise<CreateBatchResult> {
  const { file, profileKey, organizationId, periodMonth, storageBucket = "import-files" } = params;
  const hash = await hashFile(file);
  const profileId = await getProfileId(profileKey);

  const path = safeStorageKey(file.name);
  const { error: uploadError } = await supabase.storage.from(storageBucket).upload(path, file);
  if (uploadError) throw new Error(`העלאת הקובץ נכשלה: ${uploadError.message}`);

  // האצווה והשורות שלה נשמרות בפעולה אחת (מיגרציה 135). עד היום אלה היו שתי קריאות:
  // כשל בשמירת השורות השאיר אצווה ריקה, ובגלל שאסור לקלוט אותו קובץ פעמיים (לפי
  // טביעת הקובץ) - גם ניסיון חוזר נחסם. עכשיו כשל מבטל הכול, ואפשר פשוט לנסות שוב.
  const { data: batchId, error: batchError } = await supabase.rpc("create_import_batch_with_rows", {
    p_batch: {
      profile_id: profileId,
      organization_id: organizationId || null,
      period_month: periodMonth || null,
      file_path: path,
      file_name: file.name,
      file_hash: hash,
      row_count: rows.length,
      valid_count: rows.filter((r) => r.status === "valid").length,
      needs_decision_count: rows.filter((r) => r.status === "needs_decision").length,
      invalid_count: rows.filter((r) => r.status === "invalid").length,
    },
    p_rows: rows.map((r) => ({
      row_number: r.rowNumber,
      raw: r.raw,
      status: r.status,
      error_message: r.errorMessage,
    })),
  });
  if (batchError || !batchId) throw new Error(batchError?.message ?? "יצירת האצווה נכשלה");

  return { batchId: batchId as string, rows };
}

export interface StoredImportRow {
  row_number: number;
  raw: Record<string, string>;
  status: "valid" | "needs_decision" | "invalid" | "committed";
  error_message: string | null;
}

export async function fetchImportBatchRows(batchId: string): Promise<StoredImportRow[]> {
  const data = await fetchAll(() => supabase.from("import_rows").select("row_number, raw, status, error_message").eq("batch_id", batchId).order("row_number").order("id"));
  return data ?? [];
}

// סימון שנשמר עם שורה שהמפעיל דחה בסקירה. "השלמת שורות שנדחו" ומרכז
// החריגות מדלגים עליה (מיגרציה 110) - בלי הסימון אין דרך להבדיל בינה לבין
// שורה שהמערכת דחתה משום שהיה חסר לה משהו שהוזן מאז.
export const MANUAL_REJECT_MARK = "נדחתה ידנית בבדיקה";

// מחזירה הודעת שגיאה, או null כשהעדכון הצליח. עד היום שגיאה מהשרת נבלעה בשקט,
// והשורה נראתה כאילו עודכנה.
export async function resolveImportRow(batchId: string, rowNumber: number, status: "valid" | "invalid"): Promise<string | null> {
  if (status === "invalid") {
    const { error } = await supabase.from("import_rows")
      .update({ status, error_message: MANUAL_REJECT_MARK })
      .eq("batch_id", batchId).eq("row_number", rowNumber);
    return error?.message ?? null;
  }
  // אישור אחרי דחייה: הסימון יורד, והודעה אחרת (סיבת "דורש החלטה") נשארת.
  const { error } = await supabase.from("import_rows").update({ status }).eq("batch_id", batchId).eq("row_number", rowNumber);
  if (error) return error.message;
  const { error: markError } = await supabase.from("import_rows")
    .update({ error_message: null })
    .eq("batch_id", batchId).eq("row_number", rowNumber).eq("error_message", MANUAL_REJECT_MARK);
  return markError?.message ?? null;
}
