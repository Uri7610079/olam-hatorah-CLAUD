import { useState } from "react";
import { fromMonthInput, toMonthInput } from "@/components/MonthField";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { useLastSelected } from "@/lib/useLastSelected";
import type { ClassifiedRow } from "@/lib/importParsing";
import {
  analyzeFile,
  checkDuplicateFile,
  legacyXlsWarning,
  createImportBatch,
  fetchImportBatchRows,
  resolveImportRow,
  type StoredImportRow,
} from "@/lib/importBatches";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ImportPreviewTabs } from "@/components/ImportPreviewTabs";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { HeaderRowConfirm } from "@/components/HeaderRowConfirm";

interface OrgOption {
  id: string;
  legal_name: string;
}

async function fetchOrgs(): Promise<OrgOption[]> {
  const { data, error } = await supabase.from("organizations").select("id, legal_name").eq("status", "active").order("legal_name");
  if (error) throw error;
  return data ?? [];
}

type ErrorStatus = "open" | "in_progress" | "pending_info" | "closed";

interface TalmudError {
  id: string;
  external_student_ref: string | null;
  month: string;
  error_code: string;
  error_description: string | null;
  status: ErrorStatus;
  is_recurring: boolean;
  created_at: string;
  student: { external_id: string; full_name: string } | null;
}

const STATUS_LABEL: Record<ErrorStatus, string> = {
  open: "פתוח",
  in_progress: "בטיפול",
  pending_info: "ממתין למידע",
  closed: "סגור",
};

async function fetchErrors(orgId: string, statusFilter: string): Promise<TalmudError[]> {
  let query = supabase
    .from("talmud_errors")
    .select("id, external_student_ref, month, error_code, error_description, status, is_recurring, created_at, student:students(external_id, full_name)")
    .eq("organization_id", orgId)
    .order("is_recurring", { ascending: false })
    .order("created_at", { ascending: false });
  if (statusFilter) query = query.eq("status", statusFilter);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, student: Array.isArray(r.student) ? (r.student[0] ?? null) : r.student }));
}

type BatchStatus = "uploaded" | "analyzed" | "previewed" | "committed" | "rejected";
const OPEN_STATUSES: BatchStatus[] = ["uploaded", "analyzed", "previewed"];
const BATCH_STATUS_LABEL: Record<BatchStatus, string> = {
  uploaded: "הועלה",
  analyzed: "נותח",
  previewed: "נסקר",
  committed: "נקלט",
  rejected: "בוטל",
};

interface ErrorsBatchSummary {
  id: string;
  file_name: string;
  status: BatchStatus;
  period_month: string | null;
  valid_count: number;
  needs_decision_count: number;
  invalid_count: number;
  created_at: string;
}

