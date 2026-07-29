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
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ImportPreviewTabs } from "@/components/ImportPreviewTabs";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { HeaderRowConfirm } from "@/components/HeaderRowConfirm";

type BatchStatus = "uploaded" | "analyzed" | "previewed" | "committed" | "rejected";
const OPEN_STATUSES: BatchStatus[] = ["uploaded", "analyzed", "previewed"];
const BATCH_STATUS_LABEL: Record<BatchStatus, string> = {
  uploaded: "הועלה",
  analyzed: "נותח",
  previewed: "נסקר",
  committed: "נקלט",
  rejected: "בוטל",
};

interface StudentsBatchSummary {
  id: string;
  file_name: string;
  status: BatchStatus;
  valid_count: number;
  needs_decision_count: number;
  invalid_count: number;
  created_at: string;
}

async function fetchStudentsBatches(): Promise<StudentsBatchSummary[]> {
  const profile = await supabase.from("import_profiles").select("id").eq("key", "students").single();
  if (!profile.data) return [];
  const { data, error } = await supabase
    .from("import_batches")
    .select("id, file_name, status, valid_count, needs_decision_count, invalid_count, created_at")
    .eq("profile_id", profile.data.id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

async function fetchBatchById(id: string): Promise<StudentsBatchSummary> {
  const { data, error } = await supabase
    .from("import_batches")
    .select("id, file_name, status, valid_count, needs_decision_count, invalid_count, created_at")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

interface CommitResult {
  created: number;
  duplicate: number;
  invalid: number;
}

// פאנל יבוא תלמידים מאקסל - אותו דפוס בדיוק כמו EligibilityImportPanel (מרכז היבוא),
// רק בלי בורר עמותה/חודש (תלמיד אינו קשור לעמותה בשלב היצירה, השיוך קורה בנפרד בכרטיס
// התלמיד, בדיוק כמו ביצירה ידנית ב-StudentsListScreen). analyzeFile/createImportBatch/
// commit_students_import_batch (076) הן אותה תשתית משותפת כמו כל דומיין יבוא אחר.
export function StudentsImportPanel() {
  const queryClient = useQueryClient();
  const { hasPermission: canImport } = useHasPermission("students", "manage");

  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ClassifiedRow[] | null>(null);
  const [legacyWarning, setLegacyWarning] = useState(false);
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  const [headerConfirm, setHeaderConfirm] = useState<{ file: File; previewRows: string[][]; detectedIndex: number } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reviewBatchId, setReviewBatchId] = useState<string | null>(null);
  const [resolvingRow, setResolvingRow] = useState<number | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);

  const batchesQuery = useQuery({ queryKey: ["students-import-batches"], queryFn: fetchStudentsBatches });
  const reviewBatchQuery = useQuery({ queryKey: ["students-import-batch", reviewBatchId], queryFn: () => fetchBatchById(reviewBatchId!), enabled: !!reviewBatchId });
  const reviewRowsQuery = useQuery({
    queryKey: ["students-import-batch-rows", reviewBatchId],
    queryFn: () => fetchImportBatchRows(reviewBatchId!),
    enabled: !!reviewBatchId,
  });

  const resetForm = () => {
    setFile(null);
    setParsedRows(null);
    setLegacyWarning(false);
    setDuplicateId(null);
    setHeaderConfirm(null);
    setError(null);
  };

  const closeReview = () => {
    setReviewBatchId(null);
    setCommitResult(null);
    queryClient.invalidateQueries({ queryKey: ["students-import-batches"] });
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
    setAnalyzing(true);
    try {
      const result = await analyzeFile(chosenFile, chosenIndex);
      setParsedRows(result.rows);
      setHeaderConfirm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בניתוח הקובץ");
      setHeaderConfirm(null);
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
      const { batchId } = await createImportBatch({ file, profileKey: "students" }, parsedRows);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["students-import-batches"] });
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
    queryClient.invalidateQueries({ queryKey: ["students-import-batch-rows", reviewBatchId] });
  };

  const commit = async () => {
    if (!reviewBatchId) return;
    setCommitting(true);
    setError(null);
    const { data, error: commitError } = await supabase.rpc("commit_students_import_batch", { p_batch_id: reviewBatchId }).single();
    setCommitting(false);
    if (commitError) {
      setError(commitError.message);
      return;
    }
    const result = data as { created_count: number; duplicate_count: number; invalid_count: number };
    setCommitResult({ created: result.created_count, duplicate: result.duplicate_count, invalid: result.invalid_count });
    queryClient.invalidateQueries({ queryKey: ["students-import-batch", reviewBatchId] });
    queryClient.invalidateQueries({ queryKey: ["students-import-batch-rows", reviewBatchId] });
    queryClient.invalidateQueries({ queryKey: ["students-import-batches"] });
    queryClient.invalidateQueries({ queryKey: ["students"] });
  };

  if (!canImport) return <ErrorState message="אין לך הרשאה ליבוא תלמידים." />;

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
    <div className="card mb-6 max-w-3xl space-y-4 p-5">
      <p className="text-sm text-slate-600">יבוא תלמידים חדשים מקובץ אקסל. כל תלמיד נוצר בסטטוס טיוטה, בדיוק כמו ביצירה ידנית.</p>

      {!reviewBatchId && (
        <>
          <p className="text-xs text-slate-500">
            עמודות בקובץ: סוג מזהה (ת"ז/דרכון/אחר, ברירת מחדל ת"ז), מזהה חיצוני (חובה), שם מלא (חובה), טלפון, תאריך לידה, כתובת (רחוב), מס בית, עיר, קוד לימוד. ניתן להעלות גם קובץ שהורדת ישירות ממערכת תלמוד ("שאילתת תלמיד") - הכותרות שלו מזוהות אוטומטית.
          </p>
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
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>קובץ XLS ישן - מומלץ להמיר ל-XLSX/CSV.</span>
            </div>
          )}
          {error && <ErrorState message={error} />}

          {headerConfirm && (
            <HeaderRowConfirm
              previewRows={headerConfirm.previewRows}
              detectedIndex={headerConfirm.detectedIndex}
              onConfirm={handleHeaderConfirm}
              onCancel={handleHeaderCancel}
            />
          )}

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

      {reviewBatchId && (
        <>
          {reviewBatchQuery.isLoading || reviewRowsQuery.isLoading ? (
            <LoadingState rows={4} />
          ) : reviewBatchQuery.data ? (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-900">{reviewBatchQuery.data.file_name}</p>
                <StatusBadge
                  severity={reviewBatchQuery.data.status === "committed" ? "ok" : reviewBatchQuery.data.status === "rejected" ? "neutral" : "medium"}
                  label={BATCH_STATUS_LABEL[reviewBatchQuery.data.status]}
                />
              </div>

              {reviewIsOpen && <p className="text-sm text-slate-600">פתרו שורות "דורש החלטה" ואז קלטו את הקובץ (שורות "שגוי" יישארו מחוץ ליבוא).</p>}

              <ImportPreviewTabs validCount={storedValid.length} needsDecisionCount={storedNeeds.length} invalidCount={storedInvalid.length}>
                {(tab) => {
                  const data = tab === "valid" ? storedValid : tab === "needsDecision" ? storedNeeds : storedInvalid;
                  return <DataTable columns={storedCols(reviewIsOpen && tab !== "valid")} rows={data} rowKey={(r) => String(r.row_number)} emptyTitle="אין שורות" />;
                }}
              </ImportPreviewTabs>

              {error && <ErrorState message={error} />}

              {reviewIsOpen && (
                <button onClick={commit} disabled={committing} className="btn-primary">
                  {committing ? "קולטת…" : "קליטת התלמידים"}
                </button>
              )}
              <button onClick={closeReview} className="text-xs text-slate-500 underline">
                חזרה / יבוא נוסף
              </button>
            </>
          ) : (
            <ErrorState message="האצווה לא נמצאה." />
          )}
        </>
      )}

      {commitResult && (
        <div className="rounded-md bg-green-50 p-3 text-sm text-green-800">
          נוצרו {commitResult.created} תלמידים חדשים.
          {commitResult.duplicate > 0 && ` ${commitResult.duplicate} שורות דולגו (תלמיד קיים כבר).`}
          {commitResult.invalid > 0 && ` ${commitResult.invalid} שורות שגויות (חסר שדה חובה).`}
        </div>
      )}

      <div>
        <h3 className="mb-2 mt-2 text-sm font-semibold text-slate-700">היסטוריית יבוא תלמידים</h3>
        <DataTable
          columns={[
            { key: "file", header: "קובץ", render: (b: StudentsBatchSummary) => b.file_name },
            {
              key: "counts",
              header: "תקין / דורש החלטה / שגוי",
              className: "tabular",
              render: (b: StudentsBatchSummary) => `${b.valid_count} / ${b.needs_decision_count} / ${b.invalid_count}`,
            },
            {
              key: "status",
              header: "סטטוס",
              render: (b: StudentsBatchSummary) => (
                <StatusBadge severity={b.status === "committed" ? "ok" : b.status === "rejected" ? "neutral" : "medium"} label={BATCH_STATUS_LABEL[b.status]} />
              ),
            },
            { key: "date", header: "תאריך", className: "tabular", render: (b: StudentsBatchSummary) => new Date(b.created_at).toLocaleDateString("he-IL") },
          ]}
          rows={batchesQuery.data ?? []}
          rowKey={(b: StudentsBatchSummary) => b.id}
          loading={batchesQuery.isLoading}
          emptyTitle="אין עדיין יבואים"
          onRowClick={(b: StudentsBatchSummary) => setReviewBatchId(b.id)}
        />
      </div>
    </div>
  );
}
