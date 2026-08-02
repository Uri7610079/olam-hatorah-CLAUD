import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { useLastSelected } from "@/lib/useLastSelected";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ErrorState } from "@/components/ErrorState";

interface OrgOption {
  id: string;
  legal_name: string;
}

interface BranchRow {
  id: string;
  internal_name: string;
  talmud_branch_code: string;
}

interface QuotaRow {
  branchId: string;
  branchName: string;
  branchCode: string;
  approvedQuota: number | null;
  registeredCount: number;
  eligibleCount: number;
}

async function fetchOrgs(): Promise<OrgOption[]> {
  const { data, error } = await supabase.from("organizations").select("id, legal_name").eq("status", "active").order("legal_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchBranches(orgId: string): Promise<BranchRow[]> {
  const { data, error } = await supabase.from("branches").select("id, internal_name, talmud_branch_code").eq("organization_id", orgId).eq("status", "active").order("talmud_branch_code");
  if (error) throw error;
  return data ?? [];
}

// רשומים/זכאים נגזרים בזמן שאילתה - לא נשמרים כשדה סטטי (ר' הערת migration 023).
// "רשומים" = כרגע (אין מעקב היסטורי "נכון לתאריך X" עדיין); "זכאים" = זכאות פעילה לחודש שנבחר.
function countByBranch(rows: { branch_id: string }[] | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows ?? []) counts.set(r.branch_id, (counts.get(r.branch_id) ?? 0) + 1);
  return counts;
}

interface PriorMonthQuotas {
  month: string;
  values: Map<string, number>;
}

// מוצאת את החודש האחרון שבו הוגדרו מכסות לעמותה זו (לא בהכרח החודש הקלנדרי הקודם -
// ייתכן חודש עם מכסות חסרות), ומחזירה את ערכי המכסה לפי סניף עבור אותו חודש בלבד.
async function fetchPriorMonthQuotas(orgId: string, beforeMonth: string): Promise<PriorMonthQuotas | null> {
  const { data, error } = await supabase
    .from("monthly_quotas")
    .select("branch_id, approved_quota, month")
    .eq("organization_id", orgId)
    .lt("month", beforeMonth)
    .order("month", { ascending: false });
  if (error) throw error;
  if (!data || data.length === 0) return null;
  const priorMonth = data[0].month as string;
  const values = new Map<string, number>();
  for (const row of data as { branch_id: string; approved_quota: number; month: string }[]) {
    if (row.month === priorMonth) values.set(row.branch_id, row.approved_quota);
  }
  return { month: priorMonth, values };
}

async function fetchQuotaData(orgId: string, month: string, branches: BranchRow[]): Promise<QuotaRow[]> {
  const branchIds = branches.map((b) => b.id);
  // שאילתה אחת מרוכזת לכל הסניפים במקום שתי שאילתות ספירה לכל סניף בנפרד (N+1 שנתפס
  // בביקורת ביצועים שלב 16) - סופרים בצד לקוח לפי branch_id במקום count() נפרד לכל סניף.
  const [{ data: approved }, { data: registered }, { data: eligible }] = await Promise.all([
    supabase.from("monthly_quotas").select("branch_id, approved_quota").eq("organization_id", orgId).eq("month", month),
    branchIds.length ? supabase.from("student_assignments").select("branch_id").in("branch_id", branchIds).eq("is_active", true) : Promise.resolve({ data: [] as { branch_id: string }[] }),
    branchIds.length ? supabase.from("monthly_eligibility").select("branch_id").in("branch_id", branchIds).eq("month", month).eq("status", "active") : Promise.resolve({ data: [] as { branch_id: string }[] }),
  ]);
  const approvedMap = new Map((approved ?? []).map((a) => [a.branch_id, a.approved_quota]));
  const registeredMap = countByBranch(registered);
  const eligibleMap = countByBranch(eligible);

  return branches.map((branch) => ({
    branchId: branch.id,
    branchName: branch.internal_name,
    branchCode: branch.talmud_branch_code,
    approvedQuota: approvedMap.get(branch.id) ?? null,
    registeredCount: registeredMap.get(branch.id) ?? 0,
    eligibleCount: eligibleMap.get(branch.id) ?? 0,
  }));
}

