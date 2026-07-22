import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Network, Users } from "lucide-react";
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
}

const DISTRIBUTION_LABEL: Record<string, string> = {
  equal: "שווה",
  fixed_amounts: "סכומים קבועים",
  percentages: "אחוזים",
  manual: "ידנית",
};

async function fetchActiveOrganizations(): Promise<OrgOption[]> {
  const { data, error } = await supabase.from("organizations").select("id, legal_name").eq("status", "active").order("legal_name");
  if (error) throw error;
  return data ?? [];
}

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
    .select("id, name, status, group_leader_id, default_distribution_method, leader:group_leaders(full_name)")
    .eq("branch_id", branchId)
    .order("name");
  if (error) throw error;
  return (data ?? []).map((g: any) => ({ ...g, group_leader_name: g.leader?.full_name ?? null }));
}

const EMPTY_BRANCH_FORM = { talmud_branch_code: "", internal_name: "", address: "", responsible_person: "", phone_system_id: "" };
const EMPTY_GROUP_FORM = { name: "", group_leader_id: "", opened_at: "", default_distribution_method: "" };

export function BranchesGroupsScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { hasPermission: canManageBranches } = useHasPermission("branches", "manage");
  const { hasPermission: canManageGroups } = useHasPermission("groups", "manage");

  const orgId = searchParams.get("org") ?? "";
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);

  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchActiveOrganizations });
  const branchesQuery = useQuery({ queryKey: ["branches", orgId], queryFn: () => fetchBranches(orgId), enabled: !!orgId });
  const leadersQuery = useQuery({ queryKey: ["group-leaders"], queryFn: fetchGroupLeaders });
  const groupsQuery = useQuery({
    queryKey: ["groups", selectedBranchId],
    queryFn: () => fetchGroups(selectedBranchId!),
    enabled: !!selectedBranchId,
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

  const handleOrgChange = (nextOrgId: string) => {
    setSearchParams(nextOrgId ? { org: nextOrgId } : {});
    setSelectedBranchId(null);
  };

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
    if (!selectedBranchId) return;
    setGroupSubmitting(true);
    setGroupError(null);
    const { error } = await supabase.from("groups").insert({
      branch_id: selectedBranchId,
      name: groupForm.name,
      group_leader_id: groupForm.group_leader_id || null,
      opened_at: groupForm.opened_at || null,
      default_distribution_method: groupForm.default_distribution_method || null,
    });
    setGroupSubmitting(false);
    if (error) {
      setGroupError(error.message);
      return;
    }
    setGroupForm(EMPTY_GROUP_FORM);
    setShowAddGroup(false);
    queryClient.invalidateQueries({ queryKey: ["groups", selectedBranchId] });
  };

  const closeGroup = async (id: string) => {
    const { error } = await supabase.from("groups").update({ status: "closed" }).eq("id", id);
    if (!error) queryClient.invalidateQueries({ queryKey: ["groups", selectedBranchId] });
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
          {canManageBranches && r.status === "active" && (
            <button onClick={() => closeBranch(r.id)} className="text-xs text-red-600 underline hover:text-red-800">
              סגירה
            </button>
          )}
        </div>
      ),
    },
  ];

  const groupColumns: DataTableColumn<GroupRow>[] = [
    { key: "name", header: "שם קבוצה", render: (r) => r.name },
    { key: "leader", header: "ראש קבוצה", render: (r) => r.group_leader_name ?? "—" },
    {
      key: "method",
      header: "שיטת חלוקה",
      render: (r) => (r.default_distribution_method ? DISTRIBUTION_LABEL[r.default_distribution_method] : "—"),
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
          <button onClick={() => closeGroup(r.id)} className="text-xs text-red-600 underline hover:text-red-800">
            סגירה
          </button>
        ) : null,
    },
  ];

  const selectedBranch = branchesQuery.data?.find((b) => b.id === selectedBranchId);

  return (
    <div>
      <PageHeader title="סניפים וקבוצות" description="ניהול סניפים וקבוצות בתוך עמותה." />

      <div className="mb-6 max-w-sm">
        <label className="field-label">עמותה</label>
        <select value={orgId} onChange={(e) => handleOrgChange(e.target.value)} className="input-field">
          <option value="">— בחרי עמותה —</option>
          {(orgsQuery.data ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.legal_name}
            </option>
          ))}
        </select>
      </div>

      {!orgId ? (
        <ErrorState message="יש לבחור עמותה כדי לראות ולנהל את הסניפים שלה." />
      ) : (
        <>
          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">סניפים</h3>
              {canManageBranches && (
                <button onClick={() => setShowAddBranch((v) => !v)} className="btn-secondary text-xs">
                  {showAddBranch ? "סגירה" : "סניף חדש"}
                </button>
              )}
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
                <h3 className="text-sm font-semibold text-slate-700">קבוצות — {selectedBranch?.internal_name}</h3>
                {canManageGroups && (
                  <button onClick={() => setShowAddGroup((v) => !v)} className="btn-secondary text-xs">
                    {showAddGroup ? "סגירה" : "קבוצה חדשה"}
                  </button>
                )}
              </div>

              {showAddGroup && (
                <form onSubmit={submitGroup} className="card mb-3 max-w-xl space-y-3 p-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="field-label">שם קבוצה</label>
                      <input
                        required
                        value={groupForm.name}
                        onChange={(e) => setGroupForm((f) => ({ ...f, name: e.target.value }))}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="field-label">ראש קבוצה</label>
                      <div className="flex items-center gap-2">
                        <select
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
                          חדש
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="field-label">תאריך פתיחה</label>
                      <input
                        type="date"
                        value={groupForm.opened_at}
                        onChange={(e) => setGroupForm((f) => ({ ...f, opened_at: e.target.value }))}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="field-label">שיטת חלוקה ברירת מחדל</label>
                      <select
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
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
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

                  {groupError && <ErrorState message={groupError} />}
                  <button type="submit" disabled={groupSubmitting} className="btn-primary">
                    {groupSubmitting ? "שומרת…" : "הוספה"}
                  </button>
                </form>
              )}

              <DataTable
                columns={groupColumns}
                rows={groupsQuery.data ?? []}
                rowKey={(r) => r.id}
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
