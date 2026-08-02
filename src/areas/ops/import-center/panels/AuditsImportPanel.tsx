import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { useLastSelected } from "@/lib/useLastSelected";
import type { ClassifiedRow } from "@/lib/importParsing";
import { analyzeFile, checkDuplicateFile, legacyXlsWarning, createImportBatch, fetchImportBatchRows, resolveImportRow, type StoredImportRow } from "@/lib/importBatches";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { HeaderRowConfirm } from "@/components/HeaderRowConfirm";
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

const AUDIT_STATUS_LABEL: Record<AuditStatus, string> = { draft: "טיוטה", completed: "הושלמה" };

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

// פאנל יבוא רשימת חסרים לביקורת עבור מרכז היבוא - אותה לוגיקה בדיוק כמו AuditsScreen
// (analyzeFile/createImportBatch/commit_audit_attendance_batch), כולל בורר/יצירת אירוע
// ביקורת עצמאי כי היבוא תלוי בבחירת ביקורת ספציפית. המסך המקורי נשאר כפי שהוא.
export function AuditsImportPanel() {
  const queryClient = useQueryClient();
  const { hasPermission: canImport, isLoading: permLoading } = useHasPermission("audits", "import");
  const { hasPermission: canManage } = useHasPermission("audits", "manage");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });

  const [orgId, setOrgId] = useLastSelected<string>("last-org", "");
  const [showCreate, setShowCreate] = useState(false);
  const [branchId, setBranchId] = useState("");
  const [auditDate, setAuditDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [selectedAuditId, setSelectedAuditId] = useState<string | null>(null);
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

  const branchesQuery = useQuery({ queryKey: ["audit-branches", orgId], queryFn: () => fetchBranches(orgId), enabled: !!orgId });
  const auditsQuery = useQuery({ queryKey: ["audits", orgId], queryFn: () => fetchAudits(orgId), enabled: !!orgId });
  const reviewRowsQuery = useQuery({ queryKey: ["audit-batch-rows", reviewBatchId], queryFn: () => fetchImportBatchRows(reviewBatchId!), enabled: !!reviewBatchId });

  const selectedAudit = auditsQuery.data?.find((a) => a.id === selectedAuditId) ?? null;
  const draftAudits = (auditsQuery.data ?? []).filter((a) => a.status === "draft");

  const createAudit = async () => {
    if (!orgId || !auditDate) return;
    setCreating(true);
    setCreateError(null);
    const { data, error: err } = await supabase
      .from("audits")
      .insert({ organization_id: orgId, branch_id: branchId || null, audit_date: auditDate })
      .select("id")
      .single();
    setCreating(false);
    if (err) {
      setCreateError(err.message);
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
    setHeaderConfirm(null);
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
    resetImportForm();
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
    setReviewBatchId(null);
    queryClient.invalidateQueries({ queryKey: ["audits", orgId] });
    queryClient.invalidateQueries({ queryKey: ["audit-attendance", selectedAuditId] });
  };

  if (permLoading) return <LoadingState rows={4} />;
  if (!canImport) return <ErrorState message="אין לך הרשאה לייבא רשימות חסרים לביקורת." />;

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
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">יבוא רשימת חסרים לאירוע ביקורת (התאמה לתלמיד לפי מזהה). לניהול מלא של אירועי ביקורת ותוצאות - מסך "ביקורות משרד החינוך".</p>

      <div className="max-w-sm">
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

      {orgId && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 max-w-2xl">
          <div>
            <label className="field-label">ביקורת (טיוטה קיימת)</label>
            <select value={selectedAuditId ?? ""} onChange={(e) => setSelectedAuditId(e.target.value || null)} className="input-field">
              <option value="">— בחרי —</option>
              {draftAudits.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.audit_date} · {a.branch?.internal_name ?? "כל הסניפים"}
                </option>
              ))}
            </select>
          </div>
          {canManage && (
            <div className="flex items-end">
              <button onClick={() => setShowCreate((v) => !v)} className="btn-secondary text-xs">
                {showCreate ? "סגירה" : "אירוע ביקורת חדש"}
              </button>
            </div>
          )}
        </div>
      )}

      {showCreate && orgId && canManage && (
        <div className="card max-w-2xl space-y-3 p-4">
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
          {createError && <ErrorState message={createError} />}
          <button onClick={createAudit} disabled={creating} className="btn-primary">
            {creating ? "יוצרת…" : "יצירת אירוע ביקורת"}
          </button>
        </div>
      )}

      {selectedAudit && selectedAudit.status === "draft" && !reviewBatchId && (
        <div className="card max-w-2xl space-y-4 p-5">
          {headerConfirm ? (
            <HeaderRowConfirm
              previewRows={headerConfirm.previewRows}
              detectedIndex={headerConfirm.detectedIndex}
              onConfirm={handleHeaderConfirm}
              onCancel={handleHeaderCancel}
            />
          ) : (
            <>
              <p className="text-xs text-ink-subtle">עמודה נדרשת: מזהה תלמיד. כל עמודה נוספת נשמרת כפרטי גולמי בלבד.</p>
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
              {legacyWarning && <p className="text-xs text-warn-ink">קובץ XLS ישן - מומלץ להמיר ל-XLSX/CSV.</p>}
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
            </>
          )}
        </div>
      )}

      {reviewBatchId && (
        <div className="card max-w-2xl space-y-3 p-5">
          {reviewRowsQuery.isLoading ? (
            <LoadingState rows={3} />
          ) : (
            <>
              <p className="text-sm text-ink-muted">פתרו שורות "דורש החלטה" ואז קלטו את הרשימה.</p>
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
                <button onClick={() => setReviewBatchId(null)} className="text-xs text-ink-subtle underline">
                  חזרה
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {commitResult && (
        <div className="rounded-md bg-ok-soft p-3 text-sm text-ok-ink">
          נקלטו {commitResult.matched} רשומות. {commitResult.unmatched > 0 && `${commitResult.unmatched} שורות עם בעיה לא נכללו.`}
        </div>
      )}

      {orgId && selectedAudit && (
        <p className="text-xs text-ink-subtle">
          סטטוס הביקורת הנוכחית: <StatusBadge severity={selectedAudit.status === "completed" ? "ok" : "medium"} label={AUDIT_STATUS_LABEL[selectedAudit.status]} />
          {selectedAudit.status === "completed" && " - ביקורת שהושלמה אינה פתוחה ליבוא נוסף; לצפייה בתוצאות עברי למסך הביקורות."}
        </p>
      )}
    </div>
  );
}
