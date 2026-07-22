import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { parseImportFile, hashFile, classifyRows, isLegacyXls, type ClassifiedRow, type RowStatus } from "@/lib/importParsing";
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

type BatchStatus = "uploaded" | "analyzed" | "previewed" | "committed" | "rejected";

interface BatchRow {
  id: string;
  file_name: string;
  status: BatchStatus;
  row_count: number;
  valid_count: number;
  needs_decision_count: number;
  invalid_count: number;
  organization_id: string | null;
  created_at: string;
  committed_at: string | null;
  organization: { legal_name: string } | null;
}

interface StoredRow {
  row_number: number;
  raw: Record<string, string>;
  status: RowStatus | "committed";
  error_message: string | null;
}

const STATUS_LABEL: Record<BatchStatus, string> = {
  uploaded: "הועלה",
  analyzed: "נותח",
  previewed: "נסקר",
  committed: "נסגר",
  rejected: "בוטל",
};

const OPEN_STATUSES: BatchStatus[] = ["uploaded", "analyzed", "previewed"];

async function fetchOrganizations(): Promise<OrgOption[]> {
  const { data, error } = await supabase.from("organizations").select("id, legal_name").eq("status", "active").order("legal_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchBatches(): Promise<BatchRow[]> {
  const { data, error } = await supabase
    .from("import_batches")
    .select(
      "id, file_name, status, row_count, valid_count, needs_decision_count, invalid_count, organization_id, created_at, committed_at, organization:organizations(legal_name)",
    )
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, organization: Array.isArray(r.organization) ? (r.organization[0] ?? null) : r.organization }));
}

async function fetchBatchById(id: string): Promise<BatchRow> {
  const { data, error } = await supabase
    .from("import_batches")
    .select(
      "id, file_name, status, row_count, valid_count, needs_decision_count, invalid_count, organization_id, created_at, committed_at, organization:organizations(legal_name)",
    )
    .eq("id", id)
    .single();
  if (error) throw error;
  return { ...(data as any), organization: Array.isArray((data as any).organization) ? ((data as any).organization[0] ?? null) : (data as any).organization };
}

async function fetchBatchRows(batchId: string): Promise<StoredRow[]> {
  const { data, error } = await supabase
    .from("import_rows")
    .select("row_number, raw, status, error_message")
    .eq("batch_id", batchId)
    .order("row_number");
  if (error) throw error;
  return data ?? [];
}

// מסנכרן את ספירות הבקרה על import_batches מול המצב האמיתי של import_rows - כי resolveRow
// משנה סטטוס שורה בודדת, ובלי זה הספירות שהוצגו בזמן היצירה היו נשארות לא-מעודכנות.
async function syncBatchCounts(batchId: string) {
  const rows = await fetchBatchRows(batchId);
  await supabase
    .from("import_batches")
    .update({
      valid_count: rows.filter((r) => r.status === "valid").length,
      needs_decision_count: rows.filter((r) => r.status === "needs_decision").length,
      invalid_count: rows.filter((r) => r.status === "invalid").length,
    })
    .eq("id", batchId);
}

