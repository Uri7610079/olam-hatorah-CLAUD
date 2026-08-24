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

  const { data: batch, error: batchError } = await supabase
    .from("import_batches")
    .insert({
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
      status: "previewed",
    })
    .select("id")
    .single();
  if (batchError || !batch) throw new Error(batchError?.message ?? "יצירת האצווה נכשלה");

  const { error: rowsError } = await supabase.from("import_rows").insert(
    rows.map((r) => ({
      batch_id: batch.id,
      row_number: r.rowNumber,
      raw: r.raw,
      status: r.status,
      error_message: r.errorMessage,
    })),
  );
  if (rowsError) throw new Error(`שמירת השורות נכשלה: ${rowsError.message}`);

  return { batchId: batch.id, rows };
}

export interface StoredImportRow {
  row_number: number;
  raw: Record<string, string>;
  status: "valid" | "needs_decision" | "invalid" | "committed";
  error_message: string | null;
}

export async function fetchImportBatchRows(batchId: string): Promise<StoredImportRow[]> {
  const { data, error } = await supabase.from("import_rows").select("row_number, raw, status, error_message").eq("batch_id", batchId).order("row_number");
  if (error) throw error;
  return data ?? [];
}

export async function resolveImportRow(batchId: string, rowNumber: number, status: "valid" | "invalid") {
  await supabase.from("import_rows").update({ status }).eq("batch_id", batchId).eq("row_number", rowNumber);
}
