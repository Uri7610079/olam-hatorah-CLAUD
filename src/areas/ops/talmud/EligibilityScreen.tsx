import { EmptyState } from "@/components/EmptyState";
import { todayLocalIso } from "@/lib/today";
import { fetchAll } from "@/lib/fetchAll";
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
import { Tabs, type TabDef } from "@/components/Tabs";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { HeaderRowConfirm } from "@/components/HeaderRowConfirm";
import { RawRowPreview } from "@/components/RawRowPreview";
import { MetricCard } from "@/components/MetricCard";
import { DuplicateFileNotice, ImportSteps, PreviewSummary, SavedForReviewNote, batchCountsText, batchImportStep } from "@/components/ImportV3Parts";
import { useIsV3 } from "@/lib/uiTheme";
import { formatDate, formatMoney, formatMonth, formatNumber as formatCount } from "@/lib/format";

type SectionTabKey = "month" | "missing" | "amounts" | "history";

const SECTION_TABS: TabDef<SectionTabKey>[] = [
  { key: "month", label: "זכאות לחודש" },
  { key: "missing", label: "תלמידים פעילים שלא הופיעו בדוח" },
  { key: "amounts", label: "בדיקת סכומים" },
  { key: "history", label: "היסטוריית יבוא זכאות" },
];

function formatNumber(value: number | string | null | undefined, maxDigits: number, minDigits = 0): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("he-IL", { minimumFractionDigits: minDigits, maximumFractionDigits: maxDigits });
}

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
  const data = await fetchAll(() => supabase
    .from("monthly_eligibility")
    .select("id, gross_amount, score_or_payment_type, student:students(external_id, full_name)")
    .eq("organization_id", orgId)
    .eq("month", month)
    .eq("status", "active")
    .order("created_at", { ascending: false }).order("id"));
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
  const assigned = await fetchAll(() => supabase
    .from("student_assignments")
    .select("student_id, students!inner(id, external_id, full_name, status)")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .in("students.status", ["sent_to_talmud", "active", "active_with_error"]).order("id"));

  const ids = (assigned ?? []).map((r: any) => r.students.id);
  if (ids.length === 0) return [];

  const eligible = await fetchAll(() => supabase.from("monthly_eligibility").select("student_id").eq("organization_id", orgId).eq("month", month).eq("status", "active").order("id"));
  const eligibleSet = new Set((eligible ?? []).map((e) => e.student_id));

  return (assigned ?? [])
    .map((r: any) => r.students)
    .filter((s: any) => !eligibleSet.has(s.id));
}

// בדיקת סכומים: השוואה בין הסכום שדווח בדוח הזכאות לבין הסכום שנגזר מהניקוד ומשווי
// הנקודה של אותו חודש. זו בדיקה בלבד - הסכום של משרד החינוך הוא הקובע, והמערכת
// לעולם לא מתקנת אותו. expected_amount ריק פירושו שחסרה הגדרה (ניקוד או שווי נקודה)
// ולא שיש פער.
interface AmountCheckRow {
  student_id: string;
  full_name: string | null;
  study_code: string | null;
  reported_points: number | string | null;
  expected_points: number | string | null;
  point_value: number | string | null;
  reported_amount: number | string | null;
  expected_amount: number | string | null;
  difference: number | string | null;
}

async function fetchAmountCheck(orgId: string, month: string): Promise<AmountCheckRow[]> {
  // פונקציה שמחזירה שורה לכל תלמיד - גם היא נחתכת ב-1,000. המיון בצד השרת
  // (שם ואז מזהה) נדרש כדי שהחלקים לא יחפפו.
  const data = await fetchAll(() =>
    supabase.rpc("eligibility_amount_check", { p_organization_id: orgId, p_month: month }).order("full_name").order("student_id"),
  );
  return data as AmountCheckRow[];
}

