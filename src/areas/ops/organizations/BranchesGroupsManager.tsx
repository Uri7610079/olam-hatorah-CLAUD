import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchAll } from "@/lib/fetchAll";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Network, Users, Download, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { exportRowsToExcel } from "@/lib/reportExport";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ErrorState } from "@/components/ErrorState";

interface BranchRow {
  id: string;
  talmud_branch_code: string;
  internal_name: string;
  status: "active" | "closed";
}

interface GroupLeaderOption {
  id: string;
  full_name: string;
}

interface GroupRow {
  id: string;
  name: string;
  status: "active" | "closed";
  group_leader_id: string | null;
  group_leader_name: string | null;
  default_distribution_method: string | null;
  require_id_photo: boolean;
  bank_account_optional: boolean;
}

const DISTRIBUTION_LABEL: Record<string, string> = {
  equal: "שווה",
  fixed_amounts: "סכומים קבועים",
  percentages: "אחוזים",
  manual: "ידנית",
};

async function fetchBranches(orgId: string): Promise<BranchRow[]> {
  const { data, error } = await supabase
    .from("branches")
    .select("id, talmud_branch_code, internal_name, status")
    .eq("organization_id", orgId)
    .order("talmud_branch_code");
  if (error) throw error;
  return data ?? [];
}

