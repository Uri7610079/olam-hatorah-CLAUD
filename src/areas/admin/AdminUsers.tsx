import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserCog } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge, type Severity } from "@/components/StatusBadge";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { UserPermissionsDrawer } from "./UserPermissionsDrawer";

type ProfileStatus = "pending" | "approved" | "disabled";
type Area = "ops" | "finance" | "admin" | "tasks";

interface AdminProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
  status: ProfileStatus;
  default_area: Area | null;
  role_id: string | null;
  role: { key: string; label_he: string } | null;
}

interface RoleOption {
  key: string;
  label_he: string;
}

async function fetchProfiles(): Promise<AdminProfileRow[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, status, default_area, role_id, role:roles(key, label_he)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    ...row,
    role: Array.isArray(row.role) ? (row.role[0] ?? null) : row.role,
  }));
}

async function fetchRoles(): Promise<RoleOption[]> {
  const { data, error } = await supabase.from("roles").select("key, label_he").order("label_he");
  if (error) throw error;
  return data ?? [];
}

const STATUS_SEVERITY: Record<ProfileStatus, Severity> = { pending: "medium", approved: "ok", disabled: "critical" };
const STATUS_LABEL: Record<ProfileStatus, string> = { pending: "ממתין לאישור", approved: "מאושר", disabled: "מושבת" };
const AREA_LABEL: Record<Area, string> = { ops: "תפעול שוטף", finance: "כספים ובקרה", admin: "ניהול", tasks: "משימות ותזכורות" };

