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
  const { hasPermission: canManagePeriods } = useHasPermission("financial_periods", "manage");
  const { hasPermission: canCalculate, isLoading: permLoading } = useHasPermission("commission", "calculate");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });

  const [orgId, setOrgId] = useLastSelected<string>("last-org", "");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7) + "-01");
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
    { key: "month", header: "חודש", className: "tabular", render: (r) => r.month },
    { key: "status", header: "סטטוס", render: (r) => <StatusBadge severity={STATUS_SEVERITY[r.status]} label={STATUS_LABEL[r.status]} /> },
    { key: "opened", header: "נפתח", className: "tabular", render: (r) => new Date(r.opened_at).toLocaleDateString("he-IL") },
    { key: "closed", header: "נסגר", className: "tabular", render: (r) => (r.closed_at ? new Date(r.closed_at).toLocaleDateString("he-IL") : "—") },
  ];

  const previewColumns: DataTableColumn<PreviewRow>[] = [
    { key: "id", header: "מזהה", className: "tabular", render: (r) => r.student_external_id },
    { key: "name", header: "שם", render: (r) => r.student_name },
    { key: "group", header: "קבוצה", render: (r) => r.group_name ?? "—" },
    { key: "gross", header: "ברוטו", className: "tabular", render: (r) => r.gross_amount.toLocaleString("he-IL") },
    {
      key: "rule",
      header: "כלל תואם",
      render: (r) => (r.rule_id ? r.calculation_type ?? "—" : <span className="text-warn">אין כלל תואם</span>),
    },
    { key: "commission", header: "עמלה", className: "tabular", render: (r) => r.commission_amount.toLocaleString("he-IL") },
    { key: "net", header: "נטו", className: "tabular", render: (r) => r.net_amount.toLocaleString("he-IL") },
    {
      key: "already",
      header: "",
      render: (r) => (r.already_calculated ? <StatusBadge severity="neutral" label="חושב בעבר" /> : <StatusBadge severity="ok" label="חדש" />),
    },
  ];

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
                <p className="text-sm font-medium text-ink">חודש {month}</p>
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
                    <button onClick={openPeriod} disabled={opening} className="btn-primary text-xs">
                      {opening ? "פותחת…" : "פתיחת חודש"}
                    </button>
                  )}
                  {currentPeriod?.status === "open" && (
                    <button onClick={() => setPeriodStatus("in_review")} disabled={changingStatus} className="btn-secondary text-xs">
                      מעבר לבדיקה
                    </button>
                  )}
                  {currentPeriod?.status === "in_review" && (
                    <>
                      <button onClick={() => setPeriodStatus("open")} disabled={changingStatus} className="btn-secondary text-xs">
                        חזרה לפתוח
                      </button>
                      <button onClick={() => setShowChecklist((v) => !v)} className="btn-primary text-xs">
                        {showChecklist ? "סגירת רשימת הבדיקה" : "בדיקת מוכנות לסגירה"}
                      </button>
                    </>
                  )}
                  {currentPeriod?.status === "closed" && (
                    <button onClick={() => setShowReopenForm((v) => !v)} className="btn-secondary text-xs">
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
                        <StatusBadge severity={item.open_count === 0 ? "ok" : "medium"} label={String(item.open_count)} />
                      </li>
                    ))}
                  </ul>
                )}
                <button onClick={closeMonth} disabled={closing || !checklistReady} className="btn-primary text-xs" title={!checklistReady ? "יש תנאים פתוחים ברשימה למעלה" : undefined}>
                  {closing ? "סוגרת…" : "סגירת חודש"}
                </button>
              </div>
            )}

            {showReopenForm && currentPeriod?.status === "closed" && (
              <div className="mt-4 space-y-2 border-t border-line pt-4">
                <label className="field-label">סיבת פתיחה מחדש (חובה)</label>
                <div className="flex gap-2">
                  <input value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} className="input-field" />
                  <button onClick={reopenMonth} disabled={!reopenReason.trim() || reopening} className="btn-primary text-xs shrink-0">
                    {reopening ? "פותחת…" : "אישור"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {canCalculate && (
            <div className="card mb-6 max-w-4xl space-y-4 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink-muted">חישוב עמלה חודשי</h2>
                <button onClick={runPreview} disabled={previewing} className="btn-secondary flex items-center gap-2 text-xs">
                  <Calculator className="h-3.5 w-3.5" aria-hidden="true" />
                  {previewing ? "מחשבת תצוגה מקדימה…" : "תצוגה מקדימה"}
                </button>
              </div>

              {previewRows && (
                <>
                  <DataTable columns={previewColumns} rows={previewRows} rowKey={(r) => r.eligibility_id} emptyTitle="אין זכאויות פעילות לחודש זה" />
                  {previewRows.length > 0 && (
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-ink-subtle">
                        {previewRows.filter((r) => !r.already_calculated).length} שורות ישתנו אם יאושר החישוב הסופי.
                      </p>
                      <button
                        onClick={() => setConfirmCommit(true)}
                        disabled={committing || currentPeriod?.status !== "open"}
                        className="btn-primary text-xs"
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
                  עודכנו <span className="tabular">{commitResult.processed}</span> זכאויות. סך עמלה:{" "}
                  <span className="tabular">{commitResult.commission.toLocaleString("he-IL")}</span>, סך נטו:{" "}
                  <span className="tabular">{commitResult.net.toLocaleString("he-IL")}</span>.
                </div>
              )}
            </div>
          )}

          <h2 className="mb-2 mt-6 text-sm font-semibold text-ink-muted">היסטוריית חודשים</h2>
          <DataTable
            columns={periodColumns}
            rows={periodsQuery.data ?? []}
            rowKey={(r) => r.id}
            loading={periodsQuery.isLoading}
            emptyTitle="אין עדיין חודשים כספיים לעמותה זו"
            emptyIcon={Calendar}
            onRowClick={(r) => setMonth(r.month)}
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
