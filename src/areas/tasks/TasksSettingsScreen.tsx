import { useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, Repeat, FileStack } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { StatusBadge } from "@/components/StatusBadge";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import { useLastSelected } from "@/lib/useLastSelected";
import {
  addWhatsAppGroup,
  createRecurrenceRule,
  createTemplate,
  fetchAssignableUsers,
  fetchCategories,
  fetchRecurrenceRules,
  fetchTeams,
  fetchTemplates,
  fetchWhatsAppGroups,
  toggleRecurrenceRuleActive,
  toggleTemplateActive,
  toggleWhatsAppGroupActive,
} from "./api";
import { useAuth } from "@/lib/auth";
import { PriorityBadge } from "./PriorityBadge";
import {
  DAY_OF_WEEK_LABEL,
  FREQUENCY_LABEL,
  PRIORITY_LABEL,
  type RecurrenceFrequency,
  type TaskPriority,
  type TaskRecurrenceRule,
  type TaskTemplate,
  type Team,
} from "./types";

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

const EMPTY_RECURRENCE_FORM = {
  title: "",
  description: "",
  categoryId: "",
  priority: "normal" as TaskPriority,
  frequency: "weekly" as RecurrenceFrequency,
  dayOfWeek: 0,
  dayOfMonth: 1,
  intervalDays: 7,
  startDate: new Date().toISOString().slice(0, 10),
  endDate: "",
  createNextEvenIfPreviousIncomplete: false,
  reminderDaysBeforeDue: "",
  ownerIds: [] as string[],
  teamIds: [] as string[],
};