// הסכומים מעוגלים לשתי ספרות במסד, ולכן כל פער אמיתי גדול מחצי אגורה.
function hasGap(difference: number | string | null): boolean {
  if (difference === null || difference === undefined || difference === "") return false;
  const n = Number(difference);
  return Number.isFinite(n) && Math.abs(n) > 0.005;
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

interface EligibilityBatchSummary {
  id: string;
  file_name: string;
  status: BatchStatus;
  period_month: string | null;
  valid_count: number;
  needs_decision_count: number;
  invalid_count: number;
  created_at: string;
}

async function fetchEligibilityBatches(orgId: string): Promise<EligibilityBatchSummary[]> {
  const profile = await supabase.from("import_profiles").select("id").eq("key", "talmud_eligibility").single();
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

async function fetchBatchById(id: string): Promise<EligibilityBatchSummary> {
  const { data, error } = await supabase
    .from("import_batches")
    .select("id, file_name, status, period_month, valid_count, needs_decision_count, invalid_count, created_at")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export function EligibilityScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canImport, isLoading: permissionLoading } = useHasPermission("talmud", "import");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs, enabled: canImport });

  const [orgId, setOrgId] = useLastSelected<string>("last-org", "");
  const [month, setMonth] = useState(() => todayLocalIso().slice(0, 7) + "-01");
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ClassifiedRow[] | null>(null);
  const [legacyWarning, setLegacyWarning] = useState(false);
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [headerConfirm, setHeaderConfirm] = useState<{ file: File; previewRows: string[][]; detectedIndex: number } | null>(null);

  const [sectionTab, setSectionTab] = useState<SectionTabKey>("month");

  const [reviewBatchId, setReviewBatchId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryResult, setRetryResult] = useState<string | null>(null);
  const [resolvingRow, setResolvingRow] = useState<number | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<{ matched: number; unmatched: number } | null>(null);
  // v3: אזור היבוא מוסתר מאחורי כפתור, והנתונים של החודש מוצגים ראשונים
  const isV3 = useIsV3();
  const [showImport, setShowImport] = useState(false);

  const batchesQuery = useQuery({ queryKey: ["eligibility-batches", orgId], queryFn: () => fetchEligibilityBatches(orgId), enabled: !!orgId });
  const reviewBatchQuery = useQuery({ queryKey: ["eligibility-batch", reviewBatchId], queryFn: () => fetchBatchById(reviewBatchId!), enabled: !!reviewBatchId });
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
  const amountCheckQuery = useQuery({
    queryKey: ["eligibility-amount-check", orgId, month],
    queryFn: () => fetchAmountCheck(orgId, month),
    // v3: נטען כבר בפתיחת המסך, כדי שכרטיס "פערי סכומים" יציג מספר ולא יסתיר חריגה
    enabled: !!orgId && !!month && (sectionTab === "amounts" || isV3),
  });

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
    queryClient.invalidateQueries({ queryKey: ["eligibility-batches", orgId] });
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
      const { batchId } = await createImportBatch({ file, profileKey: "talmud_eligibility", organizationId: orgId, periodMonth: month }, parsedRows);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["eligibility-batches", orgId] });
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
    const rowError = await resolveImportRow(reviewBatchId, rowNumber, status);
    if (rowError) setError(`עדכון השורה נכשל: ${rowError}`);
    setResolvingRow(null);
    queryClient.invalidateQueries({ queryKey: ["eligibility-batch-rows", reviewBatchId] });
  };

  // השלמת שורות שנדחו באצווה שכבר נקלטה. נחוץ כשהנתונים שחסרו הוזנו
  // אחרי הקליטה: התלמיד קיים כעת, אבל הכסף שלו לא נזקף כי הקליטה כבר
  // רצה. קליטה חוזרת של הקובץ חסומה (file_hash ייחודי, ובצדק - היא
  // מונעת זכאות כפולה), ולכן מריצים את ההתאמה שוב על אותה אצווה.
  const retryRejected = async (batchId: string) => {
    setRetrying(batchId);
    setRetryResult(null);
    setError(null);
    const { data, error: retryError } = await supabase
      .rpc("retry_rejected_eligibility_rows", { p_batch_id: batchId })
      .single();
    setRetrying(null);
    if (retryError) {
      setError(retryError.message);
      return;
    }
    const r = data as { recovered_count: number; already_had_count: number; still_rejected_count: number };
    setRetryResult(
      r.recovered_count === 0 && r.already_had_count === 0
        ? `לא הושלמה אף שורה. ${r.still_rejected_count} שורות עדיין חסרות תלמיד או שיוך.`
        : `הושלמו ${r.recovered_count} שורות` +
          (r.already_had_count ? ` · ${r.already_had_count} כבר היו זכאיות` : "") +
          (r.still_rejected_count ? ` · ${r.still_rejected_count} עדיין חסרות נתונים` : "")
    );
    queryClient.invalidateQueries({ queryKey: ["eligibility-batches", orgId] });
    queryClient.invalidateQueries({ queryKey: ["eligibility-batch", batchId] });
    queryClient.invalidateQueries({ queryKey: ["eligibility-batch-rows", batchId] });
    queryClient.invalidateQueries({ queryKey: ["month-eligibility", orgId, month] });
    queryClient.invalidateQueries({ queryKey: ["eligibility-amount-check", orgId, month] });
    queryClient.invalidateQueries({ queryKey: ["missing-from-report", orgId, month] });
  };

  const commit = async () => {
    if (!reviewBatchId || !reviewBatchQuery.data?.period_month) return;
    setCommitting(true);
    setError(null);
    const { data, error: commitError } = await supabase
      .rpc("commit_eligibility_batch", { p_batch_id: reviewBatchId, p_month: reviewBatchQuery.data.period_month })
      .single();
    setCommitting(false);
    if (commitError) {
      setError(commitError.message);
      return;
    }
    setCommitResult({ matched: (data as any).matched_count, unmatched: (data as any).unmatched_count });
    queryClient.invalidateQueries({ queryKey: ["eligibility-batch", reviewBatchId] });
    queryClient.invalidateQueries({ queryKey: ["eligibility-batch-rows", reviewBatchId] });
    queryClient.invalidateQueries({ queryKey: ["eligibility-batches", orgId] });
    queryClient.invalidateQueries({ queryKey: ["month-eligibility", orgId, month] });
    queryClient.invalidateQueries({ queryKey: ["missing-from-report", orgId, month] });
    queryClient.invalidateQueries({ queryKey: ["eligibility-amount-check", orgId, month] });
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
  const reviewIsOpen = reviewBatchQuery.data ? OPEN_STATUSES.includes(reviewBatchQuery.data.status) : false;

  // סיכום החודש (v3) - נגזר מהשורות שהמסך כבר טוען, בלי שאילתה נוספת.
  // פערי הסכומים נטענים רק כשנכנסים ללשונית "בדיקת סכומים", ולכן עד אז אין מספר.
  const monthRows = monthDataQuery.data ?? [];
  const monthTotal = monthRows.reduce((sum, r) => sum + Number(r.gross_amount || 0), 0);
  const gapCount = amountCheckQuery.data ? amountCheckQuery.data.filter((r) => hasGap(r.difference)).length : null;
  const batchesWithRejected = (batchesQuery.data ?? []).filter((b) => b.status === "committed" && b.invalid_count > 0);
  // עוד לא נקלט דוח זכאות לחודש: אין עם מה להשוות. בלי ההבחנה הזו כל תלמיד פעיל
  // נספר "לא הופיע בדוח", והסכום מוצג כאפס - כאילו זו תוצאה ולא היעדר נתונים.
  const noReport = !monthDataQuery.isLoading && !!monthDataQuery.data && monthRows.length === 0;
  const importStep = batchImportStep({ reviewing: !!reviewBatchId, committed: reviewBatchQuery.data?.status === "committed", previewing: !!parsedRows && !duplicateId });
  const importVisible = !isV3 || showImport || !!file;

  const localCols: DataTableColumn<ClassifiedRow>[] = [
    { key: "num", header: "#", className: "tabular", render: (r) => r.rowNumber },
    { key: "content", header: "תוכן", render: (r) => <RawRowPreview raw={r.raw} /> },
    { key: "note", header: "הערה", render: (r) => r.errorMessage ?? "—" },
  ];

  const storedCols = (allowResolve: boolean): DataTableColumn<StoredImportRow>[] => [
    { key: "num", header: "#", className: "tabular", render: (r) => r.row_number },
    { key: "content", header: "תוכן", render: (r) => <RawRowPreview raw={r.raw} /> },
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
        title="זכאות חודשית"
        description="יבוא דוח זכאות מתלמוד. הזכאות נפרדת לגמרי מתשלום בפועל."
        primaryAction={
          isV3 && orgId && !reviewBatchId ? (
            <button type="button" onClick={() => (showImport ? (resetForm(), setShowImport(false)) : setShowImport(true))} className={showImport ? "btn-secondary" : "btn-primary"}>
              {!showImport && <Upload className="h-4 w-4" aria-hidden="true" />}
              {showImport ? "סגירת היבוא" : "יבוא דוח זכאות"}
            </button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 max-w-lg mb-4">
        <div>
          <label htmlFor="eligibility-org" className="field-label">עמותה</label>
          <select id="eligibility-org" value={orgId} onChange={(e) => setOrgId(e.target.value)} className="input-field">
            <option value="">— בחרי —</option>
            {(orgsQuery.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.legal_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          {/* v3: אותו חודש קובע גם את הנתונים שמוצגים למטה, לא רק את הקובץ החדש */}
          <label htmlFor="eligibility-month" className="field-label">
            <span className="v3:hidden">חודש (לקובץ חדש)</span>
            <span className="hidden v3:inline">חודש</span>
          </label>
          <input id="eligibility-month" type="month" value={toMonthInput(month)} onChange={(e) => setMonth(fromMonthInput(e.target.value))} className="input-field" />
        </div>
      </div>

      {isV3 && orgId && (
        <div className="mb-4 grid max-w-4xl grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard
            label={`זכאות ל${formatMonth(month)}`}
            value={monthDataQuery.isLoading ? "…" : noReport ? "—" : formatMoney(monthTotal)}
            hint={noReport ? "טרם נקלט דוח זכאות לחודש הזה" : undefined}
            tone="primary"
            emphasis
            muted={!monthDataQuery.isLoading && monthRows.length === 0}
          />
          <MetricCard
            label="תלמידים זכאים"
            value={monthDataQuery.isLoading ? "…" : noReport ? "—" : formatCount(monthRows.length)}
            muted={!monthDataQuery.isLoading && monthRows.length === 0}
          />
          <MetricCard
            label="פעילים שלא הופיעו בדוח"
            value={noReport ? "—" : missingQuery.isLoading ? "…" : formatCount(missingQuery.data?.length ?? 0)}
            hint={noReport ? "אין עדיין דוח להשוות אליו" : undefined}
            tone="warn"
            muted={noReport || !missingQuery.data?.length}
          />
          <MetricCard
            label="פערי סכומים לבירור"
            value={noReport ? "—" : gapCount === null ? "…" : formatCount(gapCount)}
            tone="high"
            muted={!gapCount}
          />
        </div>
      )}

      {/* v3: יבואים שנקלטו עם שורות שנדחו - כדי שהפעולה "השלמת שורות שנדחו" לא תישאר
          חבויה בעמודה האחרונה של לשונית ההיסטוריה */}
      {isV3 && orgId && batchesWithRejected.length > 0 && sectionTab !== "history" && (
        <div className="mb-4 flex max-w-4xl flex-wrap items-center justify-between gap-2 rounded-control border border-warn/30 bg-warn-soft px-3 py-2.5 text-sm text-warn-ink">
          <span>
            {batchesWithRejected.length === 1 ? "יבוא אחד נקלט" : `${formatCount(batchesWithRejected.length)} יבואים נקלטו`} עם שורות שנדחו
            {/* לאיזה חודש שייך כל יבוא - ההודעה נגזרת מכל היסטוריית העמותה, לא רק מהחודש שנבחר */}
            {` (${[...new Set(batchesWithRejected.map((b) => (b.period_month ? formatMonth(b.period_month) : "בלי חודש")))].join(", ")}; ${formatCount(batchesWithRejected.reduce((n, b) => n + b.invalid_count, 0))} שורות)`}
            . אם הנתונים החסרים כבר הוזנו - אפשר להשלים אותן.
          </span>
          <button type="button" onClick={() => setSectionTab("history")} className="btn-secondary px-3 py-1.5 text-sm">
            להשלמת שורות שנדחו
          </button>
        </div>
      )}

      {orgId && !reviewBatchId && importVisible && (
        <div className="card mb-6 max-w-2xl space-y-4 p-5">
          <ImportSteps current={importStep} />
          <p className="text-xs text-ink-subtle">עמודות צפויות בקובץ: מזהה תלמיד, סכום ברוטו, ניקוד/סוג תשלום (לא חובה).</p>
          <input type="file" accept=".csv,.xlsx,.xls" aria-label="קובץ דוח זכאות" onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)} className="input-field" />

          {analyzing && <LoadingState rows={2} />}
          {duplicateId && (
            <div className="space-y-2">
              <DuplicateFileNotice />
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
                <PreviewSummary
                  valid={localValid.length}
                  needs={localNeeds.length}
                  invalid={localInvalid.length}
                  next="האישור שומר את השורות לבדיקה, והזכאות נקלטת רק בשלב הבא."
                />
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
              <ImportSteps current={importStep} />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-ink">{reviewBatchQuery.data.file_name}</p>
                  <p className="text-xs text-ink-subtle">חודש: {isV3 ? formatMonth(reviewBatchQuery.data.period_month) : reviewBatchQuery.data.period_month ?? "—"}</p>
                </div>
                <StatusBadge
                  severity={reviewBatchQuery.data.status === "committed" ? "ok" : reviewBatchQuery.data.status === "rejected" ? "neutral" : "medium"}
                  label={BATCH_STATUS_LABEL[reviewBatchQuery.data.status]}
                />
              </div>

              {reviewIsOpen && <SavedForReviewNote what="דוח הזכאות" />}
              {reviewIsOpen && <p className="text-sm text-ink-muted">פתרו שורות "דורש החלטה" ואז קלטו את הדוח (שורות "שגוי" יישארו מחוץ לזכאות).</p>}

              <ImportPreviewTabs validCount={storedValid.length} needsDecisionCount={storedNeeds.length} invalidCount={storedInvalid.length}>
                {(tab) => {
                  const data = tab === "valid" ? storedValid : tab === "needsDecision" ? storedNeeds : storedInvalid;
                  return <DataTable columns={storedCols(reviewIsOpen && tab !== "valid")} rows={data} rowKey={(r) => String(r.row_number)} emptyTitle="אין שורות" />;
                }}
              </ImportPreviewTabs>

              {error && <ErrorState message={error} />}

              {reviewIsOpen && (
                <button onClick={commit} disabled={committing} className="btn-primary">
                  {committing ? "קולטת…" : "קליטת דוח הזכאות"}
                </button>
              )}
              <button onClick={closeReview} className="text-xs text-ink-subtle underline">
                חזרה לרשימה / יבוא נוסף
              </button>
            </>
          ) : (
            <ErrorState message="האצווה לא נמצאה." />
          )}
        </div>
      )}

      {commitResult && (
        <div className="mb-6 rounded-md bg-ok-soft p-3 text-sm text-ok-ink">
          נקלטו {commitResult.matched} רשומות זכאות. {commitResult.unmatched > 0 && `${commitResult.unmatched} שורות לא הותאמו לתלמיד ונשארו לבדיקה.`}
        </div>
      )}

      {orgId && (
        <>
          <Tabs tabs={SECTION_TABS} activeTab={sectionTab} onChange={setSectionTab} ariaLabel="לשוניות זכאות" />

          {sectionTab === "month" && (
            <DataTable
              columns={[
                { key: "id", header: "מזהה", className: "tabular ltr-num", render: (r: EligibilityRow) => r.student?.external_id ?? "—" },
                { key: "name", header: "שם", render: (r: EligibilityRow) => r.student?.full_name ?? "—" },
                {
                  key: "amount",
                  header: "סכום ברוטו",
                  className: isV3 ? undefined : "tabular",
                  kind: isV3 ? "money" : undefined,
                  sortValue: isV3 ? (r: EligibilityRow) => Number(r.gross_amount) : undefined,
                  render: (r: EligibilityRow) => (isV3 ? formatMoney(r.gross_amount) : r.gross_amount.toLocaleString("he-IL")),
                },
                { key: "score", header: "ניקוד/סוג תשלום", render: (r: EligibilityRow) => r.score_or_payment_type ?? "—" },
              ]}
              rows={monthDataQuery.data ?? []}
              rowKey={(r: EligibilityRow) => r.id}
              loading={monthDataQuery.isLoading}
              emptyTitle="אין זכאות לחודש זה עדיין"
            />
          )}

          {sectionTab === "missing" && noReport && (
            <EmptyState title="טרם נקלט דוח זכאות לחודש הזה" description="אחרי קליטת הדוח יוצגו כאן תלמידים פעילים שלא הופיעו בו." />
          )}
          {sectionTab === "missing" && !noReport && (
            <DataTable
              columns={[
                { key: "id", header: "מזהה", className: "tabular ltr-num", render: (r: MissingStudent) => r.external_id },
                { key: "name", header: "שם", render: (r: MissingStudent) => r.full_name },
              ]}
              rows={missingQuery.data ?? []}
              rowKey={(r: MissingStudent) => r.id}
              loading={missingQuery.isLoading}
              emptyTitle="אין חריגות - כל התלמידים הפעילים הופיעו בדוח"
            />
          )}

          {sectionTab === "amounts" && (
            <div className="space-y-3">
              <div className="max-w-3xl space-y-1">
                <p className="text-sm text-ink-muted">
                  בדיקה בלבד - לא תיקון. הסכום שמשרד החינוך שילם הוא הסכום הקובע, וכל פער הוא נושא לבירור מול המשרד ולא משהו שהמערכת מתקנת לבד.
                </p>
                <p className="text-xs text-ink-subtle">
                  הסכום הצפוי מחושב לפי הניקוד ושווי הנקודה שהיו בתוקף באותו חודש (מסך "קודי לימוד וערכי מערכת"). שורה שבה חסרה אחת מההגדרות מסומנת "לא הוגדר ניקוד/שווי" - זו הגדרה חסרה, לא פער.
                </p>
              </div>

              {amountCheckQuery.error && <ErrorState message="שגיאה בטעינת בדיקת הסכומים." />}

              <DataTable
                columns={[
                  { key: "name", header: "שם", render: (r: AmountCheckRow) => r.full_name ?? "—" },
                  { key: "code", header: "קוד לימוד", className: "tabular", render: (r: AmountCheckRow) => r.study_code ?? "—" },
                  {
                    key: "points",
                    header: "ניקוד",
                    className: "tabular",
                    render: (r: AmountCheckRow) => {
                      const used = r.reported_points ?? r.expected_points;
                      if (used === null || used === undefined) return "—";
                      return (
                        <span>
                          {formatNumber(used, 3)}
                          {r.reported_points === null && <span className="text-xs text-ink-subtle"> (לפי קוד הלימוד)</span>}
                        </span>
                      );
                    },
                  },
                  { key: "value", header: "שווי נקודה", className: "tabular", render: (r: AmountCheckRow) => formatNumber(r.point_value, 4, 2) },
                  { key: "reported", header: "סכום מדווח", className: "tabular", kind: isV3 ? "money" : undefined, render: (r: AmountCheckRow) => (isV3 ? formatMoney(r.reported_amount) : formatNumber(r.reported_amount, 2, 2)) },
                  {
                    key: "expected",
                    header: "סכום צפוי",
                    className: "tabular",
                    render: (r: AmountCheckRow) =>
                      r.expected_amount === null || r.expected_amount === undefined ? (
                        <span className="text-xs text-ink-subtle">לא הוגדר ניקוד/שווי</span>
                      ) : (
                        isV3 ? formatMoney(r.expected_amount) : formatNumber(r.expected_amount, 2, 2)
                      ),
                  },
                  {
                    key: "difference",
                    header: "הפרש",
                    className: "tabular",
                    render: (r: AmountCheckRow) =>
                      r.difference === null || r.difference === undefined ? "—" : <span className={hasGap(r.difference) ? "font-semibold text-warn-ink" : ""}>{isV3 ? formatMoney(r.difference) : formatNumber(r.difference, 2, 2)}</span>,
                  },
                  {
                    key: "state",
                    header: "מצב",
                    // טקסט + צבע ולא צבע בלבד - השורה המודגשת נקראת גם בלי הבחנת צבעים.
                    render: (r: AmountCheckRow) =>
                      r.expected_amount === null || r.expected_amount === undefined ? (
                        <StatusBadge severity="neutral" label="לא ניתן לבדוק" />
                      ) : hasGap(r.difference) ? (
                        <StatusBadge severity="high" label="פער לבירור" />
                      ) : (
                        <StatusBadge severity="ok" label="תואם" />
                      ),
                  },
                ]}
                rows={amountCheckQuery.data ?? []}
                rowKey={(r: AmountCheckRow) => r.student_id}
                rowClassName={(r: AmountCheckRow) => (hasGap(r.difference) ? "bg-warn-soft text-warn-ink" : undefined)}
                loading={amountCheckQuery.isLoading}
                emptyTitle="אין זכאות לחודש זה לבדיקה"
              />
            </div>
          )}

          {sectionTab === "history" && (
            <>
            {retryResult && (
              <div className="mb-3 rounded-control border border-line bg-surface-muted p-3 text-sm text-ink">
                {retryResult}
              </div>
            )}
            {/* v3: כשאזור היבוא סגור, שגיאה בהשלמת שורות לא מופיעה בו - מציגים אותה כאן */}
            {isV3 && error && !reviewBatchId && !importVisible && <div className="mb-3"><ErrorState message={error} /></div>}
            <DataTable
              columns={[
                { key: "file", header: "קובץ", truncate: isV3, render: (b: EligibilityBatchSummary) => b.file_name },
                {
                  key: "month",
                  header: "חודש",
                  className: "tabular",
                  sortValue: isV3 ? (b: EligibilityBatchSummary) => b.period_month : undefined,
                  render: (b: EligibilityBatchSummary) => (isV3 ? formatMonth(b.period_month) : b.period_month ?? "—"),
                },
                {
                  key: "counts",
                  header: isV3 ? "שורות" : "תקין / דורש החלטה / שגוי",
                  className: "tabular",
                  render: (b: EligibilityBatchSummary) =>
                    isV3 ? batchCountsText(b) : `${b.valid_count} / ${b.needs_decision_count} / ${b.invalid_count}`,
                },
                {
                  key: "status",
                  header: "סטטוס",
                  render: (b: EligibilityBatchSummary) => (
                    <StatusBadge severity={b.status === "committed" ? "ok" : b.status === "rejected" ? "neutral" : "medium"} label={BATCH_STATUS_LABEL[b.status]} />
                  ),
                },
                {
                  key: "date",
                  header: "תאריך",
                  className: "tabular",
                  sortValue: isV3 ? (b: EligibilityBatchSummary) => b.created_at : undefined,
                  render: (b: EligibilityBatchSummary) => (isV3 ? formatDate(b.created_at) : new Date(b.created_at).toLocaleDateString("he-IL")),
                },
                {
                  key: "retry",
                  header: "",
                  render: (b: EligibilityBatchSummary) =>
                    b.status === "committed" && b.invalid_count > 0 ? (
                      <button
                        type="button"
                        className={isV3 ? "btn-secondary whitespace-nowrap px-2.5 py-1 text-xs" : "link-action text-xs"}
                        disabled={retrying === b.id}
                        onClick={(e) => {
                          e.stopPropagation();   // אחרת הלחיצה פותחת גם את סקירת האצווה
                          void retryRejected(b.id);
                        }}
                        title="מריץ שוב את ההתאמה על השורות שנדחו, אחרי שהנתונים החסרים הוזנו"
                      >
                        {retrying === b.id ? "משלים…" : "השלמת שורות שנדחו"}
                      </button>
                    ) : null,
                },
              ]}
              rows={batchesQuery.data ?? []}
              rowKey={(b: EligibilityBatchSummary) => b.id}
              loading={batchesQuery.isLoading}
              emptyTitle="אין עדיין יבואים"
              onRowClick={(b: EligibilityBatchSummary) => setReviewBatchId(b.id)}
            />
            </>
          )}
        </>
      )}
    </div>
  );
}
