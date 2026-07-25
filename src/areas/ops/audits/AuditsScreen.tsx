import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import type { ClassifiedRow } from "@/lib/importParsing";
import { analyzeFile, checkDuplicateFile, legacyXlsWarning, createImportBatch, fetchImportBatchRows, resolveImportRow, type StoredImportRow } from "@/lib/importBatches";
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

interface BranchOption {
  id: string;
  internal_name: string;
}

type AuditStatus = "draft" | "completed";

interface AuditRow {
  id: string;
  audit_date: string;
  status: AuditStatus;
  branch: { internal_name: string } | null;
}

type AttendanceStatus = "open" | "in_progress" | "pending_info" | "closed";

interface AttendanceRow {
  id: string;
  external_student_ref: string | null;
  status: AttendanceStatus;
  reason: string | null;
  is_recurring: boolean;
  student: { external_id: string; full_name: string } | null;
  group: { name: string } | null;
}

const AUDIT_STATUS_LABEL: Record<AuditStatus, string> = { draft: "טיוטה", completed: "הושלמה" };
const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = { open: "פתוח", in_progress: "בטיפול", pending_info: "ממתין למידע", closed: "טופל" };

async function fetchOrgs(): Promise<OrgOption[]> {
  const { data, error } = await supabase.from("organizations").select("id, legal_name").eq("status", "active").order("legal_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchBranches(orgId: string): Promise<BranchOption[]> {
  const { data, error } = await supabase.from("branches").select("id, internal_name").eq("organization_id", orgId).eq("status", "active");
  if (error) throw error;
  return data ?? [];
}

async function fetchAudits(orgId: string): Promise<AuditRow[]> {
  const { data, error } = await supabase
    .from("audits")
    .select("id, audit_date, status, branch:branches(internal_name)")
    .eq("organization_id", orgId)
    .order("audit_date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, branch: Array.isArray(r.branch) ? (r.branch[0] ?? null) : r.branch }));
}

async function fetchAttendance(auditId: string): Promise<AttendanceRow[]> {
  const { data, error } = await supabase
    .from("audit_attendance")
    .select("id, external_student_ref, status, reason, is_recurring, student:students(external_id, full_name), group:groups(name)")
    .eq("audit_id", auditId)
    .order("is_recurring", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    ...r,
    student: Array.isArray(r.student) ? (r.student[0] ?? null) : r.student,
    group: Array.isArray(r.group) ? (r.group[0] ?? null) : r.group,
  }));
}

