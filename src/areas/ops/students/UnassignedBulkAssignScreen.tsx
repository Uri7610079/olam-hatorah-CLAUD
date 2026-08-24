import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/LoadingState";
import { ErrorState } from "@/components/ErrorState";
import { EmptyState } from "@/components/EmptyState";

// שיוך מרוכז של תלמידים שנדחו מדוח תלמוד בגלל חוסר שיוך.
//
// המסך הזה קיים כי שיוך של 48 תלמידים אחד-אחד הוא עבודה שאיש לא מסיים,
// והזכאות שלהם - 20,587.50 ש"ח בדוחות של אוגוסט 2026 - נשארת בחוץ.
//
// הרעיון כולו: הסניף כבר ידוע. הוא מופיע בדוח עצמו לכל תלמיד, ולכן אין
// מה לשאול עליו. מה שאינו ידוע הוא הקבוצה - היא לא מופיעה בדוח בשום
// צורה - ולכן היא הדבר היחיד שנבחר כאן, ופעם אחת לכל סניף. 48 תלמידים
// מתפלגים על שישה סניפים, וזה ההבדל בין שש הכרעות לארבעים ושמונה.

interface PendingStudent {
  student_id: string;
  full_name: string;
  external_id: string;
  organization_id: string;
  organization_name: string;
  branch_code: string;
  branch_id: string | null;
  branch_name: string | null;
  amount: number;
}

interface GroupOption {
  id: string;
  branch_id: string;
  name: string;
}

const money = (n: number) =>
  n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function fetchPending(): Promise<PendingStudent[]> {
  const { data, error } = await supabase
    .from("talmud_unassigned_students")
    .select("student_id, full_name, external_id, organization_id, organization_name, branch_code, branch_id, branch_name, amount");
  if (error) throw error;
  return data ?? [];
}

