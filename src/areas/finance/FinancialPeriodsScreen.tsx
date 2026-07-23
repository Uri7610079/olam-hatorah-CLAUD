import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, Calculator } from "lucide-react";
import { supabase } from "@/lib/supabase";
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
    .select("id, month, status, opened_at, closed_at")
    .eq("organization_id", orgId)
    .order("month", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export function FinancialPeriodsScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canManagePeriods } = useHasPermission("financial_periods", "manage");
  const { hasPermission: canCalculate, isLoading: permLoading } = useHasPermission("commission", "calculate");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });

  const [orgId, setOrgId] = useState("");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7) + "-01");
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);

  const [previewRows, setPreviewRows] = useState<PreviewRow[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [confirmCommit, setConfirmCommit] = useState(false);
  const [commitResult, setCommitResult] = useState<{ processed: number; commission: number; net: number } | null>(null);

  const periodsQuery = useQuery({ queryKey: ["financial-periods", orgId], queryFn: () => fetchPeriods(orgId), enabled: !!orgId });
  const currentPeriod = periodsQuery.data?.find((p) => p.month === month) ?? null;

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

  const setPeriodStatus = async (status: PeriodStatus) => {
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
      render: (r) => (r.rule_id ? r.calculation_type ?? "—" : <span className="text-amber-600">אין כלל תואם</span>),
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
          <input type="date" value={month} onChange={(e) => setMonth(e.target.value)} className="input-field" />
        </div>
      </div>

      {error && <div className="mb-4"><ErrorState message={error} /></div>}

      {orgId && (
        <>
          <div className="card mb-6 max-w-2xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-900">חודש {month}</p>
                {currentPeriod ? (
                  <div className="mt-1">
                    <StatusBadge severity={STATUS_SEVERITY[currentPeriod.status]} label={STATUS_LABEL[currentPeriod.status]} />
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">חודש זה טרם נפתח לעמותה זו.</p>
                )}
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
                      <button onClick={() => setPeriodStatus("closed")} disabled={changingStatus} className="btn-primary text-xs">
                        סגירה
                      </button>
                    </>
                  )}
                  {currentPeriod?.status === "closed" && (
                    <button onClick={() => setPeriodStatus("open")} disabled={changingStatus} className="btn-secondary text-xs">
                      פתיחה מחדש
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {canCalculate && (
            <div className="card mb-6 max-w-4xl space-y-4 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700">חישוב עמלה חודשי</h2>
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
                      <p className="text-xs text-slate-500">
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
                <div className="rounded-md bg-green-50 p-3 text-sm text-green-800">
                  עודכנו {commitResult.processed} זכאויות. סך עמלה: {commitResult.commission.toLocaleString("he-IL")}, סך נטו:{" "}
                  {commitResult.net.toLocaleString("he-IL")}.
                </div>
              )}
            </div>
          )}

          <h2 className="mb-2 mt-6 text-sm font-semibold text-slate-700">היסטוריית חודשים</h2>
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
