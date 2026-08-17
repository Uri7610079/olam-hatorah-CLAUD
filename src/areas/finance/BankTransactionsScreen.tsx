import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeftRight, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { parseImportFile, hashFile, isLegacyXls } from "@/lib/importParsing";
import { safeStorageKey } from "@/lib/storagePath";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { Tabs } from "@/components/Tabs";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { HeaderRowConfirm } from "@/components/HeaderRowConfirm";

interface TransactionType {
  id: string;
  label_he: string;
}

type Direction = "debit" | "credit";
type RowStatus = "valid" | "duplicate" | "invalid";
type BatchStatus = "uploaded" | "analyzed" | "previewed" | "committed" | "rejected";

interface NormalizedBankRow {
  execution_date: string;
  value_date: string | null;
  direction: Direction;
  amount: number;
  description: string | null;
  reference: string | null;
  operation_type: string | null;
  bank_balance_after: number | null;
  bank_transaction_id: string | null;
}

interface ClassifiedBankRow {
  rowNumber: number;
  raw: Record<string, string>;
  normalized: NormalizedBankRow | null;
  fingerprint: string | null;
  status: RowStatus;
  errorMessage: string | null;
}

interface BatchSummary {
  id: string;
  file_name: string;
  status: BatchStatus;
  row_count: number;
  valid_count: number;
  duplicate_count: number;
  invalid_count: number;
  created_at: string;
}

type ClassificationFilter = "all" | "unclassified" | "suggested";

interface TransactionRow {
  id: string;
  execution_date: string;
  direction: Direction;
  amount: number;
  description: string | null;
  reference: string | null;
  classification_status: "unclassified" | "suggested" | "confirmed";
  suggested_confidence: string | null;
  suggested_reason: string | null;
  suggested_type: { label_he: string } | null;
  confirmed_type: { label_he: string } | null;
}

const DIRECTION_LABEL: Record<Direction, string> = { debit: "חובה", credit: "זכות" };
const CONFIDENCE_LABEL: Record<string, string> = { high: "גבוהה", medium: "בינונית", low: "נמוכה" };
const BATCH_STATUS_LABEL: Record<BatchStatus, string> = { uploaded: "הועלה", analyzed: "נותח", previewed: "נסקר", committed: "נקלט", rejected: "בוטל" };

function parseDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const m = trimmed.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