function RecurringRulesSection() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id ?? "";
  const { hasPermission: canManage, isLoading: permissionLoading } = useHasPermission("tasks", "manage_settings");

  const rulesQuery = useQuery({ queryKey: ["recurrence-rules"], queryFn: fetchRecurrenceRules, enabled: canManage });
  const categoriesQuery = useQuery({ queryKey: ["task-categories"], queryFn: fetchCategories, enabled: canManage });
  const usersQuery = useQuery({ queryKey: ["assignable-users"], queryFn: fetchAssignableUsers, enabled: canManage });
  const teamsQuery = useQuery({ queryKey: ["teams"], queryFn: fetchTeams, enabled: canManage });

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_RECURRENCE_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ברירת מחדל לאחראים/צוותים בכלל חדש = הבחירה האחרונה (נשמר ב-DB דרך useLastSelected).
  const [lastOwners, setLastOwners] = useLastSelected<string[]>("last-task-owners", []);
  const [lastTeams, setLastTeams] = useLastSelected<string[]>("last-task-teams", []);

  useEscapeToClose(showCreate, () => setShowCreate(false));

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["recurrence-rules"] });

  const handleCreate = async () => {
    if (!form.title.trim()) {
      setError("יש להזין כותרת.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createRecurrenceRule({
        title: form.title.trim(),
        description: form.description.trim() || null,
        category_id: form.categoryId || null,
        priority: form.priority,
        frequency: form.frequency,
        day_of_week: form.frequency === "weekly" ? form.dayOfWeek : null,
        day_of_month: form.frequency === "monthly" ? form.dayOfMonth : null,
        interval_days: form.frequency === "custom" ? form.intervalDays : null,
        start_date: form.startDate,
        end_date: form.endDate || null,
        create_next_even_if_previous_incomplete: form.createNextEvenIfPreviousIncomplete,
        reminder_days_before_due: form.reminderDaysBeforeDue === "" ? null : Number(form.reminderDaysBeforeDue),
        created_by: userId,
        owner_ids: form.ownerIds,
        team_ids: form.teamIds,
      });
      setForm(EMPTY_RECURRENCE_FORM);
      setShowCreate(false);
      refresh();
    } catch (e: any) {
      setError(e.message ?? "שגיאה ביצירת הכלל");
    } finally {
      setSubmitting(false);
    }
  };

  const columns: DataTableColumn<TaskRecurrenceRule>[] = [
    { key: "title", header: "כותרת", render: (r) => r.title },
    { key: "frequency", header: "תדירות", render: (r) => FREQUENCY_LABEL[r.frequency] },
    { key: "priority", header: "עדיפות", render: (r) => PRIORITY_LABEL[r.priority] },
    { key: "start_date", header: "התחלה", className: "tabular", render: (r) => r.start_date },
    { key: "last_generated", header: "מופע אחרון שנוצר", className: "tabular", render: (r) => r.last_generated_date ?? "טרם נוצר" },
    {
      key: "status",
      header: "סטטוס",
      render: (r) => <StatusBadge severity={r.is_active ? "ok" : "neutral"} label={r.is_active ? "פעיל" : "מושהה"} />,
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <button
          onClick={async () => {
            await toggleRecurrenceRuleActive(r.id, !r.is_active);
            refresh();
          }}
          className="link-action text-xs"
        >
          {r.is_active ? "השהיה" : "הפעלה"}
        </button>
      ),
    },
  ];

  if (permissionLoading) return null;

  if (!canManage) {
    return <ErrorState message="אין לך הרשאה לצפות במסך זה." />;
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">כללים ליצירת משימה חדשה אוטומטית לפי לוח זמנים - לא לצורך מדידת ביצוע.</p>
        <button
          onClick={() => {
            // ברירת מחדל לטופס יצירה חדש = הבחירה האחרונה של המשתמש, לא ריק.
            setForm((f) => ({ ...f, ownerIds: lastOwners, teamIds: lastTeams }));
            setShowCreate(true);
          }}
          className="btn-primary text-sm shrink-0"
        >
          כלל חדש
        </button>
      </div>

      <DataTable
        columns={columns}
        rows={rulesQuery.data ?? []}
        rowKey={(r) => r.id}
        loading={rulesQuery.isLoading}
        emptyTitle="אין כללי חזרה עדיין"
        emptyIcon={Repeat}
      />

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div role="dialog" aria-modal="true" aria-labelledby="new-recurrence-title" className="card max-h-[85vh] w-full max-w-lg overflow-y-auto p-6">
            <h2 id="new-recurrence-title" className="mb-4 text-base font-semibold text-slate-900">
              כלל חזרה חדש
            </h2>
            <div className="space-y-3">
              <div>
                <label className="field-label">כותרת המשימה שתיווצר</label>
                <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="input-field" />
              </div>
              <div>
                <label className="field-label">תיאור</label>
                <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} className="input-field" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">עדיפות</label>
                  <select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as TaskPriority }))} className="input-field">
                    {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_LABEL[p]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label">קטגוריה</label>
                  <select value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))} className="input-field">
                    <option value="">— ללא —</option>
                    {(categoriesQuery.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label_he}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="field-label">תדירות</label>
                <select value={form.frequency} onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as RecurrenceFrequency }))} className="input-field">
                  {(Object.keys(FREQUENCY_LABEL) as RecurrenceFrequency[]).map((freq) => (
                    <option key={freq} value={freq}>
                      {FREQUENCY_LABEL[freq]}
                    </option>
                  ))}
                </select>
              </div>

              {form.frequency === "weekly" && (
                <div>
                  <label className="field-label">יום בשבוע</label>
                  <select value={form.dayOfWeek} onChange={(e) => setForm((f) => ({ ...f, dayOfWeek: Number(e.target.value) }))} className="input-field">
                    {DAY_OF_WEEK_LABEL.map((label, i) => (
                      <option key={i} value={i}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {form.frequency === "monthly" && (
                <div>
                  <label className="field-label">יום בחודש</label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={form.dayOfMonth}
                    onChange={(e) => setForm((f) => ({ ...f, dayOfMonth: Number(e.target.value) }))}
                    className="input-field"
                  />
                </div>
              )}
              {form.frequency === "custom" && (
                <div>
                  <label className="field-label">כל כמה ימים</label>
                  <input
                    type="number"
                    min={1}
                    value={form.intervalDays}
                    onChange={(e) => setForm((f) => ({ ...f, intervalDays: Number(e.target.value) }))}
                    className="input-field"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">תאריך התחלה</label>
                  <input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} className="input-field" />
                </div>
                <div>
                  <label className="field-label">תאריך סיום (לא חובה)</label>
                  <input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} className="input-field" />
                </div>
              </div>

              <div>
                <label className="field-label">תזכורת (ימים לפני היעד, לא חובה)</label>
                <input
                  type="number"
                  min={0}
                  value={form.reminderDaysBeforeDue}
                  onChange={(e) => setForm((f) => ({ ...f, reminderDaysBeforeDue: e.target.value }))}
                  className="input-field"
                />
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.createNextEvenIfPreviousIncomplete}
                  onChange={(e) => setForm((f) => ({ ...f, createNextEvenIfPreviousIncomplete: e.target.checked }))}
                />
                ליצור מופע חדש גם אם הקודם טרם הושלם
              </label>

              <div>
                <label className="field-label">אחראים</label>
                <div className="max-h-28 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                  {(usersQuery.data ?? []).map((u) => (
                    <label key={u.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.ownerIds.includes(u.id)}
                        onChange={(e) => {
                          const next = e.target.checked ? [...form.ownerIds, u.id] : form.ownerIds.filter((id) => id !== u.id);
                          setForm((f) => ({ ...f, ownerIds: next }));
                          setLastOwners(next);
                        }}
                      />
                      {u.full_name}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="field-label">צוותים</label>
                <div className="space-y-1 rounded-lg border border-slate-200 p-2">
                  {(teamsQuery.data ?? []).map((t) => (
                    <label key={t.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.teamIds.includes(t.id)}
                        onChange={(e) => {
                          const next = e.target.checked ? [...form.teamIds, t.id] : form.teamIds.filter((id) => id !== t.id);
                          setForm((f) => ({ ...f, teamIds: next }));
                          setLastTeams(next);
                        }}
                      />
                      {t.label_he}
                    </label>
                  ))}
                </div>
              </div>

              {error && <ErrorState message={error} />}

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setShowCreate(false)} className="btn-secondary text-sm">
                  ביטול
                </button>
                <button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">
                  {submitting ? "יוצרת…" : "יצירה"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const EMPTY_TEMPLATE_FORM = {
  title: "",
  description: "",
  categoryId: "",
  priority: "normal" as TaskPriority,
  dueInDays: "",
  checklist: "",
};

function TaskTemplatesSection() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id ?? "";
  const { hasPermission: canManage, isLoading: permissionLoading } = useHasPermission("tasks", "manage_templates");

  const templatesQuery = useQuery({ queryKey: ["all-templates"], queryFn: () => fetchTemplates(false), enabled: canManage });
  const categoriesQuery = useQuery({ queryKey: ["task-categories"], queryFn: fetchCategories, enabled: canManage });

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_TEMPLATE_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEscapeToClose(showCreate, () => setShowCreate(false));

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["all-templates"] });
    queryClient.invalidateQueries({ queryKey: ["templates"] });
  };

  const handleCreate = async () => {
    if (!form.title.trim()) {
      setError("יש להזין כותרת.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createTemplate({
        title: form.title.trim(),
        description: form.description.trim() || null,
        category_id: form.categoryId || null,
        priority: form.priority,
        due_in_days: form.dueInDays === "" ? null : Number(form.dueInDays),
        created_by: userId,
        checklistItems: form.checklist.split("\n").map((l) => l.trim()).filter(Boolean),
      });
      setForm(EMPTY_TEMPLATE_FORM);
      setShowCreate(false);
      refresh();
    } catch (e: any) {
      setError(e.message ?? "שגיאה ביצירת התבנית");
    } finally {
      setSubmitting(false);
    }
  };

  const columns: DataTableColumn<TaskTemplate>[] = [
    { key: "title", header: "כותרת", render: (t) => t.title },
    { key: "priority", header: "עדיפות", render: (t) => <PriorityBadge priority={t.priority} /> },
    { key: "due_in_days", header: "יעד יחסי", render: (t) => (t.due_in_days !== null ? `${t.due_in_days} ימים` : "—") },
    {
      key: "status",
      header: "סטטוס",
      render: (t) => <StatusBadge severity={t.is_active ? "ok" : "neutral"} label={t.is_active ? "פעילה" : "לא פעילה"} />,
    },
    {
      key: "actions",
      header: "",
      render: (t) => (
        <button
          onClick={async () => {
            await toggleTemplateActive(t.id, !t.is_active);
            refresh();
          }}
          className="link-action text-xs"
        >
          {t.is_active ? "השבתה" : "הפעלה"}
        </button>
      ),
    },
  ];

  if (permissionLoading) return null;

  if (!canManage) {
    return <ErrorState message="אין לך הרשאה לצפות במסך זה." />;
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">תבנית מאפשרת יצירה מהירה של משימה עם ערכים קבועים מראש - זמינה לכל מי שיכול ליצור משימה.</p>
        <button onClick={() => setShowCreate(true)} className="btn-primary text-sm shrink-0">
          תבנית חדשה
        </button>
      </div>

      <DataTable
        columns={columns}
        rows={templatesQuery.data ?? []}
        rowKey={(t) => t.id}
        loading={templatesQuery.isLoading}
        emptyTitle="אין תבניות עדיין"
        emptyIcon={FileStack}
      />

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div role="dialog" aria-modal="true" aria-labelledby="new-template-title" className="card max-h-[85vh] w-full max-w-lg overflow-y-auto p-6">
            <h2 id="new-template-title" className="mb-4 text-base font-semibold text-slate-900">
              תבנית חדשה
            </h2>
            <div className="space-y-3">
              <div>
                <label className="field-label">כותרת</label>
                <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="input-field" />
              </div>
              <div>
                <label className="field-label">תיאור</label>
                <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} className="input-field" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">עדיפות</label>
                  <select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as TaskPriority }))} className="input-field">
                    {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_LABEL[p]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label">קטגוריה</label>
                  <select value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))} className="input-field">
                    <option value="">— ללא —</option>
                    {(categoriesQuery.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label_he}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="field-label">יעד יחסי (ימים מרגע היצירה, לא חובה)</label>
                <input type="number" min={0} value={form.dueInDays} onChange={(e) => setForm((f) => ({ ...f, dueInDays: e.target.value }))} className="input-field" />
              </div>
              <div>
                <label className="field-label">Checklist (שורה לכל פריט, לא חובה)</label>
                <textarea value={form.checklist} onChange={(e) => setForm((f) => ({ ...f, checklist: e.target.value }))} rows={3} className="input-field" />
              </div>

              {error && <ErrorState message={error} />}

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setShowCreate(false)} className="btn-secondary text-sm">
                  ביטול
                </button>
                <button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">
                  {submitting ? "יוצרת…" : "יצירה"}
                </button>
              </div>
            </div>
          </div>
        </div>
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
  const { hasPermission: canManageTemplates, isLoading: templatesPermissionLoading } = useHasPermission("tasks", "manage_templates");
  const canViewScreen = canManage || canManageWhatsApp || canManageTemplates;

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

  if (permissionLoading || whatsAppPermissionLoading || templatesPermissionLoading) return <LoadingState rows={4} />;

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

          <CollapsibleSection title="משימות חוזרות">
            <RecurringRulesSection />
          </CollapsibleSection>
        </>
      )}

      {canManageTemplates && (
        <CollapsibleSection title="תבניות">
          <TaskTemplatesSection />
        </CollapsibleSection>
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
