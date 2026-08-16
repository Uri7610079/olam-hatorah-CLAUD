import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import type { ClassifiedRow } from "@/lib/importParsing";
import { translateMasterDataRow } from "@/lib/masterDataHeaderAliases";
import { analyzeFile, checkDuplicateFile, legacyXlsWarning, createImportBatch, fetchImportBatchRows, resolveImportRow, type StoredImportRow } from "@/lib/importBatches";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { HeaderRowConfirm } from "@/components/HeaderRowConfirm";
import { ImportPreviewTabs } from "@/components/ImportPreviewTabs";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";

interface CommitResult {
  created_organizations: number;
  created_branches: number;
  created_groups: number;
  created_group_leaders: number;
}

// בדיקות פערים ספציפיות לדומיין, מעל הסיווג הגנרי (classifyRows, שלב 5): שם עמותה
// (legal_name) חובה בכל שורה; שם קבוצה בלי קוד סניף לא ייצור קבוצה - במקום לדלג בשקט,
// מסמנים "דורש החלטה" כדי שהמשתמש יראה את הפער ויחליט במודע לפני קליטה (לא אחריה).
function applyMasterDataGapChecks(rows: ClassifiedRow[]): ClassifiedRow[] {
  return rows.map((r) => {
    // תרגום כותרות עברית לשמות השדות, לפני כל בדיקה. חייב לקרות כאן ולא מאוחר
    // יותר: ה-raw הזה הוא מה שנשמר ב-import_rows ומה שפונקציית הקליטה בשרת
    // קוראת, כך שהתרגום תקף לכל השרשרת ובלי לגעת ב-SQL.
    const raw = translateMasterDataRow(r.raw);
    r = { ...r, raw };
    if (r.status !== "valid") return r;
    const legalName = (r.raw.legal_name ?? "").trim();
    const branchCode = (r.raw.talmud_branch_code ?? "").trim();
    const groupName = (r.raw.group_name ?? "").trim();
    if (!legalName) {
      return { ...r, status: "invalid", errorMessage: "חסר שם עמותה (legal_name) - שורה זו לא תיקלט" };
    }
    if (groupName && !branchCode) {
      return { ...r, status: "needs_decision", errorMessage: "יש שם קבוצה (group_name) אך חסר קוד סניף (talmud_branch_code) - הקבוצה לא תיווצר בלי סניף" };
    }
    return r;
  });
}

interface MasterDataImportWizardProps {
  // קובץ שהגיע מלשונית "זיהוי אוטומטי" במרכז היבוא - נבחר שם כבר, ולכן נכנס לניתוח כאילו
  // נבחר כאן. לא חובה: האשף מוצג גם במסך הניהול המקורי בלי שום prop.
  initialFile?: File | null;
}

