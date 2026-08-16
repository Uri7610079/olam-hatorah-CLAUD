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
import { ColumnMappingConfirm } from "@/components/ColumnMappingConfirm";
import { PassportCountryStep, type PassportRow } from "@/components/PassportCountryStep";
import { buildMappingPlan, applyColumnMapping, STUDENT_IMPORT_FIELDS, type MappingPlan } from "@/lib/columnMapping";
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
  assigned: number;
  bankAccounts: number;
}

interface RollbackPreviewRow {
  student_id: string;
  full_name: string;
  external_id: string;
  will_delete: boolean;
  block_reason: string | null;
}

async function fetchRollbackPreview(batchId: string): Promise<RollbackPreviewRow[]> {
  const { data, error } = await supabase.rpc("preview_students_import_rollback", { p_batch_id: batchId });
  if (error) throw error;
  return (data ?? []) as RollbackPreviewRow[];
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
  // התאמת עמודות - מוצגת כשכותרות הקובץ אינן זהות לשמות השדות אבל נראות מוכרות.
  const [mappingConfirm, setMappingConfirm] = useState<{ plan: MappingPlan; headers: string[]; sample: Record<string, string>; rows: ClassifiedRow[] } | null>(null);
  // מדינת דרכון - נשאלת אחרי התאמת העמודות, כי רק אז ידוע איזו עמודה היא "סוג מזהה".
  const [passportStep, setPassportStep] = useState<{ rows: ClassifiedRow[]; passports: PassportRow[] } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ביטול יבוא - מוצג רק לאצווה שכבר נקלטה, ותמיד עם תצוגה מקדימה + הקלדת שם
  // הקובץ לאישור, כי זו מחיקה בלתי הפיכה של רשומות אמת.
  const [rollbackBatch, setRollbackBatch] = useState<{ id: string; fileName: string } | null>(null);
  const [rollbackConfirmText, setRollbackConfirmText] = useState("");
  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackResult, setRollbackResult] = useState<{ deleted: number; kept: number } | null>(null);

  const [reviewBatchId, setReviewBatchId] = useState<string | null>(null);
  const [resolvingRow, setResolvingRow] = useState<number | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);

  const batchesQuery = useQuery({ queryKey: ["students-import-batches"], queryFn: fetchStudentsBatches });
  const rollbackPreviewQuery = useQuery({
    queryKey: ["students-import-rollback-preview", rollbackBatch?.id],
    queryFn: () => fetchRollbackPreview(rollbackBatch!.id),
    enabled: !!rollbackBatch,
  });
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
    setMappingConfirm(null);
    setPassportStep(null);
    setError(null);
  };

  const closeReview = () => {
    setReviewBatchId(null);
    setCommitResult(null);
    queryClient.invalidateQueries({ queryKey: ["students-import-batches"] });
  };


  // בין הניתוח להצגה: אם הכותרות לא תואמות לשמות השדות, שואלים לפני שממשיכים -
  // במקום להציג 1583 שורות שגויות בהודעה שלא מסבירה מה לתקן.
  const applyOrAsk = (rows: ClassifiedRow[]) => {
    const headers = rows.length > 0 ? Object.keys(rows[0].raw) : [];
    const plan = buildMappingPlan(headers, STUDENT_IMPORT_FIELDS);
    if (plan.questions.length === 0) {
      askPassportOrFinish(rows);
      return;
    }
    setMappingConfirm({ plan, headers, sample: rows[0]?.raw ?? {}, rows });
  };

  const handleMappingConfirm = (mapping: Record<string, string>) => {
    if (!mappingConfirm) return;
    const mapped = mappingConfirm.rows.map((r) => ({ ...r, raw: applyColumnMapping(r.raw, mapping) }));
    setMappingConfirm(null);
    askPassportOrFinish(mapped);
  };

  // מספר דרכון אינו ייחודי בעולם, ולכן בלי מדינה הוא אינו מזהה. נשאל רק כשיש
  // בפועל שורות דרכון בקובץ - קובץ של תעודות זהות בלבד ממשיך ישר.
  const askPassportOrFinish = (rows: ClassifiedRow[]) => {
    const passports: PassportRow[] = rows
      .filter((r) => (r.raw["סוג מזהה"] ?? "").trim() === "דרכון" || (r.raw["סוג מזהה"] ?? "").trim() === "passport")
      .map((r) => ({
        rowNumber: r.rowNumber,
        name: (r.raw["שם מלא"] ?? "").trim(),
        passportNumber: (r.raw["מזהה חיצוני"] ?? "").trim(),
      }));
    if (passports.length === 0) {
      setParsedRows(rows);
      return;
    }
    setPassportStep({ rows, passports });
  };

  const handlePassportConfirm = (countryByRow: Record<number, string>) => {
    if (!passportStep) return;
    setParsedRows(
      passportStep.rows.map((r) =>
        countryByRow[r.rowNumber] ? { ...r, raw: { ...r.raw, "מדינת דרכון": countryByRow[r.rowNumber] } } : r,
      ),
    );
    setPassportStep(null);
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
      applyOrAsk(result.rows);
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
      applyOrAsk(result.rows);
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
    const result = data as {
      created_count: number; duplicate_count: number; invalid_count: number;
      assigned_count: number; bank_account_count: number;
    };
    setCommitResult({
      created: result.created_count,
      duplicate: result.duplicate_count,
      invalid: result.invalid_count,
      assigned: result.assigned_count ?? 0,
      bankAccounts: result.bank_account_count ?? 0,
    });
    queryClient.invalidateQueries({ queryKey: ["students-import-batch", reviewBatchId] });
    queryClient.invalidateQueries({ queryKey: ["students-import-batch-rows", reviewBatchId] });
    queryClient.invalidateQueries({ queryKey: ["students-import-batches"] });
    queryClient.invalidateQueries({ queryKey: ["students"] });
  };

  const closeRollback = () => {
    setRollbackBatch(null);
    setRollbackConfirmText("");
  };

  const runRollback = async () => {
    if (!rollbackBatch || rollbackConfirmText.trim() !== rollbackBatch.fileName) return;
    setRollingBack(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("rollback_students_import_batch", { p_batch_id: rollbackBatch.id }).single();
    setRollingBack(false);
    if (err) {
      setError(err.message);
      return;
    }
    const result = data as { deleted_count: number; kept_count: number };
    setRollbackResult({ deleted: result.deleted_count, kept: result.kept_count });
    closeRollback();
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
    <div className="card mb-6 max-w-3xl space-y-4 p-5">
      <p className="text-sm text-ink-muted">יבוא תלמידים חדשים מקובץ אקסל. כל תלמיד נוצר בסטטוס טיוטה, בדיוק כמו ביצירה ידנית.</p>

      {!reviewBatchId && (
        <>
          <p className="text-xs text-ink-subtle">
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
            <div className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn-soft p-3 text-sm text-warn-ink">
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

          {mappingConfirm && (
            <ColumnMappingConfirm
              plan={mappingConfirm.plan}
              headers={mappingConfirm.headers}
              sample={mappingConfirm.sample}
              onConfirm={handleMappingConfirm}
              onCancel={resetForm}
            />
          )}

          {passportStep && (
            <PassportCountryStep rows={passportStep.passports} onConfirm={handlePassportConfirm} onCancel={resetForm} />
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
                <p className="text-sm font-medium text-ink">{reviewBatchQuery.data.file_name}</p>
                <StatusBadge
                  severity={reviewBatchQuery.data.status === "committed" ? "ok" : reviewBatchQuery.data.status === "rejected" ? "neutral" : "medium"}
                  label={BATCH_STATUS_LABEL[reviewBatchQuery.data.status]}
                />
              </div>

              {reviewIsOpen && <p className="text-sm text-ink-muted">פתרו שורות "דורש החלטה" ואז קלטו את הקובץ (שורות "שגוי" יישארו מחוץ ליבוא).</p>}

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
              <button onClick={closeReview} className="text-xs text-ink-subtle underline">
                חזרה / יבוא נוסף
              </button>
            </>
          ) : (
            <ErrorState message="האצווה לא נמצאה." />
          )}
        </>
      )}

      {commitResult && (
        <div className="rounded-md bg-ok-soft p-3 text-sm text-ok-ink">
          נוצרו {commitResult.created} תלמידים חדשים.
          {commitResult.assigned > 0 && ` ${commitResult.assigned} שויכו לקבוצה.`}
          {commitResult.created > commitResult.assigned &&
            ` ${commitResult.created - commitResult.assigned} נוצרו בלי שיוך (לא נמצאה הקבוצה לפי עמותה+סניף+שם).`}
          {commitResult.bankAccounts > 0 && ` ${commitResult.bankAccounts} חשבונות בנק נקלטו - כולם ממתינים לאימות.`}
          {commitResult.duplicate > 0 && ` ${commitResult.duplicate} שורות דולגו (תלמיד קיים כבר).`}
          {commitResult.invalid > 0 && ` ${commitResult.invalid} שורות שגויות (חסר שדה חובה).`}
        </div>
      )}

      {rollbackResult && (
        <div className="rounded-md bg-ok-soft p-3 text-sm text-ok-ink">
          היבוא בוטל. נמחקו {rollbackResult.deleted} תלמידים.
          {rollbackResult.kept > 0 && ` ${rollbackResult.kept} תלמידים נשארו כי כבר נעשה בהם שימוש.`}
        </div>
      )}

      {rollbackBatch && (
        <div className="card space-y-3 border-danger bg-danger-soft p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-ink">ביטול היבוא: {rollbackBatch.fileName}</p>
              <p className="mt-1 text-sm text-ink-muted">
                התלמידים שנוצרו ביבוא הזה יימחקו לצמיתות - פעולה בלתי הפיכה. תלמיד שכבר נעשה בו שימוש (שיוך, חשבון בנק,
                זכאות, תשלום וכו') לא יימחק, ויוצג כאן עם הסיבה.
              </p>
            </div>
          </div>

          {rollbackPreviewQuery.isLoading ? (
            <LoadingState rows={3} />
          ) : rollbackPreviewQuery.error ? (
            <ErrorState message="שגיאה בטעינת התצוגה המקדימה." />
          ) : (
            (() => {
              const rows = rollbackPreviewQuery.data ?? [];
              const toDelete = rows.filter((r) => r.will_delete);
              const kept = rows.filter((r) => !r.will_delete);
              return (
                <>
                  <p className="text-sm text-ink">
                    <span className="font-semibold">{toDelete.length}</span> תלמידים יימחקו
                    {kept.length > 0 && (
                      <>
                        , <span className="font-semibold">{kept.length}</span> יישארו
                      </>
                    )}
                    .
                  </p>

                  {kept.length > 0 && (
                    <div className="max-h-40 overflow-auto rounded border border-line bg-surface p-2">
                      <p className="mb-1 text-xs font-medium text-ink-muted">לא יימחקו:</p>
                      <ul className="space-y-0.5 text-xs text-ink-muted">
                        {kept.map((r) => (
                          <li key={r.student_id}>
                            {r.full_name} <span className="ltr-num">{r.external_id}</span> — {r.block_reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {toDelete.length > 0 && (
                    <div>
                      <label className="field-label" htmlFor="rollback-confirm">
                        כדי לאשר, הקלידי את שם הקובץ בדיוק: {rollbackBatch.fileName}
                      </label>
                      <input
                        id="rollback-confirm"
                        value={rollbackConfirmText}
                        onChange={(e) => setRollbackConfirmText(e.target.value)}
                        className="input-field"
                        autoComplete="off"
                      />
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={runRollback}
                      disabled={rollingBack || toDelete.length === 0 || rollbackConfirmText.trim() !== rollbackBatch.fileName}
                      className="btn-danger text-xs"
                    >
                      {rollingBack ? "מוחקת…" : "אישור מחיקה סופית"}
                    </button>
                    <button onClick={closeRollback} className="text-xs text-ink-subtle underline">
                      ביטול
                    </button>
                  </div>
                </>
              );
            })()
          )}
        </div>
      )}

      <div>
        <h3 className="mb-2 mt-2 text-sm font-semibold text-ink-muted">היסטוריית יבוא תלמידים</h3>
        <DataTable
          columns={[
            { key: "file", header: "קובץ", render: (b: StudentsBatchSummary) => b.file_name },
            {
              key: "counts",
              header: "תקין / דורש החלטה / שגוי",
              // ltr-num ולא רק tabular: "1583 / 0 / 0" הוא רצף של תווים ניטרליים,
              // ובהקשר RTL הוא נקרא הפוך - כלומר אצווה עם 1583 תקינות הוצגה כאילו
              // יש בה 1583 שגויות, וההפך. נתפס מול צילום מסך אמיתי של ההיסטוריה.
              className: "tabular ltr-num",
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
            {
              key: "rollback",
              header: "",
              render: (b: StudentsBatchSummary) =>
                b.status === "committed" ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setRollbackResult(null);
                      setRollbackConfirmText("");
                      setRollbackBatch({ id: b.id, fileName: b.file_name });
                    }}
                    className="text-xs text-danger underline hover:text-danger-ink"
                  >
                    ביטול יבוא
                  </button>
                ) : null,
            },
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
