import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Network } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ErrorState } from "@/components/ErrorState";
import type { StudentAssignment } from "./types";

interface StudentAssignmentTabProps {
  studentId: string;
}

interface OrgOption {
  id: string;
  legal_name: string;
}
interface BranchOption {
  id: string;
  internal_name: string;
}
interface GroupOption {
  id: string;
  name: string;
}

async function fetchAssignments(studentId: string): Promise<StudentAssignment[]> {
  const { data, error } = await supabase
    .from("student_assignments")
    .select(
      "id, student_id, organization_id, branch_id, group_id, start_date, end_date, end_reason, is_active, organization:organizations(legal_name), branch:branches(internal_name), group:groups(name)",
    )
    .eq("student_id", studentId)
    .order("start_date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    ...r,
    organization_name: r.organization?.legal_name ?? null,
    branch_name: r.branch?.internal_name ?? null,
    group_name: r.group?.name ?? null,
  }));
}

async function fetchOrganizations(): Promise<OrgOption[]> {
  const { data, error } = await supabase.from("organizations").select("id, legal_name").eq("status", "active").order("legal_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchBranches(orgId: string): Promise<BranchOption[]> {
  const { data, error } = await supabase
    .from("branches")
    .select("id, internal_name")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .order("internal_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchGroups(branchId: string): Promise<GroupOption[]> {
  const { data, error } = await supabase.from("groups").select("id, name").eq("branch_id", branchId).eq("status", "active").order("name");
  if (error) throw error;
  return data ?? [];
}

export function StudentAssignmentTab({ studentId }: StudentAssignmentTabProps) {
  const queryClient = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("students", "manage");
  const query = useQuery({ queryKey: ["student-assignments", studentId], queryFn: () => fetchAssignments(studentId) });
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrganizations });

  const [showReassign, setShowReassign] = useState(false);
  const [orgId, setOrgId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const branchesQuery = useQuery({ queryKey: ["branches", orgId], queryFn: () => fetchBranches(orgId), enabled: !!orgId });
  const groupsQuery = useQuery({ queryKey: ["groups", branchId], queryFn: () => fetchGroups(branchId), enabled: !!branchId });

  const currentAssignment = (query.data ?? []).find((a) => a.is_active);

  const handleReassign = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error } = await supabase.rpc("reassign_student", {
      p_student_id: studentId,
      p_organization_id: orgId,
      p_branch_id: branchId,
      p_group_id: groupId,
      p_start_date: startDate,
      p_end_reason: currentAssignment ? reason || "reassigned" : null,
    });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setShowReassign(false);
    setOrgId("");
    setBranchId("");
    setGroupId("");
    setReason("");
    queryClient.invalidateQueries({ queryKey: ["student-assignments", studentId] });
  };

  const columns: DataTableColumn<StudentAssignment>[] = [
    { key: "org", header: "עמותה", render: (r) => r.organization_name ?? "—" },
    { key: "branch", header: "סניף", render: (r) => r.branch_name ?? "—" },
    { key: "group", header: "קבוצה", render: (r) => r.group_name ?? "—" },
    { key: "start", header: "מתאריך", className: "tabular", render: (r) => r.start_date },
    { key: "end", header: "עד תאריך", className: "tabular", render: (r) => r.end_date ?? "—" },
    {
      key: "status",
      header: "סטטוס",
      render: (r) => <StatusBadge severity={r.is_active ? "ok" : "neutral"} label={r.is_active ? "פעיל" : "הסתיים"} />,
    },
  ];

  return (
    <div>
      {canManage && (
        <button onClick={() => setShowReassign((v) => !v)} className="btn-secondary mb-3 text-sm">
          {showReassign ? "סגירה" : currentAssignment ? "שינוי שיוך" : "שיוך ראשוני"}
        </button>
      )}

      {showReassign && (
        <form onSubmit={handleReassign} className="card mb-4 max-w-xl space-y-3 p-4">
          <p className="text-xs text-ink-subtle">
            {currentAssignment
              ? "השיוך הנוכחי ייסגר אוטומטית (עם תאריך וסיבה) והשיוך החדש ייפתח - שום דבר לא נדרס."
              : "יצירת שיוך ראשון לתלמיד."}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="field-label">עמותה</label>
              <select
                required
                value={orgId}
                onChange={(e) => {
                  setOrgId(e.target.value);
                  setBranchId("");
                  setGroupId("");
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
              <label className="field-label">סניף</label>
              <select
                required
                value={branchId}
                onChange={(e) => {
                  setBranchId(e.target.value);
                  setGroupId("");
                }}
                disabled={!orgId}
                className="input-field"
              >
                <option value="">— בחרי —</option>
                {(branchesQuery.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.internal_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">קבוצה</label>
              <select required value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={!branchId} className="input-field">
                <option value="">— בחרי —</option>
                {(groupsQuery.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label">תאריך תחילת שיוך</label>
              <input required type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input-field" />
            </div>
            {currentAssignment && (
              <div>
                <label className="field-label">סיבת שינוי</label>
                <input value={reason} onChange={(e) => setReason(e.target.value)} className="input-field" />
              </div>
            )}
          </div>
          {error && <ErrorState message={error} />}
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? "שומרת…" : "אישור שיוך"}
          </button>
        </form>
      )}

      <DataTable
        columns={columns}
        rows={query.data ?? []}
        rowKey={(r) => r.id}
        loading={query.isLoading}
        emptyTitle="אין שיוך רשום לתלמיד"
        emptyIcon={Network}
      />
    </div>
  );
}
