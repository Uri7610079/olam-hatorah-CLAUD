import { todayLocalIso } from "@/lib/today";
import { useState } from "react";
import { fromMonthInput, toMonthInput } from "@/components/MonthField";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, Calculator } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useLastSelected } from "@/lib/useLastSelected";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useIsV3 } from "@/lib/uiTheme";
import { formatDate, formatMoney, formatMonth, formatNumber } from "@/lib/format";

interface OrgOption {
  id: string;
  legal_name: string;
}

type PeriodStatus = "open" | "in_review" | "closed";

interface FinancialPeriod {
  id: string;
  month: string;
  status: PeriodStatus;
  opened_at: string;
  closed_at: string | null;
  status_reason: string | null;
}

interface ChecklistItem {
  item_key: string;
  label_he: string;
  open_count: number;
}

interface PreviewRow {
  eligibility_id: string;
  student_id: string;
  student_external_id: string;
  student_name: string;
  group_id: string | null;
  group_name: string | null;
  gross_amount: number;
  rule_id: string | null;
  calculation_type: string | null;
  commission_amount: number;
  net_amount: number;
  already_calculated: boolean;
}

const STATUS_LABEL: Record<PeriodStatus, string> = { open: "פתוח", in_review: "בבדיקה", closed: "סגור" };
const STATUS_SEVERITY: Record<PeriodStatus, "ok" | "medium" | "neutral"> = { open: "ok", in_review: "medium", closed: "neutral" };
// calculation_type מגיע מהשרת באנגלית ("percentage") - מוצג בעברית, כמו במסך כללי העמלה.
const CALC_TYPE_LABEL: Record<string, string> = { percentage: "אחוז", fixed: "קבוע", combined: "משולב" };

