import { useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { StatusBadge } from "@/components/StatusBadge";
import { addWhatsAppGroup, fetchAssignableUsers, fetchWhatsAppGroups, toggleWhatsAppGroupActive } from "./api";
import { useAuth } from "@/lib/auth";
import type { Team } from "./types";

// סעיף מתקפל, סגור כברירת מחדל - לבקשת Chani: צוותים/קטגוריות נדרשים לעריכה רק לעיתים
// רחוקות (בדרך כלל פעם אחת בהתחלה), אז אין סיבה שיתפסו מקום קבוע על המסך.
function CollapsibleSection({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card overflow-hidden p-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-right hover:bg-slate-50"
      >
        <span className="text-sm font-semibold text-slate-800">{title}</span>
        {open ? <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden="true" /> : <ChevronLeft className="h-4 w-4 text-slate-400" aria-hidden="true" />}
      </button>
      {open && (
        <div className="border-t border-slate-100 p-4">
          {subtitle && <p className="mb-3 text-xs text-slate-500">{subtitle}</p>}
          {children}
        </div>
      )}
    </section>
  );
}

const PROVIDER_LABEL: Record<string, string> = {
  twilio: "Twilio (WhatsApp Sandbox/API)",
  meta: "Meta WhatsApp Cloud API (ישיר)",
};

const PROVIDER_HELP: Record<string, string> = {
  twilio: 'מזהה חיצוני = מספר ה-WhatsApp של Twilio, בפורמט whatsapp:+1415... (כולל המילה whatsapp ונקודתיים). ה-Webhook: /api/whatsapp-webhook.',
  meta: 'מזהה חיצוני = ה-Phone Number ID שמטא מציגה (מספר, לא מספר טלפון). ה-Webhook: /api/whatsapp-webhook-meta.',
};

interface TeamRow extends Team {}

async function fetchAllTeams(): Promise<TeamRow[]> {
  const { data, error } = await supabase.from("teams").select("id, key, label_he, is_active").order("label_he");
  if (error) throw error;
  return data ?? [];
}

async function fetchTeamMembers(teamId: string): Promise<{ user_id: string }[]> {
  const { data, error } = await supabase.from("team_members").select("user_id").eq("team_id", teamId);
  if (error) throw error;
  return data ?? [];
}

async function fetchAllCategories(): Promise<{ id: string; key: string; label_he: string; is_active: boolean }[]> {
  const { data, error } = await supabase.from("task_categories").select("id, key, label_he, is_active").order("label_he");
  if (error) throw error;
  return data ?? [];
}

function TeamMembersPanel({ teamId, canManage }: { teamId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const membersQuery = useQuery({ queryKey: ["team-members", teamId], queryFn: () => fetchTeamMembers(teamId) });
  const usersQuery = useQuery({ queryKey: ["assignable-users"], queryFn: fetchAssignableUsers });

  const memberIds = new Set((membersQuery.data ?? []).map((m) => m.user_id));
  const usersById = new Map((usersQuery.data ?? []).map((u) => [u.id, u.full_name]));

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["team-members", teamId] });

  const addMember = async (userId: string) => {
    if (!userId) return;
    await supabase.from("team_members").insert({ team_id: teamId, user_id: userId });
    refresh();
  };

  const removeMember = async (userId: string) => {
    await supabase.from("team_members").delete().eq("team_id", teamId).eq("user_id", userId);
    refresh();
  };

  return (
    <div className="mt-2 rounded-lg bg-slate-50 p-3">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {[...memberIds].length === 0 && <span className="text-xs text-slate-400">אין חברים בצוות עדיין.</span>}
        {[...memberIds].map((id) => (
          <span key={id} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs text-slate-700 ring-1 ring-slate-200">
            {usersById.get(id) ?? "—"}
            {canManage && (
              <button onClick={() => removeMember(id)} aria-label="הסרה" title="הסרת חבר מהצוות" className="text-slate-400 hover:text-red-600">
                ✕
              </button>
            )}
          </span>
        ))}
      </div>
      {canManage && (
        <select value="" onChange={(e) => addMember(e.target.value)} className="input-field w-auto text-xs">
          <option value="">+ הוספת חבר צוות</option>
          {(usersQuery.data ?? [])
            .filter((u) => !memberIds.has(u.id))
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
        </select>
      )}
    </div>
  );
}

export function TasksSettingsScreen() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id ?? "";
  const { hasPermission: canManage, isLoading: permissionLoading } = useHasPermission("tasks", "manage_settings");
  const { hasPermission: canManageWhatsApp, isLoading: whatsAppPermissionLoading } = useHasPermission("tasks", "manage_whatsapp");
  const canViewScreen = canManage || canManageWhatsApp;

  const teamsQuery = useQuery({ queryKey: ["all-teams"], queryFn: fetchAllTeams, enabled: canViewScreen });
  const categoriesQuery = useQuery({ queryKey: ["all-task-categories"], queryFn: fetchAllCategories, enabled: canViewScreen });
  const whatsAppGroupsQuery = useQuery({ queryKey: ["all-whatsapp-groups"], queryFn: fetchWhatsAppGroups, enabled: canViewScreen });

  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [newTeamLabel, setNewTeamLabel] = useState("");
  const [newCategoryLabel, setNewCategoryLabel] = useState("");
  const [newGroupExternalId, setNewGroupExternalId] = useState("");
  const [newGroupLabel, setNewGroupLabel] = useState("");
  const [newGroupTeamId, setNewGroupTeamId] = useState("");
  const [newGroupProvider, setNewGroupProvider] = useState("twilio");
  const [error, setError] = useState<string | null>(null);

  const addGroup = async (e: FormEvent) => {
    e.preventDefault();
    if (!newGroupExternalId.trim() || !newGroupLabel.trim()) return;
    setError(null);
    try {
      await addWhatsAppGroup(userId, newGroupExternalId.trim(), newGroupLabel.trim(), newGroupTeamId || null, newGroupProvider);
      setNewGroupExternalId("");
      setNewGroupLabel("");
      setNewGroupTeamId("");
      queryClient.invalidateQueries({ queryKey: ["all-whatsapp-groups"] });
    } catch (e: any) {
      setError(e.message ?? "שגיאה בחיבור הקבוצה");
    }
  };

  const toggleGroupActive = async (id: string, isActive: boolean) => {
    await toggleWhatsAppGroupActive(id, !isActive);
    queryClient.invalidateQueries({ queryKey: ["all-whatsapp-groups"] });
  };

  const slugify = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9֐-׿]+/g, "_").replace(/^_+|_+$/g, "") || `x_${Date.now()}`;

  const addTeam = async (e: FormEvent) => {
    e.preventDefault();
    if (!newTeamLabel.trim()) return;
    setError(null);
    const { error } = await supabase.from("teams").insert({ key: slugify(newTeamLabel), label_he: newTeamLabel.trim() });
    if (error) {
      setError(error.message);
      return;
    }
    setNewTeamLabel("");
    queryClient.invalidateQueries({ queryKey: ["all-teams"] });
    queryClient.invalidateQueries({ queryKey: ["teams"] });
  };

  const toggleTeamActive = async (team: TeamRow) => {
    await supabase.from("teams").update({ is_active: !team.is_active }).eq("id", team.id);
    queryClient.invalidateQueries({ queryKey: ["all-teams"] });
    queryClient.invalidateQueries({ queryKey: ["teams"] });
  };

  const addCategory = async (e: FormEvent) => {
    e.preventDefault();
    if (!newCategoryLabel.trim()) return;
    setError(null);
    const { error } = await supabase.from("task_categories").insert({ key: slugify(newCategoryLabel), label_he: newCategoryLabel.trim() });
    if (error) {
      setError(error.message);
      return;
    }
    setNewCategoryLabel("");
    queryClient.invalidateQueries({ queryKey: ["all-task-categories"] });
    queryClient.invalidateQueries({ queryKey: ["task-categories"] });
  };

  const toggleCategoryActive = async (cat: { id: string; is_active: boolean }) => {
    await supabase.from("task_categories").update({ is_active: !cat.is_active }).eq("id", cat.id);
    queryClient.invalidateQueries({ queryKey: ["all-task-categories"] });
    queryClient.invalidateQueries({ queryKey: ["task-categories"] });
  };

  if (permissionLoading || whatsAppPermissionLoading) return <LoadingState rows={4} />;

  if (!canViewScreen) {
    return (
      <div>
        <PageHeader title="הגדרות - צוותים, קטגוריות ו-WhatsApp" />
        <ErrorState message="אין לך הרשאה לצפות במסך זה." />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader title="הגדרות - צוותים, קטגוריות ו-WhatsApp" description="ניהול צוותי שיוך, קטגוריות משימה וחיבור קבוצות WhatsApp. חברות בצוות נקבעת כאן, לא בהרשאות המשתמש." />
      {error && <ErrorState message={error} />}

      {canManage && (
        <>
          <CollapsibleSection title={`צוותים (${(teamsQuery.data ?? []).length})`}>
            <div className="space-y-2">
              {(teamsQuery.data ?? []).map((team) => (
                <div key={team.id} className="card p-3">
                  <div className="flex items-center justify-between">
                    <button onClick={() => setExpandedTeamId((id) => (id === team.id ? null : team.id))} className="link-action text-sm font-medium">
                      {team.label_he}
                    </button>
                    <div className="flex items-center gap-3">
                      <StatusBadge severity={team.is_active ? "ok" : "neutral"} label={team.is_active ? "פעיל" : "לא פעיל"} />
                      <button onClick={() => toggleTeamActive(team)} className="text-xs text-slate-500 underline">
                        {team.is_active ? "השבתה" : "הפעלה"}
                      </button>
                    </div>
                  </div>
                  {expandedTeamId === team.id && <TeamMembersPanel teamId={team.id} canManage={canManage} />}
                </div>
              ))}
            </div>
            <form onSubmit={addTeam} className="mt-3 flex gap-2">
              <input value={newTeamLabel} onChange={(e) => setNewTeamLabel(e.target.value)} placeholder="שם צוות חדש…" className="input-field" />
              <button type="submit" className="btn-secondary text-sm">
                הוספה
              </button>
            </form>
          </CollapsibleSection>

          <CollapsibleSection title={`קטגוריות (${(categoriesQuery.data ?? []).length})`}>
            <div className="space-y-2">
              {(categoriesQuery.data ?? []).map((cat) => (
                <div key={cat.id} className="card flex items-center justify-between p-3">
                  <span className="text-sm">{cat.label_he}</span>
                  <div className="flex items-center gap-3">
                    <StatusBadge severity={cat.is_active ? "ok" : "neutral"} label={cat.is_active ? "פעילה" : "לא פעילה"} />
                    <button onClick={() => toggleCategoryActive(cat)} className="text-xs text-slate-500 underline">
                      {cat.is_active ? "השבתה" : "הפעלה"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <form onSubmit={addCategory} className="mt-3 flex gap-2">
              <input value={newCategoryLabel} onChange={(e) => setNewCategoryLabel(e.target.value)} placeholder="קטגוריה חדשה…" className="input-field" />
              <button type="submit" className="btn-secondary text-sm">
                הוספה
              </button>
            </form>
          </CollapsibleSection>
        </>
      )}

      {canManageWhatsApp && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">חיבור WhatsApp</h2>
          <p className="mb-3 text-xs text-slate-500">
            שני ספקים רשמיים נתמכים - אפשר לבחור לפי מה שהלקוח מעדיף להקים בפועל. שניהם משתמשים באותו "מזהה סוד" (WHATSAPP_WEBHOOK_SECRET) שהוגדר פעם אחת.
          </p>
          <div className="space-y-2">
            {(whatsAppGroupsQuery.data ?? []).map((group) => (
              <div key={group.id} className="card flex items-center justify-between p-3">
                <div>
                  <span className="text-sm font-medium">{group.label}</span>
                  <span className="mr-2 text-xs text-slate-400">{PROVIDER_LABEL[group.provider ?? ""] ?? group.provider ?? "—"}</span>
                  <span className="mr-2 text-xs text-slate-400 tabular">{group.external_group_id}</span>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge severity={group.is_active ? "ok" : "neutral"} label={group.is_active ? "מחוברת" : "מנותקת"} />
                  <button onClick={() => toggleGroupActive(group.id, group.is_active)} className="text-xs text-slate-500 underline">
                    {group.is_active ? "ניתוק" : "חיבור מחדש"}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <form onSubmit={addGroup} className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              <select value={newGroupProvider} onChange={(e) => setNewGroupProvider(e.target.value)} className="input-field w-auto">
                <option value="twilio">Twilio</option>
                <option value="meta">Meta Cloud API (ישיר)</option>
              </select>
              <input value={newGroupLabel} onChange={(e) => setNewGroupLabel(e.target.value)} placeholder="שם לתצוגה…" className="input-field w-auto" />
              <input value={newGroupExternalId} onChange={(e) => setNewGroupExternalId(e.target.value)} placeholder="מזהה חיצוני…" className="input-field w-auto" />
              <select value={newGroupTeamId} onChange={(e) => setNewGroupTeamId(e.target.value)} className="input-field w-auto">
                <option value="">ללא צוות ברירת מחדל</option>
                {(teamsQuery.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label_he}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn-secondary text-sm">
                חיבור
              </button>
            </div>
            <p className="text-xs text-slate-400">{PROVIDER_HELP[newGroupProvider]}</p>
          </form>
        </section>
      )}
    </div>
  );
}