async function fetchGroupLeaders(): Promise<GroupLeaderOption[]> {
  const { data, error } = await supabase.from("group_leaders").select("id, full_name").eq("status", "active").order("full_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchGroups(branchId: string): Promise<GroupRow[]> {
  const { data, error } = await supabase
    .from("groups")
    .select("id, name, status, group_leader_id, default_distribution_method, require_id_photo, bank_account_optional, leader:group_leaders(full_name)")
    .eq("branch_id", branchId)
    .order("name");
  if (error) throw error;
  return (data ?? []).map((g: any) => ({ ...g, group_leader_name: g.leader?.full_name ?? null }));
}

interface AllGroupRow {
  id: string;
  name: string;
  status: string;
  branch_id: string;
  branch_code: string;
  branch_name: string;
  leader_name: string | null;
  duplicateBranches: string[];
}

// כל הקבוצות של העמותה בכל הסניפים, ברשימה אחת.
//
// שם קבוצה אינו ייחודי בין סניפים, וזה לגיטימי - "רוטנברג" קיים בסניפים
// 01, 02 ו-04 של ברכת אלימלך, ואלה שלוש קבוצות שונות. אבל כשעוברים סניף
// אחרי סניף זה נראה בדיוק כמו כפילות. לכן הרשימה הזו מציגה את הסניף לצד
// כל שם, ומסמנת במפורש שם שחוזר ביותר מסניף אחד.
async function fetchAllGroups(orgId: string): Promise<AllGroupRow[]> {
  const { data, error } = await supabase
    .from("groups")
    .select("id, name, status, branch_id, leader:group_leaders(full_name), branch:branches!inner(talmud_branch_code, internal_name, organization_id)")
    .eq("branch.organization_id", orgId)
    .order("name");
  if (error) throw error;

  const rows = (data ?? []).map((g: any) => {
    const br = Array.isArray(g.branch) ? g.branch[0] : g.branch;
    const ld = Array.isArray(g.leader) ? g.leader[0] : g.leader;
    return {
      id: g.id,
      name: g.name,
      status: g.status,
      branch_id: g.branch_id,
      branch_code: br?.talmud_branch_code ?? "—",
      branch_name: br?.internal_name ?? "—",
      leader_name: ld?.full_name ?? null,
      duplicateBranches: [] as string[],
    };
  });

  // שם שמופיע ביותר מסניף אחד. אותו שם *באותו* סניף היה כפילות אמיתית,
  // אבל כזו אין במסד - נבדק על הנתונים החיים ונמצאו אפס מקרים.
  const byName = new Map<string, string[]>();
  rows.forEach((r) => {
    const list = byName.get(r.name) ?? [];
    if (!list.includes(r.branch_code)) list.push(r.branch_code);
    byName.set(r.name, list);
  });
  rows.forEach((r) => {
    const list = byName.get(r.name) ?? [];
    r.duplicateBranches = list.length > 1 ? list.slice().sort() : [];
  });
  return rows;
}

const EMPTY_BRANCH_FORM = { talmud_branch_code: "", internal_name: "", address: "", responsible_person: "", phone_system_id: "" };
const EMPTY_GROUP_FORM = {
  branch_id: "",
  name: "",
  group_leader_id: "",
  opened_at: "",
  default_distribution_method: "",
  require_id_photo: false,
  bank_account_optional: false,
};

// ניהול הסניפים והקבוצות של עמותה אחת. עד שלב 36 זה היה מסך נפרד ("סניפים וקבוצות");
// מאז הוא מוצג בתוך מסך העמותות, מתחת לעמותה שנבחרה, ובלשונית "סניפים וקבוצות"
// בכרטיס העמותה. הקישורים הישנים (?org=&branch=&group=) ממשיכים לעבוד.
export function BranchesGroupsManager({ orgId }: { orgId: string }) {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { hasPermission: canManageBranches } = useHasPermission("branches", "manage");
  const { hasPermission: canManageGroups } = useHasPermission("groups", "manage");
  // הגעה מקישור במסך התלמידים: הסניף נפתח, והקבוצה מסומנת
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(searchParams.get("branch"));
  const highlightGroupId = searchParams.get("group");
  useEffect(() => {
    const b = searchParams.get("branch");
    if (b) setSelectedBranchId(b);
  }, [searchParams]);
  useEffect(() => {
    if (!highlightGroupId) return;
    // השורה קיימת רק אחרי שרשימת הקבוצות נטענה מהמסד - ממתינים לה (עד 10 שניות),
    // במקום לנחש זמן קבוע ולפספס כשהטעינה איטית.
    // גלילה מיידית ולא "חלקה": גלילה חלקה היא אנימציה, ודפדפן עוצר אנימציות
    // בחלון שאינו בחזית. ועוד גלילה אחת אחרי שנייה - חלקים שנטענים מעל השורה
    // (סניפים, ספירות) דוחפים אותה למטה אחרי הגלילה הראשונה.
    let tries = 0;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const scrollTo = () => document.querySelector(".highlight-group-row")?.scrollIntoView({ block: "center" });
    const t = setInterval(() => {
      const row = document.querySelector(".highlight-group-row");
      if (row || ++tries > 50) {
        clearInterval(t);
        scrollTo();
        settle = setTimeout(scrollTo, 1000);
      }
    }, 200);
    return () => { clearInterval(t); clearTimeout(settle); };
  }, [highlightGroupId, selectedBranchId]);

  // כמה תלמידים פעילים בכל סניף וקבוצה - לקישור "תלמידים (N)"
  const studentCountsQuery = useQuery({
    queryKey: ["student-counts-by-place", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const rows = await fetchAll(() =>
        supabase.from("student_assignments").select("branch_id, group_id").eq("organization_id", orgId).eq("is_active", true).order("id"),
      );
      const byBranch = new Map<string, number>();
      const byGroup = new Map<string, number>();
      rows.forEach((r) => {
        byBranch.set(r.branch_id, (byBranch.get(r.branch_id) ?? 0) + 1);
        byGroup.set(r.group_id, (byGroup.get(r.group_id) ?? 0) + 1);
      });
      return { byBranch, byGroup };
    },
  });
  const studentsLink = (kind: "branch" | "group", id: string) => {
    const n = (kind === "branch" ? studentCountsQuery.data?.byBranch : studentCountsQuery.data?.byGroup)?.get(id) ?? 0;
    return (
      <Link to={`/ops/students?${kind}=${id}`} className="link-action whitespace-nowrap text-xs" onClick={(e) => e.stopPropagation()}>
        תלמידים ({n})
      </Link>
    );
  };

  const branchesQuery = useQuery({ queryKey: ["branches", orgId], queryFn: () => fetchBranches(orgId), enabled: !!orgId });
  const leadersQuery = useQuery({ queryKey: ["group-leaders"], queryFn: fetchGroupLeaders });
  const groupsQuery = useQuery({
    queryKey: ["groups", selectedBranchId],
    queryFn: () => fetchGroups(selectedBranchId!),
    enabled: !!selectedBranchId,
  });

  const [showAllGroups, setShowAllGroups] = useState(false);
  const allGroupsQuery = useQuery({
    queryKey: ["all-groups", orgId],
    queryFn: () => fetchAllGroups(orgId),
    enabled: !!orgId && showAllGroups,
  });

  const [showAddBranch, setShowAddBranch] = useState(false);
  const [branchForm, setBranchForm] = useState(EMPTY_BRANCH_FORM);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [branchSubmitting, setBranchSubmitting] = useState(false);

  const [showAddGroup, setShowAddGroup] = useState(false);
  const [groupForm, setGroupForm] = useState(EMPTY_GROUP_FORM);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [groupSubmitting, setGroupSubmitting] = useState(false);

  const [showAddLeader, setShowAddLeader] = useState(false);
  const [newLeaderName, setNewLeaderName] = useState("");
  const [newLeaderPhone, setNewLeaderPhone] = useState("");
  const [leaderSubmitting, setLeaderSubmitting] = useState(false);
  const [leaderError, setLeaderError] = useState<string | null>(null);

  const submitBranch = async (e: FormEvent) => {
    e.preventDefault();
    setBranchSubmitting(true);
    setBranchError(null);
    const { error } = await supabase.from("branches").insert({
      organization_id: orgId,
      talmud_branch_code: branchForm.talmud_branch_code,
      internal_name: branchForm.internal_name,
      address: branchForm.address || null,
      responsible_person: branchForm.responsible_person || null,
      phone_system_id: branchForm.phone_system_id || null,
    });
    setBranchSubmitting(false);
    if (error) {
      setBranchError(error.message);
      return;
    }
    setBranchForm(EMPTY_BRANCH_FORM);
    setShowAddBranch(false);
    queryClient.invalidateQueries({ queryKey: ["branches", orgId] });
  };

  const closeBranch = async (id: string) => {
    const { error } = await supabase.from("branches").update({ status: "closed" }).eq("id", id);
    if (!error) queryClient.invalidateQueries({ queryKey: ["branches", orgId] });
  };

  const submitGroup = async (e: FormEvent) => {
    e.preventDefault();
    const branchId = groupForm.branch_id;
    if (!branchId) {
      setGroupError("יש לבחור סניף");
      return;
    }
    setGroupSubmitting(true);
    setGroupError(null);
    // group_leader_id לא נשלח כאן: קבוצה נוצרת תמיד בלי ראש קבוצה, ואם נבחר אחד בטופס
    // הוא משויך מיד אחרי דרך reassign_group_leader() - כך שיש רק מסלול אחד שקובע
    // group_leader_id (גם ליצירה ראשונה וגם להחלפה מאוחרת), עם היסטוריה שנשמרת.
    const { data, error } = await supabase
      .from("groups")
      .insert({
        branch_id: branchId,
        name: groupForm.name.trim(),
        opened_at: groupForm.opened_at || null,
        default_distribution_method: groupForm.default_distribution_method || null,
        require_id_photo: groupForm.require_id_photo,
        bank_account_optional: groupForm.bank_account_optional,
      })
      .select("id")
      .single();
    if (error) {
      setGroupSubmitting(false);
      setGroupError(error.message.includes("duplicate") ? "כבר יש קבוצה בשם הזה בסניף הזה." : error.message);
      return;
    }
    if (groupForm.group_leader_id && data) {
      const { error: leaderError } = await supabase.rpc("reassign_group_leader", {
        p_group_id: data.id,
        p_group_leader_id: groupForm.group_leader_id,
        p_start_date: groupForm.opened_at || new Date().toISOString().slice(0, 10),
      });
      if (leaderError) {
        setGroupSubmitting(false);
        setGroupError(`הקבוצה נוצרה, אך שיוך ראש הקבוצה נכשל: ${leaderError.message}`);
        refreshGroups();
        return;
      }
    }
    setGroupSubmitting(false);
    setGroupForm(EMPTY_GROUP_FORM);
    setShowAddGroup(false);
    // הסניף של הקבוצה החדשה נפתח, כדי שהיא תיראה מיד ברשימה
    setSelectedBranchId(branchId);
    refreshGroups();
  };

  const refreshGroups = () => {
    queryClient.invalidateQueries({ queryKey: ["groups"] });
    queryClient.invalidateQueries({ queryKey: ["all-groups", orgId] });
    queryClient.invalidateQueries({ queryKey: ["groups-for-settings"] });
  };

  const openAddGroup = (branchId: string | null) => {
    setGroupForm({ ...EMPTY_GROUP_FORM, branch_id: branchId ?? "" });
    setGroupError(null);
    setShowAddGroup(true);
    setTimeout(() => document.getElementById("add-group-form")?.scrollIntoView({ block: "start", behavior: "smooth" }), 0);
  };

  const closeGroup = async (id: string) => {
    const { error } = await supabase.from("groups").update({ status: "closed" }).eq("id", id);
    if (!error) refreshGroups();
  };

  const [changingLeaderGroupId, setChangingLeaderGroupId] = useState<string | null>(null);
  const [leaderChoice, setLeaderChoice] = useState("");
  const [leaderChangeSubmitting, setLeaderChangeSubmitting] = useState(false);

  const startChangeLeader = (group: GroupRow) => {
    setChangingLeaderGroupId(group.id);
    setLeaderChoice(group.group_leader_id ?? "");
  };

  const confirmChangeLeader = async () => {
    if (!changingLeaderGroupId || !leaderChoice) return;
    setLeaderChangeSubmitting(true);
    const { error } = await supabase.rpc("reassign_group_leader", {
      p_group_id: changingLeaderGroupId,
      p_group_leader_id: leaderChoice,
      p_start_date: new Date().toISOString().slice(0, 10),
    });
    setLeaderChangeSubmitting(false);
    if (!error) {
      setChangingLeaderGroupId(null);
      queryClient.invalidateQueries({ queryKey: ["groups", selectedBranchId] });
    }
  };

  const submitNewLeader = async (e: FormEvent) => {
    e.preventDefault();
    setLeaderSubmitting(true);
    setLeaderError(null);
    const { data, error } = await supabase
      .from("group_leaders")
      .insert({ full_name: newLeaderName, phone: newLeaderPhone || null })
      .select("id")
      .single();
    setLeaderSubmitting(false);
    if (error) {
      setLeaderError(error.message);
      return;
    }
    setNewLeaderName("");
    setNewLeaderPhone("");
    setShowAddLeader(false);
    await queryClient.invalidateQueries({ queryKey: ["group-leaders"] });
    if (data) setGroupForm((f) => ({ ...f, group_leader_id: data.id }));
  };

  const handleExportBranches = () => {
    exportRowsToExcel(
      (branchesQuery.data ?? []).map((r) => ({
        "קוד סניף": r.talmud_branch_code,
        "שם פנימי": r.internal_name,
        "סטטוס": r.status === "active" ? "פעיל" : "סגור",
      })),
      "סניפים",
      `branches-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  };

  const handleExportGroups = () => {
    exportRowsToExcel(
      (groupsQuery.data ?? []).map((r) => ({
        "שם קבוצה": r.name,
        "ראש קבוצה": r.group_leader_name ?? "",
        "שיטת חלוקה": r.default_distribution_method ? DISTRIBUTION_LABEL[r.default_distribution_method] : "",
        "סטטוס": r.status === "active" ? "פעילה" : "סגורה",
      })),
      "קבוצות",
      `groups-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  };

  const branchColumns: DataTableColumn<BranchRow>[] = [
    { key: "code", header: "קוד סניף", className: "tabular", render: (r) => r.talmud_branch_code },
    { key: "name", header: "שם פנימי", render: (r) => r.internal_name },
    {
      key: "status",
      header: "סטטוס",
      render: (r) => <StatusBadge severity={r.status === "active" ? "ok" : "neutral"} label={r.status === "active" ? "פעיל" : "סגור"} />,
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <div className="flex gap-3">
          <button onClick={() => setSelectedBranchId(r.id)} className="link-action text-xs">
            קבוצות
          </button>
          {studentsLink("branch", r.id)}
          {canManageBranches && r.status === "active" && (
            <button onClick={() => closeBranch(r.id)} className="text-xs text-danger underline hover:text-danger-ink">
              סגירה
            </button>
          )}
        </div>
      ),
    },
  ];

  const groupColumns: DataTableColumn<GroupRow>[] = [
    { key: "name", header: "שם קבוצה", render: (r) => r.name },
    { key: "students", header: "תלמידים", render: (r) => studentsLink("group", r.id) },
    {
      key: "leader",
      header: "ראש קבוצה",
      render: (r) =>
        changingLeaderGroupId === r.id ? (
          <div className="flex items-center gap-2">
            <select value={leaderChoice} onChange={(e) => setLeaderChoice(e.target.value)} className="input-field text-xs">
              <option value="">— בחרי —</option>
              {(leadersQuery.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.full_name}
                </option>
              ))}
            </select>
            <button
              onClick={confirmChangeLeader}
              disabled={!leaderChoice || leaderChangeSubmitting}
              className="link-action text-xs"
            >
              {leaderChangeSubmitting ? "שומרת…" : "אישור"}
            </button>
            <button onClick={() => setChangingLeaderGroupId(null)} className="text-xs text-ink-subtle underline">
              ביטול
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span>{r.group_leader_name ?? "—"}</span>
            {canManageGroups && (
              <button onClick={() => startChangeLeader(r)} className="link-action text-xs">
                שינוי
              </button>
            )}
          </div>
        ),
    },
    {
      key: "method",
      header: "שיטת חלוקה",
      render: (r) => (r.default_distribution_method ? DISTRIBUTION_LABEL[r.default_distribution_method] : "—"),
    },
    {
      key: "settings",
      header: "הגדרות",
      render: (r) =>
        r.require_id_photo || r.bank_account_optional ? (
          <div className="flex flex-wrap gap-1">
            {r.require_id_photo && <StatusBadge severity="neutral" label="חובה צילום ת״ז" />}
            {r.bank_account_optional && <StatusBadge severity="neutral" label="בנק לא חובה" />}
          </div>
        ) : (
          "—"
        ),
    },
    {
      key: "status",
      header: "סטטוס",
      render: (r) => <StatusBadge severity={r.status === "active" ? "ok" : "neutral"} label={r.status === "active" ? "פעילה" : "סגורה"} />,
    },
    {
      key: "actions",
      header: "",
      render: (r) =>
        canManageGroups && r.status === "active" ? (
          <button onClick={() => closeGroup(r.id)} className="text-xs text-danger underline hover:text-danger-ink">
            סגירה
          </button>
        ) : null,
    },
  ];

  const selectedBranch = branchesQuery.data?.find((b) => b.id === selectedBranchId);

  const activeBranches = (branchesQuery.data ?? []).filter((b) => b.status === "active");

  return (
    <div>
      {!orgId ? (
        <ErrorState message="יש לבחור עמותה כדי לראות ולנהל את הסניפים שלה." />
      ) : (
        <>
          {/* רשימה אחת לכל הקבוצות של העמותה, חוצת סניפים. קיימת כי
              מעבר סניף-אחרי-סניף אינו נותן תמונה כוללת, ובעיקר: אותו שם
              קבוצה חוזר בכמה סניפים ונראה בדיוק כמו כפילות. */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-secondary flex items-center gap-1.5 text-xs"
              onClick={() => setShowAllGroups((v) => !v)}
            >
              <Network className="h-3.5 w-3.5" aria-hidden="true" />
              {showAllGroups ? "הסתרת כל הקבוצות" : "כל הקבוצות בכל הסניפים"}
            </button>
            {canManageGroups && (
              <button type="button" className="btn-primary flex items-center gap-1.5 text-xs" onClick={() => openAddGroup(selectedBranchId)}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                הוספת קבוצה
              </button>
            )}
          </div>

          {showAddGroup && (
            <form id="add-group-form" onSubmit={submitGroup} className="card mb-6 max-w-2xl space-y-4 p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-ink">קבוצה חדשה</h3>
                <button type="button" onClick={() => setShowAddGroup(false)} className="link-action text-xs">
                  ביטול
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="field-label" htmlFor="ng-branch">סניף *</label>
                  <select
                    id="ng-branch"
                    required
                    value={groupForm.branch_id}
                    onChange={(e) => setGroupForm((f) => ({ ...f, branch_id: e.target.value }))}
                    className="input-field"
                  >
                    <option value="">— בחרי סניף —</option>
                    {activeBranches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.talmud_branch_code} · {b.internal_name}
                      </option>
                    ))}
                  </select>
                  {activeBranches.length === 0 && <p className="mt-1 text-xs text-warn-ink">אין לעמותה סניף פעיל - צריך להוסיף סניף קודם.</p>}
                </div>
                <div>
                  <label className="field-label" htmlFor="ng-name">שם קבוצה *</label>
                  <input
                    id="ng-name"
                    required
                    value={groupForm.name}
                    onChange={(e) => setGroupForm((f) => ({ ...f, name: e.target.value }))}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="ng-leader">ראש קבוצה</label>
                  <div className="flex items-center gap-2">
                    <select
                      id="ng-leader"
                      value={groupForm.group_leader_id}
                      onChange={(e) => setGroupForm((f) => ({ ...f, group_leader_id: e.target.value }))}
                      className="input-field"
                    >
                      <option value="">— ללא —</option>
                      {(leadersQuery.data ?? []).map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.full_name}
                        </option>
                      ))}
                    </select>
                    <button type="button" onClick={() => setShowAddLeader((v) => !v)} className="link-action shrink-0 text-xs">
                      ראש קבוצה חדש
                    </button>
                  </div>
                </div>
                <div>
                  <label className="field-label" htmlFor="ng-opened">תאריך פתיחה</label>
                  <input
                    id="ng-opened"
                    type="date"
                    value={groupForm.opened_at}
                    onChange={(e) => setGroupForm((f) => ({ ...f, opened_at: e.target.value }))}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="ng-method">שיטת חלוקה ברירת מחדל</label>
                  <select
                    id="ng-method"
                    value={groupForm.default_distribution_method}
                    onChange={(e) => setGroupForm((f) => ({ ...f, default_distribution_method: e.target.value }))}
                    className="input-field"
                  >
                    <option value="">— לא נקבע —</option>
                    {Object.entries(DISTRIBUTION_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {showAddLeader && (
                <div className="rounded-control border border-line bg-surface-muted p-3">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input
                      placeholder="שם ראש קבוצה"
                      value={newLeaderName}
                      onChange={(e) => setNewLeaderName(e.target.value)}
                      className="input-field"
                    />
                    <input
                      placeholder="טלפון (לא חובה)"
                      value={newLeaderPhone}
                      onChange={(e) => setNewLeaderPhone(e.target.value)}
                      className="input-field"
                    />
                  </div>
                  {leaderError && <ErrorState message={leaderError} />}
                  <button
                    type="button"
                    onClick={submitNewLeader}
                    disabled={!newLeaderName || leaderSubmitting}
                    className="btn-secondary mt-2 text-xs"
                  >
                    {leaderSubmitting ? "שומרת…" : "יצירת ראש קבוצה"}
                  </button>
                </div>
              )}

              <div className="space-y-2 border-t border-line pt-3">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={groupForm.require_id_photo}
                    onChange={(e) => setGroupForm((f) => ({ ...f, require_id_photo: e.target.checked }))}
                  />
                  <span>
                    חובה לצרף צילום תעודת זהות
                    <span className="block text-xs text-ink-subtle">כשראש הקבוצה מוסיף תלמיד חדש מהפורטל.</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={groupForm.bank_account_optional}
                    onChange={(e) => setGroupForm((f) => ({ ...f, bank_account_optional: e.target.checked }))}
                  />
                  <span>
                    חשבון בנק אינו חובה
                    <span className="block text-xs text-ink-subtle">
                      תלמיד בקבוצה יעבור ל"מוכן לתלמוד" גם בלי חשבון בנק. תשלום עדיין דורש חשבון תקין.
                    </span>
                  </span>
                </label>
              </div>

              {groupError && <ErrorState message={groupError} />}
              <button type="submit" disabled={groupSubmitting} className="btn-primary">
                {groupSubmitting ? "שומרת…" : "שמירת הקבוצה"}
              </button>
            </form>
          )}

          {showAllGroups && (
            <div className="mb-6">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink-muted">
                  כל הקבוצות של העמותה
                  {allGroupsQuery.data ? ` — ${allGroupsQuery.data.length}` : ""}
                </h3>
                {(() => {
                  const dup = (allGroupsQuery.data ?? []).filter((g) => g.duplicateBranches.length > 0);
                  const names = [...new Set(dup.map((g) => g.name))];
                  return names.length > 0 ? (
                    <span className="text-xs text-warn-ink">
                      {names.length} שמות חוזרים ביותר מסניף אחד — אלה קבוצות נפרדות, לא כפילות
                    </span>
                  ) : (
                    <span className="text-xs text-ink-subtle">אין שמות חוזרים</span>
                  );
                })()}
              </div>
              <DataTable
                columns={[
                  {
                    key: "name",
                    header: "קבוצה",
                    render: (g: AllGroupRow) => (
                      <span className="flex items-center gap-2">
                        {g.name}
                        {g.duplicateBranches.length > 0 && (
                          <span
                            className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] text-warn-ink"
                            title={`השם הזה קיים גם בסניפים ${g.duplicateBranches.join(", ")}`}
                          >
                            גם ב-{g.duplicateBranches.filter((c) => c !== g.branch_code).join(", ")}
                          </span>
                        )}
                      </span>
                    ),
                  },
                  { key: "branch", header: "סניף", className: "tabular", render: (g: AllGroupRow) => g.branch_code },
                  { key: "branchName", header: "שם הסניף", render: (g: AllGroupRow) => g.branch_name },
                  { key: "leader", header: "ראש קבוצה", render: (g: AllGroupRow) => g.leader_name ?? "—" },
                  { key: "students", header: "תלמידים", render: (g: AllGroupRow) => studentsLink("group", g.id) },
                  {
                    key: "status",
                    header: "סטטוס",
                    render: (g: AllGroupRow) => (
                      <StatusBadge severity={g.status === "active" ? "ok" : "neutral"} label={g.status === "active" ? "פעילה" : "סגורה"} />
                    ),
                  },
                ]}
                rows={allGroupsQuery.data ?? []}
                rowKey={(g: AllGroupRow) => g.id}
                loading={allGroupsQuery.isLoading}
                emptyTitle="אין קבוצות לעמותה זו"
                emptyIcon={Network}
                onRowClick={(g: AllGroupRow) => setSelectedBranchId(g.branch_id)}
              />
            </div>
          )}

          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink-muted">סניפים</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportBranches}
                  disabled={!(branchesQuery.data && branchesQuery.data.length > 0)}
                  className="btn-secondary flex items-center gap-1.5 text-xs"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  ייצוא לאקסל
                </button>
                {canManageBranches && (
                  <button onClick={() => setShowAddBranch((v) => !v)} className="btn-secondary text-xs">
                    {showAddBranch ? "סגירה" : "סניף חדש"}
                  </button>
                )}
              </div>
            </div>

            {showAddBranch && (
              <form onSubmit={submitBranch} className="card mb-3 max-w-xl space-y-3 p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="field-label">קוד סניף (כולל 00 אם רלוונטי)</label>
                    <input
                      required
                      value={branchForm.talmud_branch_code}
                      onChange={(e) => setBranchForm((f) => ({ ...f, talmud_branch_code: e.target.value }))}
                      className="input-field tabular"
                    />
                  </div>
                  <div>
                    <label className="field-label">שם פנימי</label>
                    <input
                      required
                      value={branchForm.internal_name}
                      onChange={(e) => setBranchForm((f) => ({ ...f, internal_name: e.target.value }))}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="field-label">כתובת</label>
                    <input
                      value={branchForm.address}
                      onChange={(e) => setBranchForm((f) => ({ ...f, address: e.target.value }))}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="field-label">אחראי</label>
                    <input
                      value={branchForm.responsible_person}
                      onChange={(e) => setBranchForm((f) => ({ ...f, responsible_person: e.target.value }))}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="field-label">מזהה מערכת טלפונית</label>
                    <input
                      value={branchForm.phone_system_id}
                      onChange={(e) => setBranchForm((f) => ({ ...f, phone_system_id: e.target.value }))}
                      className="input-field tabular"
                    />
                  </div>
                </div>
                {branchError && <ErrorState message={branchError} />}
                <button type="submit" disabled={branchSubmitting} className="btn-primary">
                  {branchSubmitting ? "שומרת…" : "הוספה"}
                </button>
              </form>
            )}

            <DataTable
              columns={branchColumns}
              rows={branchesQuery.data ?? []}
              rowKey={(r) => r.id}
              loading={branchesQuery.isLoading}
              emptyTitle="אין סניפים לעמותה זו"
              emptyIcon={Network}
            />
          </div>

          {selectedBranchId && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-ink-muted">קבוצות — {selectedBranch?.internal_name}</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleExportGroups}
                    disabled={!(groupsQuery.data && groupsQuery.data.length > 0)}
                    className="btn-secondary flex items-center gap-1.5 text-xs"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    ייצוא לאקסל
                  </button>
                  {canManageGroups && (
                    <button onClick={() => openAddGroup(selectedBranchId)} className="btn-secondary text-xs">
                      קבוצה חדשה בסניף הזה
                    </button>
                  )}
                </div>
              </div>

              <DataTable
                columns={groupColumns}
                rows={groupsQuery.data ?? []}
                rowKey={(r) => r.id}
                rowClassName={(r) => (r.id === highlightGroupId ? "highlight-group-row !bg-brand-50 ring-2 ring-inset ring-brand-500" : undefined)}
                loading={groupsQuery.isLoading}
                emptyTitle="אין קבוצות בסניף זה"
                emptyIcon={Users}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