export function AuditsScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canImport, isLoading: permLoading } = useHasPermission("audits", "import");
  const { hasPermission: canManage } = useHasPermission("audits", "manage");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });

  const [orgId, setOrgId] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [branchId, setBranchId] = useState("");
  const [auditDate, setAuditDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [creating, setCreating] = useState(false);

  const [selectedAuditId, setSelectedAuditId] = useState<string | null>(null);
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

  const branchesQuery = useQuery({ queryKey: ["audit-branches", orgId], queryFn: () => fetchBranches(orgId), enabled: !!orgId });
  const auditsQuery = useQuery({ queryKey: ["audits", orgId], queryFn: () => fetchAudits(orgId), enabled: !!orgId });
  const attendanceQuery = useQuery({ queryKey: ["audit-attendance", selectedAuditId], queryFn: () => fetchAttendance(selectedAuditId!), enabled: !!selectedAuditId });
  const reviewRowsQuery = useQuery({ queryKey: ["audit-batch-rows", reviewBatchId], queryFn: () => fetchImportBatchRows(reviewBatchId!), enabled: !!reviewBatchId });

  const selectedAudit = auditsQuery.data?.find((a) => a.id === selectedAuditId) ?? null;

  const createAudit = async () => {
    if (!orgId || !auditDate) return;
    setCreating(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("audits")
      .insert({ organization_id: orgId, branch_id: branchId || null, audit_date: auditDate })
      .select("id")
      .single();
    setCreating(false);
    if (err) {
      setError(err.message);
      return;
    }
    setShowCreate(false);
    queryClient.invalidateQueries({ queryKey: ["audits", orgId] });
    setSelectedAuditId(data.id);
  };

  const resetImportForm = () => {
    setFile(null);
    setParsedRows(null);
    setLegacyWarning(false);
    setDuplicateId(null);
    setError(null);
  };

  const handleFileChange = async (selected: File | null) => {
    resetImportForm();
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
    if (!file || !parsedRows || !selectedAudit) return;
    setUploading(true);
    setError(null);
    try {
      const { batchId } = await createImportBatch(
        { file, profileKey: "audit_attendance", organizationId: orgId, periodMonth: selectedAudit.audit_date },
        parsedRows,
      );
      resetImportForm();
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
    queryClient.invalidateQueries({ queryKey: ["audit-batch-rows", reviewBatchId] });
  };

  const commit = async () => {
    if (!reviewBatchId || !selectedAuditId) return;
    setCommitting(true);
    setError(null);
    const { data, error: commitError } = await supabase
      .rpc("commit_audit_attendance_batch", { p_batch_id: reviewBatchId, p_audit_id: selectedAuditId })
      .single();
    setCommitting(false);
    if (commitError) {
      setError(commitError.message);
      return;
    }
    setCommitResult({ matched: (data as any).matched_count, unmatched: (data as any).unmatched_count });
    setShowImport(false);
    setReviewBatchId(null);
    queryClient.invalidateQueries({ queryKey: ["audits", orgId] });
    queryClient.invalidateQueries({ queryKey: ["audit-attendance", selectedAuditId] });
  };

  const changeAttendanceStatus = async (id: string, status: AttendanceStatus) => {
    await supabase.from("audit_attendance").update({ status }).eq("id", id);
    queryClient.invalidateQueries({ queryKey: ["audit-attendance", selectedAuditId] });
  };

  if (permLoading) return <LoadingState rows={4} />;

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
        title="ביקורות משרד החינוך"
        description="אירוע ביקורת לפי עמותה/סניף/תאריך + רשימת חסרים מיובאת. התאמה לתלמיד לפי מזהה; לא מותאם נשאר להחלטה. חוסר חוזר (אותו תלמיד הופיע כחסר גם בביקורת קודמת) מסומן ומועלה בעדיפות."
        primaryAction={
          orgId &&
          canManage && (
            <button onClick={() => setShowCreate((v) => !v)} className="btn-primary">
              {showCreate ? "סגירה" : "אירוע ביקורת חדש"}
            </button>
          )
        }
      />

      <div className="mb-4 max-w-sm">
        <label className="field-label">עמותה</label>
        <select
          value={orgId}
          onChange={(e) => {
            setOrgId(e.target.value);
            setSelectedAuditId(null);
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

      {showCreate && orgId && (
        <div className="card mb-6 max-w-2xl space-y-3 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label">סניף (לא חובה)</label>
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="input-field">
                <option value="">— כל הסניפים —</option>
                {(branchesQuery.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.internal_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">תאריך ביקורת</label>
              <input type="date" value={auditDate} onChange={(e) => setAuditDate(e.target.value)} className="input-field" />
            </div>
          </div>
          {error && <ErrorState message={error} />}
          <button onClick={createAudit} disabled={creating} className="btn-primary">
            {creating ? "יוצרת…" : "יצירת אירוע ביקורת"}
          </button>
        </div>
      )}

      {orgId && (
        <DataTable
          columns={[
            { key: "date", header: "תאריך", className: "tabular", render: (a: AuditRow) => a.audit_date },
            { key: "branch", header: "סניף", render: (a: AuditRow) => a.branch?.internal_name ?? "כל הסניפים" },
            { key: "status", header: "סטטוס", render: (a: AuditRow) => <StatusBadge severity={a.status === "completed" ? "ok" : "medium"} label={AUDIT_STATUS_LABEL[a.status]} /> },
          ]}
          rows={auditsQuery.data ?? []}
          rowKey={(a: AuditRow) => a.id}
          loading={auditsQuery.isLoading}
          emptyTitle="אין עדיין אירועי ביקורת"
          emptyIcon={ClipboardList}
          onRowClick={(a: AuditRow) => setSelectedAuditId(a.id === selectedAuditId ? null : a.id)}
        />
      )}

      {selectedAudit && (
        <div className="card mt-4 max-w-4xl space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">
              ביקורת · {selectedAudit.audit_date} · {selectedAudit.branch?.internal_name ?? "כל הסניפים"}
            </h2>
            <div className="flex items-center gap-2">
              <StatusBadge severity={selectedAudit.status === "completed" ? "ok" : "medium"} label={AUDIT_STATUS_LABEL[selectedAudit.status]} />
              {canImport && selectedAudit.status === "draft" && (
                <button onClick={() => setShowImport((v) => !v)} className="btn-secondary flex items-center gap-2 text-xs">
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  {showImport ? "סגירה" : "יבוא רשימת חסרים"}
                </button>
              )}
            </div>
          </div>

          {showImport && !reviewBatchId && (
            <div className="space-y-3 border-t border-slate-200 pt-4">
              <p className="text-xs text-slate-500">עמודה נדרשת: מזהה תלמיד. כל עמודה נוספת נשמרת כפרטי גולמי בלבד.</p>
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
              {legacyWarning && <p className="text-xs text-amber-700">קובץ XLS ישן - מומלץ להמיר ל-XLSX/CSV.</p>}
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
            <div className="space-y-3 border-t border-slate-200 pt-4">
              {reviewRowsQuery.isLoading ? (
                <LoadingState rows={3} />
              ) : (
                <>
                  <p className="text-sm text-slate-600">פתרו שורות "דורש החלטה" ואז קלטו את הרשימה.</p>
                  <ImportPreviewTabs validCount={storedValid.length} needsDecisionCount={storedNeeds.length} invalidCount={storedInvalid.length}>
                    {(tab) => {
                      const data = tab === "valid" ? storedValid : tab === "needsDecision" ? storedNeeds : storedInvalid;
                      return <DataTable columns={storedCols(tab !== "valid")} rows={data} rowKey={(r) => String(r.row_number)} emptyTitle="אין שורות" />;
                    }}
                  </ImportPreviewTabs>
                  {error && <ErrorState message={error} />}
                  <div className="flex gap-3">
                    <button onClick={commit} disabled={committing} className="btn-primary">
                      {committing ? "קולטת…" : "קליטת רשימת החסרים"}
                    </button>
                    <button onClick={() => setReviewBatchId(null)} className="text-xs text-slate-500 underline">
                      חזרה
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {commitResult && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-800">
              נקלטו {commitResult.matched} רשומות. {commitResult.unmatched > 0 && `${commitResult.unmatched} שורות עם בעיה לא נכללו.`}
            </div>
          )}

          {selectedAudit.status === "completed" && (
            <DataTable
              columns={[
                { key: "recurring", header: "", render: (r: AttendanceRow) => (r.is_recurring ? <StatusBadge severity="high" label="חוזר" /> : null) },
                { key: "id", header: "מזהה", className: "tabular", render: (r: AttendanceRow) => r.student?.external_id ?? r.external_student_ref ?? "—" },
                { key: "name", header: "שם", render: (r: AttendanceRow) => r.student?.full_name ?? "(לא הותאם)" },
                { key: "group", header: "קבוצה", render: (r: AttendanceRow) => r.group?.name ?? "—" },
                {
                  key: "status",
                  header: "טיפול",
                  render: (r: AttendanceRow) =>
                    canManage ? (
                      <select value={r.status} onChange={(e) => changeAttendanceStatus(r.id, e.target.value as AttendanceStatus)} className="input-field text-xs">
                        {(Object.keys(ATTENDANCE_STATUS_LABEL) as AttendanceStatus[]).map((s) => (
                          <option key={s} value={s}>
                            {ATTENDANCE_STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      ATTENDANCE_STATUS_LABEL[r.status]
                    ),
                },
              ]}
              rows={attendanceQuery.data ?? []}
              rowKey={(r: AttendanceRow) => r.id}
              loading={attendanceQuery.isLoading}
              emptyTitle="אין רשומות חוסר"
            />
          )}
        </div>
      )}
    </div>
  );
}