export function ImportCenterScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canImport, isLoading: permissionLoading } = useHasPermission("import", "perform");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrganizations, enabled: canImport });
  const batchesQuery = useQuery({ queryKey: ["import-batches"], queryFn: fetchBatches, enabled: canImport });

  const [orgId, setOrgId] = useState("");
  const [periodMonth, setPeriodMonth] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ClassifiedRow[] | null>(null);
  const [legacyWarning, setLegacyWarning] = useState(false);
  const [duplicateOfBatchId, setDuplicateOfBatchId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reviewBatchId, setReviewBatchId] = useState<string | null>(null);
  const [resolvingRow, setResolvingRow] = useState<number | null>(null);
  const [committing, setCommitting] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const reviewBatchQuery = useQuery({
    queryKey: ["import-batch", reviewBatchId],
    queryFn: () => fetchBatchById(reviewBatchId!),
    enabled: !!reviewBatchId,
  });
  const reviewRowsQuery = useQuery({
    queryKey: ["import-batch-rows", reviewBatchId],
    queryFn: () => fetchBatchRows(reviewBatchId!),
    enabled: !!reviewBatchId,
  });

  const resetUploadForm = () => {
    setFile(null);
    setParsedRows(null);
    setLegacyWarning(false);
    setDuplicateOfBatchId(null);
    setError(null);
  };

  const closeReview = () => {
    setReviewBatchId(null);
    queryClient.invalidateQueries({ queryKey: ["import-batches"] });
  };

  const handleFileChange = async (selected: File | null) => {
    resetUploadForm();
    if (!selected) return;
    setFile(selected);
    setAnalyzing(true);
    try {
      const hash = await hashFile(selected);
      const { data: existing } = await supabase.from("import_batches").select("id").eq("file_hash", hash).maybeSingle();
      if (existing) {
        setDuplicateOfBatchId(existing.id);
        setAnalyzing(false);
        return;
      }

      setLegacyWarning(isLegacyXls(selected));
      const parsed = await parseImportFile(selected);
      setParsedRows(classifyRows(parsed.rows));
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בניתוח הקובץ");
    } finally {
      setAnalyzing(false);
    }
  };

  const submitBatch = async () => {
    if (!file || !parsedRows) return;
    setUploading(true);
    setError(null);
    try {
      const hash = await hashFile(file);
      const { data: profile, error: profileError } = await supabase
        .from("import_profiles")
        .select("id")
        .eq("key", "generic_csv_xlsx")
        .single();
      if (profileError || !profile) throw new Error("פרופיל היבוא הכללי לא נמצא");

      const path = `${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from("import-files").upload(path, file);
      if (uploadError) throw new Error(`העלאת הקובץ נכשלה: ${uploadError.message}`);

      const { data: batch, error: batchError } = await supabase
        .from("import_batches")
        .insert({
          profile_id: profile.id,
          organization_id: orgId || null,
          period_month: periodMonth || null,
          file_path: path,
          file_name: file.name,
          file_hash: hash,
          row_count: parsedRows.length,
          valid_count: parsedRows.filter((r) => r.status === "valid").length,
          needs_decision_count: parsedRows.filter((r) => r.status === "needs_decision").length,
          invalid_count: parsedRows.filter((r) => r.status === "invalid").length,
          status: "previewed",
        })
        .select("id")
        .single();
      if (batchError || !batch) throw new Error(batchError?.message ?? "יצירת האצווה נכשלה");

      const { error: rowsError } = await supabase.from("import_rows").insert(
        parsedRows.map((r) => ({
          batch_id: batch.id,
          row_number: r.rowNumber,
          raw: r.raw,
          status: r.status,
          error_message: r.errorMessage,
        })),
      );
      if (rowsError) throw new Error(`שמירת השורות נכשלה: ${rowsError.message}`);

      resetUploadForm();
      queryClient.invalidateQueries({ queryKey: ["import-batches"] });
      setReviewBatchId(batch.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה לא צפויה");
    } finally {
      setUploading(false);
    }
  };

  const resolveRow = async (rowNumber: number, status: "valid" | "invalid") => {
    if (!reviewBatchId) return;
    setResolvingRow(rowNumber);
    await supabase.from("import_rows").update({ status }).eq("batch_id", reviewBatchId).eq("row_number", rowNumber);
    await syncBatchCounts(reviewBatchId);
    setResolvingRow(null);
    queryClient.invalidateQueries({ queryKey: ["import-batch-rows", reviewBatchId] });
    queryClient.invalidateQueries({ queryKey: ["import-batch", reviewBatchId] });
  };

  const commitBatch = async () => {
    if (!reviewBatchId) return;
    setCommitting(true);
    setError(null);
    const { error: commitError } = await supabase.rpc("commit_import_batch", { p_batch_id: reviewBatchId });
    setCommitting(false);
    if (commitError) {
      setError(commitError.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["import-batch", reviewBatchId] });
    queryClient.invalidateQueries({ queryKey: ["import-batch-rows", reviewBatchId] });
    queryClient.invalidateQueries({ queryKey: ["import-batches"] });
  };

  const rejectBatch = async () => {
    if (!reviewBatchId) return;
    setRejecting(true);
    await supabase.rpc("reject_import_batch", { p_batch_id: reviewBatchId, p_reason: "בוטל ידנית ממרכז היבוא" });
    setRejecting(false);
    closeReview();
  };

  if (permissionLoading) return <LoadingState rows={4} />;
  if (!canImport) return <ErrorState message="אין לך הרשאה לייבא קבצים." />;

  const validRows = (parsedRows ?? []).filter((r) => r.status === "valid");
  const needsDecisionRows = (parsedRows ?? []).filter((r) => r.status === "needs_decision");
  const invalidRows = (parsedRows ?? []).filter((r) => r.status === "invalid");

  const storedRows = reviewRowsQuery.data ?? [];
  const storedValid = storedRows.filter((r) => r.status === "valid" || r.status === "committed");
  const storedNeedsDecision = storedRows.filter((r) => r.status === "needs_decision");
  const storedInvalid = storedRows.filter((r) => r.status === "invalid");
  const reviewIsOpen = reviewBatchQuery.data ? OPEN_STATUSES.includes(reviewBatchQuery.data.status) : false;

  const localColumns: DataTableColumn<ClassifiedRow>[] = [
    { key: "num", header: "#", className: "tabular", render: (r) => r.rowNumber },
    { key: "content", header: "תוכן השורה", render: (r) => <span className="text-xs">{JSON.stringify(r.raw)}</span> },
    { key: "note", header: "הערה", render: (r) => r.errorMessage ?? "—" },
  ];

  const storedColumns = (allowResolve: boolean): DataTableColumn<StoredRow>[] => [
    { key: "num", header: "#", className: "tabular", render: (r) => r.row_number },
    { key: "content", header: "תוכן השורה", render: (r) => <span className="text-xs">{JSON.stringify(r.raw)}</span> },
    { key: "note", header: "הערה", render: (r) => r.error_message ?? "—" },
    ...(allowResolve
      ? [
          {
            key: "actions",
            header: "",
            render: (r: StoredRow) => (
              <div className="flex gap-2">
                <button
                  disabled={resolvingRow === r.row_number}
                  onClick={() => resolveRow(r.row_number, "valid")}
                  className="link-action text-xs disabled:opacity-50"
                >
                  סמן תקין
                </button>
                <button
                  disabled={resolvingRow === r.row_number}
                  onClick={() => resolveRow(r.row_number, "invalid")}
                  className="text-xs text-red-600 underline hover:text-red-800 disabled:opacity-50"
                >
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
        title="מרכז יבוא"
        description="העלאת קובץ CSV/XLSX, תצוגה מקדימה לפני קליטה, וסגירת אצווה. תשתית כללית - יבוא מסוגי דוחות ספציפיים (זכאות, בנק) יתווסף עם השלבים הרלוונטיים."
      />

      {!reviewBatchId && (
        <div className="card mb-6 max-w-2xl space-y-4 p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label">עמותה (לא חובה)</label>
              <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className="input-field">
                <option value="">— ללא —</option>
                {(orgsQuery.data ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.legal_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">חודש (לא חובה)</label>
              <input type="date" value={periodMonth} onChange={(e) => setPeriodMonth(e.target.value)} className="input-field" />
            </div>
          </div>

          <div>
            <label className="field-label">קובץ (CSV / XLSX)</label>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              className="input-field"
            />
          </div>

          {analyzing && <LoadingState rows={2} />}

          {duplicateOfBatchId && (
            <div className="space-y-2">
              <ErrorState message="הקובץ הזה כבר יובא בעבר (אצווה קיימת). לא ניתן לייבא אותו קובץ פעמיים." />
              <button onClick={() => setReviewBatchId(duplicateOfBatchId)} className="link-action text-xs">
                פתיחת האצווה הקיימת
              </button>
            </div>
          )}

          {legacyWarning && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>קובץ XLS ישן (פורמט טרום-2007) - הפרסור עשוי להיות לא מדויק. מומלץ להמיר ל-XLSX או CSV לפני היבוא.</span>
            </div>
          )}

          {error && <ErrorState message={error} />}

          {parsedRows && !duplicateOfBatchId && (
            <>
              <ImportPreviewTabs validCount={validRows.length} needsDecisionCount={needsDecisionRows.length} invalidCount={invalidRows.length}>
                {(tab) => {
                  const data = tab === "valid" ? validRows : tab === "needsDecision" ? needsDecisionRows : invalidRows;
                  return <DataTable columns={localColumns} rows={data} rowKey={(r) => String(r.rowNumber)} emptyTitle="אין שורות בקטגוריה זו" />;
                }}
              </ImportPreviewTabs>

              <button onClick={submitBatch} disabled={uploading} className="btn-primary flex items-center gap-2">
                <Upload className="h-4 w-4" aria-hidden="true" />
                {uploading ? "מעלה ושומרת…" : "אישור ויצירת אצווה"}
              </button>
            </>
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
                  <p className="text-sm font-medium text-slate-900">{reviewBatchQuery.data.file_name}</p>
                  <p className="text-xs text-slate-500">
                    {reviewBatchQuery.data.organization?.legal_name ?? "ללא עמותה"} · {new Date(reviewBatchQuery.data.created_at).toLocaleDateString("he-IL")}
                  </p>
                </div>
                <StatusBadge
                  severity={reviewBatchQuery.data.status === "committed" ? "ok" : reviewBatchQuery.data.status === "rejected" ? "neutral" : "medium"}
                  label={STATUS_LABEL[reviewBatchQuery.data.status]}
                />
              </div>

              {reviewIsOpen && (
                <p className="text-sm text-slate-600">אפשר לתקן שורות "דורש החלטה" כאן, ואז לסגור את האצווה.</p>
              )}

              <ImportPreviewTabs validCount={storedValid.length} needsDecisionCount={storedNeedsDecision.length} invalidCount={storedInvalid.length}>
                {(tab) => {
                  const data = tab === "valid" ? storedValid : tab === "needsDecision" ? storedNeedsDecision : storedInvalid;
                  return (
                    <DataTable
                      columns={storedColumns(reviewIsOpen && tab !== "valid")}
                      rows={data}
                      rowKey={(r) => String(r.row_number)}
                      emptyTitle="אין שורות בקטגוריה זו"
                    />
                  );
                }}
              </ImportPreviewTabs>

              {error && <ErrorState message={error} />}

              {reviewIsOpen && (
                <div className="flex flex-wrap gap-3">
                  <button onClick={commitBatch} disabled={committing} className="btn-primary">
                    {committing ? "סוגרת…" : "סגירת אצווה"}
                  </button>
                  <button onClick={rejectBatch} disabled={rejecting} className="text-xs text-red-600 underline hover:text-red-800">
                    {rejecting ? "מבטלת…" : "ביטול אצווה"}
                  </button>
                </div>
              )}
              <button onClick={closeReview} className="text-xs text-slate-500 underline">
                חזרה לרשימה / יבוא נוסף
              </button>
            </>
          ) : (
            <ErrorState message="האצווה לא נמצאה." />
          )}
        </div>
      )}

      <h2 className="mb-2 text-sm font-semibold text-slate-700">היסטוריית יבואים</h2>
      <DataTable
        columns={[
          { key: "file", header: "קובץ", render: (b) => b.file_name },
          { key: "org", header: "עמותה", render: (b) => b.organization?.legal_name ?? "—" },
          {
            key: "counts",
            header: "תקין / דורש החלטה / שגוי",
            className: "tabular",
            render: (b) => `${b.valid_count} / ${b.needs_decision_count} / ${b.invalid_count}`,
          },
          {
            key: "status",
            header: "סטטוס",
            render: (b) => (
              <StatusBadge
                severity={b.status === "committed" ? "ok" : b.status === "rejected" ? "neutral" : "medium"}
                label={STATUS_LABEL[b.status]}
              />
            ),
          },
          { key: "date", header: "תאריך", className: "tabular", render: (b) => new Date(b.created_at).toLocaleDateString("he-IL") },
        ]}
        rows={batchesQuery.data ?? []}
        rowKey={(b) => b.id}
        loading={batchesQuery.isLoading}
        emptyTitle="אין עדיין יבואים"
        onRowClick={(b) => setReviewBatchId(b.id)}
      />
    </div>
  );
}
