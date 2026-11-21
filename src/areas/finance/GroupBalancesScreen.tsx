import { groupLabel } from "@/lib/groupLabel";
import { todayLocalIso } from "@/lib/today";
import { fetchAll } from "@/lib/fetchAll";
import { useState, type FormEvent } from "react";
import { fromMonthInput, toMonthInput } from "@/components/MonthField";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useLastSelected } from "@/lib/useLastSelected";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { MetricCard } from "@/components/MetricCard";
import { useIsV3 } from "@/lib/uiTheme";
import { formatDate, formatMoney, formatMonth, formatNumber } from "@/lib/format";

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

// source_table הוא שם טבלה טכני ("eligibility_financial_results") - מוצג בעברית.
// ערך שלא מופיע כאן מוצג כמו שהוא, כדי שמקור חדש לא ייעלם מהמסך.
const SOURCE_TABLE_LABEL: Record<string, string> = {
  eligibility_financial_results: "חישוב מלגה",
  donations: "תרומה",
  masav_lines: "מס״ב",
  masav_batches: "מס״ב",
  payment_returns: "החזרת תשלום",
  demo_batches: "נתוני דמו",
};

/** v3: יתרה עם מינוס מפורש, ₪ ומילה - חוב/זכות לא מועברים בצבע בלבד */
function BalanceAmount({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`tabular font-semibold ${value < 0 ? "text-danger-ink" : "text-ink"}`}>{formatMoney(value)}</span>
      {value < 0 && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger-ink">חוב</span>}
    </span>
  );
}

async function fetchOrgs(): Promise<OrgOption[]> {
  const { data, error } = await supabase.from("organizations").select("id, legal_name").eq("status", "active").order("legal_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchGroupBalances(orgId: string): Promise<GroupBalanceRow[]> {
  // שם הקבוצה מוצג עם הסניף: בעמותה יכולות להיות כמה קבוצות באותו שם (INT-03)
  const [{ data, error }, { data: branches, error: branchesErr }] = await Promise.all([
    supabase.from("group_balances").select("group_id, group_name, branch_id, balance").eq("organization_id", orgId).order("group_name"),
    supabase.from("branches").select("id, internal_name, talmud_branch_code").eq("organization_id", orgId),
  ]);
  if (error) throw error;
  if (branchesErr) throw branchesErr;
  const branchById = new Map((branches ?? []).map((b) => [b.id, b]));
  return (data ?? []).map((r) => ({ group_id: r.group_id, group_name: groupLabel(r.group_name, branchById.get(r.branch_id)), balance: r.balance }));
}

// כסף שנכנס לעמותה עבור תלמידים בלי קבוצה: החישוב החודשי מחשב להם נטו, אבל אין קבוצה
// שאפשר לזקוף לה אותו, ולכן הוא לא מופיע באף יתרה. מוצג בנפרד כ"חסרי שיוך" - כדי שהכסף
// לא ייעלם מהתמונה עד שהתלמידים ישויכו.
export interface UnassignedMoney {
  net: number;
  students: number;
}
export function sumUnassigned(rows: { net_amount: number | string; student_id: string }[]): UnassignedMoney {
  const net = rows.reduce((sum, r) => sum + (Number(r.net_amount) || 0), 0);
  return { net: Math.round(net * 100) / 100, students: new Set(rows.map((r) => r.student_id)).size };
}
async function fetchUnassignedMoney(orgId: string): Promise<UnassignedMoney> {
  const data = await fetchAll(() => supabase
    .from("eligibility_financial_results")
    .select("id, net_amount, student_id")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .is("group_id", null)
    .order("id"));
  return sumUnassigned((data ?? []) as { net_amount: number; student_id: string }[]);
}

async function fetchLedgerEntries(groupId: string): Promise<LedgerEntry[]> {
  const data = await fetchAll(() => supabase
    .from("group_ledger_entries")
    .select("id, entry_type, amount, period_month, source_table, reference, reason, created_at")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false }).order("id"));
  return data ?? [];
}

const EMPTY_CORRECTION = { amount: "", periodMonth: todayLocalIso().slice(0, 7) + "-01", reason: "", reference: "" };

