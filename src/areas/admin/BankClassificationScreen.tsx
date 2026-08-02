import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, ScanSearch, Tags, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import type { ClassifiedRow } from "@/lib/importParsing";
import { analyzeFile, checkDuplicateFile, legacyXlsWarning, createImportBatch, fetchImportBatchRows, resolveImportRow, type StoredImportRow } from "@/lib/importBatches";
import { exportRowsToExcel } from "@/lib/reportExport";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ImportPreviewTabs } from "@/components/ImportPreviewTabs";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { Tabs } from "@/components/Tabs";
import { HeaderRowConfirm } from "@/components/HeaderRowConfirm";

interface TransactionTypeRow {
  id: string;
  code: string;
  label_he: string;
  is_active: boolean;
}

async function fetchTypes(): Promise<TransactionTypeRow[]> {
  const { data, error } = await supabase.from("bank_transaction_types").select("id, code, label_he, is_active").order("label_he");
  if (error) throw error;
  return data ?? [];
}

const EMPTY_TYPE_FORM = { code: "", label_he: "" };

// --- יבוא מאקסל (משותף לשני הטאבים במסך הזה) --------------------------------------------
// פאנל גנרי אחד על גבי מנוע היבוא הכללי (analyzeFile/createImportBatch/ImportPreviewTabs -
// אותו דפוס בדיוק כמו EligibilityImportPanel/AuditsScreen), מוזן ע"י profileKey+commitRpc
// כך ששני הטאבים (סוגי תנועה - פשוט; כללי זיהוי - עשיר יותר) חולקים את אותו קוד תצוגה
// בלי כפילות. אין כאן בורר עמותה/חודש - שני הפרופילים האלה גלובליים לגמרי, לא מוגבלים לעמותה.
type GenericBatchStatus = "uploaded" | "analyzed" | "previewed" | "committed" | "rejected";
const OPEN_STATUSES: GenericBatchStatus[] = ["uploaded", "analyzed", "previewed"];
const BATCH_STATUS_LABEL: Record<GenericBatchStatus, string> = {
  uploaded: "הועלה",
  analyzed: "נותח",
  previewed: "נסקר",
  committed: "נקלט",
  rejected: "בוטל",
};

interface GenericBatchSummary {
  id: string;
  file_name: string;
  status: GenericBatchStatus;
}

async function fetchGenericBatch(id: string): Promise<GenericBatchSummary> {
  const { data, error } = await supabase.from("import_batches").select("id, file_name, status").eq("id", id).single();
  if (error) throw error;
  return data;
}

interface BankCatalogImportPanelProps {
  profileKey: string;
  commitRpc: string;
  columnsHint: string;
  onCommitted: () => void;
}