async function fetchErrorsBatches(orgId: string): Promise<ErrorsBatchSummary[]> {
  const profile = await supabase.from("import_profiles").select("id").eq("key", "talmud_errors").single();
  if (!profile.data) return [];
  const { data, error } = await supabase
    .from("import_batches")
    .select("id, file_name, status, period_month, valid_count, needs_decision_count, invalid_count, created_at")
    .eq("profile_id", profile.data.id)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

async function fetchBatchById(id: string): Promise<ErrorsBatchSummary> {
  const { data, error } = await supabase
    .from("import_batches")
    .select("id, file_name, status, period_month, valid_count, needs_decision_count, invalid_count, created_at")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export function ErrorsCenterScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canImport, isLoading: importPermLoading } = useHasPermission("talmud", "import");
  const { hasPermission: canManage } = useHasPermission("talmud_errors", "manage");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs, enabled: canImport });

  const [orgId, setOrgId] = useLastSelected<string>("last-org", "");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7) + "-01");
  const [statusFilter, setStatusFilter] = useState("");
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
  const [commitResult, setCommitResult] = useState<{ matched: number; unmatched: number } | null>(null);

  const errorsQuery = useQuery({ queryKey: ["talmud-errors", orgId, statusFilter], queryFn: () => fetchErrors(orgId, statusFilter), enabled: !!orgId });
  const batchesQuery = useQuery({ queryKey: ["errors-batches", orgId], queryFn: () => fetchErrorsBatches(orgId), enabled: !!orgId });
  const reviewBatchQuery = useQuery({ queryKey: ["errors-batch", reviewBatchId], queryFn: () => fetchBatchById(reviewBatchId!), enabled: !!reviewBatchId });
  const reviewRowsQuery = useQuery({ queryKey: ["errors-batch-rows", reviewBatchId], queryFn: () => fetchImportBatchRows(reviewBatchId!), enabled: !!reviewBatchId });

  const resetForm = () => {
    setFile(null);
    setParsedRows(null);
    setLegacyWarning(false);
    setDuplicateId(null);
    setError(null);
    setHeaderConfirm(null);
  };

  const closeReview = () => {
    setReviewBatchId(null);
    queryClient.invalidateQueries({ queryKey: ["errors-batches", orgId] });
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
    setAnalyzing(true);
    try {
      const result = await analyzeFile(headerConfirm.file, chosenIndex);
      setHeaderConfirm(null);
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
    if (!file || !parsedRows || !orgId) return;
    setUploading(true);
    setError(null);
    try {
      const { batchId } = await createImportBatch({ file, profileKey: "talmud_errors", organizationId: orgId, periodMonth: month }, parsedRows);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["errors-batches", orgId] });
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
    queryClient.invalidateQueries({ queryKey: ["errors-batch-rows", reviewBatchId] });
  };

  const commit = async () => {
    if (!reviewBatchId || !reviewBatchQuery.data?.period_month) return;
    setCommitting(true);
    setError(null);
    const { data, error: commitError } = await supabase
      .rpc("commit_errors_batch", { p_batch_id: reviewBatchId, p_month: reviewBatchQuery.data.period_month })
      .single();
    setCommitting(false);
    if (commitError) {
      setError(commitError.message);
      return;
    }
    setCommitResult({ matched: (data as any).matched_count, unmatched: (data as any).unmatched_count });
    queryClient.invalidateQueries({ queryKey: ["errors-batch", reviewBatchId] });
    queryClient.invalidateQueries({ queryKey: ["errors-batch-rows", reviewBatchId] });
    queryClient.invalidateQueries({ queryKey: ["errors-batches", orgId] });
    queryClient.invalidateQueries({ queryKey: ["talmud-errors", orgId, statusFilter] });
    queryClient.invalidateQueries({ queryKey: ["students"] });
  };

  const changeStatus = async (errorId: string, status: ErrorStatus) => {
    await supabase.rpc("resolve_talmud_error", { p_error_id: errorId, p_status: status });
    queryClient.invalidateQueries({ queryKey: ["talmud-errors", orgId, statusFilter] });
  };

  if (importPermLoading) return <LoadingState rows={4} />;
  if (!canImport) return <ErrorState message="אין לך הרשאה למרכז השגיאות." />;

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
    <div>
      <PageHeader
        title="מרכז שגיאות תלמוד"
        description="שגיאות מדוח תלמוד, לפי תלמיד וחודש. תלמיד יכול לצבור כמה שגיאות באותו חודש."
        primaryAction={
          <button onClick={() => setShowImport((v) => !v)} className="btn-secondary">
            {showImport ? "סגירה" : "יבוא דוח שגויים"}
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 max-w-2xl mb-4">
        <div>
          <label className="field-label">עמותה</label>
          <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className="input-field">
            <option value="">— בחרי —</option>
            {(orgsQuery.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.legal_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">חודש (לקובץ חדש)</label>
          <input type="month" value={toMonthInput(month)} onChange={(e) => setMonth(fromMonthInput(e.target.value))} className="input-field" />
        </div>
        <div>
          <label className="field-label">סינון סטטוס</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-field">
            <option value="">הכול</option>
            {(Object.keys(STATUS_LABEL) as ErrorStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {showImport && orgId && !reviewBatchId && (
        <div className="card mb-6 max-w-2xl space-y-4 p-5">
          <p className="text-xs text-ink-subtle">עמודות צפויות: מזהה תלמיד, קוד שגיאה, תיאור שגיאה (לא חובה).</p>
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
            <div className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn-soft p-3 text-sm text-warn-ink">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>קובץ XLS ישן - מומלץ להמיר ל-XLSX/CSV.</span>
            </div>
          )}
          {error && <ErrorState message={error} />}
          {headerConfirm ? (
            <HeaderRowConfirm
              previewRows={headerConfirm.previewRows}
              detectedIndex={headerConfirm.detectedIndex}
              onConfirm={handleHeaderConfirm}
              onCancel={handleHeaderCancel}
            />
          ) : (
            parsedRows &&
            !duplicateId && (
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
            )
          )}
        </div>
      )}

      {reviewBatchId && (
        <div className="card mb-6 max-w-3xl space-y-4 p-5">
          {reviewBatchQuery.isLoading || reviewRowsQuery.isLoading ? (
            <LoadingState rows={4} />
          ) : reviewBatchQuery.data ? (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-ink">{reviewBatchQuery.data.file_name}</p>
                  <p className="text-xs text-ink-subtle">חודש: {reviewBatchQuery.data.period_month ?? "—"}</p>
                </div>
                <StatusBadge
                  severity={reviewBatchQuery.data.status === "committed" ? "ok" : reviewBatchQuery.data.status === "rejected" ? "neutral" : "medium"}
                  label={BATCH_STATUS_LABEL[reviewBatchQuery.data.status]}
                />
              </div>

              {reviewIsOpen && <p className="text-sm text-ink-muted">פתרו שורות "דורש החלטה" ואז קלטו את הדוח.</p>}

              <ImportPreviewTabs validCount={storedValid.length} needsDecisionCount={storedNeeds.length} invalidCount={storedInvalid.length}>
                {(tab) => {
                  const data = tab === "valid" ? storedValid : tab === "needsDecision" ? storedNeeds : storedInvalid;
                  return <DataTable columns={storedCols(reviewIsOpen && tab !== "valid")} rows={data} rowKey={(r) => String(r.row_number)} emptyTitle="אין שורות" />;
                }}
              </ImportPreviewTabs>
              {error && <ErrorState message={error} />}
              <div className="flex gap-3">
                {reviewIsOpen && (
                  <button onClick={commit} disabled={committing} className="btn-primary">
                    {committing ? "קולטת…" : "קליטת דוח השגויים"}
                  </button>
                )}
                <button onClick={closeReview} className="text-xs text-ink-subtle underline">
                  חזרה לרשימה
                </button>
              </div>
            </>
          ) : (
            <ErrorState message="האצווה לא נמצאה." />
          )}
        </div>
      )}

      {commitResult && (
        <div className="mb-6 rounded-md bg-ok-soft p-3 text-sm text-ok-ink">
          נקלטו {commitResult.matched} שגיאות. {commitResult.unmatched > 0 && `${commitResult.unmatched} שורות עם בעיה נשארו לבדיקה.`}
        </div>
      )}

      {orgId && (
        <>
          <DataTable
            columns={[
              { key: "recurring", header: "", render: (r: TalmudError) => (r.is_recurring ? <StatusBadge severity="high" label="חוזרת" /> : null) },
              { key: "id", header: "מזהה", className: "tabular ltr-num", render: (r: TalmudError) => r.student?.external_id ?? r.external_student_ref ?? "—" },
              { key: "name", header: "שם", render: (r: TalmudError) => r.student?.full_name ?? "(לא הותאם)" },
              { key: "code", header: "קוד", className: "tabular", render: (r: TalmudError) => r.error_code },
              { key: "desc", header: "תיאור", render: (r: TalmudError) => r.error_description ?? "—" },
              {
                key: "status",
                header: "סטטוס",
                render: (r: TalmudError) =>
                  canManage ? (
                    <select value={r.status} onChange={(e) => changeStatus(r.id, e.target.value as ErrorStatus)} className="input-field text-xs">
                      {(Object.keys(STATUS_LABEL) as ErrorStatus[]).map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    STATUS_LABEL[r.status]
                  ),
              },
            ]}
            rows={errorsQuery.data ?? []}
            rowKey={(r: TalmudError) => r.id}
            loading={errorsQuery.isLoading}
            emptyTitle="אין שגיאות"
          />

          <h2 className="mb-2 mt-6 text-sm font-semibold text-ink-muted">היסטוריית יבוא שגויים</h2>
          <DataTable
            columns={[
              { key: "file", header: "קובץ", render: (b: ErrorsBatchSummary) => b.file_name },
              { key: "month", header: "חודש", className: "tabular", render: (b: ErrorsBatchSummary) => b.period_month ?? "—" },
              {
                key: "counts",
                header: "תקין / דורש החלטה / שגוי",
                className: "tabular",
                render: (b: ErrorsBatchSummary) => `${b.valid_count} / ${b.needs_decision_count} / ${b.invalid_count}`,
              },
              {
                key: "status",
                header: "סטטוס",
                render: (b: ErrorsBatchSummary) => (
                  <StatusBadge severity={b.status === "committed" ? "ok" : b.status === "rejected" ? "neutral" : "medium"} label={BATCH_STATUS_LABEL[b.status]} />
                ),
              },
              { key: "date", header: "תאריך", className: "tabular", render: (b: ErrorsBatchSummary) => new Date(b.created_at).toLocaleDateString("he-IL") },
            ]}
            rows={batchesQuery.data ?? []}
            rowKey={(b: ErrorsBatchSummary) => b.id}
            loading={batchesQuery.isLoading}
            emptyTitle="אין עדיין יבואים"
            onRowClick={(b: ErrorsBatchSummary) => setReviewBatchId(b.id)}
          />
        </>
      )}
    </div>
  );
}
