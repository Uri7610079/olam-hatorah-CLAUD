// קליטה אוטומטית של הדוחות שירדו מתלמוד (שלב 42).
//
// החלטת צ'ני: מה שמגיע מתלמוד ועובר את כל הבדיקות נקלט בלי אישור. עד עכשיו כל קובץ
// דרש "המשך ליבוא" ← תצוגה מקדימה ← "קליטה". כאן אותן פעולות בדיוק, בלי המסכים:
// אותן פונקציות פענוח, אותן בדיקות (validateTalmudImport, סיכומי הקובץ), ואותן
// פונקציות קליטה במסד. שום כלל חדש לא מומצא כאן.
//
// הסדר קבוע: רשימת התלמידים קודם (היא יוצרת תלמידים חסרים - 122), אחריה דרישת
// התשלום (וממנה חישוב העמלות רץ לבד - 124), אחריה הסיבות לאי זכאות, ובסוף הדוחות
// הנלווים (תשלומים למוסד, בג"ץ, הסבר תשלומים).
//
// קובץ נעצר - ונשאר לקליטה ידנית ב"קבצים מתלמוד" - רק כשמשהו לא מסתדר:
//   * הקובץ זוהה כסוג אחר ממה שהדוח אמור להיות
//   * העמותה או החודש בקובץ שונים מאלה שהמשיכה ביקשה
//   * הסכומים או הספירות לא תואמים לסיכום שתלמוד עצמו כתב בקובץ
//   * יש שורות כפולות שדורשות החלטה
// קובץ שכבר נקלט (אותה טביעה) מדולג.

import { supabase } from "./supabase";
import { hashFile, parseImportFile, readFileMatrix } from "./importParsing";
import { detectImportType } from "./importDetection";
import { analyzeFile, checkDuplicateFile, createImportBatch } from "./importBatches";
import { validateTalmudImport } from "./talmudImportValidation";
import { isTalmudEligibilityList, parseTalmudEligibilityList } from "./talmudEligibilityList";
import { STORED_REPORT_KEYS, nonEntitlementToErrorsFile, storedReportRows, type StoredReportKey } from "./talmudReports";

export type AutoImportStatus = "imported" | "skipped" | "blocked" | "failed";

export interface AutoImportResult {
  fileId: string;
  reportLabel: string;
  organization: string;
  month: string | null;
  status: AutoImportStatus;
  detail: string;
}

interface PulledFile {
  id: string;
  organization_id: string;
  legal_name: string;
  report_key: string;
  report_label: string;
  month: string | null;
  file_name: string;
  file_type: string | null;
  file_hash: string;
}

const EXPECTED: Record<string, string> = {
  payment_demand: "talmud_eligibility",
  students_list: "talmud_eligibility_list",
  non_entitlement: "talmud_non_entitlement",
  institute_payments: "talmud_institute_payments",
  bagatz: "talmud_bagatz",
  payment_explanation: "talmud_payment_explanation",
};

const ORDER: Record<string, number> = { students_list: 0, payment_demand: 1, non_entitlement: 2 };
const monthStart = (iso: string | null | undefined) => (iso ? `${iso.slice(0, 7)}-01` : null);
const monthText = (iso: string | null) => (iso ? iso.slice(0, 7).split("-").reverse().join("/") : "");
const errText = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "שגיאה";

class Blocked extends Error {}
class Skipped extends Error {}

/** האם הקליטה האוטומטית מופעלת (הגדרה ב-automation_settings, 124). אין הגדרה - כבויה. */
export async function isTalmudAutoImportEnabled(): Promise<boolean> {
  const { data } = await supabase.from("automation_settings").select("is_enabled").eq("key", "talmud_auto_import").maybeSingle();
  return !!data?.is_enabled;
}

async function downloadPulled(p: PulledFile): Promise<File> {
  const { data, error } = await supabase.rpc("talmud_pulled_file", { p_file_id: p.id });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) throw new Error(error?.message ?? "הקובץ לא נמצא");
  const bytes = Uint8Array.from(atob(row.file_base64), (c) => c.charCodeAt(0));
  return new File([bytes], p.file_name, { type: p.file_type ?? "" });
}

async function checkType(p: PulledFile, file: File) {
  const parsed = await parseImportFile(file);
  const top = detectImportType(parsed.headers, parsed.rows.length).candidates[0];
  const expected = EXPECTED[p.report_key];
  if (!top) throw new Blocked("לא זוהה סוג הקובץ");
  if (expected && top.signature.key !== expected) throw new Blocked(`הקובץ זוהה כ"${top.signature.label}" ולא כמו שהדוח הזה אמור להיות`);
}

