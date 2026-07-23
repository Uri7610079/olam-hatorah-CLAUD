import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { StatusBadge } from "@/components/StatusBadge";

interface PermissionCatalogItem {
  id: string;
  resource: string;
  action: string;
  label_he: string;
}

interface UserPermissionsDrawerProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  userLabel: string;
  roleId: string | null;
  roleLabel: string | null;
}

type Effect = "grant" | "revoke";

async function fetchPermissionsCatalog(): Promise<PermissionCatalogItem[]> {
  const { data, error } = await supabase.from("permissions").select("id, resource, action, label_he").order("resource").order("action");
  if (error) throw error;
  return data ?? [];
}

async function fetchRoleGrants(roleId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from("role_permissions").select("permission_id").eq("role_id", roleId);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.permission_id));
}

async function fetchUserOverrides(userId: string): Promise<Map<string, Effect>> {
  const { data, error } = await supabase.from("user_permissions").select("permission_id, effect").eq("user_id", userId);
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.permission_id, r.effect as Effect]));
}

// מגירה לניהול הרשאות פר-משתמש - שכבה על גבי מנגנון ה-overrides שכבר קיים משלב 2
// (user_permissions + admin_set_user_permission), רק בלי ממשק עד עכשיו. "ברירת מחדל" =
// מה שהתפקיד נותן (role_permissions); "הענקה נוספת"/"שלילה" = חריגה פר-משתמש שמנצחת
// את ברירת המחדל; "איפוס" מוחק את החריגה וחוזר לברירת המחדל של התפקיד.
export function UserPermissionsDrawer({ open, onClose, userId, userLabel, roleId, roleLabel }: UserPermissionsDrawerProps) {
  const queryClient = useQueryClient();

  const catalogQuery = useQuery({ queryKey: ["permissions-catalog"], queryFn: fetchPermissionsCatalog, enabled: open });
  const roleGrantsQuery = useQuery({
    queryKey: ["role-grants", roleId],
    queryFn: () => fetchRoleGrants(roleId!),
    enabled: open && !!roleId,
  });
  const overridesQuery = useQuery({ queryKey: ["user-overrides", userId], queryFn: () => fetchUserOverrides(userId), enabled: open });

  if (!open) return null;

  const loading = catalogQuery.isLoading || overridesQuery.isLoading || (!!roleId && roleGrantsQuery.isLoading);
  const roleGrants = roleGrantsQuery.data ?? new Set<string>();
  const overrides = overridesQuery.data ?? new Map<string, Effect>();

  const setOverride = async (resource: string, action: string, effect: Effect | null) => {
    await supabase.rpc("admin_set_user_permission", { p_user_id: userId, p_resource: resource, p_action: action, p_effect: effect });
    queryClient.invalidateQueries({ queryKey: ["user-overrides", userId] });
    queryClient.invalidateQueries({ queryKey: ["my-permissions"] });
  };

  const grouped = new Map<string, PermissionCatalogItem[]>();
  for (const item of catalogQuery.data ?? []) {
    if (!grouped.has(item.resource)) grouped.set(item.resource, []);
    grouped.get(item.resource)!.push(item);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button aria-label="סגור" className="flex-1 bg-slate-900/40" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="ניהול הרשאות" className="h-full w-full max-w-lg overflow-y-auto bg-white p-5 shadow-xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">ניהול הרשאות — {userLabel}</h2>
          <button onClick={onClose} aria-label="סגור" className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100">
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs text-slate-500">
          תפקיד: {roleLabel ?? "— טרם נקבע —"}. "ברירת מחדל" ניתנת מהתפקיד; ניתן לחרוג פר-משתמש בכל שורה בנפרד.
        </p>

        {loading ? (
          <LoadingState rows={6} />
        ) : (catalogQuery.data ?? []).length === 0 ? (
          <EmptyState title="אין הרשאות מוגדרות במערכת" />
        ) : (
          <div className="space-y-5">
            {Array.from(grouped.entries()).map(([resource, items]) => (
              <div key={resource}>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{resource}</h3>
                <ul className="space-y-1.5">
                  {items.map((item) => {
                    const override = overrides.get(item.id) ?? null;
                    const fromRole = roleGrants.has(item.id);
                    const effective = override === "revoke" ? false : override === "grant" ? true : fromRole;
                    return (
                      <li key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 p-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-slate-800">{item.label_he}</p>
                          <p className="text-xs text-slate-400">
                            {item.resource}.{item.action}
                            {override && (
                              <span className="mr-2 text-amber-600">
                                {override === "grant" ? "· הענקה ידנית" : "· שלילה ידנית"} (ברירת מחדל: {fromRole ? "כן" : "לא"})
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <StatusBadge severity={effective ? "ok" : "neutral"} label={effective ? "יש גישה" : "אין גישה"} />
                          {!fromRole && (
                            <button onClick={() => setOverride(item.resource, item.action, "grant")} disabled={override === "grant"} className="link-action text-xs disabled:opacity-40">
                              הענקה
                            </button>
                          )}
                          {fromRole && (
                            <button onClick={() => setOverride(item.resource, item.action, "revoke")} disabled={override === "revoke"} className="text-xs text-red-600 underline disabled:opacity-40">
                              שלילה
                            </button>
                          )}
                          {override && (
                            <button onClick={() => setOverride(item.resource, item.action, null)} className="text-xs text-slate-500 underline">
                              איפוס
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