async function fetchOrgs(): Promise<OrgOption[]> {
  const { data, error } = await supabase.from("organizations").select("id, legal_name").eq("status", "active").order("legal_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchPeriods(orgId: string): Promise<FinancialPeriod[]> {
  const { data, error } = await supabase
    .from("financial_periods")
    .select("id, month, status, opened_at, closed_at, status_reason")
    .eq("organization_id", orgId)
    .order("month", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function fetchChecklist(orgId: string, month: string): Promise<ChecklistItem[]> {
  const { data, error } = await supabase.rpc("get_month_close_checklist", { p_organization_id: orgId, p_month: month });
  if (error) throw error;
  return data ?? [];
}

export function FinancialPeriodsScreen() {
  const queryClient = useQueryClient();
  const isV3 = useIsV3();
  // v3: כפתורים בגודל רגיל במקום text-xs (בערכות הקודמות - בלי שינוי)
  const xs = isV3 ? "" : " text-xs";
  const { hasPermission: canManagePeriods } = useHasPermission("financial_periods", "manage");
  const { hasPermission: canCalculate, isLoading: permLoading } = useHasPermission("commission", "calculate");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });

  const [orgId, setOrgId] = useLastSelected<string>("last-org", "");
  const [month, setMonth] = useState(() => todayLocalIso().slice(0, 7) + "-01");
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);

  const [previewRows, setPreviewRows] = useState<PreviewRow[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [confirmCommit, setConfirmCommit] = useState(false);
  const [commitResult, setCommitResult] = useState<{ processed: number; commission: number; net: number } | null>(null);

  const [showChecklist, setShowChecklist] = useState(false);
  const [closing, setClosing] = useState(false);
  const [showReopenForm, setShowReopenForm] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopening, setReopening] = useState(false);

  const periodsQuery = useQuery({ queryKey: ["financial-periods", orgId], queryFn: () => fetchPeriods(orgId), enabled: !!orgId });
  const currentPeriod = periodsQuery.data?.find((p) => p.month === month) ?? null;
  const checklistQuery = useQuery({
    queryKey: ["month-close-checklist", orgId, month],
    queryFn: () => fetchChecklist(orgId, month),
    enabled: !!orgId && showChecklist,
  });
  const checklistReady = !!checklistQuery.data && checklistQuery.data.every((i) => i.open_count === 0);

  const invalidatePeriods = () => queryClient.invalidateQueries({ queryKey: ["financial-periods", orgId] });

  const openPeriod = async () => {
    setOpening(true);
    setError(null);
    const { error: err } = await supabase.rpc("open_financial_period", { p_organization_id: orgId, p_month: month });
    setOpening(false);
    if (err) {
      setError(err.message);
      return;
    }
    invalidatePeriods();
  };

  const setPeriodStatus = async (status: "open" | "in_review") => {
    if (!currentPeriod) return;
    setChangingStatus(true);
    setError(null);
    const { error: err } = await supabase.rpc("set_financial_period_status", { p_period_id: currentPeriod.id, p_status: status });
    setChangingStatus(false);
    if (err) {
      setError(err.message);
      return;
    }
    invalidatePeriods();
  };

  const closeMonth = async () => {
    if (!currentPeriod) return;
    setClosing(true);
    setError(null);
    const { error: err } = await supabase.rpc("close_financial_month", { p_organization_id: orgId, p_month: month, p_period_id: currentPeriod.id });
    setClosing(false);
    if (err) {
      setError(err.message);
      return;
    }
    setShowChecklist(false);
    invalidatePeriods();
  };

  const reopenMonth = async () => {
    if (!currentPeriod || !reopenReason.trim()) return;
    setReopening(true);
    setError(null);
    const { error: err } = await supabase.rpc("reopen_financial_month", { p_period_id: currentPeriod.id, p_reason: reopenReason });
    setReopening(false);
    if (err) {
      setError(err.message);
      return;
    }
    setShowReopenForm(false);
    setReopenReason("");
    invalidatePeriods();
  };

  const runPreview = async () => {
    setPreviewing(true);
    setError(null);
    setCommitResult(null);
    const { data, error: err } = await supabase.rpc("preview_commission_calculation", { p_organization_id: orgId, p_month: month });
    setPreviewing(false);
    if (err) {
      setError(err.message);
      return;
    }
    setPreviewRows(data ?? []);
  };

  const runCommit = async () => {
    setConfirmCommit(false);
    setCommitting(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("commit_commission_calculation", { p_organization_id: orgId, p_month: month }).single();
    setCommitting(false);
    if (err) {
      setError(err.message);
      return;
    }
    const result = data as { processed_count: number; total_commission: number; total_net: number };
    setCommitResult({ processed: result.processed_count, commission: result.total_commission, net: result.total_net });
    setPreviewRows(null);
    queryClient.invalidateQueries({ queryKey: ["group-balances"] });
    queryClient.invalidateQueries({ queryKey: ["financial-periods", orgId] });
  };

  const periodColumns: DataTableColumn<FinancialPeriod>[] = [
    { key: "month", header: "חודש", className: "tabular", sortValue: (r) => r.month, render: (r) => (isV3 ? formatMonth(r.month) : r.month) },
    { key: "status", header: "סטטוס", render: (r) => <StatusBadge severity={STATUS_SEVERITY[r.status]} label={STATUS_LABEL[r.status]} /> },
    {
      key: "opened",
      header: "נפתח",
      className: "tabular",
      sortValue: (r) => r.opened_at,
      render: (r) => (isV3 ? formatDate(r.opened_at) : new Date(r.opened_at).toLocaleDateString("he-IL")),
    },
    {
      key: "closed",
      header: "נסגר",
      className: "tabular",
      sortValue: (r) => r.closed_at,
      render: (r) => (r.closed_at ? (isV3 ? formatDate(r.closed_at) : new Date(r.closed_at).toLocaleDateString("he-IL")) : "—"),
    },
  ];

  // v3: סכום בתצוגת ₪ אחידה, ממוין ומסונן לפי הערך המספרי
  const moneyCol = (key: string, header: string, value: (r: PreviewRow) => number): DataTableColumn<PreviewRow> =>
    isV3
      ? { key, header, kind: "money", sortValue: value, filterValue: value, render: (r) => formatMoney(value(r)) }
      : { key, header, className: "tabular", render: (r) => value(r).toLocaleString("he-IL") };

  const previewColumns: DataTableColumn<PreviewRow>[] = [
    { key: "id", header: "מזהה", className: "tabular", render: (r) => r.student_external_id },
    { key: "name", header: "שם", render: (r) => r.student_name },
    { key: "group", header: "קבוצה", render: (r) => r.group_name ?? "—" },
    moneyCol("gross", "ברוטו", (r) => r.gross_amount),
    {
      key: "rule",
      header: "כלל תואם",
      render: (r) =>
        r.rule_id ? (r.calculation_type ? CALC_TYPE_LABEL[r.calculation_type] ?? r.calculation_type : "—") : <span className="text-warn v3:text-warn-ink">אין כלל תואם</span>,
    },
    moneyCol("commission", "עמלה", (r) => r.commission_amount),
    moneyCol("net", "נטו", (r) => r.net_amount),
    {
      key: "already",
      header: "",
      render: (r) => (r.already_calculated ? <StatusBadge severity="neutral" label="חושב בעבר" /> : <StatusBadge severity="ok" label="חדש" />),
    },
  ];

  // v3: סיכום התצוגה המקדימה - מחושב מהשורות שכבר חזרו מהשרת, לא שאילתה נוספת
  const previewTotals = previewRows
    ? previewRows.reduce(
        (t, r) => ({ gross: t.gross + r.gross_amount, commission: t.commission + r.commission_amount, net: t.net + r.net_amount }),
        { gross: 0, commission: 0, net: 0 },
      )
    : null;
  const previewChanging = previewRows ? previewRows.filter((r) => !r.already_calculated).length : 0;

  if (permLoading) return <LoadingState rows={4} />;

  return (
    <div>
      <PageHeader
        title="חודשים כספיים"
        description="פתיחה/סגירה של חודש כספי לכל עמותה, והרצת חישוב עמלה חודשי מעליו. נוסחת 90%/10% אינה מופעלת - ממתינה לאישור חשבונאי."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 max-w-lg mb-6">
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
          <input type="month" value={toMonthInput(month)} onChange={(e) => setMonth(fromMonthInput(e.target.value))} className="input-field" />
        </div>
      </div>

      {error && <div className="mb-4"><ErrorState message={error} /></div>}

      {orgId && (
        <>
          <div className="card mb-6 max-w-2xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-ink v3:text-base v3:font-semibold v3:text-primary">חודש {isV3 ? formatMonth(month) : month}</p>
                {currentPeriod ? (
                  <div className="mt-1">
                    <StatusBadge severity={STATUS_SEVERITY[currentPeriod.status]} label={STATUS_LABEL[currentPeriod.status]} />
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-ink-subtle">חודש זה טרם נפתח לעמותה זו.</p>
                )}
                {currentPeriod?.status_reason && <p className="mt-1 text-xs text-ink-subtle">סיבה: {currentPeriod.status_reason}</p>}
              </div>
              {canManagePeriods && (
                <div className="flex gap-2">
                  {!currentPeriod && (
                    <button onClick={openPeriod} disabled={opening} className={`btn-primary${xs}`}>
                      {opening ? "פותחת…" : "פתיחת חודש"}
                    </button>
                  )}
                  {/* v3: מעבר לבדיקה הוא הפעולה היחידה בחודש פתוח - ולכן היא הראשית */}
                  {currentPeriod?.status === "open" && (
                    <button onClick={() => setPeriodStatus("in_review")} disabled={changingStatus} className={isV3 ? "btn-primary" : "btn-secondary text-xs"}>
                      מעבר לבדיקה
                    </button>
                  )}
                  {currentPeriod?.status === "in_review" && (
                    <>
                      <button onClick={() => setPeriodStatus("open")} disabled={changingStatus} className={`btn-secondary${xs}`}>
                        חזרה לפתוח
                      </button>
                      {/* v3: כשהרשימה פתוחה, הפעולה הראשית עוברת לכפתור "סגירת חודש" שבתוכה */}
                      <button onClick={() => setShowChecklist((v) => !v)} className={isV3 ? (showChecklist ? "btn-secondary" : "btn-primary") : "btn-primary text-xs"}>
                        {showChecklist ? "סגירת רשימת הבדיקה" : "בדיקת מוכנות לסגירה"}
                      </button>
                    </>
                  )}
                  {currentPeriod?.status === "closed" && (
                    <button onClick={() => setShowReopenForm((v) => !v)} className={`btn-secondary${xs}`}>
                      פתיחה מחדש
                    </button>
                  )}
                </div>
              )}
            </div>

            {showChecklist && currentPeriod?.status === "in_review" && (
              <div className="mt-4 space-y-2 border-t border-line pt-4">
                <p className="text-xs text-ink-subtle">כל התנאים חייבים להיות ריקים (0) כדי לסגור את החודש - הבדיקה מורצת שוב בשרת בעת הסגירה עצמה.</p>
                {checklistQuery.isLoading ? (
                  <LoadingState rows={3} />
                ) : (
                  <ul className="space-y-1">
                    {(checklistQuery.data ?? []).map((item) => (
                      <li key={item.item_key} className="flex items-center justify-between text-sm">
                        <span className="text-ink-muted">{item.label_he}</span>
                        <StatusBadge
                          severity={item.open_count === 0 ? "ok" : "medium"}
                          label={isV3 ? (item.open_count === 0 ? "תקין" : `${formatNumber(item.open_count)} פתוחים`) : String(item.open_count)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <button onClick={closeMonth} disabled={closing || !checklistReady} className={`btn-primary${xs}`} title={!checklistReady ? "יש תנאים פתוחים ברשימה למעלה" : undefined}>
                    {closing ? "סוגרת…" : "סגירת חודש"}
                  </button>
                  {/* v3: הסיבה שהכפתור כבוי - כטקסט גלוי ולא רק בריחוף */}
                  {isV3 && checklistQuery.data && !checklistReady && <span className="text-sm text-warn-ink">אפשר לסגור רק כשכל התנאים ברשימה תקינים.</span>}
                </div>
              </div>
            )}

            {showReopenForm && currentPeriod?.status === "closed" && (
              <div className="mt-4 space-y-2 border-t border-line pt-4">
                <label className="field-label">סיבת פתיחה מחדש (חובה)</label>
                <div className="flex gap-2">
                  <input value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} className="input-field" />
                  <button onClick={reopenMonth} disabled={!reopenReason.trim() || reopening} className={`btn-primary shrink-0${xs}`}>
                    {reopening ? "פותחת…" : "אישור"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {canCalculate && (
            <div className="card mb-6 max-w-4xl space-y-4 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink-muted v3:text-base v3:text-primary">חישוב עמלה חודשי</h2>
                {/* v3: לפני שיש תצוגה מקדימה - זו הפעולה הראשית; אחריה "אישור וחישוב סופי" הוא הראשי */}
                <button
                  onClick={runPreview}
                  disabled={previewing}
                  className={isV3 ? (previewRows ? "btn-secondary" : "btn-primary") : "btn-secondary flex items-center gap-2 text-xs"}
                >
                  <Calculator className={isV3 ? "h-4 w-4" : "h-3.5 w-3.5"} aria-hidden="true" />
                  {previewing ? "מחשבת תצוגה מקדימה…" : "תצוגה מקדימה"}
                </button>
              </div>

              {previewRows && (
                <>
                  {isV3 && previewTotals && previewRows.length > 0 && (
                    <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
                      <span>
                        <span className="tabular font-semibold text-ink">{formatNumber(previewRows.length)}</span> זכאויות
                      </span>
                      <span>
                        ברוטו <span className="tabular font-semibold text-ink">{formatMoney(previewTotals.gross)}</span>
                      </span>
                      <span>
                        עמלה <span className="tabular font-semibold text-ink">{formatMoney(previewTotals.commission)}</span>
                      </span>
                      <span>
                        נטו <span className="tabular font-semibold text-primary">{formatMoney(previewTotals.net)}</span>
                      </span>
                    </p>
                  )}
                  <DataTable columns={previewColumns} rows={previewRows} rowKey={(r) => r.eligibility_id} emptyTitle="אין זכאויות פעילות לחודש זה" />
                  {previewRows.length > 0 && (
                    <div className={isV3 ? "flex flex-wrap items-center justify-between gap-2" : "flex items-center justify-between"}>
                      <div>
                        <p className="text-xs text-ink-subtle">
                          {isV3 ? formatNumber(previewChanging) : previewChanging} שורות ישתנו אם יאושר החישוב הסופי.
                        </p>
                        {/* v3: התנאי לאישור - כטקסט גלוי ולא רק בריחוף */}
                        {isV3 && currentPeriod?.status !== "open" && <p className="text-sm text-warn-ink">אפשר לאשר חישוב רק כשהחודש במצב "פתוח".</p>}
                      </div>
                      <button
                        onClick={() => setConfirmCommit(true)}
                        disabled={committing || currentPeriod?.status !== "open"}
                        className={`btn-primary${xs}`}
                        title={currentPeriod?.status !== "open" ? "יש לפתוח את החודש כדי לאשר חישוב" : undefined}
                      >
                        {committing ? "מאשרת…" : "אישור וחישוב סופי"}
                      </button>
                    </div>
                  )}
                </>
              )}

              {commitResult && (
                <div className="rounded-md bg-ok-soft p-3 text-sm text-ok-ink">
                  עודכנו <span className="tabular">{isV3 ? formatNumber(commitResult.processed) : commitResult.processed}</span> זכאויות. סך עמלה:{" "}
                  <span className="tabular">{isV3 ? formatMoney(commitResult.commission) : commitResult.commission.toLocaleString("he-IL")}</span>, סך נטו:{" "}
                  <span className="tabular">{isV3 ? formatMoney(commitResult.net) : commitResult.net.toLocaleString("he-IL")}</span>.
                </div>
              )}
            </div>
          )}

          <h2 className="mb-2 mt-6 text-sm font-semibold text-ink-muted v3:text-base v3:text-primary">היסטוריית חודשים</h2>
          <DataTable
            columns={periodColumns}
            rows={periodsQuery.data ?? []}
            rowKey={(r) => r.id}
            loading={periodsQuery.isLoading}
            emptyTitle="אין עדיין חודשים כספיים לעמותה זו"
            emptyIcon={Calendar}
            onRowClick={(r) => setMonth(r.month)}
            selectedKey={isV3 ? currentPeriod?.id ?? null : undefined}
          />
        </>
      )}

      <ConfirmDialog
        open={confirmCommit}
        title="אישור חישוב עמלה סופי"
        description="הפעולה תיצור תוצאות חישוב ותנועות ספר לקבוצות. לא ניתן לערוך תוצאה שכבר נוצרה - רק לחשב מחדש (יוצר גרסה חדשה)."
        confirmLabel="אישור"
        onConfirm={runCommit}
        onCancel={() => setConfirmCommit(false)}
      />
    </div>
  );
}
