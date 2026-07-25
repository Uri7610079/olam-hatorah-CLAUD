import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GitMerge, AlertTriangle, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ErrorState } from "@/components/ErrorState";

interface OrgOption {
  id: string;
  legal_name: string;
}

interface BankAccountOption {
  id: string;
  bank_name: string | null;
  account_number_masked: string | null;
}

type MatchType = "masav_batch" | "donation" | "commission" | "return" | "inter_account_transfer" | "other_expense" | "other_income";
type MatchStatus = "suggested" | "approved" | "rejected";

interface MatchRow {
  id: string;
  match_type: MatchType;
  target_table: string | null;
  target_id: string | null;
  matched_amount: number;
  status: MatchStatus;
  suggested_reason: string | null;
  notes: string | null;
  rejected_reason: string | null;
}

interface TransactionRow {
  id: string;
  execution_date: string;
  direction: "debit" | "credit";
  amount: number;
  description: string | null;
  reference: string | null;
  matches: MatchRow[];
}

interface ExceptionRow {
  exception_type: string;
  severity: "critical" | "warning";
  related_table: string;
  related_id: string;
  amount: number | null;
  related_date: string | null;
  description: string;
}

interface MasavBatchOption {
  id: string;
  period_month: string;
  total_amount: number;
  status: string;
}

interface DonationOption {
  id: string;
  amount: number;
  donation_date: string;
  donor_reference_masked: string | null;
}

interface ReturnOption {
  id: string;
  amount: number;
  return_date: string;
  reason: string;
}

interface InterAccountOption {
  id: string;
  execution_date: string;
  amount: number;
  description: string | null;
}

const MATCH_TYPE_LABEL: Record<MatchType, string> = {
  masav_batch: "אצוות מס״ב",
  donation: "תרומה",
  commission: "עמלה",
  return: "החזרת תשלום",
  inter_account_transfer: "העברה בין חשבונות",
  other_expense: "הוצאה אחרת",
  other_income: "הכנסה אחרת",
};
const MATCH_STATUS_LABEL: Record<MatchStatus, string> = { suggested: "הצעה", approved: "מאושר", rejected: "נדחה" };
const DIRECTION_LABEL: Record<"debit" | "credit", string> = { debit: "חובה", credit: "זכות" };
const SEVERITY_LABEL: Record<"critical" | "warning", string> = { critical: "קריטי", warning: "אזהרה" };