export function AdminUsers() {
  const queryClient = useQueryClient();
  const { hasPermission, isLoading: permissionLoading } = useHasPermission("users", "manage");
  const profilesQuery = useQuery({ queryKey: ["admin-profiles"], queryFn: fetchProfiles, enabled: hasPermission });
  const rolesQuery = useQuery({ queryKey: ["roles-catalog"], queryFn: fetchRoles, enabled: hasPermission });

  const [pendingAction, setPendingAction] = useState<{
    userId: string;
    status: "approved" | "disabled";
    kind: "approve" | "disable" | "changeRole";
  } | null>(null);
  const [permissionsUser, setPermissionsUser] = useState<AdminProfileRow | null>(null);
  const [roleChoice, setRoleChoice] = useState("");
  const [areaChoice, setAreaChoice] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-profiles"] });

  const openAction = (row: AdminProfileRow, status: "approved" | "disabled") => {
    setPendingAction({ userId: row.id, status, kind: status === "approved" ? "approve" : "disable" });
    setRoleChoice(row.role?.key ?? "");
    setAreaChoice(row.default_area ?? "");
    setActionError(null);
  };

  // שינוי תפקיד למשתמש שכבר מאושר: קוראת לאותה admin_set_user_status עם p_status="approved" -
  // הפונקציה לא בודקת סטטוס קודם, רק מציבה מחדש את אותו approved ומעדכנת role_id/default_area,
  // כך שהמשתמש לא יורד לרגע מ-approved (ר' migration 003, admin_set_user_status).
  const openRoleChange = (row: AdminProfileRow) => {
    setPendingAction({ userId: row.id, status: "approved", kind: "changeRole" });
    setRoleChoice(row.role?.key ?? "");
    setAreaChoice(row.default_area ?? "");
    setActionError(null);
  };

  const runStatusChange = async () => {
    if (!pendingAction) return;
    if (pendingAction.status === "approved" && !roleChoice) {
      setActionError("יש לבחור תפקיד לפני אישור.");
      return;
    }
    setSubmitting(true);
    setActionError(null);
    const { error } = await supabase.rpc("admin_set_user_status", {
      p_user_id: pendingAction.userId,
      p_status: pendingAction.status,
      p_role_key: roleChoice || null,
      p_default_area: areaChoice || null,
    });
    setSubmitting(false);
    if (error) {
      setActionError(error.message);
      return;
    }
    setPendingAction(null);
    refresh();
  };

  if (permissionLoading) return <LoadingState rows={4} />;

  if (!hasPermission) {
    return (
      <div>
        <PageHeader title="משתמשים והרשאות" />
        <ErrorState message="אין לך הרשאה לצפות במסך זה." />
      </div>
    );
  }

  const columns: DataTableColumn<AdminProfileRow>[] = [
    { key: "name", header: "שם", render: (r) => r.full_name ?? "—" },
    { key: "email", header: "אימייל", className: "ltr-num", render: (r) => r.email ?? "—" },
    {
      key: "status",
      header: "סטטוס",
      render: (r) => <StatusBadge severity={STATUS_SEVERITY[r.status]} label={STATUS_LABEL[r.status]} />,
    },
    { key: "role", header: "תפקיד", render: (r) => r.role?.label_he ?? "—" },
    { key: "area", header: "אזור ברירת מחדל", render: (r) => (r.default_area ? AREA_LABEL[r.default_area] : "—") },
    {
      key: "actions",
      header: "פעולות",
      render: (r) => (
        <div className="flex gap-3">
          {r.status !== "approved" && (
            <button onClick={() => openAction(r, "approved")} className="link-action text-xs">
              {r.status === "pending" ? "אישור" : "הפעלה מחדש"}
            </button>
          )}
          {r.status !== "disabled" && (
            <button onClick={() => openAction(r, "disabled")} className="text-xs text-danger underline hover:text-danger-ink">
              {r.status === "pending" ? "דחייה" : "השבתה"}
            </button>
          )}
          {r.status === "approved" && (
            <button onClick={() => openRoleChange(r)} className="link-action text-xs">
              שינוי תפקיד
            </button>
          )}
          <button onClick={() => setPermissionsUser(r)} className="link-action text-xs">
            ניהול הרשאות
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="משתמשים והרשאות" description="אישור, דחייה או השבתה של משתמשים, כולל תפקיד ואזור ברירת מחדל." />
      <DataTable
        columns={columns}
        rows={profilesQuery.data ?? []}
        rowKey={(r) => r.id}
        loading={profilesQuery.isLoading}
        emptyTitle="אין משתמשים עדיין"
        emptyIcon={UserCog}
      />

      <ConfirmDialog
        open={pendingAction !== null}
        title={
          pendingAction?.kind === "approve"
            ? "אישור משתמש"
            : pendingAction?.kind === "changeRole"
              ? "שינוי תפקיד"
              : "דחייה / השבתת משתמש"
        }
        danger={pendingAction?.status === "disabled"}
        confirmLabel={submitting ? "מעדכנת…" : pendingAction?.kind === "changeRole" ? "שמירה" : "אישור"}
        onCancel={() => setPendingAction(null)}
        onConfirm={runStatusChange}
        description={
          pendingAction?.status === "approved" ? (
            <div className="space-y-3 text-right">
              <div>
                <label className="field-label text-xs">תפקיד</label>
                <select
                  value={roleChoice}
                  onChange={(e) => setRoleChoice(e.target.value)}
                  className="input-field"
                >
                  <option value="">— בחרי תפקיד —</option>
                  {(rolesQuery.data ?? []).map((role) => (
                    <option key={role.key} value={role.key}>
                      {role.label_he}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label text-xs">אזור ברירת מחדל</label>
                <select
                  value={areaChoice}
                  onChange={(e) => setAreaChoice(e.target.value)}
                  className="input-field"
                >
                  <option value="">— ללא —</option>
                  <option value="ops">תפעול שוטף</option>
                  <option value="finance">כספים ובקרה</option>
                  <option value="admin">ניהול</option>
                  <option value="tasks">משימות ותזכורות</option>
                </select>
              </div>
              {actionError && <ErrorState message={actionError} />}
            </div>
          ) : (
            <div className="space-y-3 text-right">
              <p>הפעולה תחסום גישה מיידית למשתמש הזה.</p>
              {actionError && <ErrorState message={actionError} />}
            </div>
          )
        }
      />

      <UserPermissionsDrawer
        open={permissionsUser !== null}
        onClose={() => setPermissionsUser(null)}
        userId={permissionsUser?.id ?? ""}
        userLabel={permissionsUser?.full_name ?? permissionsUser?.email ?? ""}
        roleId={permissionsUser?.role_id ?? null}
        roleLabel={permissionsUser?.role?.label_he ?? null}
      />
    </div>
  );
}
