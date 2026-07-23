import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeftRight, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { parseImportFile, hashFile, isLegacyXls } from "@/lib/importParsing";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { Tabs } from "@/components/Tabs";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";

interface OrgOption {
  id: string;
  legal_name: string;
}

interface BankAccountOption {
  id: string;
  bank_name: string | null;
  account_number_masked: string | null;
}

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

function normalizeBankRow(raw: Record<string, string>): NormalizedBankRow | null {
  const executionDate = parseDate(raw["תאריך ביצוע"] ?? "");
  const amountRaw = (raw["סכום"] ?? "").replace(/[^\d.-]/g, "");
  const amount = Number(amountRaw);
  const directionRaw = (raw["חובה/זכות"] ?? "").trim();
  const direction: Direction | null = directionRaw === "חובה" ? "debit" : directionRaw === "זכות" ? "credit" : null;
  if (!executionDate || !amountRaw || !Number.isFinite(amount) || amount <= 0 || !direction) return null;

  const balanceRaw = (raw["יתרה"] ?? "").replace(/[^\d.-]/g, "");

  return {
    execution_date: executionDate,
    value_date: parseDate(raw["תאריך ערך"] ?? ""),
    direction,
    amount,
    description: (raw["תיאור"] ?? "").trim() || null,
    reference: (raw["אסמכתה"] ?? "").trim() || null,
    operation_type: (raw["סוג פעולה"] ?? "").trim() || null,
    bank_balance_after: balanceRaw ? Number(balanceRaw) : null,
    bank_transaction_id: (raw["מזהה בנק"] ?? "").trim() || null,
  };
}