export function MasterDataImportWizard({ initialFile }: MasterDataImportWizardProps) {
  const queryClient = useQueryClient();
  const { hasPermission: canImport, isLoading: permLoading } = useHasPermission("master_data_import", "perform");

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
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);

  const reviewRowsQuery = useQuery({ queryKey: ["master-data-batch-rows", reviewBatchId], queryFn: () => fetchImportBatchRows(reviewBatchId!), enabled: !!reviewBatchId });

  const resetImportForm = () => {
    setFile(null);
    setParsedRows(null);
    setLegacyWarning(false);
    setDuplicateId(null);
    setError(null);
    setHeaderConfirm(null);
  };

  const startOver = () => {
    resetImportForm();
    setReviewBatchId(null);
    setCommitResult(null);
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
      setParsedRows(applyMasterDataGapChecks(result.rows));
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בניתוח הקובץ");
    } finally {
      setAnalyzing(false);
    }
  };

  // קובץ שהועבר מהזיהוי האוטומטי נכנס לניתוח בדיוק כמו קובץ שנבחר ידנית. אין כאן בורר
  // עמותה, ולכן התצוגה המקדימה מופיעה מיד.
  useEffect(() => {
    if (initialFile) void handleFileChange(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const handleHeaderConfirm = async (chosenIndex: number) => {
    if (!headerConfirm) return;
    setAnalyzing(true);
    try {
      const result = await analyzeFile(headerConfirm.file, chosenIndex);
      setHeaderConfirm(null);
      setParsedRows(applyMasterDataGapChecks(result.rows));
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
    if (!file || !parsedRows) return;
    setUploading(true);
    setError(null);
    try {
      const { batchId } = await createImportBatch({ file, profileKey: "master_data" }, parsedRows);
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
    queryClient.invalidateQueries({ queryKey: ["master-data-batch-rows", reviewBatchId] });
  };

  const commit = async () => {
    if (!reviewBatchId) return;
    setCommitting(true);
    setError(null);
    const { data, error: commitError } = await supabase.rpc("commit_master_data_import_batch", { p_batch_id: reviewBatchId }).single();
    setCommitting(false);
    if (commitError) {
      setError(commitError.message);
      return;
    }
    setCommitResult(data as unknown as CommitResult);
    setReviewBatchId(null);
  };

  if (permLoading) return <LoadingState rows={4} />;

  if (!canImport) {
    return <ErrorState message="אין לך הרשאה לבצע יבוא קובץ אב." />;
  }

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
      <p className="text-sm text-ink-muted">
        יבוא קובץ אב ליצירת עמותות/סניפים/קבוצות/ראשי קבוצה אמיתיים. עמותה/סניף/קבוצה/ראש קבוצה קיימים (לפי מספר עמותה או שם מדויק, קוד סניף, שם קבוצה) לא ייווצרו כפול - רק יושלם מה שחסר. הנתונים הנוצרים כאן אינם מסומנים כדמו לעולם, ולא יכולים להתערבב עם חבילת דמו.
      </p>
      <p className="text-xs text-ink-subtle">
        אפשר כותרות בעברית: <span className="font-medium">שם עמותה</span> (חובה), סמל מוסד, מספר סניף, שם סניף, שם קבוצה, ראש
        קבוצה, טלפון ראש קבוצה, מייל. כותרת שאינה מזוהה מוצגת כשדה חסר ולא נקלטת לשדה אחר - למשל "סניף" לבדו, שיכול להיות
        קוד או שם; צריך "מספר סניף".
        <br />
        קוד סניף מושלם לשתי ספרות, כך ש-<span className="tabular">1</span> ו-<span className="tabular">01</span> הם אותו סניף.
        ראש קבוצה מזוהה לפי הטלפון, כך שסדר השם בקובץ לא משנה.
        <br />
        לחלופין, שמות השדות באנגלית: <span className="tabular">legal_name</span> (חובה), <span className="tabular">org_number</span>,{" "}
        <span className="tabular">contact_phone</span>, <span className="tabular">contact_email</span>, <span className="tabular">contact_address</span>,{" "}
        <span className="tabular">talmud_branch_code</span>, <span className="tabular">branch_internal_name</span>, <span className="tabular">branch_address</span>,{" "}
        <span className="tabular">group_name</span>, <span className="tabular">group_leader_name</span>, <span className="tabular">group_leader_phone</span>.
      </p>

      {error && <ErrorState message={error} />}

      {commitResult && (
        <div className="space-y-2 rounded-control bg-ok-soft p-3 text-sm text-ok-ink">
          <p>הקובץ נקלט בהצלחה.</p>
          <ul className="space-y-0.5 text-xs">
            <li>עמותות חדשות: {commitResult.created_organizations}</li>
            <li>סניפים חדשים: {commitResult.created_branches}</li>
            <li>קבוצות חדשות: {commitResult.created_groups}</li>
            <li>ראשי קבוצה חדשים: {commitResult.created_group_leaders}</li>
          </ul>
          <button onClick={startOver} className="link-action text-xs">
            יבוא קובץ נוסף
          </button>
        </div>
      )}

      {!reviewBatchId && !commitResult && (
        <div className="space-y-3">
          {headerConfirm ? (
            <HeaderRowConfirm
              previewRows={headerConfirm.previewRows}
              detectedIndex={headerConfirm.detectedIndex}
              onConfirm={handleHeaderConfirm}
              onCancel={handleHeaderCancel}
            />
          ) : (
            <>
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
        <div className="space-y-3">
          {reviewRowsQuery.isLoading ? (
            <LoadingState rows={3} />
          ) : (
            <>
              <p className="text-sm text-ink-muted">פתרו שורות "דורש החלטה" ואז קלטו את הקובץ.</p>
              <ImportPreviewTabs validCount={storedValid.length} needsDecisionCount={storedNeeds.length} invalidCount={storedInvalid.length}>
                {(tab) => {
                  const data = tab === "valid" ? storedValid : tab === "needsDecision" ? storedNeeds : storedInvalid;
                  return <DataTable columns={storedCols(tab !== "valid")} rows={data} rowKey={(r) => String(r.row_number)} emptyTitle="אין שורות" />;
                }}
              </ImportPreviewTabs>
              <div className="flex gap-3">
                <button onClick={commit} disabled={committing || storedNeeds.length > 0} className="btn-primary">
                  {committing ? "קולטת…" : "קליטת קובץ האב"}
                </button>
                <button onClick={startOver} className="text-xs text-ink-subtle underline">
                  ביטול
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