function BankCatalogImportPanel({ profileKey, commitRpc, columnsHint, onCommitted }: BankCatalogImportPanelProps) {
  const queryClient = useQueryClient();
  const [showImport, setShowImport] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ClassifiedRow[] | null>(null);
  const [legacyWarning, setLegacyWarning] = useState(false);
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [headerConfirm, setHeaderConfirm] = useState<{ file: File; previewRows: string[][]; detectedIndex: number } | null>(null);

  const [reviewBatchId, setReviewBatchId] = useState<string | null>(null);
  const [resolvingRow, setResolvingRow] = useState<number | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<{ created: number; invalid: number } | null>(null);

  const reviewBatchQuery = useQuery({
    queryKey: ["bank-catalog-import-batch", profileKey, reviewBatchId],
    queryFn: () => fetchGenericBatch(reviewBatchId!),
    enabled: !!reviewBatchId,
  });
  const reviewRowsQuery = useQuery({
    queryKey: ["bank-catalog-import-batch-rows", profileKey, reviewBatchId],
    queryFn: () => fetchImportBatchRows(reviewBatchId!),
    enabled: !!reviewBatchId,
  });

  const resetForm = () => {
    setFile(null);
    setParsedRows(null);
    setLegacyWarning(false);
    setDuplicateId(null);
    setError(null);
    setHeaderConfirm(null);
  };

  const closeImport = () => {
    setShowImport(false);
    setReviewBatchId(null);
    resetForm();
  };

  const handleFileChange = async (selected: File | null) => {
    resetForm();
    if (!selected) return;
    setFile(selected);
    setAnalyzing(true);
    try {
      const existing = await checkDuplicateFile(selected);
      if (existing) {
        setDuplicateId(existing);
        return;
      }
      setLegacyWarning(legacyXlsWarning(selected));
      const result = await analyzeFile(selected);
      if (result.headerConfidence === "low") {
        setHeaderConfirm({ file: selected, previewRows: result.previewRows, detectedIndex: result.headerRowIndex });
        return;
      }
      setParsedRows(result.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בניתוח הקובץ");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleHeaderConfirm = async (chosenIndex: number) => {
    if (!headerConfirm) return;
    const chosenFile = headerConfirm.file;
    setHeaderConfirm(null);
    setAnalyzing(true);
    try {
      const result = await analyzeFile(chosenFile, chosenIndex);
      setParsedRows(result.rows);
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
    if (!file || !parsedRows) return;
    setUploading(true);
    setError(null);
    try {
      const { batchId } = await createImportBatch({ file, profileKey }, parsedRows);
      resetForm();
      setReviewBatchId(batchId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה לא צפויה");
    } finally {
      setUploading(false);
    }
  };

  const resolveRow = async (rowNumber: number, status: "valid" | "invalid") => {
    if (!reviewBatchId) return;
    setResolvingRow(rowNumber);
    await resolveImportRow(reviewBatchId, rowNumber, status);
    setResolvingRow(null);
    queryClient.invalidateQueries({ queryKey: ["bank-catalog-import-batch-rows", profileKey, reviewBatchId] });
  };

  const commit = async () => {
    if (!reviewBatchId) return;
    setCommitting(true);
    setError(null);
    const { data, error: commitError } = await supabase.rpc(commitRpc, { p_batch_id: reviewBatchId }).single();
    setCommitting(false);
    if (commitError) {
      setError(commitError.message);
      return;
    }
    setCommitResult({ created: (data as any).created_count, invalid: (data as any).invalid_count });
    queryClient.invalidateQueries({ queryKey: ["bank-catalog-import-batch", profileKey, reviewBatchId] });
    queryClient.invalidateQueries({ queryKey: ["bank-catalog-import-batch-rows", profileKey, reviewBatchId] });
    onCommitted();
  };

  const localValid = (parsedRows ?? []).filter((r) => r.status === "valid");
  const localNeeds = (parsedRows ?? []).filter((r) => r.status === "needs_decision");
  const localInvalid = (parsedRows ?? []).filter((r) => r.status === "invalid");

  const storedRows = reviewRowsQuery.data ?? [];
  const storedValid = storedRows.filter((r) => r.status === "valid" || r.status === "committed");
  const storedNeeds = storedRows.filter((r) => r.status === "needs_decision");
  const storedInvalid = storedRows.filter((r) => r.status === "invalid");
  const reviewIsOpen = reviewBatchQuery.data ? OPEN_STATUSES.includes(reviewBatchQuery.data.status) : false;

  const localCols: DataTableColumn<ClassifiedRow>[] = [
    { key: "num", header: "#", className: "tabular", render: (r) => r.rowNumber },
    { key: "content", header: "תוכן", render: (r) => <span className="text-xs">{JSON.stringify(r.raw)}</span> },
    { key: "note", header: "הערה", render: (r) => r.errorMessage ?? "—" },
  ];

  const storedCols = (allowResolve: boolean): DataTableColumn<StoredImportRow>[] => [
    { key: "num", header: "#", className: "tabular", render: (r) => r.row_number },
    { key: "content", header: "תוכן", render: (r) => <span className="text-xs">{JSON.stringify(r.raw)}</span> },
    { key: "note", header: "הערה", render: (r) => r.error_message ?? "—" },
    ...(allowResolve
      ? [
          {
            key: "actions",
            header: "",
            render: (r: StoredImportRow) => (
              <div className="flex gap-2">
                <button disabled={resolvingRow === r.row_number} onClick={() => resolveRow(r.row_number, "valid")} className="link-action text-xs disabled:opacity-50">
                  סמן תקין
                </button>
                <button disabled={resolvingRow === r.row_number} onClick={() => resolveRow(r.row_number, "invalid")} className="text-xs text-danger underline hover:text-danger-ink disabled:opacity-50">
                  סמן שגוי
                </button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="card max-w-3xl space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-lg text-xs text-ink-subtle">{columnsHint}</p>
        <button onClick={() => (showImport ? closeImport() : setShowImport(true))} className="btn-secondary flex items-center gap-2 text-xs">
          <Upload className="h-3.5 w-3.5" aria-hidden="true" />
          {showImport ? "סגירה" : "יבוא מאקסל"}
        </button>
      </div>

      {showImport && !reviewBatchId && (
        <div className="space-y-3 border-t border-line pt-3">
          <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)} className="input-field" />
          {analyzing && <LoadingState rows={2} />}
          {duplicateId && (
            <div className="space-y-2">
              <ErrorState message="הקובץ הזה כבר יובא בעבר." />
              <button onClick={() => setReviewBatchId(duplicateId)} className="link-action text-xs">
                פתיחת האצווה הקיימת
              </button>
            </div>
          )}
          {legacyWarning && (
            <div className="flex items-start gap-2 rounded-control border border-warn/30 bg-warn-soft p-3 text-sm text-warn-ink">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>קובץ XLS ישן - מומלץ להמיר ל-XLSX/CSV.</span>
            </div>
          )}
          {error && <ErrorState message={error} />}
          {headerConfirm && !duplicateId && (
            <HeaderRowConfirm
              previewRows={headerConfirm.previewRows}
              detectedIndex={headerConfirm.detectedIndex}
              onConfirm={handleHeaderConfirm}
              onCancel={handleHeaderCancel}
            />
          )}
          {parsedRows && !duplicateId && !headerConfirm && (
            <>
              <ImportPreviewTabs validCount={localValid.length} needsDecisionCount={localNeeds.length} invalidCount={localInvalid.length}>
                {(tab) => {
                  const data = tab === "valid" ? localValid : tab === "needsDecision" ? localNeeds : localInvalid;
                  return <DataTable columns={localCols} rows={data} rowKey={(r) => String(r.rowNumber)} emptyTitle="אין שורות" />;
                }}
              </ImportPreviewTabs>
              <button onClick={submitBatch} disabled={uploading} className="btn-primary flex items-center gap-2">
                <Upload className="h-4 w-4" aria-hidden="true" />
                {uploading ? "מעלה…" : "אישור ויצירת אצווה"}
              </button>
            </>
          )}
        </div>
      )}

      {reviewBatchId && (
        <div className="space-y-3 border-t border-line pt-3">
          {reviewBatchQuery.isLoading || reviewRowsQuery.isLoading ? (
            <LoadingState rows={3} />
          ) : reviewBatchQuery.data ? (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-ink">{reviewBatchQuery.data.file_name}</p>
                <StatusBadge
                  severity={reviewBatchQuery.data.status === "committed" ? "ok" : reviewBatchQuery.data.status === "rejected" ? "neutral" : "medium"}
                  label={BATCH_STATUS_LABEL[reviewBatchQuery.data.status]}
                />
              </div>

              {reviewIsOpen && <p className="text-sm text-ink-muted">פתרו שורות "דורש החלטה" ואז קלטו את הקובץ (שורות "שגוי" יידחו - ר' הודעת השגיאה לכל שורה).</p>}

              <ImportPreviewTabs validCount={storedValid.length} needsDecisionCount={storedNeeds.length} invalidCount={storedInvalid.length}>
                {(tab) => {
                  const data = tab === "valid" ? storedValid : tab === "needsDecision" ? storedNeeds : storedInvalid;
                  return <DataTable columns={storedCols(reviewIsOpen && tab !== "valid")} rows={data} rowKey={(r) => String(r.row_number)} emptyTitle="אין שורות" />;
                }}
              </ImportPreviewTabs>

              {error && <ErrorState message={error} />}

              {reviewIsOpen && (
                <button onClick={commit} disabled={committing} className="btn-primary">
                  {committing ? "קולטת…" : "קליטת הקובץ"}
                </button>
              )}
              <button onClick={closeImport} className="text-xs text-ink-subtle underline">
                סגירה
              </button>
            </>
          ) : (
            <ErrorState message="האצווה לא נמצאה." />
          )}
        </div>
      )}

      {commitResult && (
        <div className="rounded-control bg-ok-soft p-3 text-sm text-ok-ink">
          נקלטו {commitResult.created} רשומות.
          {commitResult.invalid > 0 && ` ${commitResult.invalid} שורות נדחו - ר' הודעת שגיאה לכל שורה בתצוגה המקדימה למעלה.`}
        </div>
      )}
    </div>
  );
}

function TransactionTypesPanel() {
  const queryClient = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("transaction_classification", "perform");
  const query = useQuery({ queryKey: ["bank-transaction-types"], queryFn: fetchTypes });

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_TYPE_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["bank-transaction-types"] });

  const submitType = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error: err } = await supabase.from("bank_transaction_types").insert({ code: form.code, label_he: form.label_he });
    setSubmitting(false);
    if (err) {
      setError(err.message.includes("duplicate") ? "קוד זה כבר קיים." : err.message);
      return;
    }
    setForm(EMPTY_TYPE_FORM);
    setShowAdd(false);
    refresh();
  };

  const toggleActive = async (row: TransactionTypeRow) => {
    await supabase.from("bank_transaction_types").update({ is_active: !row.is_active }).eq("id", row.id);
    refresh();
  };

  const exportTypes = () => {
    const rows = (query.data ?? []).map((r) => ({
      "קוד": r.code,
      "תווית": r.label_he,
      "סטטוס": r.is_active ? "פעיל" : "לא פעיל",
    }));
    exportRowsToExcel(rows, "סוגי תנועה", `סוגי-תנועת-בנק-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const columns: DataTableColumn<TransactionTypeRow>[] = [
    { key: "code", header: "קוד", className: "tabular", render: (r) => r.code },
    { key: "label", header: "תיאור", render: (r) => r.label_he },
    { key: "status", header: "סטטוס", render: (r) => <StatusBadge severity={r.is_active ? "ok" : "neutral"} label={r.is_active ? "פעיל" : "לא פעיל"} /> },
    {
      key: "actions",
      header: "",
      render: (r) =>
        canManage ? (
          <button onClick={() => toggleActive(r)} className="link-action text-xs">
            {r.is_active ? "השבתה" : "הפעלה"}
          </button>
        ) : null,
    },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-muted">
          קטלוג סוגי התנועה לצורך סיווג. 13 הסוגים הבסיסיים לפי האפיון כבר קיימים - הוספה כאן היא להרחבה עתידית בלבד.
        </p>
        <div className="flex items-center gap-2">
          <button onClick={exportTypes} className="btn-secondary flex items-center gap-2 text-xs">
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            ייצוא לאקסל
          </button>
          {canManage && (
            <button onClick={() => setShowAdd((v) => !v)} className="btn-primary">
              {showAdd ? "סגירה" : "סוג חדש"}
            </button>
          )}
        </div>
      </div>

      {showAdd && (
        <form onSubmit={submitType} className="card mb-4 max-w-lg space-y-3 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label">קוד</label>
              <input required value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} className="input-field tabular" />
            </div>
            <div>
              <label className="field-label">תיאור</label>
              <input required value={form.label_he} onChange={(e) => setForm((f) => ({ ...f, label_he: e.target.value }))} className="input-field" />
            </div>
          </div>
          {error && <ErrorState message={error} />}
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? "שומרת…" : "הוספה"}
          </button>
        </form>
      )}

      {canManage && (
        <BankCatalogImportPanel
          profileKey="bank_transaction_types"
          commitRpc="commit_transaction_types_import_batch"
          columnsHint="עמודות קובץ (שם כותרת מדויק): קוד (חובה, ייחודי בקטלוג), תווית (חובה)."
          onCommitted={refresh}
        />
      )}

      <div className="mt-4">
        <DataTable columns={columns} rows={query.data ?? []} rowKey={(r) => r.id} loading={query.isLoading} emptyTitle="אין סוגי תנועה" emptyIcon={Tags} />
      </div>
    </div>
  );
}

interface OrgOption {
  id: string;
  legal_name: string;
}

interface BankAccountOption {
  id: string;
  bank_name: string | null;
  account_number_masked: string | null;
}

interface TransactionTypeOption {
  id: string;
  code: string;
  label_he: string;
}

type Direction = "debit" | "credit";
type TextMatchType = "contains" | "starts_with";
type Confidence = "high" | "medium" | "low";

interface RuleRow {
  id: string;
  organization_bank_account_id: string | null;
  direction: Direction | null;
  text_match_type: TextMatchType | null;
  text_match_value: string | null;
  counterparty_name: string | null;
  amount_min: number | null;
  amount_max: number | null;
  reference_match: string | null;
  effective_from: string | null;
  effective_until: string | null;
  confidence_level: Confidence;
  priority: number;
  is_active: boolean;
  suggested_type: { code: string; label_he: string } | null;
  account: { bank_name: string | null; account_number_masked: string | null } | null;
}

const DIRECTION_LABEL: Record<Direction, string> = { debit: "חובה", credit: "זכות" };
const TEXT_MATCH_LABEL: Record<TextMatchType, string> = { contains: "מכיל", starts_with: "מתחיל ב" };
const CONFIDENCE_LABEL: Record<Confidence, string> = { high: "גבוהה", medium: "בינונית", low: "נמוכה" };

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

async function fetchTransactionTypes(): Promise<TransactionTypeOption[]> {
  const { data, error } = await supabase.from("bank_transaction_types").select("id, code, label_he").eq("is_active", true).order("label_he");
  if (error) throw error;
  return data ?? [];
}

async function fetchRules(): Promise<RuleRow[]> {
  const { data, error } = await supabase
    .from("recognition_rules")
    .select(
      "id, organization_bank_account_id, direction, text_match_type, text_match_value, counterparty_name, amount_min, amount_max, reference_match, effective_from, effective_until, confidence_level, priority, is_active, suggested_type:bank_transaction_types(code, label_he), account:organization_bank_accounts_view(bank_name, account_number_masked)",
    )
    .order("priority", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    ...r,
    suggested_type: Array.isArray(r.suggested_type) ? (r.suggested_type[0] ?? null) : r.suggested_type,
    account: Array.isArray(r.account) ? (r.account[0] ?? null) : r.account,
  }));
}

const EMPTY_RULE_FORM = {
  orgId: "",
  bankAccountId: "",
  direction: "" as Direction | "",
  textMatchType: "" as TextMatchType | "",
  textMatchValue: "",
  counterpartyName: "",
  amountMin: "",
  amountMax: "",
  referenceMatch: "",
  effectiveFrom: "",
  effectiveUntil: "",
  suggestedTypeId: "",
  confidenceLevel: "medium" as Confidence,
  priority: "0",
};

function RecognitionRulesPanel() {
  const queryClient = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("transaction_classification", "perform");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });
  const typesQuery = useQuery({ queryKey: ["bank-transaction-types-active"], queryFn: fetchTransactionTypes });
  const rulesQuery = useQuery({ queryKey: ["recognition-rules"], queryFn: fetchRules });

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_RULE_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bankAccountsQuery = useQuery({ queryKey: ["recognition-org-accounts", form.orgId], queryFn: () => fetchOrgBankAccounts(form.orgId), enabled: !!form.orgId });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["recognition-rules"] });

  const toNum = (v: string) => (v.trim() === "" ? null : Number(v));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.suggestedTypeId) return;
    setSubmitting(true);
    setError(null);
    const { error: err } = await supabase.from("recognition_rules").insert({
      organization_bank_account_id: form.bankAccountId || null,
      direction: form.direction || null,
      text_match_type: form.textMatchValue ? form.textMatchType || "contains" : null,
      text_match_value: form.textMatchValue || null,
      counterparty_name: form.counterpartyName || null,
      amount_min: toNum(form.amountMin),
      amount_max: toNum(form.amountMax),
      reference_match: form.referenceMatch || null,
      effective_from: form.effectiveFrom || null,
      effective_until: form.effectiveUntil || null,
      suggested_type_id: form.suggestedTypeId,
      confidence_level: form.confidenceLevel,
      priority: Number(form.priority) || 0,
    });
    setSubmitting(false);
    if (err) {
      setError(err.message);
      return;
    }
    setForm(EMPTY_RULE_FORM);
    setShowAdd(false);
    refresh();
  };

  const toggleActive = async (rule: RuleRow) => {
    await supabase.from("recognition_rules").update({ is_active: !rule.is_active }).eq("id", rule.id);
    refresh();
  };

  const exportRules = () => {
    const rows = (rulesQuery.data ?? []).map((r) => ({
      "חשבון בנק": r.account ? `${r.account.bank_name ?? ""} · ${r.account.account_number_masked ?? ""}` : "",
      "כיוון": r.direction ? DIRECTION_LABEL[r.direction] : "",
      "סוג התאמת טקסט": r.text_match_type ? TEXT_MATCH_LABEL[r.text_match_type] : "",
      "ערך התאמת טקסט": r.text_match_value ?? "",
      "שם צד שכנגד": r.counterparty_name ?? "",
      "סכום מינימום": r.amount_min ?? "",
      "סכום מקסימום": r.amount_max ?? "",
      "התאמת אסמכתה": r.reference_match ?? "",
      "תקף מתאריך": r.effective_from ?? "",
      "תקף עד תאריך": r.effective_until ?? "",
      "קוד סוג תנועה מוצע": r.suggested_type?.code ?? "",
      "רמת ביטחון": CONFIDENCE_LABEL[r.confidence_level],
      "עדיפות": r.priority,
    }));
    exportRowsToExcel(rows, "כללי זיהוי בנק", `כללי-זיהוי-בנק-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const columns: DataTableColumn<RuleRow>[] = [
    {
      key: "scope",
      header: "חשבון",
      render: (r) =>
        r.account ? (
          <>
            {r.account.bank_name ?? "בנק"} · <span className="ltr-num">{r.account.account_number_masked}</span>
          </>
        ) : (
          "כל החשבונות"
        ),
    },
    {
      key: "criteria",
      header: "קריטריונים",
      render: (r) =>
        [
          r.direction ? DIRECTION_LABEL[r.direction] : null,
          r.text_match_type && r.text_match_value ? `${TEXT_MATCH_LABEL[r.text_match_type]} "${r.text_match_value}"` : null,
          r.counterparty_name ? `גורם: ${r.counterparty_name}` : null,
          r.amount_min != null || r.amount_max != null ? `סכום: ${r.amount_min ?? "—"}–${r.amount_max ?? "—"}` : null,
          r.reference_match ? `אסמכתה: ${r.reference_match}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "ללא הגבלה",
    },
    { key: "type", header: "סוג מוצע", render: (r) => r.suggested_type?.label_he ?? "—" },
    { key: "confidence", header: "רמת ביטחון", render: (r) => CONFIDENCE_LABEL[r.confidence_level] },
    { key: "priority", header: "עדיפות", className: "tabular", render: (r) => r.priority },
    {
      key: "status",
      header: "סטטוס",
      render: (r) =>
        canManage ? (
          <button onClick={() => toggleActive(r)} className="link-action text-xs">
            <StatusBadge severity={r.is_active ? "ok" : "neutral"} label={r.is_active ? "פעיל" : "כבוי"} />
          </button>
        ) : (
          <StatusBadge severity={r.is_active ? "ok" : "neutral"} label={r.is_active ? "פעיל" : "כבוי"} />
        ),
    },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-muted">
          הצעת סיווג בלבד - לעולם לא אישור אוטומטי. כשכמה כללים תואמים לאותה תנועה, מנצחת העדיפות הגבוהה ביותר.
        </p>
        <div className="flex items-center gap-2">
          <button onClick={exportRules} className="btn-secondary flex items-center gap-2 text-xs">
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            ייצוא לאקסל
          </button>
          {canManage && (
            <button onClick={() => setShowAdd((v) => !v)} className="btn-primary">
              {showAdd ? "סגירה" : "כלל חדש"}
            </button>
          )}
        </div>
      </div>

      {showAdd && (
        <form onSubmit={submit} className="card mb-6 max-w-4xl space-y-3 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="field-label">עמותה (לצורך בחירת חשבון)</label>
              <select value={form.orgId} onChange={(e) => setForm((f) => ({ ...f, orgId: e.target.value, bankAccountId: "" }))} className="input-field">
                <option value="">— בחרי —</option>
                {(orgsQuery.data ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.legal_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">חשבון (לא חובה - ריק = כל החשבונות)</label>
              <select value={form.bankAccountId} onChange={(e) => setForm((f) => ({ ...f, bankAccountId: e.target.value }))} className="input-field" disabled={!form.orgId}>
                <option value="">— כל החשבונות —</option>
                {(bankAccountsQuery.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.bank_name ?? "בנק"} · {a.account_number_masked}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">צד (לא חובה)</label>
              <select value={form.direction} onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value as Direction | "" }))} className="input-field">
                <option value="">— כל הצדדים —</option>
                <option value="debit">חובה</option>
                <option value="credit">זכות</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="field-label">סוג התאמת טקסט</label>
              <select value={form.textMatchType} onChange={(e) => setForm((f) => ({ ...f, textMatchType: e.target.value as TextMatchType | "" }))} className="input-field">
                <option value="contains">מכיל</option>
                <option value="starts_with">מתחיל ב</option>
              </select>
            </div>
            <div>
              <label className="field-label">ערך טקסט להתאמה בתיאור (לא חובה)</label>
              <input value={form.textMatchValue} onChange={(e) => setForm((f) => ({ ...f, textMatchValue: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="field-label">שם גורם (לא חובה)</label>
              <input value={form.counterpartyName} onChange={(e) => setForm((f) => ({ ...f, counterpartyName: e.target.value }))} className="input-field" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="field-label">סכום מינימום (לא חובה)</label>
              <input type="number" step="0.01" value={form.amountMin} onChange={(e) => setForm((f) => ({ ...f, amountMin: e.target.value }))} className="input-field tabular" />
            </div>
            <div>
              <label className="field-label">סכום מקסימום (לא חובה)</label>
              <input type="number" step="0.01" value={form.amountMax} onChange={(e) => setForm((f) => ({ ...f, amountMax: e.target.value }))} className="input-field tabular" />
            </div>
            <div>
              <label className="field-label">התאמת אסמכתה (לא חובה)</label>
              <input value={form.referenceMatch} onChange={(e) => setForm((f) => ({ ...f, referenceMatch: e.target.value }))} className="input-field" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="field-label">בתוקף מתאריך (לא חובה)</label>
              <input type="date" value={form.effectiveFrom} onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="field-label">בתוקף עד (לא חובה)</label>
              <input type="date" value={form.effectiveUntil} onChange={(e) => setForm((f) => ({ ...f, effectiveUntil: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="field-label">עדיפות (מספר גבוה יותר מנצח)</label>
              <input type="number" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} className="input-field tabular" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label">סוג תנועה מוצע</label>
              <select required value={form.suggestedTypeId} onChange={(e) => setForm((f) => ({ ...f, suggestedTypeId: e.target.value }))} className="input-field">
                <option value="">— בחרי —</option>
                {(typesQuery.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label_he}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">רמת ביטחון</label>
              <select value={form.confidenceLevel} onChange={(e) => setForm((f) => ({ ...f, confidenceLevel: e.target.value as Confidence }))} className="input-field">
                {(Object.keys(CONFIDENCE_LABEL) as Confidence[]).map((c) => (
                  <option key={c} value={c}>
                    {CONFIDENCE_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && <ErrorState message={error} />}
          <button type="submit" disabled={submitting || !form.suggestedTypeId} className="btn-primary">
            {submitting ? "שומרת…" : "שמירת כלל"}
          </button>
        </form>
      )}

      {canManage && (
        <BankCatalogImportPanel
          profileKey="recognition_rules"
          commitRpc="commit_recognition_rules_import_batch"
          columnsHint='עמודות קובץ: חשבון בנק (לא חובה - "שם בנק · מספר ממוסך" בדיוק כמו בעמודת "חשבון" למעלה/בקובץ יצוא; ריק = כל החשבונות), כיוון (חובה/זכות), סוג התאמת טקסט (מכיל/מתחיל ב), ערך התאמת טקסט (שני השדות תמיד ביחד או ריקים ביחד), שם צד שכנגד, סכום מינימום, סכום מקסימום, התאמת אסמכתה, תקף מתאריך, תקף עד תאריך, קוד סוג תנועה מוצע (חובה), רמת ביטחון (גבוהה/בינונית/נמוכה, חובה), עדיפות.'
          onCommitted={refresh}
        />
      )}

      <div className="mt-4">
        <DataTable columns={columns} rows={rulesQuery.data ?? []} rowKey={(r) => r.id} loading={rulesQuery.isLoading} emptyTitle="אין כללי זיהוי" emptyIcon={ScanSearch} />
      </div>
    </div>
  );
}

export function BankClassificationScreen() {
  const [tab, setTab] = useState<"types" | "rules">("types");

  return (
    <div>
      <PageHeader
        title="בנק — סיווג תנועות"
        description="ניהול קטלוג סוגי התנועה וכללי הזיהוי האוטומטי המציעים סיווג לתנועות בנק נכנסות."
      />

      <Tabs
        tabs={[
          { key: "types", label: "סוגי תנועה" },
          { key: "rules", label: "כללי זיהוי בנק" },
        ]}
        activeTab={tab}
        onChange={setTab}
        ariaLabel="בנק — סיווג תנועות"
      />

      {tab === "types" && <TransactionTypesPanel />}
      {tab === "rules" && <RecognitionRulesPanel />}
    </div>
  );
}