async function computeFingerprint(accountId: string, row: NormalizedBankRow): Promise<string> {
  if (row.bank_transaction_id) return `bankid:${row.bank_transaction_id}`;
  const raw = [accountId, row.execution_date, row.value_date ?? "", row.direction, row.amount.toFixed(2), row.reference ?? "", row.description ?? ""].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function analyzeBankFile(file: File, accountId: string): Promise<ClassifiedBankRow[]> {
  const parsed = await parseImportFile(file);
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
      rows.push({ rowNumber, raw, normalized: null, fingerprint: null, status: "invalid", errorMessage: "חסרים שדות חובה (תאריך ביצוע / סכום / חובה-זכות)" });
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
  return rows;
}

async function fetchOrgs(): Promise<OrgOption[]> {
  const { data, error } = await supabase.from("organizations").select("id, legal_name").eq("status", "active").order("legal_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchOrgBankAccounts(orgId: string): Promise<BankAccountOption[]> {
  const { data, error } = await supabase
    .from("organization_bank_accounts_view")
    .select("id, bank_name, account_number_masked")
    .eq("organization_id", orgId)
    .eq("is_active", true);
  if (error) throw error;
  return data ?? [];
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

export function BankTransactionsScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canImport } = useHasPermission("bank_import", "perform");
  const { hasPermission: canClassify } = useHasPermission("transaction_classification", "perform");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });
  const typesQuery = useQuery({ queryKey: ["bank-transaction-types-active"], queryFn: fetchTransactionTypes });

  const [orgId, setOrgId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [filter, setFilter] = useState<ClassificationFilter>("all");
  const [previewTab, setPreviewTab] = useState<RowStatus>("valid");

  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ClassifiedBankRow[] | null>(null);
  const [legacyWarning, setLegacyWarning] = useState(false);
  const [duplicateFileId, setDuplicateFileId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewBatchId, setReviewBatchId] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<{ committed_count: number; duplicate_count: number; invalid_count: number } | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  const bankAccountsQuery = useQuery({ queryKey: ["bank-org-accounts", orgId], queryFn: () => fetchOrgBankAccounts(orgId), enabled: !!orgId });
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
      setParsedRows(await analyzeBankFile(selected, accountId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בניתוח הקובץ");
    } finally {
      setAnalyzing(false);
    }
  };

  const submitBatch = async () => {
    if (!file || !parsedRows || !accountId) return;
    setUploading(true);
    setError(null);
    try {
      const hash = await hashFile(file);
      const path = `${accountId}/${crypto.randomUUID()}-${file.name}`;
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
    { key: "ref", header: "אסמכתה", render: (r) => r.reference ?? "—" },
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
      <PageHeader
        title="תנועות בנק"
        description="סיווג תנועה הוא הצעה/קטגוריה בלבד - אינו משנה יתרת קבוצה ללא התאמה עסקית מאושרת (שלב 12)."
        primaryAction={
          orgId &&
          accountId &&
          canImport && (
            <button onClick={() => setShowImport((v) => !v)} className="btn-secondary">
              {showImport ? "סגירה" : "יבוא תנועות"}
            </button>
          )
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 max-w-2xl mb-4">
        <div>
          <label className="field-label">עמותה</label>
          <select
            value={orgId}
            onChange={(e) => {
              setOrgId(e.target.value);
              setAccountId("");
            }}
            className="input-field"
          >
            <option value="">— בחרי —</option>
            {(orgsQuery.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.legal_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">חשבון עמותה</label>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="input-field" disabled={!orgId}>
            <option value="">— בחרי —</option>
            {(bankAccountsQuery.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.bank_name ?? "בנק"} · {a.account_number_masked}
              </option>
            ))}
          </select>
        </div>
      </div>

      {showImport && accountId && !reviewBatchId && (
        <div className="card mb-6 max-w-2xl space-y-4 p-5">
          <p className="text-xs text-slate-500">
            עמודות צפויות (הנחה זמנית עד קבלת פורמט מאושר מהבנק): תאריך ביצוע, תאריך ערך, חובה/זכות, סכום, תיאור, אסמכתה, סוג פעולה, יתרה, מזהה בנק (לא חובה).
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
          {legacyWarning && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>קובץ XLS ישן - מומלץ להמיר ל-XLSX/CSV.</span>
            </div>
          )}
          {error && <ErrorState message={error} />}
          {parsedRows && !duplicateFileId && (
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
            <p className="text-sm font-medium text-slate-900">אצווה נוצרה</p>
            <button onClick={() => setReviewBatchId(null)} className="text-xs text-slate-500 underline">
              חזרה לרשימה
            </button>
          </div>
          {error && <ErrorState message={error} />}
          <button onClick={commit} disabled={committing} className="btn-primary">
            {committing ? "קולטת…" : "קליטת תנועות"}
          </button>
          {commitResult && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-800">
              נקלטו {commitResult.committed_count} תנועות. {commitResult.duplicate_count} כפילויות ו-{commitResult.invalid_count} שגויות לא נכללו.
            </div>
          )}
        </div>
      )}

      {accountId && (
        <>
          <h2 className="mb-2 mt-2 text-sm font-semibold text-slate-700">היסטוריית יבוא</h2>
          <DataTable
            columns={[
              { key: "file", header: "קובץ", render: (b: BatchSummary) => b.file_name },
              { key: "count", header: "שורות", className: "tabular", render: (b: BatchSummary) => b.row_count },
              { key: "valid", header: "תקין / כפילות / שגוי", className: "tabular", render: (b: BatchSummary) => `${b.valid_count} / ${b.duplicate_count} / ${b.invalid_count}` },
              { key: "status", header: "סטטוס", render: (b: BatchSummary) => <StatusBadge severity={b.status === "committed" ? "ok" : "medium"} label={BATCH_STATUS_LABEL[b.status]} /> },
              { key: "date", header: "תאריך", className: "tabular", render: (b: BatchSummary) => new Date(b.created_at).toLocaleDateString("he-IL") },
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
            emptyTitle="אין תנועות"
            emptyIcon={ArrowLeftRight}
          />
        </>
      )}
    </div>
  );
}