async function fetchOrgs(): Promise<OrgOption[]> {
  const { data, error } = await supabase.from("organizations").select("id, legal_name").eq("status", "active").order("legal_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchOrgBankAccounts(orgId: string): Promise<BankAccountOption[]> {
  const { data, error } = await supabase
    .from("organization_bank_accounts_view")
    .select("id, bank_name, account_number_masked")
    .eq("organization_id", orgId)
    .eq("is_active", true);
  if (error) throw error;
  return data ?? [];
}

async function fetchTransactions(accountId: string): Promise<TransactionRow[]> {
  const { data, error } = await supabase
    .from("bank_transactions")
    .select("id, execution_date, direction, amount, description, reference, matches:bank_matches(id, match_type, target_table, target_id, matched_amount, status, suggested_reason, notes, rejected_reason)")
    .eq("organization_bank_account_id", accountId)
    .order("execution_date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function fetchExceptions(orgId: string): Promise<ExceptionRow[]> {
  const { data, error } = await supabase
    .from("bank_reconciliation_exceptions")
    .select("exception_type, severity, related_table, related_id, amount, related_date, description")
    .eq("organization_id", orgId)
    .order("severity");
  if (error) throw error;
  return data ?? [];
}

async function fetchMasavBatchOptions(accountId: string): Promise<MasavBatchOption[]> {
  const { data, error } = await supabase
    .from("masav_batches")
    .select("id, period_month, total_amount, status")
    .eq("organization_bank_account_id", accountId)
    .in("status", ["transmitted", "bank_completed"])
    .order("period_month", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function fetchDonationOptions(orgId: string): Promise<DonationOption[]> {
  // donations_view (לא הטבלה הבסיסית) - donor_reference ממוסך כברירת מחדל, בדיוק כמו בכל
  // מסך אחר שמציג תרומות (ר' תיקון שלב 16: הטבלה הבסיסית עצמה דורשת עכשיו view_sensitive).
  const { data, error } = await supabase
    .from("donations_view")
    .select("id, amount, donation_date, donor_reference_masked")
    .eq("organization_id", orgId)
    .eq("status", "approved")
    .order("donation_date", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

async function fetchReturnOptions(orgId: string): Promise<ReturnOption[]> {
  // payment_returns has two FKs into masav_lines (original + retry) - חייבים לציין את שם
  // ה-FK במפורש (אותו דפוס PGRST201 שכבר תועד ב-ReturnsScreen/שלב 10).
  const { data, error } = await supabase
    .from("payment_returns")
    .select("id, amount, return_date, reason, masav_line:masav_lines!payment_returns_masav_line_id_fkey(batch:masav_batches(organization_id))")
    .in("status", ["open", "retried"])
    .order("return_date", { ascending: false });
  if (error) throw error;
  return (data ?? [])
    .map((r: any) => ({ ...r, masav_line: Array.isArray(r.masav_line) ? r.masav_line[0] : r.masav_line }))
    .map((r: any) => ({ ...r, _orgId: Array.isArray(r.masav_line.batch) ? r.masav_line.batch[0]?.organization_id : r.masav_line.batch?.organization_id }))
    .filter((r: any) => r._orgId === orgId);
}

async function fetchInterAccountOptions(orgId: string, excludeTransactionId: string): Promise<InterAccountOption[]> {
  const { data: accounts } = await supabase.from("organization_bank_accounts_view").select("id").eq("organization_id", orgId);
  const accountIds = (accounts ?? []).map((a) => a.id);
  if (accountIds.length === 0) return [];
  const { data, error } = await supabase
    .from("bank_transactions")
    .select("id, execution_date, amount, description")
    .in("organization_bank_account_id", accountIds)
    .neq("id", excludeTransactionId)
    .order("execution_date", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

export function BankMatchingScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canMatch } = useHasPermission("bank_matching", "perform");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });

  const [orgId, setOrgId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyMatchId, setBusyMatchId] = useState<string | null>(null);
  const [rejectingMatchId, setRejectingMatchId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null);
  const [matchType, setMatchType] = useState<MatchType>("masav_batch");
  const [targetId, setTargetId] = useState("");
  const [matchedAmount, setMatchedAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);

  const bankAccountsQuery = useQuery({ queryKey: ["matching-org-accounts", orgId], queryFn: () => fetchOrgBankAccounts(orgId), enabled: !!orgId });
  const transactionsQuery = useQuery({ queryKey: ["matching-transactions", accountId], queryFn: () => fetchTransactions(accountId), enabled: !!accountId });
  const exceptionsQuery = useQuery({ queryKey: ["reconciliation-exceptions", orgId], queryFn: () => fetchExceptions(orgId), enabled: !!orgId });

  const masavBatchOptionsQuery = useQuery({ queryKey: ["matching-masav-options", accountId], queryFn: () => fetchMasavBatchOptions(accountId), enabled: !!accountId && matchType === "masav_batch" });
  const donationOptionsQuery = useQuery({ queryKey: ["matching-donation-options", orgId], queryFn: () => fetchDonationOptions(orgId), enabled: !!orgId && matchType === "donation" });
  const returnOptionsQuery = useQuery({ queryKey: ["matching-return-options", orgId], queryFn: () => fetchReturnOptions(orgId), enabled: !!orgId && matchType === "return" });
  const interAccountOptionsQuery = useQuery({
    queryKey: ["matching-inter-account-options", orgId, selectedTransactionId],
    queryFn: () => fetchInterAccountOptions(orgId, selectedTransactionId!),
    enabled: !!orgId && !!selectedTransactionId && matchType === "inter_account_transfer",
  });

  const selectedTransaction = transactionsQuery.data?.find((t) => t.id === selectedTransactionId) ?? null;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["matching-transactions", accountId] });
    queryClient.invalidateQueries({ queryKey: ["reconciliation-exceptions", orgId] });
  };

  const runSuggestions = async () => {
    if (!accountId) return;
    setSuggesting(true);
    setError(null);
    const { error: err } = await supabase.rpc("suggest_masav_matches", { p_organization_bank_account_id: accountId });
    setSuggesting(false);
    if (err) {
      setError(err.message);
      return;
    }
    refresh();
  };

  const approveMatch = async (matchId: string) => {
    setBusyMatchId(matchId);
    setError(null);
    const { error: err } = await supabase.rpc("approve_bank_match", { p_match_id: matchId });
    setBusyMatchId(null);
    if (err) {
      setError(err.message);
      return;
    }
    refresh();
  };

  const submitReject = async () => {
    if (!rejectingMatchId || !rejectReason.trim()) return;
    setBusyMatchId(rejectingMatchId);
    setError(null);
    const { error: err } = await supabase.rpc("reject_bank_match", { p_match_id: rejectingMatchId, p_reason: rejectReason });
    setBusyMatchId(null);
    if (err) {
      setError(err.message);
      return;
    }
    setRejectingMatchId(null);
    setRejectReason("");
    refresh();
  };

  const targetTableFor = (t: MatchType): string | null =>
    t === "masav_batch" ? "masav_batches" : t === "donation" ? "donations" : t === "return" ? "payment_returns" : t === "inter_account_transfer" ? "bank_transactions" : null;

  const createMatch = async () => {
    if (!selectedTransactionId || !matchedAmount) return;
    const needsTarget = matchType !== "commission" && matchType !== "other_expense" && matchType !== "other_income";
    if (needsTarget && !targetId) return;
    setCreating(true);
    setError(null);
    const { error: err } = await supabase.rpc("create_bank_match", {
      p_bank_transaction_id: selectedTransactionId,
      p_match_type: matchType,
      p_target_table: needsTarget ? targetTableFor(matchType) : null,
      p_target_id: needsTarget ? targetId : null,
      p_matched_amount: Number(matchedAmount),
      p_notes: notes || null,
    });
    setCreating(false);
    if (err) {
      setError(err.message);
      return;
    }
    setTargetId("");
    setMatchedAmount("");
    setNotes("");
    refresh();
  };

  const columns: DataTableColumn<TransactionRow>[] = [
    { key: "date", header: "תאריך", className: "tabular", render: (r) => r.execution_date },
    { key: "direction", header: "צד", render: (r) => DIRECTION_LABEL[r.direction] },
    { key: "amount", header: "סכום", className: "tabular", render: (r) => r.amount.toLocaleString("he-IL") },
    { key: "desc", header: "תיאור", render: (r) => r.description ?? "—" },
    {
      key: "matched",
      header: "מצב התאמה",
      render: (r) => {
        const approved = r.matches.filter((m) => m.status === "approved").reduce((s, m) => s + m.matched_amount, 0);
        const suggested = r.matches.filter((m) => m.status === "suggested").reduce((s, m) => s + m.matched_amount, 0);
        const remainder = r.amount - approved - suggested;
        if (approved >= r.amount - 0.01) return <StatusBadge severity="ok" label="הותאם במלואו" />;
        if (suggested > 0) return <StatusBadge severity="medium" label={`הצעה ממתינה · יתרה ${remainder.toLocaleString("he-IL")}`} />;
        return <StatusBadge severity="neutral" label={`לא הותאם · יתרה ${remainder.toLocaleString("he-IL")}`} />;
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="התאמות בנק"
        description='כל תנועת בנק (או חלק ממנה) מקושרת ליעד עסקי מאושר - אצוות מס״ב, תרומה, החזרה, עמלה, הוצאה/הכנסה אחרת, או הצד השני של העברה בין חשבונות. תנועה יכולה להתאים לכמה יעדים (פיצול), ויעד יכול להיות מכוסה ע"י כמה תנועות.'
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 max-w-2xl mb-4">
        <div>
          <label className="field-label">עמותה</label>
          <select
            value={orgId}
            onChange={(e) => {
              setOrgId(e.target.value);
              setAccountId("");
              setSelectedTransactionId(null);
            }}
            className="input-field"
          >
            <option value="">— בחרי —</option>
            {(orgsQuery.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.legal_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">חשבון עמותה</label>
          <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setSelectedTransactionId(null); }} className="input-field" disabled={!orgId}>
            <option value="">— בחרי —</option>
            {(bankAccountsQuery.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.bank_name ?? "בנק"} · {a.account_number_masked}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="mb-4"><ErrorState message={error} /></div>}

      {orgId && (exceptionsQuery.data ?? []).length > 0 && (
        <div className="card mb-6 max-w-4xl space-y-2 p-4">
          <h2 className="text-sm font-semibold text-slate-700">חריגות התאמה</h2>
          {(exceptionsQuery.data ?? []).map((e, i) => (
            <div key={i} className={`flex items-start gap-2 rounded-md border p-2 text-sm ${e.severity === "critical" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                <span className="font-medium">{SEVERITY_LABEL[e.severity]}:</span> {e.description}
                {e.amount != null && ` · ${e.amount.toLocaleString("he-IL")}`}
                {e.related_date && ` · ${e.related_date}`}
              </span>
            </div>
          ))}
        </div>
      )}

      {accountId && canMatch && (
        <div className="mb-4">
          <button onClick={runSuggestions} disabled={suggesting} className="btn-secondary flex items-center gap-2 text-xs">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            {suggesting ? "מריצה…" : "הרצת הצעות התאמה למס״ב"}
          </button>
        </div>
      )}

      {accountId && (
        <DataTable
          columns={columns}
          rows={transactionsQuery.data ?? []}
          rowKey={(r) => r.id}
          loading={transactionsQuery.isLoading}
          emptyTitle="אין תנועות בנק בחשבון זה"
          emptyIcon={GitMerge}
          onRowClick={(r) => setSelectedTransactionId(r.id === selectedTransactionId ? null : r.id)}
        />
      )}

      {selectedTransaction && (
        <div className="card mt-4 max-w-4xl space-y-4 p-5">
          <h2 className="text-sm font-semibold text-slate-700">
            תנועה · {selectedTransaction.execution_date} · {selectedTransaction.amount.toLocaleString("he-IL")} ({DIRECTION_LABEL[selectedTransaction.direction]})
          </h2>

          {selectedTransaction.matches.length > 0 && (
            <ul className="space-y-2">
              {selectedTransaction.matches.map((m) => (
                <li key={m.id} className="flex items-center justify-between rounded-md border border-slate-200 p-2 text-sm">
                  <span>
                    {MATCH_TYPE_LABEL[m.match_type]} · {m.matched_amount.toLocaleString("he-IL")}
                    {m.suggested_reason && <span className="text-xs text-slate-400"> · {m.suggested_reason}</span>}
                    {m.rejected_reason && <span className="text-xs text-red-500"> · נדחה: {m.rejected_reason}</span>}
                  </span>
                  <div className="flex items-center gap-2">
                    <StatusBadge severity={m.status === "approved" ? "ok" : m.status === "rejected" ? "critical" : "medium"} label={MATCH_STATUS_LABEL[m.status]} />
                    {m.status === "suggested" && canMatch && (
                      <>
                        <button onClick={() => approveMatch(m.id)} disabled={busyMatchId === m.id} className="btn-primary text-xs">
                          אישור
                        </button>
                        <button onClick={() => setRejectingMatchId(m.id)} className="text-xs text-red-600 underline">
                          דחייה
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {rejectingMatchId && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <label className="field-label">סיבת דחייה (חובה)</label>
              <div className="flex gap-2">
                <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className="input-field" />
                <button onClick={submitReject} disabled={!rejectReason.trim() || busyMatchId === rejectingMatchId} className="btn-primary text-xs shrink-0">
                  אישור
                </button>
                <button onClick={() => setRejectingMatchId(null)} className="text-xs text-slate-500 underline shrink-0">
                  ביטול
                </button>
              </div>
            </div>
          )}

          {canMatch && (
            <div className="space-y-3 border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold text-slate-700">יצירת התאמה ידנית</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="field-label">סוג התאמה</label>
                  <select
                    value={matchType}
                    onChange={(e) => {
                      setMatchType(e.target.value as MatchType);
                      setTargetId("");
                    }}
                    className="input-field"
                  >
                    {(Object.keys(MATCH_TYPE_LABEL) as MatchType[]).map((k) => (
                      <option key={k} value={k}>
                        {MATCH_TYPE_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </div>
                {matchType === "masav_batch" && (
                  <div>
                    <label className="field-label">אצוות מס״ב</label>
                    <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="input-field">
                      <option value="">— בחרי —</option>
                      {(masavBatchOptionsQuery.data ?? []).map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.period_month} · {b.total_amount.toLocaleString("he-IL")}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {matchType === "donation" && (
                  <div>
                    <label className="field-label">תרומה</label>
                    <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="input-field">
                      <option value="">— בחרי —</option>
                      {(donationOptionsQuery.data ?? []).map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.donation_date} · {d.amount.toLocaleString("he-IL")} {d.donor_reference_masked ? `· ${d.donor_reference_masked}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {matchType === "return" && (
                  <div>
                    <label className="field-label">החזרת תשלום</label>
                    <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="input-field">
                      <option value="">— בחרי —</option>
                      {(returnOptionsQuery.data ?? []).map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.return_date} · {r.amount.toLocaleString("he-IL")} · {r.reason}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {matchType === "inter_account_transfer" && (
                  <div>
                    <label className="field-label">תנועת היעד (חשבון אחר)</label>
                    <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="input-field">
                      <option value="">— בחרי —</option>
                      {(interAccountOptionsQuery.data ?? []).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.execution_date} · {t.amount.toLocaleString("he-IL")} {t.description ? `· ${t.description}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="field-label">סכום התאמה</label>
                  <input type="number" step="0.01" value={matchedAmount} onChange={(e) => setMatchedAmount(e.target.value)} className="input-field tabular" />
                </div>
                <div>
                  <label className="field-label">הערות</label>
                  <input value={notes} onChange={(e) => setNotes(e.target.value)} className="input-field" />
                </div>
              </div>
              <button onClick={createMatch} disabled={creating || !matchedAmount} className="btn-primary text-xs">
                {creating ? "יוצרת…" : "יצירת התאמה"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