async function importStudentsList(p: PulledFile, file: File): Promise<string> {
  const hash = await hashFile(file);
  const { data: existing } = await supabase.from("talmud_eligibility_lists").select("id").eq("file_hash", hash).maybeSingle();
  if (existing) throw new Skipped("כבר נקלט");
  const matrix = await readFileMatrix(file);
  if (!isTalmudEligibilityList(matrix)) throw new Blocked("אינו רשימת תלמידים מתלמוד");
  const parsed = parseTalmudEligibilityList(matrix);
  if (parsed.problems.length) throw new Blocked(parsed.problems.join(" · "));
  const { data: org } = await supabase.from("organizations").select("id").eq("org_number", parsed.orgNumber ?? "").maybeSingle();
  if (!org || org.id !== p.organization_id) throw new Blocked(`מספר העמותה בקובץ (${parsed.orgNumber ?? "—"}) אינו של ${p.legal_name}`);
  if (p.month && parsed.month && monthStart(parsed.month) !== monthStart(p.month)) {
    throw new Blocked(`החודש בקובץ (${monthText(parsed.month)}) שונה מהחודש שנמשך (${monthText(p.month)})`);
  }
  const month = monthStart(parsed.month ?? p.month);
  if (!month) throw new Blocked("לא זוהה חודש בקובץ");
  const { data, error } = await supabase
    .rpc("import_talmud_eligibility_list", {
      p_organization_id: p.organization_id,
      p_month: month,
      p_file_name: file.name,
      p_file_hash: hash,
      p_rows: parsed.rows.map((r) => ({
        branch_code: r.branchCode, external_id: r.externalId, id_type: r.idType, first_name: r.firstName, last_name: r.lastName,
        eligible: r.eligible, study_code: r.studyCode, start_date: r.startDate, end_date: r.endDate, birth_date: r.birthDate,
        marital_status: r.maritalStatus, gender: r.gender, origin: r.origin,
      })),
    })
    .single();
  if (error) throw new Error(error.message);
  const d = data as { eligible_count: number; created_count?: number; updated_count?: number; unmatched_eligible_count: number };
  return `${parsed.rows.length} שורות · ${d.eligible_count} זכאים` +
    (d.created_count ? ` · ${d.created_count} תלמידים חדשים נוצרו` : "") +
    (d.updated_count ? ` · ${d.updated_count} עודכנו` : "");
}

async function importPaymentDemand(p: PulledFile, file: File): Promise<string> {
  if (await checkDuplicateFile(file)) throw new Skipped("כבר נקלט");
  const result = await analyzeFile(file);
  if (!result.talmud) throw new Blocked("אינו דוח דרישת תשלום מתלמוד");
  const report = await validateTalmudImport(result.talmud, result.rows.map((r) => r.raw));
  if (report.blocked) throw new Blocked(report.blockReason ?? "הקובץ לא עבר את הבדיקות");
  if (report.orgId !== p.organization_id) throw new Blocked(`העמותה בקובץ אינה ${p.legal_name}`);
  if (p.month && result.talmud.month && monthStart(result.talmud.month) !== monthStart(p.month)) {
    throw new Blocked(`החודש בקובץ (${monthText(result.talmud.month)}) שונה מהחודש שנמשך (${monthText(p.month)})`);
  }
  const needs = result.rows.filter((r) => r.status === "needs_decision").length;
  if (needs) throw new Blocked(`${needs} שורות כפולות דורשות החלטה - יש לקלוט ידנית`);
  const month = result.talmud.month;
  const { batchId } = await createImportBatch({ file, profileKey: "talmud_eligibility", organizationId: p.organization_id, periodMonth: month }, result.rows);
  const { data, error } = await supabase.rpc("commit_eligibility_batch", { p_batch_id: batchId, p_month: month });
  if (error) throw new Error(error.message);
  const r = (Array.isArray(data) ? data[0] : data) as { matched_count: number; unmatched_count: number };
  return `נקלטו ${r.matched_count} זכאויות` + (r.unmatched_count ? ` · ${r.unmatched_count} לא הותאמו (במרכז החריגות)` : "") + " · העמלות מחושבות אוטומטית";
}