export function QuotasScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("quotas", "manage");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });

  const [orgId, setOrgId] = useLastSelected<string>("last-org", "");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7) + "-01");
  // מפתח = branchId, ערך = תוכן שדה הקלט הנוכחי. נוכחות מפתח ב-map = הסניף במצב עריכה.
  // מאפשר גם עריכה בודדת של סניף אחד וגם מילוי מרוכז ("העתקה מהחודש הקודם") של כמה
  // סניפים בבת אחת, כשכל שורה עדיין נשמרת בנפרד דרך פעולת השמירה הקיימת - אין שמירה
  // אוטומטית ואין שינוי בלוגיקת האישור.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const branchesQuery = useQuery({ queryKey: ["quota-branches", orgId], queryFn: () => fetchBranches(orgId), enabled: !!orgId });
  const quotasQuery = useQuery({
    queryKey: ["quotas", orgId, month, branchesQuery.data],
    queryFn: () => fetchQuotaData(orgId, month, branchesQuery.data ?? []),
    enabled: !!orgId && !!month && !!branchesQuery.data,
  });

  // מנקה עריכות פתוחות (כולל כאלה שמולאו ע"י "העתקה מהחודש הקודם") בעת מעבר בין
  // עמותה/חודש, כדי שלא יישארו ערכים שלא נשמרו "תקועים" משורה של הקשר אחר.
  useEffect(() => {
    setEdits({});
    setError(null);
  }, [orgId, month]);

  const startEdit = (row: QuotaRow) => {
    setEdits((prev) => ({ ...prev, [row.branchId]: row.approvedQuota != null ? String(row.approvedQuota) : "" }));
    setError(null);
  };

  const cancelEdit = (branchId: string) => {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[branchId];
      return next;
    });
  };

  const updateEdit = (branchId: string, value: string) => {
    setEdits((prev) => ({ ...prev, [branchId]: value }));
  };

  const saveQuota = async (branchId: string) => {
    const value = Number(edits[branchId]);
    if (!Number.isFinite(value) || value < 0) {
      setError("יש להזין מספר תקין");
      return;
    }
    setSaving(branchId);
    setError(null);
    const { error } = await supabase.from("monthly_quotas").upsert(
      { organization_id: orgId, branch_id: branchId, month, approved_quota: value },
      { onConflict: "organization_id,branch_id,month" },
    );
    setSaving(null);
    if (error) {
      setError(error.message);
      return;
    }
    cancelEdit(branchId);
    queryClient.invalidateQueries({ queryKey: ["quotas", orgId, month] });
  };

  // "העתקת מכסות מהחודש הקודם": ממלאת את שדה הקלט לכל סניף בערך מהחודש הקודם שנמצא
  // בפועל (לא בהכרח month-1 קלנדרי), אך לא שומרת דבר - המשתמשת חייבת עדיין לבדוק כל
  // שורה וללחוץ על פעולת השמירה הקיימת פר-סניף (או לבטל/לשנות ידנית לפני השמירה).
  const copyFromLastMonth = async () => {
    if (!orgId || !branchesQuery.data) return;
    setCopying(true);
    setError(null);
    try {
      const prior = await fetchPriorMonthQuotas(orgId, month);
      if (!prior) {
        setError("לא נמצאו מכסות מחודש קודם להעתקה");
        return;
      }
      setEdits((prev) => {
        const next = { ...prev };
        for (const branch of branchesQuery.data ?? []) {
          const priorValue = prior.values.get(branch.id);
          if (priorValue != null) next[branch.id] = String(priorValue);
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה לא צפויה בהעתקת מכסות");
    } finally {
      setCopying(false);
    }
  };

  const columns: DataTableColumn<QuotaRow>[] = [
    { key: "code", header: "קוד סניף", className: "tabular", render: (r) => r.branchCode },
    { key: "name", header: "סניף", render: (r) => r.branchName },
    {
      key: "quota",
      header: "מכסה מאושרת",
      className: "tabular",
      render: (r) =>
        r.branchId in edits ? (
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={edits[r.branchId]}
              onChange={(e) => updateEdit(r.branchId, e.target.value)}
              className="input-field w-24 tabular"
              autoFocus
            />
            <button onClick={() => saveQuota(r.branchId)} disabled={saving === r.branchId} className="link-action text-xs">
              {saving === r.branchId ? "שומרת…" : "שמירה"}
            </button>
            <button onClick={() => cancelEdit(r.branchId)} className="text-xs text-ink-subtle underline">
              ביטול
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span>{r.approvedQuota ?? "לא הוגדרה"}</span>
            {canManage && (
              <button onClick={() => startEdit(r)} className="link-action text-xs">
                עריכה
              </button>
            )}
          </div>
        ),
    },
    { key: "registered", header: "רשומים", className: "tabular", render: (r) => r.registeredCount },
    { key: "eligible", header: "זכאים", className: "tabular", render: (r) => r.eligibleCount },
    {
      key: "utilization",
      header: "ניצול",
      render: (r) => {
        // מכסה שלא הוגדרה בכלל (null) שונה ממכסה שאושרה כ-0 (מסלול לגיטימי - סניף שעדיין
        // לא אושר לקלוט אף תלמיד) - בדיקת truthy הייתה מתייחסת לשתיהן אותו דבר.
        if (r.approvedQuota == null) return <span className="text-ink-subtle">—</span>;
        const over = r.eligibleCount > r.approvedQuota;
        const pct = r.approvedQuota === 0 ? (r.eligibleCount > 0 ? Infinity : 0) : Math.round((r.eligibleCount / r.approvedQuota) * 100);
        const label = pct === Infinity ? `חריגה (מכסה 0)` : `${pct}%${over ? " (חריגה)" : ""}`;
        return <StatusBadge severity={over ? "high" : pct >= 90 ? "medium" : "ok"} label={label} />;
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="מכסות"
        description="מכסה מול רשומים וזכאים, לפי סניף וחודש. משמעות המכסה המדויקת (והאם ניתנת להעברה בין סניפים) טרם אושרה - המסך מציג נתונים בלבד."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 max-w-lg mb-4">
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

      {orgId && canManage && (
        <button onClick={copyFromLastMonth} disabled={copying || !branchesQuery.data} className="btn-secondary mb-4 text-sm">
          {copying ? "מעתיקה…" : "העתקת מכסות מהחודש הקודם"}
        </button>
      )}

      {error && <div className="mb-4"><ErrorState message={error} /></div>}

      {orgId && (
        <DataTable
          columns={columns}
          rows={quotasQuery.data ?? []}
          rowKey={(r) => r.branchId}
          loading={quotasQuery.isLoading || branchesQuery.isLoading}
          emptyTitle="אין סניפים לעמותה זו"
          emptyIcon={Gauge}
        />
      )}
    </div>
  );
}
