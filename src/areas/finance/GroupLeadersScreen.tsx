import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Building2, Info, Network, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { StatusBadge } from "@/components/StatusBadge";
import { useLastSelected } from "@/lib/useLastSelected";

interface LeaderBalanceRow {
  group_leader_id: string;
  group_leader_name: string;
  organization_id: string;
  organization_name: string;
  group_count: number;
  branch_count: number;
  balance: number;
}

interface LeaderGroupRow {
  group_leader_id: string;
  organization_id: string;
  organization_name: string;
  group_id: string;
  group_name: string;
  group_status: string;
  branch_id: string;
  branch_name: string;
  talmud_branch_code: string;
  balance: number;
}

interface MismatchRow {
  group_leader_id: string;
  group_leader_name: string;
  organization_id: string;
  organization_name: string;
  distinct_rule_shapes: number;
  group_count: number;
}

async function fetchLeaderBalances(): Promise<LeaderBalanceRow[]> {
  const { data, error } = await supabase.from("group_leader_balances").select("*").order("group_leader_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchLeaderGroups(leaderId: string): Promise<LeaderGroupRow[]> {
  const { data, error } = await supabase
    .from("group_leader_group_rows")
    .select("*")
    .eq("group_leader_id", leaderId)
    .order("organization_name")
    .order("branch_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchMismatches(): Promise<MismatchRow[]> {
  const { data, error } = await supabase.rpc("group_leader_commission_mismatches");
  if (error) throw error;
  return (data as MismatchRow[]) ?? [];
}

function money(value: number): string {
  return value.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// מסך "קבוצה לפי ראש קבוצה" - הקבוצה כפי שהיא בהתנהלות היומיומית, ולא כפי שהיא רשומה.
//
// שני הכללים שמנחים את המסך, מתוך דברי הלקוח:
//   סניפים מאוחדים - "ראש הקבוצה, גם אם הוא מתנהל בשני סניפים, זה לא רלוונטי.
//   הדוחות יופיעו ברצף לכל הקבוצות ביחד."
//   עמותות מפוצלות - "אם קבוצה אחת מתנהלת בשתי עמותות, שיופיע בכל דוח בחלוקה לפי
//   שתי העמותות."
//
// אין כאן סכום כולל על פני עמותות, וזה לא השמטה: הלקוח אישר שכל עמותה מנהלת חשבון
// נפרד ומשלמת בנפרד. מספר מאוחד בין עמותות היה מספר שאי אפשר לשלם ואי אפשר להתאים
// מול הבנק, ולכן מוצגת במקומו שורה שאומרת זאת במפורש.
export function GroupLeadersScreen() {
  const balancesQuery = useQuery({ queryKey: ["group-leader-balances"], queryFn: fetchLeaderBalances });
  const mismatchQuery = useQuery({ queryKey: ["group-leader-commission-mismatches"], queryFn: fetchMismatches });
  const [leaderId, setLeaderId] = useLastSelected<string>("last-group-leader", "");

  const leaders = useMemo(() => {
    const map = new Map<string, { id: string; name: string; orgCount: number; groupCount: number }>();
    for (const row of balancesQuery.data ?? []) {
      const current = map.get(row.group_leader_id);
      if (current) {
        current.orgCount += 1;
        current.groupCount += row.group_count;
      } else {
        map.set(row.group_leader_id, {
          id: row.group_leader_id,
          name: row.group_leader_name,
          orgCount: 1,
          groupCount: row.group_count,
        });
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "he"));
  }, [balancesQuery.data]);

  const groupsQuery = useQuery({
    queryKey: ["group-leader-groups", leaderId],
    queryFn: () => fetchLeaderGroups(leaderId),
    enabled: !!leaderId,
  });

  const orgBlocks = useMemo(() => (balancesQuery.data ?? []).filter((r) => r.group_leader_id === leaderId), [balancesQuery.data, leaderId]);
  const selected = leaders.find((l) => l.id === leaderId) ?? null;
  const leaderMismatches = (mismatchQuery.data ?? []).filter((m) => m.group_leader_id === leaderId);

  return (
    <div>
      <PageHeader
        title="קבוצות לפי ראש קבוצה"
        description="הקבוצה כפי שהיא מתנהלת בפועל - כל הקבוצות של אותו ראש קבוצה יחד, מכל הסניפים. עמותות מוצגות בנפרד, כי כל עמותה מנהלת חשבון נפרד ומשלמת בנפרד."
      />

      {balancesQuery.isLoading ? (
        <LoadingState rows={4} />
      ) : balancesQuery.error ? (
        <ErrorState message={(balancesQuery.error as Error).message} />
      ) : leaders.length === 0 ? (
        <EmptyState
          icon={Users}
          title="אין עדיין קבוצות עם ראש קבוצה"
          description="קבוצה מקבלת ראש קבוצה במסך סניפים וקבוצות. קבוצות בלי ראש קבוצה ממשיכות להופיע רגיל במסך יתרות קבוצות."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="space-y-1.5">
            <label className="field-label" htmlFor="leader-select">
              ראש קבוצה
            </label>
            <select id="leader-select" value={leaderId} onChange={(e) => setLeaderId(e.target.value)} className="input-field">
              <option value="">— בחרי —</option>
              {leaders.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.orgCount > 1 ? ` (${l.orgCount} עמותות)` : ""}
                </option>
              ))}
            </select>
            <p className="pt-1 text-xs text-ink-subtle">{leaders.length} ראשי קבוצה</p>
          </aside>

          <div className="space-y-4">
            {!leaderId ? (
              <p className="text-sm text-ink-muted">בחרי ראש קבוצה כדי לראות את הקבוצה שלו.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-ink">{selected?.name}</h2>
                  <span className="flex items-center gap-1 text-xs text-ink-subtle">
                    <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {orgBlocks.length} עמותות
                  </span>
                  <span className="flex items-center gap-1 text-xs text-ink-subtle">
                    <Network className="h-3.5 w-3.5" aria-hidden="true" />
                    {selected?.groupCount} רשומות קבוצה
                  </span>
                </div>

                {leaderMismatches.length > 0 && (
                  <div className="flex items-start gap-2 rounded-control border border-warn bg-warn-soft p-3 text-sm text-warn-ink">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <div>
                      <p className="font-semibold">כללי עמלה שונים בתוך אותה עמותה</p>
                      <p className="mt-1">
                        לרשומות של הקבוצה הזו ב
                        {leaderMismatches.map((m) => m.organization_name).join(", ")} יש כללי עמלה שונים זה מזה. אם התכוונת
                        שהתנאים יהיו זהים לכל הקבוצה - כנראה עודכנה רק אחת מהרשומות.
                      </p>
                    </div>
                  </div>
                )}

                {orgBlocks.map((org) => {
                  const rows = (groupsQuery.data ?? []).filter((g) => g.organization_id === org.organization_id);
                  return (
                    <section key={org.organization_id} className="card overflow-hidden">
                      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-muted px-4 py-2.5">
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                          <Building2 className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" />
                          {org.organization_name}
                        </span>
                        <span className="text-sm">
                          <span className="text-ink-subtle">יתרה: </span>
                          <span className={`font-semibold tabular ${org.balance < 0 ? "text-danger" : "text-ink"}`}>{money(org.balance)} ₪</span>
                        </span>
                      </header>

                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-line text-xs text-ink-subtle">
                            <th className="px-4 py-2 text-right font-medium">קבוצה</th>
                            <th className="px-4 py-2 text-right font-medium">סניף</th>
                            <th className="px-4 py-2 text-right font-medium">יתרה</th>
                          </tr>
                        </thead>
                        <tbody>
                          {groupsQuery.isLoading ? (
                            <tr>
                              <td colSpan={3} className="px-4 py-3 text-ink-subtle">
                                טוען...
                              </td>
                            </tr>
                          ) : (
                            rows.map((g) => (
                              <tr key={g.group_id} className="border-b border-line last:border-0">
                                <td className="px-4 py-2 text-ink">
                                  {g.group_name}
                                  {g.group_status !== "active" && (
                                    <span className="mr-2">
                                      <StatusBadge severity="neutral" label="סגורה" />
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-2 text-ink-muted">
                                  {g.branch_name} <span className="text-ink-subtle ltr-num">({g.talmud_branch_code})</span>
                                </td>
                                <td className={`px-4 py-2 tabular ${g.balance < 0 ? "text-danger" : "text-ink"}`}>{money(g.balance)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </section>
                  );
                })}

                {orgBlocks.length > 1 && (
                  <div className="flex items-start gap-2 rounded-control border border-line bg-surface-muted p-3 text-sm text-ink-muted">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" />
                    <span>
                      אין סכום מאוחד בין העמותות, וזו לא השמטה: כל עמותה מנהלת חשבון נפרד ומשלמת בנפרד. סכום שמאחד את שתיהן
                      אינו סכום שאפשר לשלם או להתאים מול הבנק.
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
