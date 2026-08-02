import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useLastSelected } from "@/lib/useLastSelected";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";

interface OrgOption {
  id: string;
  legal_name: string;
}

interface GroupBalanceRow {
  group_id: string;
  group_name: string;
  balance: number;
}

type EntryType = "net_scholarship" | "donation" | "credit" | "payment" | "refund" | "charge" | "correction";

interface LedgerEntry {
  id: string;
  entry_type: EntryType;
  amount: number;
  period_month: string | null;
  source_table: string | null;
  reference: string | null;
  reason: string | null;
  created_at: string;
}

const ENTRY_TYPE_LABEL: Record<EntryType, string> = {
  net_scholarship: "מלגה נטו",
  donation: "תרומה",
  credit: "זיכוי",
  payment: "תשלום",
  refund: "החזרה",
  charge: "חיוב",
  correction: "תיקון",
};

async function fetchOrgs(): Promise<OrgOption[]> {
  const { data, error } = await supabase.from("organizations").select("id, legal_name").eq("status", "active").order("legal_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchGroupBalances(orgId: string): Promise<GroupBalanceRow[]> {
  const { data, error } = await supabase.from("group_balances").select("group_id, group_name, balance").eq("organization_id", orgId).order("group_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchLedgerEntries(groupId: string): Promise<LedgerEntry[]> {
  const { data, error } = await supabase
    .from("group_ledger_entries")
    .select("id, entry_type, amount, period_month, source_table, reference, reason, created_at")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

const EMPTY_CORRECTION = { amount: "", periodMonth: new Date().toISOString().slice(0, 7) + "-01", reason: "", reference: "" };

export function GroupBalancesScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canCorrect } = useHasPermission("ledger", "correct");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });

  const [orgId, setOrgId] = useLastSelected<string>("last-org", "");
  const [selectedGroupId, setSelectedGroupId] = useLastSelected<string>("last-group", "");
  const [showCorrection, setShowCorrection] = useState(false);
  const [correction, setCorrection] = useState(EMPTY_CORRECTION);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const balancesQuery = useQuery({ queryKey: ["group-balances", orgId], queryFn: () => fetchGroupBalances(orgId), enabled: !!orgId });
  const entriesQuery = useQuery({ queryKey: ["group-ledger-entries", selectedGroupId], queryFn: () => fetchLedgerEntries(selectedGroupId), enabled: !!selectedGroupId });

  const selectedGroup = balancesQuery.data?.find((g) => g.group_id === selectedGroupId) ?? null;
  const totalLiabilities = (balancesQuery.data ?? []).reduce((sum, g) => sum + g.balance, 0);

  const openGroup = (row: GroupBalanceRow) => {
    setSelectedGroupId(row.group_id);
    setShowCorrection(false);
    setCorrection(EMPTY_CORRECTION);
    setError(null);
  };

  const submitCorrection = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedGroupId || !correction.amount) return;
    setSubmitting(true);
    setError(null);
    const { error: err } = await supabase.rpc("create_ledger_correction", {
      p_organization_id: orgId,
      p_group_id: selectedGroupId,
      p_period_month: correction.periodMonth,
      p_amount: Number(correction.amount),
      p_reason: correction.reason,
      p_reference: correction.reference || null,
    });
    setSubmitting(false);
    if (err) {
      setError(err.message);
      return;
    }
    setCorrection(EMPTY_CORRECTION);
    setShowCorrection(false);
    queryClient.invalidateQueries({ queryKey: ["group-balances", orgId] });
    queryClient.invalidateQueries({ queryKey: ["group-ledger-entries", selectedGroupId] });
  };

  const balanceColumns: DataTableColumn<GroupBalanceRow>[] = [
    { key: "name", header: "קבוצה", render: (r) => r.group_name },
    {
      key: "balance",
      header: "יתרה",
      className: "tabular",
      render: (r) => <span className={r.balance < 0 ? "text-danger" : "text-ink"}>{r.balance.toLocaleString("he-IL")}</span>,
    },
  ];

  const entryColumns: DataTableColumn<LedgerEntry>[] = [
    { key: "date", header: "תאריך", className: "tabular", render: (r) => new Date(r.created_at).toLocaleDateString("he-IL") },
    { key: "type", header: "סוג תנועה", render: (r) => ENTRY_TYPE_LABEL[r.entry_type] },
    {
      key: "amount",
      header: "סכום",
      className: "tabular",
      render: (r) => <span className={r.amount < 0 ? "text-danger" : "text-ok-ink"}>{r.amount.toLocaleString("he-IL")}</span>,
    },
    { key: "month", header: "חודש", className: "tabular", render: (r) => r.period_month ?? "—" },
    { key: "source", header: "מקור", render: (r) => r.source_table ?? "—" },
    { key: "ref", header: "אסמכתה / סיבה", render: (r) => (r.reference ? <span className="ltr-num">{r.reference}</span> : r.reason ?? "—") },
  ];

  return (
    <div>
      <PageHeader
        title="יתרות קבוצות"
        description="יתרה = מלגות נטו + תרומות משויכות + זיכויים מאושרים − תשלומים שבוצעו − חיובים מאושרים. מחושבת תמיד, לא שדה לעריכה - תיקון רק בתנועה נגדית."
      />

      <div className="mb-4 max-w-sm">
        <label className="field-label">עמותה</label>
        <select
          value={orgId}
          onChange={(e) => {
            setOrgId(e.target.value);
            setSelectedGroupId("");
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

      {orgId && (
        <>
          <div className="card mb-4 max-w-sm p-4">
            <p className="text-xs text-ink-subtle">סך התחייבויות לכל הקבוצות</p>
            <p className={`mt-1 text-xl font-bold tabular ${totalLiabilities < 0 ? "text-danger" : "text-ink"}`}>
              {totalLiabilities.toLocaleString("he-IL")}
            </p>
          </div>

          <DataTable
            columns={balanceColumns}
            rows={balancesQuery.data ?? []}
            rowKey={(r) => r.group_id}
            loading={balancesQuery.isLoading}
            emptyTitle="אין קבוצות לעמותה זו"
            emptyIcon={Wallet}
            onRowClick={openGroup}
          />

          {selectedGroupId && (
            <div className="card mt-6 max-w-4xl space-y-4 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-ink-muted">כרטיס יתרה — {selectedGroup?.group_name}</h2>
                  <p className="text-xs text-ink-subtle">
                    יתרה נוכחית: <span className="tabular">{selectedGroup?.balance.toLocaleString("he-IL")}</span>
                  </p>
                </div>
                {canCorrect && (
                  <button onClick={() => setShowCorrection((v) => !v)} className="btn-secondary text-xs">
                    {showCorrection ? "סגירה" : "תנועת תיקון"}
                  </button>
                )}
              </div>

              {showCorrection && (
                <form onSubmit={submitCorrection} className="rounded-control border border-line bg-surface-muted p-4 space-y-3">
                  <p className="text-xs text-ink-subtle">תיקון הוא תמיד תנועה נגדית חדשה עם סיבה - אין עריכה של יתרה או תנועה קיימת.</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="field-label">סכום (חיובי/שלילי)</label>
                      <input
                        required
                        type="number"
                        step="0.01"
                        value={correction.amount}
                        onChange={(e) => setCorrection((f) => ({ ...f, amount: e.target.value }))}
                        className="input-field tabular"
                      />
                    </div>
                    <div>
                      <label className="field-label">חודש כספי</label>
                      <input
                        required
                        type="date"
                        value={correction.periodMonth}
                        onChange={(e) => setCorrection((f) => ({ ...f, periodMonth: e.target.value }))}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="field-label">אסמכתה (לא חובה)</label>
                      <input value={correction.reference} onChange={(e) => setCorrection((f) => ({ ...f, reference: e.target.value }))} className="input-field" />
                    </div>
                  </div>
                  <div>
                    <label className="field-label">סיבה (חובה)</label>
                    <input required value={correction.reason} onChange={(e) => setCorrection((f) => ({ ...f, reason: e.target.value }))} className="input-field" />
                  </div>
                  {error && <ErrorState message={error} />}
                  <button type="submit" disabled={submitting} className="btn-primary text-sm">
                    {submitting ? "שומרת…" : "שמירת תיקון"}
                  </button>
                </form>
              )}

              {entriesQuery.isLoading ? (
                <LoadingState rows={3} />
              ) : (
                <DataTable columns={entryColumns} rows={entriesQuery.data ?? []} rowKey={(r) => r.id} emptyTitle="אין עדיין תנועות לקבוצה זו" />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
