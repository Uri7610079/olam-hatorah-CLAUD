import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/fetchAll";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";

interface GroupOption {
  id: string;
  name: string;
  branch: string;
  organization: string;
  leader: string | null;
  bank_account_optional: boolean;
}

async function fetchGroups(): Promise<GroupOption[]> {
  const rows = await fetchAll(() =>
    supabase
      .from("groups")
      .select("id, name, bank_account_optional, leader:group_leaders(full_name), branch:branches!inner(internal_name, organization:organizations(legal_name))")
      .eq("status", "active")
      .order("name")
      .order("id"),
  );
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  return rows
    .map((g: any) => {
      const br = one<any>(g.branch);
      return {
        id: g.id as string,
        name: g.name as string,
        branch: br?.internal_name ?? "—",
        organization: one<any>(br?.organization)?.legal_name ?? "—",
        leader: one<any>(g.leader)?.full_name ?? null,
        bank_account_optional: !!g.bank_account_optional,
      };
    })
    .sort((a, b) => a.organization.localeCompare(b.organization, "he") || a.branch.localeCompare(b.branch, "he") || a.name.localeCompare(b.name, "he"));
}

const groupLabel = (g: GroupOption) => `${g.name} · ${g.branch} · ${g.organization}`;

// הגדרות כלליות של המשרד. כרגע: קבוצות שבהן חשבון בנק אינו חובה (מיגרציה 115).
export function SettingsScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("groups", "manage");
  const groupsQuery = useQuery({ queryKey: ["groups-for-settings"], queryFn: fetchGroups });

  const [search, setSearch] = useState("");
  const [choice, setChoice] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const all = groupsQuery.data ?? [];
  const optional = all.filter((g) => g.bank_account_optional);
  const candidates = useMemo(() => {
    const needle = search.trim();
    return all.filter((g) => !g.bank_account_optional && (!needle || groupLabel(g).includes(needle) || (g.leader ?? "").includes(needle)));
  }, [all, search]);

  const setOptional = async (group: GroupOption, optionalValue: boolean) => {
    setSaving(group.id);
    setError(null);
    setMessage(null);
    const { data, error: err } = await supabase.rpc("set_group_bank_account_optional", { p_group_id: group.id, p_optional: optionalValue });
    setSaving(null);
    if (err) {
      setError(err.message);
      return;
    }
    if (optionalValue) {
      const advanced = Number(data ?? 0);
      setMessage(
        advanced > 0
          ? `"${group.name}" נוספה. ${advanced} תלמידים מהקבוצה עברו עכשיו ל"מוכן לתלמוד".`
          : `"${group.name}" נוספה. אין בה תלמידים שחיכו רק לחשבון בנק.`,
      );
      setChoice("");
    } else {
      setMessage(`"${group.name}" הוסרה. מעכשיו תלמידים חדשים בה יצטרכו חשבון בנק. מי שכבר עבר ל"מוכן לתלמוד" נשאר שם.`);
    }
    queryClient.invalidateQueries({ queryKey: ["groups-for-settings"] });
    queryClient.invalidateQueries({ queryKey: ["groups"] });
    queryClient.invalidateQueries({ queryKey: ["students"] });
  };

  return (
    <div>
      <PageHeader title="הגדרות" description="הגדרות כלליות של המערכת." />

      <section className="card max-w-4xl space-y-4 p-5">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <Wallet className="h-4 w-4" aria-hidden="true" />
            קבוצות שבהן חשבון בנק אינו חובה
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            תלמיד בקבוצה כזו עובר ל"מוכן לתלמוד" גם בלי חשבון בנק, וראש הקבוצה יכול לשלוח מהפורטל תלמיד חדש בלי פרטי בנק.
            לתשלום עדיין צריך חשבון בנק תקין - תלמיד בלי חשבון לא ייכלל בהעברה במס"ב.
          </p>
        </div>

        {groupsQuery.error && <ErrorState message="שגיאה בטעינת הקבוצות." />}
        {error && <ErrorState message={error} />}
        {message && <p className="rounded-md border border-ok/30 bg-ok-soft p-3 text-sm text-ok-ink">{message}</p>}

        {canManage ? (
          <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
            <div>
              <label className="field-label" htmlFor="settings-group-search">חיפוש</label>
              <input
                id="settings-group-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="שם קבוצה, סניף, עמותה או ראש קבוצה"
                className="input-field"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="settings-group-select">קבוצה להוספה</label>
              <select id="settings-group-select" value={choice} onChange={(e) => setChoice(e.target.value)} className="input-field">
                <option value="">— בחרי קבוצה ({candidates.length}) —</option>
                {candidates.map((g) => (
                  <option key={g.id} value={g.id}>
                    {groupLabel(g)}
                    {g.leader ? ` (${g.leader})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={!choice || saving !== null}
              onClick={() => {
                const g = all.find((x) => x.id === choice);
                if (g) void setOptional(g, true);
              }}
            >
              {saving && saving === choice ? "שומרת…" : "הוספה"}
            </button>
          </div>
        ) : (
          <p className="text-xs text-ink-subtle">אין לך הרשאה לשנות הגדרות קבוצות - אפשר רק לצפות.</p>
        )}

        <DataTable
          columns={[
            { key: "name", header: "קבוצה", render: (g: GroupOption) => <span className="font-medium">{g.name}</span> },
            { key: "branch", header: "סניף", render: (g: GroupOption) => g.branch },
            { key: "org", header: "עמותה", render: (g: GroupOption) => g.organization },
            { key: "leader", header: "ראש קבוצה", render: (g: GroupOption) => g.leader ?? "—" },
            {
              key: "actions",
              header: "",
              render: (g: GroupOption) =>
                canManage ? (
                  <button
                    onClick={() => void setOptional(g, false)}
                    disabled={saving !== null}
                    className="text-xs text-danger underline hover:text-danger-ink"
                  >
                    {saving === g.id ? "מסירה…" : "הסרה"}
                  </button>
                ) : null,
            },
          ]}
          rows={optional}
          rowKey={(g: GroupOption) => g.id}
          loading={groupsQuery.isLoading}
          emptyTitle="אין קבוצות כאלה - בכל הקבוצות חשבון בנק הוא חובה"
          emptyIcon={Wallet}
        />

        <p className="text-xs text-ink-subtle">
          אפשר לסמן את זה גם כשמוסיפים קבוצה חדשה, במסך <Link to="/ops/organizations" className="link-action">עמותות, סניפים וקבוצות</Link>.
        </p>
      </section>
    </div>
  );
}