// הערך הראשון מבין הכותרות שקיים בפועל בשורה. דף חשבון אמיתי מהבנק ופורמט הייצוא
// שלנו משתמשים בשמות שונים לאותו שדה, ולכן כל שדה מחפש את כל החלופות שלו.
function pickField(raw: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = raw[key];
    if (value != null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

function parseAmount(value: string): number | null {
  // מפריד אלפים ("10,000.00") מגיע כך מהבנק - מסירים כל מה שאינו ספרה/נקודה/מינוס.
  const cleaned = value.replace(/[^\d.-]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

// שלושה פורמטים נתמכים:
// 1. פורמט הייצוא שלנו - עמודת "סכום" אחת + עמודת "חובה/זכות" שקובעת כיוון.
// 2. דף חשבון אמיתי מהבנק - שתי עמודות סכום נפרדות, "זכות" ו"חובה", והכיוון נגזר
//    מאיזו מהן מלאה.
// 3. הפלט של הסקרייפר - עמודות באנגלית, עם עמודת direction מפורשת שכבר מכילה
//    debit/credit. זה הפורמט שיורד בפועל לתיקיית הבנק בכל משיכה אוטומטית, והוא
//    לא היה נתמך כלל: הקובץ לא זוהה כתנועות בנק, ואף שורה בו לא נקלטה.
function normalizeBankRow(raw: Record<string, string>): NormalizedBankRow | null {
  const executionDate = parseDate(pickField(raw, ["תאריך ביצוע", "תאריך", "execution_date"]));
  if (!executionDate) return null;

  let amount: number | null = null;
  let direction: Direction | null = null;

  // הסקרייפר נותן כיוון מפורש וסכום חיובי יחיד - הצורה הכי חד-משמעית, ולכן
  // נבדקת ראשונה ולא מנסה להסיק כיוון משום מקום אחר.
  const directionRaw = pickField(raw, ["direction"]).toLowerCase();
  if (directionRaw === "debit" || directionRaw === "credit") {
    const value = parseAmount(pickField(raw, ["amount"]));
    if (value === null) return null;
    return {
      execution_date: executionDate,
      value_date: parseDate(pickField(raw, ["value_date"])),
      direction: directionRaw,
      // הסקרייפר כותב סכום חיובי, אבל אם בכל זאת יגיע סימן - הכיוון כבר ידוע
      // מהעמודה שלו, והסימן רק היה מכשיל את הבדיקה amount > 0 שבהמשך.
      amount: Math.abs(value),
      description: pickField(raw, ["description"]) || null,
      reference: pickField(raw, ["reference"]) || null,
      operation_type: pickField(raw, ["operation_type"]) || null,
      bank_balance_after: parseAmount(pickField(raw, ["bank_balance_after"])),
      bank_transaction_id: pickField(raw, ["bank_transaction_id"]) || null,
    };
  }

  const credit = parseAmount(pickField(raw, ["זכות"]));
  const debit = parseAmount(pickField(raw, ["חובה"]));

  if (credit !== null || debit !== null) {
    // שורה תקינה בדף חשבון ממלאת בדיוק אחת מהשתיים. שתיהן מלאות = שורה שלא ברור
    // מה כיוונה, ועדיף לפסול אותה במפורש מאשר לנחש.
    if (credit !== null && debit !== null) return null;
    direction = credit !== null ? "credit" : "debit";
    amount = credit !== null ? credit : debit;
  } else {
    amount = parseAmount(pickField(raw, ["סכום"]));
    const directionRaw = pickField(raw, ["חובה/זכות"]);
    direction = directionRaw === "חובה" ? "debit" : directionRaw === "זכות" ? "credit" : null;
  }

  if (amount === null || amount <= 0 || !direction) return null;

  const balance = parseAmount(pickField(raw, ["יתרה"]));

  return {
    execution_date: executionDate,
    value_date: parseDate(pickField(raw, ["תאריך ערך"])),
    direction,
    amount,
    description: pickField(raw, ["תיאור"]) || null,
    // הבנק כותב "אסמכתא" (עם א), פורמט הייצוא שלנו "אסמכתה" (עם ה).
    reference: pickField(raw, ["אסמכתה", "אסמכתא"]) || null,
    operation_type: pickField(raw, ["סוג פעולה"]) || null,
    bank_balance_after: balance,
    bank_transaction_id: pickField(raw, ["מזהה בנק"]) || null,
  };
}

// טביעת האצבע שמונעת קליטה כפולה של אותה תנועה.
//
// בעבר, כשהיה מזהה בנק, הוא שימש לבדו כטביעת האצבע - בהנחה שמזהה של הבנק הוא
// ייחודי. ההנחה הזו שקרית: בקובץ אמיתי של פאג"י (122 תנועות) היו רק 27 מזהים
// שונים, ומזהה אחד חזר ב-64 תנועות נפרדות בסכומים 345 עד 205,000 ש"ח. כלומר
// המזהה שפאג"י מחזיר אינו מזהה תנועה אלא משהו אחר. התוצאה הייתה ש-109 מתוך 122
// התנועות היו נדחות בשקט ככפילויות, וכסף אמיתי היה נעלם מהמערכת.
//
// לכן המזהה נכנס לטביעת האצבע יחד עם התאריך, הסכום והכיוון, ולא במקומם:
//   - אותה תנועה שנמשכת פעמיים -> כל השדות זהים -> מזוהה ככפילות, כרצוי.
//   - שתי תנועות שונות עם אותו מזהה -> נבדלות בתאריך/סכום -> שתיהן נשמרות.
// היתרון המקורי נשמר: התיאור לא נכלל, כך שבנק שמשנה ניסוח בין משיכות עדיין
// מזוהה נכון.
async function computeFingerprint(accountId: string, row: NormalizedBankRow): Promise<string> {
  if (row.bank_transaction_id) {
    return `bankid:${row.bank_transaction_id}|${row.execution_date}|${row.direction}|${row.amount.toFixed(2)}`;
  }
  const raw = [accountId, row.execution_date, row.value_date ?? "", row.direction, row.amount.toFixed(2), row.reference ?? "", row.description ?? ""].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface AnalyzeBankFileResult {
  // מספרי החשבון שמופיעים בקובץ עצמו. הסקרייפר כותב account_number בכל שורה,
  // וזה מה שמאפשר לתפוס קובץ שנקלט לחשבון הלא נכון.
  fileAccountNumbers: string[];
  rows: ClassifiedBankRow[];
  headerRowIndex: number;
  headerConfidence: "high" | "low";
  previewRows: string[][];
}

// headerRowIndexOverride: מועבר רק אחרי שהמשתמשת אישרה/בחרה שורת כותרות ידנית דרך
// HeaderRowConfirm (ר' handleFileChange/handleHeaderConfirm למטה) - זה בדיוק המקרה האמיתי
// שחשף את הבאג המקורי: דוח תנועות בנק אמיתי מלקוח הגיע עם 5 שורות כותרת מוסדית/פרטי
// חשבון לפני שורת הכותרות האמיתית ("יתרה", "תאריך ערך" וכו') - הנחת "שורה 1 תמיד כותרות"
// הייתה גורמת לכל השורות לצאת שגויות בשקט.
async function analyzeBankFile(file: File, accountId: string, headerRowIndexOverride?: number): Promise<AnalyzeBankFileResult> {
  const parsed = await parseImportFile(file, headerRowIndexOverride);
  const fileAccountNumbers = [
    ...new Set(parsed.rows.map((r) => (r["account_number"] ?? "").toString().trim()).filter(Boolean)),
  ];
  const { data: existing } = await supabase.from("bank_transactions").select("fingerprint").eq("organization_bank_account_id", accountId);
  const existingSet = new Set((existing ?? []).map((r) => r.fingerprint));
  const seen = new Set<string>();
  const rows: ClassifiedBankRow[] = [];

  for (let i = 0; i < parsed.rows.length; i++) {
    const raw = parsed.rows[i];
    const rowNumber = i + 1;
    const isEmpty = Object.values(raw).every((v) => !(v ?? "").toString().trim());
    if (isEmpty) {
      rows.push({ rowNumber, raw, normalized: null, fingerprint: null, status: "invalid", errorMessage: "שורה ריקה" });
      continue;
    }
    const normalized = normalizeBankRow(raw);
    if (!normalized) {
      rows.push({ rowNumber, raw, normalized: null, fingerprint: null, status: "invalid", errorMessage: "חסרים שדות חובה: תאריך, וסכום עם כיוון (עמודות זכות/חובה, או סכום + חובה-זכות)" });
      continue;
    }
    const fingerprint = await computeFingerprint(accountId, normalized);
    if (existingSet.has(fingerprint) || seen.has(fingerprint)) {
      rows.push({ rowNumber, raw, normalized, fingerprint, status: "duplicate", errorMessage: "תנועה זו כבר קיימת" });
    } else {
      seen.add(fingerprint);
      rows.push({ rowNumber, raw, normalized, fingerprint, status: "valid", errorMessage: null });
    }
  }
  return { rows, fileAccountNumbers, headerRowIndex: parsed.headerRowIndex, headerConfidence: parsed.headerConfidence, previewRows: parsed.previewRows };
}

// ארבע הספרות האחרונות של מספר חשבון. זו כל ההשוואה שאפשר לעשות בלי לחשוף את
// המספר המלא (mask_account_number משאירה בדיוק אותן), וזה מספיק כדי לתפוס קובץ
// של בנק אחד שנקלט לחשבון של בנק אחר.
function lastFour(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/D/g, "");
  return digits.slice(-4);
}

async function fetchSelectedAccount(accountId: string): Promise<{ bank_name: string | null; account_number_masked: string | null } | null> {
  const { data } = await supabase
    .from("organization_bank_accounts_view")
    .select("bank_name, account_number_masked")
    .eq("id", accountId)
    .maybeSingle();
  return data ?? null;
}

async function fetchTransactionTypes(): Promise<TransactionType[]> {
  const { data, error } = await supabase.from("bank_transaction_types").select("id, label_he").eq("is_active", true).order("label_he");
  if (error) throw error;
  return data ?? [];
}

async function fetchBatches(accountId: string): Promise<BatchSummary[]> {
  const { data, error } = await supabase
    .from("bank_import_batches")
    .select("id, file_name, status, row_count, valid_count, duplicate_count, invalid_count, created_at")
    .eq("organization_bank_account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

async function fetchTransactions(accountId: string, filter: ClassificationFilter): Promise<TransactionRow[]> {
  let query = supabase
    .from("bank_transactions")
    .select(
      "id, execution_date, direction, amount, description, reference, classification_status, suggested_confidence, suggested_reason, suggested_type:bank_transaction_types!bank_transactions_suggested_type_id_fkey(label_he), confirmed_type:bank_transaction_types!bank_transactions_confirmed_type_id_fkey(label_he)",
    )
    .eq("organization_bank_account_id", accountId)
    .order("execution_date", { ascending: false });
  if (filter === "unclassified") query = query.eq("classification_status", "unclassified");
  if (filter === "suggested") query = query.eq("classification_status", "suggested");
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    ...r,
    suggested_type: Array.isArray(r.suggested_type) ? (r.suggested_type[0] ?? null) : r.suggested_type,
    confirmed_type: Array.isArray(r.confirmed_type) ? (r.confirmed_type[0] ?? null) : r.confirmed_type,
  }));
}

// accountId מגיע מהמסך המאחד (BankScreen.tsx) - אין כאן יותר בורר עמותה/חשבון עצמאי,
// כדי שלא יצטרכו לבחור את אותו חשבון פעם נוספת אחרי שכבר נבחר למעלה.
// initialFile (לא חובה) מגיע מלשונית "זיהוי אוטומטי" במרכז היבוא, דרך BankImportPanel.
export function BankTransactionsPanel({ accountId, initialFile }: { accountId: string; initialFile?: File | null }) {
  const queryClient = useQueryClient();
  const { hasPermission: canImport } = useHasPermission("bank_import", "perform");
  const { hasPermission: canClassify } = useHasPermission("transaction_classification", "perform");
  const typesQuery = useQuery({ queryKey: ["bank-transaction-types-active"], queryFn: fetchTransactionTypes });

  const [showImport, setShowImport] = useState(false);
  // אזהרת אי-התאמה בין החשבון שנבחר לבין החשבון שבקובץ. אזהרה ולא חסימה: יש
  // קבצים בלי עמודת חשבון בכלל, ויש מקרים שבהם המספר בקובץ כתוב אחרת (עם/בלי
  // ספרת ביקורת). ההחלטה נשארת של המשתמשת - רק שתהיה מודעת.
  const [accountMismatch, setAccountMismatch] = useState<string[] | null>(null);
  // ביטול יבוא - תמיד עם תצוגה מקדימה, כי זו מחיקת תנועות אמת. תנועה שכבר
  // משתתפת בהתאמה בנקאית לא נמחקת, והמסך אומר זאת במפורש.
  const [rollbackBatch, setRollbackBatch] = useState<{ id: string; fileName: string } | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackResult, setRollbackResult] = useState<{ deleted: number; kept: number } | null>(null);
  const rollbackPreviewQuery = useQuery({
    queryKey: ["bank-rollback-preview", rollbackBatch?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("preview_bank_import_rollback", { p_batch_id: rollbackBatch!.id });
      if (error) throw error;
      return (data ?? []) as { transaction_id: string; will_delete: boolean; block_reason: string | null }[];
    },
    enabled: !!rollbackBatch,
  });

  const doRollback = async () => {
    if (!rollbackBatch) return;
    setRollingBack(true);
    const { data, error: err } = await supabase.rpc("rollback_bank_import_batch", { p_batch_id: rollbackBatch.id }).single();
    setRollingBack(false);
    if (err) {
      setError(err.message);
      return;
    }
    const r = data as { deleted_count: number; kept_count: number };
    setRollbackResult({ deleted: r.deleted_count, kept: r.kept_count });
    setRollbackBatch(null);
    queryClient.invalidateQueries({ queryKey: ["bank-batches", accountId] });
    queryClient.invalidateQueries({ queryKey: ["bank-transactions", accountId] });
  };
  const selectedAccountQuery = useQuery({
    queryKey: ["bank-selected-account", accountId],
    queryFn: () => fetchSelectedAccount(accountId),
    enabled: !!accountId,
  });
  const [filter, setFilter] = useState<ClassificationFilter>("all");
  const [previewTab, setPreviewTab] = useState<RowStatus>("valid");

  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ClassifiedBankRow[] | null>(null);
  const [legacyWarning, setLegacyWarning] = useState(false);
  const [duplicateFileId, setDuplicateFileId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [headerConfirm, setHeaderConfirm] = useState<{ file: File; previewRows: string[][]; detectedIndex: number } | null>(null);
  const [reviewBatchId, setReviewBatchId] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<{ committed_count: number; duplicate_count: number; invalid_count: number } | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  const batchesQuery = useQuery({ queryKey: ["bank-import-batches", accountId], queryFn: () => fetchBatches(accountId), enabled: !!accountId });
  const transactionsQuery = useQuery({
    queryKey: ["bank-transactions", accountId, filter],
    queryFn: () => fetchTransactions(accountId, filter),
    enabled: !!accountId,
  });

  const resetForm = () => {
    setFile(null);
    setParsedRows(null);
    setLegacyWarning(false);
    setDuplicateFileId(null);
    setError(null);
    setHeaderConfirm(null);
    setAccountMismatch(null);
  };

  const handleFileChange = async (selected: File | null) => {
    resetForm();
    if (!selected || !accountId) return;
    setFile(selected);
    setAnalyzing(true);
    try {
      const hash = await hashFile(selected);
      const { data: existingBatch } = await supabase.from("bank_import_batches").select("id").eq("file_hash", hash).maybeSingle();
      if (existingBatch) {
        setDuplicateFileId(existingBatch.id);
        return;
      }
      setLegacyWarning(isLegacyXls(selected));
      const result = await analyzeBankFile(selected, accountId);
      if (result.headerConfidence === "low") {
        setHeaderConfirm({ file: selected, previewRows: result.previewRows, detectedIndex: result.headerRowIndex });
        return;
      }
      setParsedRows(result.rows);
      setAccountMismatch(checkAccountMismatch(result.fileAccountNumbers));
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בניתוח הקובץ");
    } finally {
      setAnalyzing(false);
    }
  };

  // קובץ שהועבר מהזיהוי האוטומטי נכנס לניתוח בדיוק כמו קובץ שנבחר ידנית, כולל פתיחת אזור
  // היבוא כדי שהתצוגה המקדימה תהיה גלויה. הניתוח כאן דורש חשבון בנק נבחר (ר' handleFileChange),
  // ולכן אם עוד לא נבחר - הקובץ ממתין ומנותח מיד כשהוא נבחר.
  useEffect(() => {
    if (!initialFile || !accountId) return;
    setShowImport(true);
    void handleFileChange(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile, accountId]);

  // מחזירה את מספרי החשבון שבקובץ אם אף אחד מהם אינו החשבון הנבחר, אחרת null.
  // קובץ בלי עמודת חשבון (דף חשבון ידני) מחזיר null - אין על מה להתריע.
  const checkAccountMismatch = (fileAccounts: string[]): string[] | null => {
    const selected = lastFour(selectedAccountQuery.data?.account_number_masked);
    if (!selected || fileAccounts.length === 0) return null;
    const matches = fileAccounts.some((a) => lastFour(a) === selected);
    return matches ? null : fileAccounts;
  };

  const handleHeaderConfirm = async (chosenIndex: number) => {
    if (!headerConfirm || !accountId) return;
    const chosenFile = headerConfirm.file;
    setHeaderConfirm(null);
    setAnalyzing(true);
    try {
      const result = await analyzeBankFile(chosenFile, accountId, chosenIndex);
      setParsedRows(result.rows);
      setAccountMismatch(checkAccountMismatch(result.fileAccountNumbers));
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בניתוח הקובץ");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleHeaderCancel = () => {
    setHeaderConfirm(null);
    resetForm();
  };

  const submitBatch = async () => {
    if (!file || !parsedRows || !accountId) return;
    setUploading(true);
    setError(null);
    try {
      const hash = await hashFile(file);
      const path = `${accountId}/${safeStorageKey(file.name)}`;
      const { error: uploadError } = await supabase.storage.from("bank-import-files").upload(path, file);
      if (uploadError) throw new Error(`העלאת הקובץ נכשלה: ${uploadError.message}`);

      const profile = await supabase.from("bank_import_profiles").select("id").eq("key", "bank_generic").single();
      if (!profile.data) throw new Error("פרופיל יבוא בנקאי לא נמצא");

      const { data: batch, error: batchError } = await supabase
        .from("bank_import_batches")
        .insert({
          organization_bank_account_id: accountId,
          profile_id: profile.data.id,
          file_path: path,
          file_name: file.name,
          row_count: parsedRows.length,
          file_hash: hash,
        })
        .select("id")
        .single();
      if (batchError) throw new Error(batchError.message);

      const rowsPayload = parsedRows.map((r) => ({
        batch_id: batch.id,
        row_number: r.rowNumber,
        raw: r.raw,
        normalized: r.normalized,
        fingerprint: r.fingerprint,
        status: r.status,
        error_message: r.errorMessage,
      }));
      const { error: rowsError } = await supabase.from("bank_import_rows").insert(rowsPayload);
      if (rowsError) throw new Error(rowsError.message);

      resetForm();
      queryClient.invalidateQueries({ queryKey: ["bank-import-batches", accountId] });
      setReviewBatchId(batch.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה לא צפויה");
    } finally {
      setUploading(false);
    }
  };

  const commit = async () => {
    if (!reviewBatchId) return;
    setCommitting(true);
    setError(null);
    const { data, error: commitError } = await supabase.rpc("commit_bank_import_batch", { p_batch_id: reviewBatchId }).single();
    setCommitting(false);
    if (commitError) {
      setError(commitError.message);
      return;
    }
    setCommitResult(data as any);
    queryClient.invalidateQueries({ queryKey: ["bank-import-batches", accountId] });
    queryClient.invalidateQueries({ queryKey: ["bank-transactions", accountId] });
  };

  const runSuggestions = async () => {
    if (!accountId) return;
    setSuggesting(true);
    setError(null);
    const { error: err } = await supabase.rpc("suggest_transaction_types", { p_organization_bank_account_id: accountId });
    setSuggesting(false);
    if (err) {
      setError(err.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["bank-transactions", accountId] });
  };

  const confirmType = async (transactionId: string, typeId: string) => {
    if (!typeId) return;
    await supabase.rpc("confirm_transaction_type", { p_transaction_id: transactionId, p_type_id: typeId });
    queryClient.invalidateQueries({ queryKey: ["bank-transactions", accountId] });
  };

  const localValid = (parsedRows ?? []).filter((r) => r.status === "valid");
  const localDuplicate = (parsedRows ?? []).filter((r) => r.status === "duplicate");
  const localInvalid = (parsedRows ?? []).filter((r) => r.status === "invalid");

  const localColumns: DataTableColumn<ClassifiedBankRow>[] = [
    { key: "num", header: "#", className: "tabular", render: (r) => r.rowNumber },
    { key: "date", header: "תאריך", className: "tabular", render: (r) => r.normalized?.execution_date ?? "—" },
    { key: "direction", header: "צד", render: (r) => (r.normalized ? DIRECTION_LABEL[r.normalized.direction] : "—") },
    { key: "amount", header: "סכום", className: "tabular", render: (r) => r.normalized?.amount.toLocaleString("he-IL") ?? "—" },
    { key: "desc", header: "תיאור", render: (r) => r.normalized?.description ?? "—" },
    { key: "note", header: "הערה", render: (r) => r.errorMessage ?? "—" },
  ];

  const transactionColumns: DataTableColumn<TransactionRow>[] = [
    { key: "date", header: "תאריך", className: "tabular", render: (r) => r.execution_date },
    { key: "direction", header: "צד", render: (r) => DIRECTION_LABEL[r.direction] },
    { key: "amount", header: "סכום", className: "tabular", render: (r) => r.amount.toLocaleString("he-IL") },
    { key: "desc", header: "תיאור", render: (r) => r.description ?? "—" },
    { key: "ref", header: "אסמכתה", className: "ltr-num", render: (r) => r.reference ?? "—" },
    {
      key: "suggested",
      header: "הצעת סיווג",
      render: (r) =>
        r.suggested_type ? (
          <span>
            {r.suggested_type.label_he} · {CONFIDENCE_LABEL[r.suggested_confidence ?? ""] ?? r.suggested_confidence}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "confirmed",
      header: "סיווג מאושר",
      render: (r) =>
        r.confirmed_type ? (
          <StatusBadge severity="ok" label={r.confirmed_type.label_he} />
        ) : canClassify ? (
          <select
            defaultValue={r.suggested_type ? "" : ""}
            onChange={(e) => confirmType(r.id, e.target.value)}
            className="input-field text-xs"
          >
            <option value="">— בחרי סוג —</option>
            {(typesQuery.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.label_he}
              </option>
            ))}
          </select>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs text-ink-subtle max-w-2xl">
          סיווג תנועה הוא הצעה/קטגוריה בלבד - אינו משנה יתרת קבוצה ללא התאמה עסקית מאושרת (שלב 12).
        </p>
        {accountId && canImport && (
          <button onClick={() => setShowImport((v) => !v)} className="btn-secondary shrink-0">
            {showImport ? "סגירה" : "יבוא תנועות"}
          </button>
        )}
      </div>

      {showImport && accountId && !reviewBatchId && (
        <div className="card mb-6 max-w-2xl space-y-4 p-5">
          <p className="text-xs text-ink-subtle">
            שלושה פורמטים נתמכים, והמערכת מזהה לבד באיזה מהם מדובר:
            <br />
            <span className="font-medium">פלט הסקרייפר</span> - הקובץ שיורד לתיקיית הבנק, עם עמודות באנגלית
            (execution_date, direction, amount…). לא צריך לגעת בו.
            <br />
            <span className="font-medium">דף חשבון מהבנק</span> - תאריך, זכות, חובה, יתרה.
            <br />
            <span className="font-medium">פורמט הייצוא של המערכת</span> - תאריך ביצוע, סכום, חובה/זכות, תיאור, אסמכתה.
          </p>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)} className="input-field" />
          {analyzing && <LoadingState rows={2} />}
          {duplicateFileId && (
            <div className="space-y-2">
              <ErrorState message="הקובץ הזה כבר יובא בעבר." />
              <button onClick={() => setReviewBatchId(duplicateFileId)} className="link-action text-xs">
                פתיחת האצווה הקיימת
              </button>
            </div>
          )}
          {accountMismatch && (
            <div className="flex items-start gap-2 rounded-control border border-warn bg-warn-soft p-3 text-sm text-warn-ink">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">הקובץ הזה שייך לחשבון אחר</p>
                <p className="mt-1">
                  בקובץ מופיע חשבון{" "}
                  <span className="font-medium ltr-num">{accountMismatch.join(", ")}</span>, והחשבון שנבחר הוא{" "}
                  <span className="font-medium">
                    {selectedAccountQuery.data?.bank_name} <span className="ltr-num">{selectedAccountQuery.data?.account_number_masked}</span>
                  </span>
                  . קליטה תשייך את התנועות לחשבון שנבחר - בדקי שזה מה שהתכוונת.
                </p>
              </div>
            </div>
          )}

          {legacyWarning && (
            <div className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn-soft p-3 text-sm text-warn-ink">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>קובץ XLS ישן - מומלץ להמיר ל-XLSX/CSV.</span>
            </div>
          )}
          {error && <ErrorState message={error} />}
          {headerConfirm && !duplicateFileId && (
            <HeaderRowConfirm
              previewRows={headerConfirm.previewRows}
              detectedIndex={headerConfirm.detectedIndex}
              onConfirm={handleHeaderConfirm}
              onCancel={handleHeaderCancel}
            />
          )}
          {parsedRows && !duplicateFileId && !headerConfirm && (
            <>
              <Tabs
                tabs={[
                  { key: "valid", label: "תקין", badge: localValid.length },
                  { key: "duplicate", label: "כפילות", badge: localDuplicate.length },
                  { key: "invalid", label: "שגוי", badge: localInvalid.length },
                ]}
                activeTab={previewTab}
                onChange={setPreviewTab}
                ariaLabel="תצוגה מקדימה"
              />
              <DataTable
                columns={localColumns}
                rows={previewTab === "valid" ? localValid : previewTab === "duplicate" ? localDuplicate : localInvalid}
                rowKey={(r) => String(r.rowNumber)}
                emptyTitle="אין שורות"
              />
              <button onClick={submitBatch} disabled={uploading || localValid.length === 0} className="btn-primary flex items-center gap-2">
                <Upload className="h-4 w-4" aria-hidden="true" />
                {uploading ? "מעלה…" : "אישור ויצירת אצווה"}
              </button>
            </>
          )}
        </div>
      )}

      {reviewBatchId && (
        <div className="card mb-6 max-w-3xl space-y-4 p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-ink">אצווה נוצרה</p>
            <button onClick={() => setReviewBatchId(null)} className="text-xs text-ink-subtle underline">
              חזרה לרשימה
            </button>
          </div>
          {error && <ErrorState message={error} />}
          <button onClick={commit} disabled={committing} className="btn-primary">
            {committing ? "קולטת…" : "קליטת תנועות"}
          </button>
          {commitResult && (
            <div className="rounded-md bg-ok-soft p-3 text-sm text-ok-ink">
              נקלטו <span className="tabular">{commitResult.committed_count}</span> תנועות. <span className="tabular">{commitResult.duplicate_count}</span> כפילויות ו-
              <span className="tabular">{commitResult.invalid_count}</span> שגויות לא נכללו.
            </div>
          )}
        </div>
      )}

      {accountId && (
        <>
          {rollbackResult && (
            <div className="mb-3 rounded-control border border-line bg-surface-muted p-3 text-sm text-ink-muted">
              בוטלו {rollbackResult.deleted} תנועות.
              {rollbackResult.kept > 0 && ` ${rollbackResult.kept} נשמרו כי הן משתתפות בהתאמה בנקאית.`}
            </div>
          )}

          {rollbackBatch && (
            <div className="card mb-3 space-y-3 border-danger bg-danger-soft p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
                <div className="text-sm text-ink">
                  <p className="font-semibold">ביטול יבוא: {rollbackBatch.fileName}</p>
                  <p className="mt-1">
                    התנועות שנקלטו ביבוא הזה יימחקו. תנועה שכבר משתתפת בהתאמה בנקאית לא תימחק.
                  </p>
                  <p className="mt-2 font-semibold">
                    {(rollbackPreviewQuery.data ?? []).filter((r) => r.will_delete).length} תנועות יימחקו
                    {(rollbackPreviewQuery.data ?? []).some((r) => !r.will_delete) &&
                      `, ${(rollbackPreviewQuery.data ?? []).filter((r) => !r.will_delete).length} יישמרו`}
                    .
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={doRollback} disabled={rollingBack} className="btn-danger text-xs">
                  {rollingBack ? "מבטל…" : "אישור ביטול"}
                </button>
                <button onClick={() => setRollbackBatch(null)} className="btn-secondary text-xs">
                  ביטול
                </button>
              </div>
            </div>
          )}

          <h2 className="mb-2 mt-2 text-sm font-semibold text-ink-muted">היסטוריית יבוא</h2>
          <DataTable
            columns={[
              { key: "file", header: "קובץ", render: (b: BatchSummary) => b.file_name },
              { key: "count", header: "שורות", className: "tabular", render: (b: BatchSummary) => b.row_count },
              { key: "valid", header: "תקין / כפילות / שגוי", className: "tabular ltr-num", render: (b: BatchSummary) => `${b.valid_count} / ${b.duplicate_count} / ${b.invalid_count}` },
              { key: "status", header: "סטטוס", render: (b: BatchSummary) => <StatusBadge severity={b.status === "committed" ? "ok" : "medium"} label={BATCH_STATUS_LABEL[b.status]} /> },
              { key: "date", header: "תאריך", className: "tabular", render: (b: BatchSummary) => new Date(b.created_at).toLocaleDateString("he-IL") },
              {
                key: "rollback",
                header: "",
                render: (b: BatchSummary) =>
                  b.status === "committed" && canImport ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setRollbackBatch({ id: b.id, fileName: b.file_name });
                      }}
                      className="text-xs text-danger underline"
                    >
                      ביטול יבוא
                    </button>
                  ) : (
                    <span className="text-ink-subtle">—</span>
                  ),
              },
            ]}
            rows={batchesQuery.data ?? []}
            rowKey={(b: BatchSummary) => b.id}
            loading={batchesQuery.isLoading}
            emptyTitle="אין עדיין יבואים"
            onRowClick={(b: BatchSummary) => (b.status !== "committed" ? setReviewBatchId(b.id) : undefined)}
          />

          <div className="mt-6 flex items-center justify-between">
            <Tabs
              tabs={[
                { key: "all", label: "כל התנועות" },
                { key: "unclassified", label: "לא מזוהות" },
                { key: "suggested", label: "ממתינות לאישור" },
              ]}
              activeTab={filter}
              onChange={(k) => setFilter(k)}
              ariaLabel="סינון תנועות"
            />
            {canClassify && (
              <button onClick={runSuggestions} disabled={suggesting} className="btn-secondary flex items-center gap-2 text-xs">
                <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
                {suggesting ? "מריצה…" : "הרצת הצעות סיווג"}
              </button>
            )}
          </div>

          <DataTable
            columns={transactionColumns}
            rows={transactionsQuery.data ?? []}
            rowKey={(r) => r.id}
            loading={transactionsQuery.isLoading}
            emptyTitle="אין עדיין תנועות בחשבון הזה"
            emptyDescription={
              canImport
                ? 'כדי לקלוט תנועות: לחצי על "יבוא תנועות" בראש המסך, ובחרי את הקובץ שירד מהבנק.'
                : undefined
            }
            emptyIcon={ArrowLeftRight}
          />
        </>
      )}
    </div>
  );
}