async function fetchGroups(): Promise<GroupOption[]> {
  const { data, error } = await supabase
    .from("groups")
    .select("id, branch_id, name")
    .eq("status", "active")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export function UnassignedBulkAssignScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canManage, isLoading: permissionLoading } = useHasPermission("students", "manage");

  const pendingQuery = useQuery({ queryKey: ["talmud-unassigned"], queryFn: fetchPending, enabled: canManage });
  const groupsQuery = useQuery({ queryKey: ["groups-active"], queryFn: fetchGroups, enabled: canManage });

  const [chosenGroup, setChosenGroup] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // קיבוץ לפי סניף. מפתח הקבוצה הוא עמותה+קוד סניף ולא קוד הסניף לבדו:
  // קוד "01" קיים בכל עמותה בנפרד, ומיזוג ביניהם היה משייך תלמיד
  // לקבוצה של עמותה אחרת.
  const branches = useMemo(() => {
    const map = new Map<string, { key: string; label: string; branchId: string | null; branchCode: string; students: PendingStudent[] }>();
    for (const s of pendingQuery.data ?? []) {
      const key = `${s.organization_id}|${s.branch_code}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          // השם הפנימי של הסניף הוא לרוב הקוד עצמו ("08"), ואז "סניף 08 — 08"
          // הוא רעש. מוסיפים אותו רק כשהוא באמת מוסיף מידע.
          label:
            `${s.organization_name} · סניף ${s.branch_code}` +
            (s.branch_name && s.branch_name !== s.branch_code ? ` — ${s.branch_name}` : ""),
          branchId: s.branch_id,
          branchCode: s.branch_code,
          students: [],
        });
      }
      map.get(key)!.students.push(s);
    }
    return [...map.values()].sort((a, b) => b.students.length - a.students.length);
  }, [pendingQuery.data]);

  const groupsByBranch = useMemo(() => {
    const m = new Map<string, GroupOption[]>();
    for (const g of groupsQuery.data ?? []) {
      if (!m.has(g.branch_id)) m.set(g.branch_id, []);
      m.get(g.branch_id)!.push(g);
    }
    return m;
  }, [groupsQuery.data]);

  // סניף עם קבוצה פעילה אחת אינו דורש הכרעה - אין ממה לבחור. הבחירה
  // עדיין מוצגת, כדי שמה שעומד לקרות יהיה גלוי ולא ייעשה מאחורי הגב.
  const groupFor = (b: (typeof branches)[number]): string => {
    if (chosenGroup[b.key]) return chosenGroup[b.key];
    const opts = b.branchId ? groupsByBranch.get(b.branchId) ?? [] : [];
    return opts.length === 1 ? opts[0].id : "";
  };

  const selectedIds = (b: (typeof branches)[number]) =>
    b.students.filter((s) => !excluded.has(s.student_id)).map((s) => s.student_id);

  const readyBranches = branches.filter((b) => groupFor(b) && selectedIds(b).length > 0);
  const totalSelected = readyBranches.reduce((n, b) => n + selectedIds(b).length, 0);
  const totalAmount = readyBranches.reduce(
    (n, b) => n + b.students.filter((s) => !excluded.has(s.student_id)).reduce((a, s) => a + Number(s.amount), 0),
    0
  );

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const assignAll = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    let assigned = 0;
    let skipped = 0;
    for (const b of readyBranches) {
      const { data, error: rpcError } = await supabase
        .rpc("bulk_assign_students", { p_group_id: groupFor(b), p_student_ids: selectedIds(b) })
        .single();
      if (rpcError) {
        setError(`${b.label}: ${rpcError.message}`);
        setBusy(false);
        return;
      }
      const r = data as { assigned_count: number; skipped_count: number };
      assigned += r.assigned_count;
      skipped += r.skipped_count;
    }
    setBusy(false);
    setResult(
      `שויכו ${assigned} תלמידים` +
        (skipped ? ` · ${skipped} דולגו (כבר היה להם שיוך)` : "") +
        '. כעת יש להריץ "השלמת שורות שנדחו" במסך זכאות כדי שהזכאות שלהם תיזקף.'
    );
    setExcluded(new Set());
    void queryClient.invalidateQueries({ queryKey: ["talmud-unassigned"] });
    void queryClient.invalidateQueries({ queryKey: ["unified-exceptions"] });
    void queryClient.invalidateQueries({ queryKey: ["students"] });
  };

  if (permissionLoading) return <LoadingState rows={4} />;
  if (!canManage) return <ErrorState message="אין לך הרשאה לנהל תלמידים." />;
  if (pendingQuery.isLoading || groupsQuery.isLoading) return <LoadingState rows={6} />;
  if (pendingQuery.error) return <ErrorState message="שגיאה בטעינת רשימת התלמידים." />;

  return (
    <div>
      <PageHeader
        title="שיוך מרוכז לתלמידים חסרי שיוך"
        description="תלמידים שהופיעו בדוח דרישת תשלום מתלמוד, קיימים במערכת, ונדחו רק משום שאין להם שיוך פעיל לסניף ולקבוצה. הסניף כבר ידוע מהדוח — צריך לבחור רק את הקבוצה, פעם אחת לכל סניף."
      />

      {result && (
        <div className="mb-4 flex items-start gap-2 rounded-control border border-ok/30 bg-ok-soft p-3 text-sm text-ok-ink">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{result}</span>
        </div>
      )}
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-control border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {branches.length === 0 ? (
        <EmptyState title="אין תלמידים חסרי שיוך" description="כל התלמידים שהופיעו בדוחות תלמוד משויכים לסניף ולקבוצה." />
      ) : (
        <>
          <div className="space-y-4">
            {branches.map((b) => {
              const opts = b.branchId ? groupsByBranch.get(b.branchId) ?? [] : [];
              const chosen = groupFor(b);
              const count = selectedIds(b).length;
              const sum = b.students
                .filter((s) => !excluded.has(s.student_id))
                .reduce((a, s) => a + Number(s.amount), 0);

              return (
                <div key={b.key} className="rounded-control border border-line bg-surface p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 font-medium text-ink">
                      <Users className="h-4 w-4 shrink-0 text-brand-500" aria-hidden="true" />
                      {b.label}
                      <span className="text-sm font-normal text-ink-muted">
                        · {count} מתוך {b.students.length} · <span className="ltr-num">{money(sum)}</span> ₪
                      </span>
                    </div>

                    {/* סניף שאינו קיים במערכת אינו ניתן לשיוך בכלל - אין לו קבוצות.
                        אומרים זאת במפורש במקום להציג רשימה ריקה בלי הסבר. */}
                    {b.branchId === null ? (
                      <span className="text-sm text-danger">
                        הסניף אינו קיים במערכת — יש לפתוח אותו קודם במסך סניפים וקבוצות
                      </span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-ink-muted" htmlFor={`group-${b.key}`}>
                          קבוצה
                        </label>
                        <select
                          id={`group-${b.key}`}
                          className="input-field"
                          value={chosen}
                          onChange={(e) => setChosenGroup((p) => ({ ...p, [b.key]: e.target.value }))}
                        >
                          <option value="">— יש לבחור —</option>
                          {opts.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                    {b.students.map((s) => (
                      <li key={s.student_id}>
                        <label className="flex items-center gap-2 text-sm text-ink">
                          <input
                            type="checkbox"
                            checked={!excluded.has(s.student_id)}
                            onChange={() => toggle(s.student_id)}
                            disabled={b.branchId === null}
                          />
                          <span className="truncate">{s.full_name}</span>
                          <span className="ltr-num text-xs text-ink-subtle">{s.external_id}</span>
                          {Number(s.amount) > 0 && (
                            <span className="ltr-num text-xs text-ink-muted">{money(Number(s.amount))} ₪</span>
                          )}
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-control border border-line bg-surface-muted p-4">
            <div className="text-sm text-ink">
              {totalSelected > 0 ? (
                <>
                  מוכנים לשיוך: <span className="font-medium">{totalSelected}</span> תלמידים ב-{readyBranches.length}{" "}
                  סניפים · <span className="ltr-num font-medium">{money(totalAmount)}</span> ₪ שייכנסו אחרי ההשלמה
                </>
              ) : (
                <span className="text-ink-muted">יש לבחור קבוצה לכל סניף כדי לשייך.</span>
              )}
            </div>
            <button type="button" className="btn-primary" disabled={busy || totalSelected === 0} onClick={() => void assignAll()}>
              {busy ? "משייך…" : `שיוך ${totalSelected} תלמידים`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