async function importNonEntitlement(p: PulledFile, file: File): Promise<string> {
  const month = monthStart(p.month);
  if (!month) throw new Blocked("לא ידוע החודש של הדוח");
  const errorsFile = await nonEntitlementToErrorsFile(file);
  if (await checkDuplicateFile(errorsFile)) throw new Skipped("כבר נקלט");
  const result = await analyzeFile(errorsFile);
  const needs = result.rows.filter((r) => r.status === "needs_decision").length;
  if (needs) throw new Blocked(`${needs} שורות כפולות דורשות החלטה - יש לקלוט ידנית`);
  if (result.rows.length === 0) throw new Skipped("אין סיבות אי זכאות בחודש הזה");
  const { batchId } = await createImportBatch({ file: errorsFile, profileKey: "talmud_errors", organizationId: p.organization_id, periodMonth: month }, result.rows);
  const { data, error } = await supabase.rpc("commit_errors_batch", { p_batch_id: batchId, p_month: month });
  if (error) throw new Error(error.message);
  const r = (Array.isArray(data) ? data[0] : data) as { matched_count: number; unmatched_count: number };
  return `${r.matched_count} סיבות אי זכאות למרכז השגיאות` + (r.unmatched_count ? ` · ${r.unmatched_count} לא הותאמו לתלמיד` : "");
}

async function importStoredReport(p: PulledFile, file: File, key: StoredReportKey): Promise<string> {
  const month = monthStart(p.month);
  if (!month) throw new Blocked("לא ידוע החודש של הדוח");
  const hash = await hashFile(file);
  const { data: existing } = await supabase.from("talmud_report_imports").select("id").eq("file_hash", hash).maybeSingle();
  if (existing) throw new Skipped("כבר נקלט");
  const parsed = await parseImportFile(file);
  const rows = storedReportRows(key, parsed.rows);
  if (rows.length === 0) throw new Skipped("אין שורות בדוח");
  const { data, error } = await supabase.rpc("import_talmud_report", {
    p_report_key: key, p_organization_id: p.organization_id, p_month: month, p_file_name: file.name, p_file_hash: hash, p_rows: rows,
  });
  if (error) throw new Error(error.message);
  const r = (Array.isArray(data) ? data[0] : data) as { row_count: number };
  return `${r.row_count} שורות נשמרו`;
}

/**
 * קולטת את כל הקבצים שירדו (במשיכה מסוימת, או כל מה שירד) ועוד לא נקלטו.
 * onProgress מקבל כל תוצאה ברגע שהיא מוכנה - כדי שהמסך יראה התקדמות.
 */
export async function autoImportPulledFiles(
  jobId: string | null,
  onProgress?: (r: AutoImportResult) => void,
): Promise<AutoImportResult[]> {
  const { data, error } = await supabase.rpc("talmud_pulled_files_list", { p_job_id: jobId });
  if (error) throw new Error(error.message);
  const seen = new Set<string>();
  const files = ((data ?? []) as PulledFile[])
    .filter((f) => f.report_key !== "study_approval" && EXPECTED[f.report_key] && !seen.has(f.file_hash) && seen.add(f.file_hash))
    .sort((a, b) => (ORDER[a.report_key] ?? 3) - (ORDER[b.report_key] ?? 3));

  const results: AutoImportResult[] = [];
  for (const p of files) {
    const base = { fileId: p.id, reportLabel: p.report_label, organization: p.legal_name, month: p.month };
    let res: AutoImportResult;
    try {
      const file = await downloadPulled(p);
      // דרישת התשלום וסיבות אי הזכאות עוברות תרגום בפענוח שלהן; את הסוג בודקים על המקור
      await checkType(p, file);
      const detail =
        p.report_key === "students_list" ? await importStudentsList(p, file)
        : p.report_key === "payment_demand" ? await importPaymentDemand(p, file)
        : p.report_key === "non_entitlement" ? await importNonEntitlement(p, file)
        : (STORED_REPORT_KEYS as string[]).includes(p.report_key) ? await importStoredReport(p, file, p.report_key as StoredReportKey)
        : (() => { throw new Skipped("סוג דוח שאינו נקלט"); })();
      res = { ...base, status: "imported", detail };
    } catch (e) {
      res = { ...base, status: e instanceof Blocked ? "blocked" : e instanceof Skipped ? "skipped" : "failed", detail: errText(e) };
    }
    results.push(res);
    onProgress?.(res);
  }
  return results;
}
