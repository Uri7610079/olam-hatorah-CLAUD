import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
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

export function ErrorsCenterScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canImport, isLoading: importPermLoading } = useHasPermission("talmud", "import");
  const { hasPermission: canManage } = useHasPermission("talmud_errors", "manage");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs, enabled: canImport });

  const [orgId, setOrgId] = useState("");
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
  const [reviewBatchId, setReviewBatchId] = useState<string | null>(null);
  const [resolvingRow, setResolvingRow] = useState<number | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<{ matched: number; unmatched: number } | null>(null);

  const errorsQuery = useQuery({ queryKey: ["talmud-errors", orgId, statusFilter], queryFn: () => fetchErrors(orgId, statusFilter), enabled: !!orgId });
  const reviewRowsQuery = useQuery({ queryKey: ["errors-batch-rows", reviewBatchId], queryFn: () => fetchImportBatchRows(reviewBatchId!), enabled: !!reviewBatchId });

  const resetForm = () => {
    setFile(null);
    setParsedRows(null);
    setLegacyWarning(false);
    setDuplicateId(null);
    setError(null);
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
      setParsedRows(await analyzeFile(selected));
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בניתוח הקובץ");
    } finally {
      setAnalyzing(false);
    }
  };

  const submitBatch = async () => {
    if (!file || !parsedRows || !orgId) return;
    setUploading(true);
    setError(null);
    try {
      const { batchId } = await createImportBatch({ file, profileKey: "talmud_errors", organizationId: orgId, periodMonth: month }, parsedRows);
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
    queryClient.invalidateQueries({ queryKey: ["errors-batch-rows", reviewBatchId] });
  };

  const commit = async () => {
    if (!reviewBatchId) return;
    setCommitting(true);
    setError(null);
    const { data, error: commitError } = await supabase.rpc("commit_errors_batch", { p_batch_id: reviewBatchId, p_month: month }).single();
    setCommitting(false);
    if (commitError) {
      setError(commitError.message);
      return;
    }
    setCommitResult({ matched: (data as any).matched_count, unmatched: (data as any).unmatched_count });
    setReviewBatchId(null);
    setShowImport(false);
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
                <button disabled={resolvingRow === r.row_number} onClick={() => resolveRow(r.row_number, "invalid")} className="text-xs text-red-600 underline hover:text-red-800 disabled:opacity-50">
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
          <label className="field-label">חודש (ליבוא)</label>
          <input type="date" value={month} onChange={(e) => setMonth(e.target.value)} className="input-field" />
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
          <p className="text-xs text-slate-500">עמודות צפויות: מזהה תלמיד, קוד שגיאה, תיאור שגיאה (לא חובה).</p>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)} className="input-field" />
          {analyzing && <LoadingState rows={2} />}
          {duplicateId && <ErrorState message="הקובץ הזה כבר יובא בעבר." />}
          {legacyWarning && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>קובץ XLS ישן - מומלץ להמיר ל-XLSX/CSV.</span>
            </div>
          )}
          {error && <ErrorState message={error} />}
          {parsedRows && !duplicateId && (
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
        <div className="card mb-6 max-w-3xl space-y-4 p-5">
          {reviewRowsQuery.isLoading ? (
            <LoadingState rows={4} />
          ) : (
            <>
              <p className="text-sm text-slate-600">פתרו שורות "דורש החלטה" ואז קלטו את הדוח.</p>
              <ImportPreviewTabs validCount={storedValid.length} needsDecisionCount={storedNeeds.length} invalidCount={storedInvalid.length}>
                {(tab) => {
                  const data = tab === "valid" ? storedValid : tab === "needsDecision" ? storedNeeds : storedInvalid;
                  return <DataTable columns={storedCols(tab !== "valid")} rows={data} rowKey={(r) => String(r.row_number)} emptyTitle="אין שורות" />;
                }}
              </ImportPreviewTabs>
              {error && <ErrorState message={error} />}
              <div className="flex gap-3">
                <button onClick={commit} disabled={committing} className="btn-primary">
                  {committing ? "קולטת…" : "קליטת דוח השגויים"}
                </button>
                <button onClick={() => setReviewBatchId(null)} className="text-xs text-slate-500 underline">
                  ביטול
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {commitResult && (
        <div className="mb-6 rounded-md bg-green-50 p-3 text-sm text-green-800">
          נקלטו {commitResult.matched} שגיאות. {commitResult.unmatched > 0 && `${commitResult.unmatched} שורות עם בעיה נשארו לבדיקה.`}
        </div>
      )}

      {orgId && (
        <DataTable
          columns={[
            { key: "recurring", header: "", render: (r: TalmudError) => (r.is_recurring ? <StatusBadge severity="high" label="חוזרת" /> : null) },
            { key: "id", header: "מזהה", className: "tabular", render: (r: TalmudError) => r.student?.external_id ?? r.external_student_ref ?? "—" },
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
      )}
    </div>
  );
}
