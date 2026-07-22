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

interface EligibilityRow {
  id: string;
  gross_amount: number;
  score_or_payment_type: string | null;
  student: { external_id: string; full_name: string } | null;
}

async function fetchMonthEligibility(orgId: string, month: string): Promise<EligibilityRow[]> {
  const { data, error } = await supabase
    .from("monthly_eligibility")
    .select("id, gross_amount, score_or_payment_type, student:students(external_id, full_name)")
    .eq("organization_id", orgId)
    .eq("month", month)
    .eq("status", "active")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, student: Array.isArray(r.student) ? (r.student[0] ?? null) : r.student }));
}

interface MissingStudent {
  id: string;
  external_id: string;
  full_name: string;
}

// "תלמידים פעילים שלא הופיעו בדוח" - דרישה מפורשת באפיון. תלמיד עם שיוך פעיל בעמותה,
// שכבר נשלח/פעיל בתלמוד, אבל אין לו זכאות פעילה לחודש הזה.
async function fetchMissingFromReport(orgId: string, month: string): Promise<MissingStudent[]> {
  const { data: assigned, error } = await supabase
    .from("student_assignments")
    .select("student_id, students!inner(id, external_id, full_name, status)")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .in("students.status", ["sent_to_talmud", "active", "active_with_error"]);
  if (error) throw error;

  const ids = (assigned ?? []).map((r: any) => r.students.id);
  if (ids.length === 0) return [];

  const { data: eligible } = await supabase.from("monthly_eligibility").select("student_id").eq("organization_id", orgId).eq("month", month).eq("status", "active");
  const eligibleSet = new Set((eligible ?? []).map((e) => e.student_id));

  return (assigned ?? [])
    .map((r: any) => r.students)
    .filter((s: any) => !eligibleSet.has(s.id));
}

export function EligibilityScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canImport, isLoading: permissionLoading } = useHasPermission("talmud", "import");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs, enabled: canImport });

  const [orgId, setOrgId] = useState("");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7) + "-01");
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

  const reviewRowsQuery = useQuery({
    queryKey: ["eligibility-batch-rows", reviewBatchId],
    queryFn: () => fetchImportBatchRows(reviewBatchId!),
    enabled: !!reviewBatchId,
  });

  const monthDataQuery = useQuery({
    queryKey: ["month-eligibility", orgId, month],
    queryFn: () => fetchMonthEligibility(orgId, month),
    enabled: !!orgId && !!month,
  });
  const missingQuery = useQuery({
    queryKey: ["missing-from-report", orgId, month],
    queryFn: () => fetchMissingFromReport(orgId, month),
    enabled: !!orgId && !!month,
  });

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
      const { batchId } = await createImportBatch({ file, profileKey: "talmud_eligibility", organizationId: orgId, periodMonth: month }, parsedRows);
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
    queryClient.invalidateQueries({ queryKey: ["eligibility-batch-rows", reviewBatchId] });
  };

  const commit = async () => {
    if (!reviewBatchId) return;
    setCommitting(true);
    setError(null);
    const { data, error: commitError } = await supabase.rpc("commit_eligibility_batch", { p_batch_id: reviewBatchId, p_month: month }).single();
    setCommitting(false);
    if (commitError) {
      setError(commitError.message);
      return;
    }
    setCommitResult({ matched: (data as any).matched_count, unmatched: (data as any).unmatched_count });
    setReviewBatchId(null);
    queryClient.invalidateQueries({ queryKey: ["month-eligibility", orgId, month] });
    queryClient.invalidateQueries({ queryKey: ["missing-from-report", orgId, month] });
    queryClient.invalidateQueries({ queryKey: ["students"] });
  };

  if (permissionLoading) return <LoadingState rows={4} />;
  if (!canImport) return <ErrorState message="אין לך הרשאה ליבוא דוחות תלמוד." />;

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
      <PageHeader title="זכאות חודשית" description="יבוא דוח זכאות מתלמוד. הזכאות נפרדת לגמרי מתשלום בפועל." />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 max-w-lg mb-4">
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
          <label className="field-label">חודש</label>
          <input type="date" value={month} onChange={(e) => setMonth(e.target.value)} className="input-field" />
        </div>
      </div>

      {orgId && !reviewBatchId && (
        <div className="card mb-6 max-w-2xl space-y-4 p-5">
          <p className="text-xs text-slate-500">עמודות צפויות בקובץ: מזהה תלמיד, סכום ברוטו, ניקוד/סוג תשלום (לא חובה).</p>
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
              <p className="text-sm text-slate-600">פתרו שורות "דורש החלטה" ואז קלטו את הדוח (שורות "שגוי" יישארו מחוץ לזכאות).</p>
              <ImportPreviewTabs validCount={storedValid.length} needsDecisionCount={storedNeeds.length} invalidCount={storedInvalid.length}>
                {(tab) => {
                  const data = tab === "valid" ? storedValid : tab === "needsDecision" ? storedNeeds : storedInvalid;
                  return <DataTable columns={storedCols(tab !== "valid")} rows={data} rowKey={(r) => String(r.row_number)} emptyTitle="אין שורות" />;
                }}
              </ImportPreviewTabs>
              {error && <ErrorState message={error} />}
              <div className="flex gap-3">
                <button onClick={commit} disabled={committing} className="btn-primary">
                  {committing ? "קולטת…" : "קליטת דוח הזכאות"}
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
          נקלטו {commitResult.matched} רשומות זכאות. {commitResult.unmatched > 0 && `${commitResult.unmatched} שורות לא הותאמו לתלמיד ונשארו לבדיקה.`}
        </div>
      )}

      {orgId && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">זכאות לחודש</h2>
          <DataTable
            columns={[
              { key: "id", header: "מזהה", className: "tabular", render: (r: EligibilityRow) => r.student?.external_id ?? "—" },
              { key: "name", header: "שם", render: (r: EligibilityRow) => r.student?.full_name ?? "—" },
              { key: "amount", header: "סכום ברוטו", className: "tabular", render: (r: EligibilityRow) => r.gross_amount.toLocaleString("he-IL") },
              { key: "score", header: "ניקוד/סוג תשלום", render: (r: EligibilityRow) => r.score_or_payment_type ?? "—" },
            ]}
            rows={monthDataQuery.data ?? []}
            rowKey={(r: EligibilityRow) => r.id}
            loading={monthDataQuery.isLoading}
            emptyTitle="אין זכאות לחודש זה עדיין"
          />

          <h2 className="mb-2 mt-6 text-sm font-semibold text-slate-700">תלמידים פעילים שלא הופיעו בדוח</h2>
          <DataTable
            columns={[
              { key: "id", header: "מזהה", className: "tabular", render: (r: MissingStudent) => r.external_id },
              { key: "name", header: "שם", render: (r: MissingStudent) => r.full_name },
            ]}
            rows={missingQuery.data ?? []}
            rowKey={(r: MissingStudent) => r.id}
            loading={missingQuery.isLoading}
            emptyTitle="אין חריגות - כל התלמידים הפעילים הופיעו בדוח"
          />
        </>
      )}
    </div>
  );
}