export function GroupBalancesScreen() {
  const queryClient = useQueryClient();
  const isV3 = useIsV3();
  const { hasPermission: canCorrect } = useHasPermission("ledger", "correct");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });

  const [orgId, setOrgId] = useLastSelected<string>("last-org", "");
  const [selectedGroupId, setSelectedGroupId] = useLastSelected<string>("last-group", "");
  const [showCorrection, setShowCorrection] = useState(false);
  const [correction, setCorrection] = useState(EMPTY_CORRECTION);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const balancesQuery = useQuery({ queryKey: ["group-balances", orgId], queryFn: () => fetchGroupBalances(orgId), enabled: !!orgId });
  const unassignedQuery = useQuery({ queryKey: ["group-balances-unassigned", orgId], queryFn: () => fetchUnassignedMoney(orgId), enabled: !!orgId });
  const unassigned = unassignedQuery.data;
  const entriesQuery = useQuery({ queryKey: ["group-ledger-entries", selectedGroupId], queryFn: () => fetchLedgerEntries(selectedGroupId), enabled: !!selectedGroupId });

  const selectedGroup = balancesQuery.data?.find((g) => g.group_id === selectedGroupId) ?? null;
  const totalLiabilities = (balancesQuery.data ?? []).reduce((sum, g) => sum + g.balance, 0);

  const openGroup = (row: GroupBalanceRow) => {
    setSelectedGroupId(row.group_id);
    setShowCorrection(false);
    setCorrection(EMPTY_CORRECTION);
    setError(null);
  };

  // תנועת תיקון היא רישום קבוע בספר (אין עריכה ואין מחיקה) - לכן אישור לפני השמירה.
  const [confirmCorrection, setConfirmCorrection] = useState(false);

  const submitCorrection = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedGroupId || !correction.amount) return;
    setConfirmCorrection(true);
  };

  const saveCorrection = async () => {
    setConfirmCorrection(false);
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

  const negativeCount = (balancesQuery.data ?? []).filter((g) => g.balance < 0).length;

  const balanceColumns: DataTableColumn<GroupBalanceRow>[] = [
    { key: "name", header: "קבוצה", render: (r) => r.group_name },
    {
      key: "balance",
      header: "יתרה",
      className: "tabular",
      kind: isV3 ? "money" : undefined,
      filterValue: isV3 ? (r) => r.balance : undefined,
      sortValue: isV3 ? (r) => r.balance : undefined,
      render: (r) => (isV3 ? <BalanceAmount value={r.balance} /> : <span className={r.balance < 0 ? "text-danger" : "text-ink"}>{r.balance.toLocaleString("he-IL")}</span>),
    },
  ];

  const entryColumns: DataTableColumn<LedgerEntry>[] = [
    {
      key: "date",
      header: "תאריך",
      className: "tabular",
      sortValue: isV3 ? (r) => r.created_at : undefined,
      render: (r) => (isV3 ? formatDate(r.created_at) : new Date(r.created_at).toLocaleDateString("he-IL")),
    },
    { key: "type", header: "סוג תנועה", render: (r) => ENTRY_TYPE_LABEL[r.entry_type] },
    {
      key: "amount",
      header: "סכום",
      className: "tabular",
      kind: isV3 ? "money" : undefined,
      filterValue: isV3 ? (r) => r.amount : undefined,
      sortValue: isV3 ? (r) => r.amount : undefined,
      // v3: + / − מפורש ו-₪ - כניסה ויציאה לא מועברות בצבע בלבד
      render: (r) => (
        <span className={r.amount < 0 ? (isV3 ? "text-danger-ink" : "text-danger") : "text-ok-ink"}>
          {isV3 ? formatMoney(r.amount, { sign: true }) : r.amount.toLocaleString("he-IL")}
        </span>
      ),
    },
    {
      key: "month",
      header: "חודש",
      className: "tabular",
      filterValue: isV3 ? (r) => r.period_month : undefined,
      render: (r) => (isV3 ? (r.period_month ? formatMonth(r.period_month) : "—") : r.period_month ?? "—"),
    },
    { key: "source", header: "מקור", render: (r) => (r.source_table ? SOURCE_TABLE_LABEL[r.source_table] ?? r.source_table : "—") },
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
          {isV3 ? (
            // v3: הסכום הכולל, וכמה קבוצות ביתרת חוב - שני מספרים מהשורות שכבר נטענו
            balancesQuery.data && (
              <div className="mb-4 grid max-w-4xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                  label="סך היתרות לכל הקבוצות"
                  value={formatMoney(totalLiabilities)}
                  tone={totalLiabilities < 0 ? "danger" : "primary"}
                  emphasis
                />
                <MetricCard label="קבוצות" value={formatNumber(balancesQuery.data.length)} />
                <MetricCard
                  label="קבוצות ביתרת חוב"
                  value={formatNumber(negativeCount)}
                  hint={negativeCount ? "יתרה שלילית - יצא יותר ממה שנכנס" : undefined}
                  tone="danger"
                  muted={negativeCount === 0}
                />
                <MetricCard
                  label="חסרי שיוך"
                  value={unassigned ? formatMoney(unassigned.net) : "…"}
                  hint={
                    unassigned && unassigned.students > 0
                      ? `נכנס לעמותה, שייך לקבוצות - חסרי שיוך · ${formatNumber(unassigned.students)} תלמידים`
                      : "נכנס לעמותה, שייך לקבוצות - חסרי שיוך"
                  }
                  tone="warn"
                  muted={!unassigned || unassigned.net === 0}
                  href="/ops/students/unassigned"
                />
              </div>
            )
          ) : (
          <div className="card mb-4 max-w-sm p-4">
            <p className="text-xs text-ink-subtle">סך התחייבויות לכל הקבוצות</p>
            <p className={`mt-1 text-xl font-bold tabular ${totalLiabilities < 0 ? "text-danger" : "text-ink"}`}>
              {totalLiabilities.toLocaleString("he-IL")}
            </p>
            <p className="mt-3 text-xs text-ink-subtle">חסרי שיוך</p>
            <p className="mt-1 text-lg font-bold tabular text-ink">{unassigned ? unassigned.net.toLocaleString("he-IL") : "…"}</p>
            <p className="text-xs text-ink-subtle">
              נכנס לעמותה, שייך לקבוצות - חסרי שיוך{unassigned && unassigned.students > 0 ? ` · ${unassigned.students} תלמידים` : ""}
            </p>
          </div>
          )}

          <DataTable
            columns={balanceColumns}
            rows={balancesQuery.data ?? []}
            rowKey={(r) => r.group_id}
            loading={balancesQuery.isLoading} error={balancesQuery.error} onRetry={() => balancesQuery.refetch()}
            emptyTitle="אין קבוצות לעמותה זו"
            emptyIcon={Wallet}
            onRowClick={openGroup}
            selectedKey={isV3 ? selectedGroupId || null : undefined}
          />

          {selectedGroupId && (
            <div className="card mt-6 max-w-4xl space-y-4 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-ink-muted v3:text-base v3:text-primary">כרטיס יתרה — {selectedGroup?.group_name}</h2>
                  {isV3 ? (
                    <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-muted">
                      יתרה נוכחית: {selectedGroup ? <BalanceAmount value={selectedGroup.balance} /> : "—"}
                    </p>
                  ) : (
                  <p className="text-xs text-ink-subtle">
                    יתרה נוכחית: <span className="tabular">{selectedGroup?.balance.toLocaleString("he-IL")}</span>
                  </p>
                  )}
                </div>
                {canCorrect && (
                  <button onClick={() => setShowCorrection((v) => !v)} className={isV3 ? "btn-secondary" : "btn-secondary text-xs"}>
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
                        type="month"
                        value={toMonthInput(correction.periodMonth)}
                        onChange={(e) => setCorrection((f) => ({ ...f, periodMonth: fromMonthInput(e.target.value) }))}
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

      <ConfirmDialog
        open={confirmCorrection}
        title="שמירת תנועת תיקון"
        description={
          <>
            תירשם תנועה של{" "}
            <span className="tabular font-semibold text-ink">
              {isV3 ? formatMoney(Number(correction.amount), { sign: true }) : Number(correction.amount).toLocaleString("he-IL")}
            </span>{" "}
            לקבוצה {selectedGroup?.group_name ?? ""}. תנועה בספר אינה ניתנת לעריכה או למחיקה - תיקון שלה הוא רק תנועה נגדית חדשה.
          </>
        }
        confirmLabel="שמירת תיקון"
        onConfirm={() => void saveCorrection()}
        onCancel={() => setConfirmCorrection(false)}
      />
    </div>
  );
}
