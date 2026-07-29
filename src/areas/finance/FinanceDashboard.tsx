import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useLastSelected } from "@/lib/useLastSelected";
import { PageHeader } from "@/components/PageHeader";
import { ExceptionGrid, type ExceptionCounter } from "@/components/ExceptionGrid";
import { LoadingState } from "@/components/LoadingState";
import { ErrorState } from "@/components/ErrorState";

interface OrgOption {
  id: string;
  legal_name: string;
}

interface FinanceCounts {
  period_status: string | null;
  gross_amount: number;
  commission_amount: number;
  net_amount: number;
  masav_in_process_count: number;
  masav_transmitted_not_completed_count: number;
  group_commitment_total: number;
  open_bank_exceptions: number;
  open_returns: number;
  unclassified_transactions: number;
  unassigned_donations: number;
}

const PERIOD_STATUS_LABEL: Record<string, string> = { open: "פתוח", in_review: "בבדיקה", closed: "סגור" };

async function fetchOrgs(): Promise<OrgOption[]> {
  const { data, error } = await supabase.from("organizations").select("id, legal_name").eq("status", "active").order("legal_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchFinanceCounts(orgId: string, month: string): Promise<FinanceCounts> {
  const { data, error } = await supabase.rpc("get_finance_dashboard_counts", { p_organization_id: orgId, p_month: month }).single();
  if (error) throw error;
  return data as unknown as FinanceCounts;
}

function buildItems(c: FinanceCounts, orgId: string): ExceptionCounter[] {
  return [
    { key: "masav-in-process", label: "אצוות מס\"ב בהכנה (טרם שודרו)", count: c.masav_in_process_count, severity: c.masav_in_process_count > 0 ? "medium" : "ok", href: `/finance/masav?org=${orgId}` },
    { key: "masav-not-completed", label: "אצוות מס\"ב ששודרו וטרם סומנו כבוצעו", count: c.masav_transmitted_not_completed_count, severity: c.masav_transmitted_not_completed_count > 0 ? "high" : "ok", href: `/finance/bank-matching?org=${orgId}` },
    { key: "open-returns", label: "תשלומים שחזרו וטרם טופלו", count: c.open_returns, severity: c.open_returns > 0 ? "high" : "ok", href: `/finance/returns?org=${orgId}` },
    { key: "unclassified-transactions", label: "תנועות בנק לא מסווגות סופית", count: c.unclassified_transactions, severity: c.unclassified_transactions > 0 ? "critical" : "ok", href: `/finance/bank-transactions?org=${orgId}` },
    { key: "open-bank-exceptions", label: "חריגות התאמת בנק פתוחות", count: c.open_bank_exceptions, severity: c.open_bank_exceptions > 0 ? "critical" : "ok", href: `/finance/bank-matching?org=${orgId}` },
    { key: "unassigned-donations", label: "תרומות לא משויכות/ממתינות", count: c.unassigned_donations, severity: c.unassigned_donations > 0 ? "medium" : "ok", href: `/finance/donations?org=${orgId}` },
    { key: "ratio-90-10", label: "מצב 90%/10% (כבוי עד אישור הנוסחה)", count: 0, severity: "neutral", href: `/finance/reports?org=${orgId}` },
  ];
}

export function FinanceDashboard() {
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });
  const [orgId, setOrgId] = useLastSelected<string>("last-org", "");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7) + "-01");

  const countsQuery = useQuery({ queryKey: ["finance-dashboard-counts", orgId, month], queryFn: () => fetchFinanceCounts(orgId, month), enabled: !!orgId });

  return (
    <div>
      <PageHeader title="דשבורד כספי" description="סטטוס החודש, חריגות ופעולות נדרשות — נגיש לכספים ובקרה בלבד. כל כרטיס מוביל לרשימה המסוננת הרלוונטית." />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 max-w-lg">
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

      {!orgId && <p className="text-sm text-slate-500">בחרי עמותה כדי להציג את מצב החודש.</p>}
      {countsQuery.isLoading && <LoadingState rows={3} />}
      {countsQuery.isError && <ErrorState message="שגיאה בטעינת נתוני הדשבורד." />}
      {countsQuery.data && (
        <>
          <div className="card mb-4 max-w-sm p-4">
            <p className="text-sm text-slate-600">סטטוס החודש</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">
              {countsQuery.data.period_status ? PERIOD_STATUS_LABEL[countsQuery.data.period_status] ?? countsQuery.data.period_status : "טרם נפתח"}
            </p>
          </div>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="card p-4">
              <p className="text-sm text-slate-600">ברוטו</p>
              <p className="tabular mt-1 text-xl font-semibold text-slate-900">{countsQuery.data.gross_amount.toLocaleString("he-IL")}</p>
            </div>
            <div className="card p-4">
              <p className="text-sm text-slate-600">עמלה</p>
              <p className="tabular mt-1 text-xl font-semibold text-slate-900">{countsQuery.data.commission_amount.toLocaleString("he-IL")}</p>
            </div>
            <div className="card p-4">
              <p className="text-sm text-slate-600">נטו</p>
              <p className="tabular mt-1 text-xl font-semibold text-slate-900">{countsQuery.data.net_amount.toLocaleString("he-IL")}</p>
            </div>
          </div>
          <div className="card mb-4 max-w-sm p-4">
            <p className="text-sm text-slate-600">התחייבות כוללת לקבוצות (יתרת ספר תנועות)</p>
            <p className="tabular mt-1 text-xl font-semibold text-slate-900">{countsQuery.data.group_commitment_total.toLocaleString("he-IL")}</p>
          </div>
          <ExceptionGrid items={buildItems(countsQuery.data, orgId)} />
        </>
      )}
    </div>
  );
}
