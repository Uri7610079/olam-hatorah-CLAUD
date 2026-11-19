import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { StatusBadge } from "@/components/StatusBadge";

interface AccountRow {
  id: string;
  bank_name: string | null;
  account_number_masked: string | null;
}

interface RunRow {
  started_at: string;
  status: "running" | "success" | "partial" | "failed";
  transactions_committed: number;
  bank_reported_balance: number | null;
  error_message: string | null;
  gap_detail: string | null;
}

interface AccountStatus extends AccountRow {
  lastRun: RunRow | null;
  lastBalance: number | null;
  monthCount: number;
}

const money = (n: number) => n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (v: string) => new Date(v).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });

async function fetchStatus(orgId: string, month: string): Promise<AccountStatus[]> {
  const { data: accounts, error } = await supabase
    .from("organization_bank_accounts_view")
    .select("id, bank_name, account_number_masked")
    .eq("organization_id", orgId)
    .eq("is_active", true);
  if (error) throw error;
  const next = new Date(`${month.slice(0, 7)}-01T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const monthEnd = next.toISOString().slice(0, 10);

  return Promise.all(
    ((accounts ?? []) as AccountRow[]).map(async (a) => {
      const [runs, balance, count] = await Promise.all([
        supabase
          .from("bank_auto_sync_runs")
          .select("started_at, status, transactions_committed, bank_reported_balance, error_message, gap_detail, setting:bank_auto_sync_settings!inner(organization_bank_account_id)")
          .eq("setting.organization_bank_account_id", a.id)
          .order("started_at", { ascending: false })
          .limit(1),
        supabase
          .from("bank_auto_sync_runs")
          .select("bank_reported_balance, setting:bank_auto_sync_settings!inner(organization_bank_account_id)")
          .eq("setting.organization_bank_account_id", a.id)
          .not("bank_reported_balance", "is", null)
          .order("started_at", { ascending: false })
          .limit(1),
        supabase
          .from("bank_transactions")
          .select("id", { count: "exact", head: true })
          .eq("organization_bank_account_id", a.id)
          .gte("execution_date", `${month.slice(0, 7)}-01`)
          .lt("execution_date", monthEnd),
      ]);
      return {
        ...a,
        lastRun: ((runs.data ?? [])[0] as unknown as RunRow) ?? null,
        lastBalance: ((balance.data ?? [])[0] as { bank_reported_balance: number | null } | undefined)?.bank_reported_balance ?? null,
        monthCount: count.count ?? 0,
      };
    }),
  );
}

// מצב הבנק בדשבורד הכספי (2026-11-19): לכל חשבון של העמותה - מתי נקלט לאחרונה, האם
// הצליח, היתרה שהבנק דיווח, וכמה תנועות יש בחודש. עד עכשיו הדשבורד הציג רק את
// החישוב מתלמוד, וקליטה שנכשלה לא הייתה נראית ממנו בכלל.
export function BankStatusCard({ orgId, month }: { orgId: string; month: string }) {
  const q = useQuery({ queryKey: ["bank-status-card", orgId, month], queryFn: () => fetchStatus(orgId, month), enabled: !!orgId });
  if (!q.data) return null;

  return (
    <div className="card mb-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">בנק</p>
        <Link to={`/finance/bank-transactions?org=${orgId}`} className="link-action text-xs">לתנועות הבנק</Link>
      </div>
      {q.data.length === 0 ? (
        <p className="mt-1 text-sm text-ink-muted">אין לעמותה חשבון בנק רשום. בלי חשבון רשום, תנועות שנמשכות מהבנק לא נקלטות - מוסיפים בכרטיס העמותה.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {q.data.map((a) => {
            const r = a.lastRun;
            return (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
                <div>
                  <p className="font-medium text-ink">{a.bank_name ?? "בנק"} <span className="ltr-num text-ink-muted">{a.account_number_masked}</span></p>
                  <p className="text-xs text-ink-muted">
                    {r ? `קליטה אחרונה: ${when(r.started_at)}` : "עוד לא נקלטו תנועות אוטומטית"}
                    {` · ${a.monthCount} תנועות בחודש`}
                  </p>
                  {r && (r.status === "failed" || r.status === "partial") && (r.error_message || r.gap_detail) && (
                    <p className="mt-0.5 text-xs text-warn-ink">{r.error_message ?? r.gap_detail}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {a.lastBalance !== null && <span className="tabular font-semibold text-ink">{money(a.lastBalance)} ₪</span>}
                  {r && (
                    <StatusBadge
                      severity={r.status === "success" ? "ok" : r.status === "failed" ? "critical" : "medium"}
                      label={r.status === "success" ? "נקלט" : r.status === "failed" ? "נכשל" : r.status === "partial" ? "לבדיקה" : "רץ"}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
