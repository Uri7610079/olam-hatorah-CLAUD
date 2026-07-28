import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useHasPermission } from "@/lib/permissions";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { StatusBadge } from "@/components/StatusBadge";
import { Tabs, type TabDef } from "@/components/Tabs";
import {
  addTaskOwner,
  addTaskTeam,
  createTask,
  fetchAssignableUsers,
  fetchCategories,
  fetchTeams,
  fetchTaskOwners,
  fetchTaskTeams,
  fetchTemplateChecklist,
  fetchTemplates,
  removeTaskOwner,
  removeTaskTeam,
  updateTask,
} from "./api";
import { supabase } from "@/lib/supabase";
import { addDaysIso } from "./dateUtils";
import { PRIORITY_LABEL, STATUS_LABEL, STATUS_SEVERITY, type Task, type TaskPriority, type TaskStatus } from "./types";
import { TaskChecklistTab } from "./TaskChecklistTab";
import { TaskCommentsTab } from "./TaskCommentsTab";
import { TaskLinksTab } from "./TaskLinksTab";
import { TaskHistoryTab } from "./TaskHistoryTab";
import { TaskRemindersTab } from "./TaskRemindersTab";

type TabKey = "details" | "checklist" | "reminders" | "comments" | "links" | "history";

const TABS: TabDef<TabKey>[] = [
  { key: "details", label: "פרטים" },
  { key: "checklist", label: "משימות משנה" },
  { key: "reminders", label: "תזכורות" },
  { key: "comments", label: "הערות וקבצים" },
  { key: "links", label: "קישורים" },
  { key: "history", label: "היסטוריה" },
];

interface TaskDrawerProps {
  open: boolean;
  onClose: () => void;
  taskId: string | null;
  onSaved: () => void;
  // תאריך יעד ראשוני לטופס יצירה - למשל בלחיצה על יום בלוח השנה (כולל ימים עתידיים).
  initialDueDate?: string;
}

async function fetchTask(id: string): Promise<Task> {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, description, status, priority, category_id, parent_task_id, due_date, source, created_by, created_at, updated_at")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export function TaskDrawer({ open, onClose, taskId, onSaved, initialDueDate }: TaskDrawerProps) {
  useEscapeToClose(open, onClose);
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id ?? "";
  const { hasPermission: canEdit } = useHasPermission("tasks", "edit", open);
  const { hasPermission: canAssignUsers } = useHasPermission("tasks", "assign_users", open);
  const { hasPermission: canAssignTeams } = useHasPermission("tasks", "assign_teams", open);

  const [activeTab, setActiveTab] = useState<TabKey>("details");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // טופס יצירה (taskId === null)
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [categoryId, setCategoryId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [selectedOwners, setSelectedOwners] = useState<string[]>([]);
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");

  const categoriesQuery = useQuery({ queryKey: ["task-categories"], queryFn: fetchCategories, enabled: open });
  const teamsQuery = useQuery({ queryKey: ["teams"], queryFn: fetchTeams, enabled: open });
  const usersQuery = useQuery({ queryKey: ["assignable-users"], queryFn: fetchAssignableUsers, enabled: open });
  const templatesQuery = useQuery({ queryKey: ["templates"], queryFn: () => fetchTemplates(true), enabled: open && !taskId });

  // פתיחה בטופס יצירה עם תאריך יעד מוכן מראש (למשל לחיצה על יום בלוח השנה, כולל
  // ימים עתידיים) - נכנס בכל פעם שהחלון נפתח מחדש במצב יצירה, לא רק פעם אחת.
  useEffect(() => {
    if (open && !taskId && initialDueDate) {
      setDueDate(initialDueDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, taskId, initialDueDate]);

  const taskQuery = useQuery({ queryKey: ["task", taskId], queryFn: () => fetchTask(taskId!), enabled: open && !!taskId });
  const ownersQuery = useQuery({ queryKey: ["task-owners", taskId], queryFn: () => fetchTaskOwners(taskId!), enabled: open && !!taskId });
  const teamsLinkQuery = useQuery({ queryKey: ["task-teams", taskId], queryFn: () => fetchTaskTeams(taskId!), enabled: open && !!taskId });

  if (!open) return null;

  const resetCreateForm = () => {
    setTitle("");
    setDescription("");
    setPriority("normal");
    setCategoryId("");
    setDueDate("");
    setSelectedOwners([]);
    setSelectedTeams([]);
    setSelectedTemplateId("");
  };

  const applyTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const template = (templatesQuery.data ?? []).find((t) => t.id === templateId);
    if (!template) return;
    setTitle(template.title);
    setDescription(template.description ?? "");
    setPriority(template.priority);
    setCategoryId(template.category_id ?? "");
    setDueDate(template.due_in_days !== null ? addDaysIso(template.due_in_days) : "");
  };

  const close = () => {
    setActiveTab("details");
    setError(null);
    resetCreateForm();
    onClose();
  };

  const handleCreate = async () => {
    if (!title.trim()) {
      setError("יש להזין כותרת.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const newTaskId = await createTask({
        title: title.trim(),
        description: description.trim() || null,
        priority,
        category_id: categoryId || null,
        due_date: dueDate || null,
        created_by: userId,
        owner_ids: selectedOwners,
        team_ids: selectedTeams,
      });
      if (selectedTemplateId) {
        const items = await fetchTemplateChecklist(selectedTemplateId);
        if (items.length > 0) {
          const { error: checklistError } = await supabase
            .from("task_checklist_items")
            .insert(items.map((item, position) => ({ task_id: newTaskId, text: item.text, position })));
          // המשימה עצמה כבר נוצרה בהצלחה - זו לא כשלון מלא, אבל חייבים להציג שה-Checklist
          // לא הועתק (למשל חוסר tasks.edit) ולא לתת רושם שגוי שהכל הועתק בשקט.
          if (checklistError) {
            // לא סוגרים את החלון - כדי שההודעה תישאר גלויה ולא תיראה כהצלחה שקטה.
            setError(`המשימה נוצרה, אך העתקת ה-Checklist מהתבנית נכשלה: ${checklistError.message}`);
            onSaved();
            return;
          }
        }
      }
      onSaved();
      close();
    } catch (e: any) {
      setError(e.message ?? "שגיאה ביצירת המשימה");
    } finally {
      setSaving(false);
    }
  };

  const refreshTask = () => {
    queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    onSaved();
  };

  const handleFieldSave = async (patch: Parameters<typeof updateTask>[1]) => {
    if (!taskId) return;
    setSaving(true);
    setError(null);
    try {
      await updateTask(taskId, patch);
      refreshTask();
    } catch (e: any) {
      setError(e.message ?? "שגיאה בעדכון המשימה");
    } finally {
      setSaving(false);
    }
  };

  const toggleOwner = async (userIdToToggle: string, isCurrentlyOwner: boolean) => {
    if (!taskId) return;
    setError(null);
    try {
      if (isCurrentlyOwner) await removeTaskOwner(taskId, userIdToToggle);
      else await addTaskOwner(taskId, userIdToToggle);
      queryClient.invalidateQueries({ queryKey: ["task-owners", taskId] });
      onSaved();
    } catch (e: any) {
      setError(e.message ?? "שגיאה בעדכון אחראים");
    }
  };

  const toggleTeam = async (teamId: string, isCurrentlyLinked: boolean) => {
    if (!taskId) return;
    setError(null);
    try {
      if (isCurrentlyLinked) await removeTaskTeam(taskId, teamId);
      else await addTaskTeam(taskId, teamId);
      queryClient.invalidateQueries({ queryKey: ["task-teams", taskId] });
      onSaved();
    } catch (e: any) {
      setError(e.message ?? "שגיאה בעדכון צוותים");
    }
  };

  const isCreate = !taskId;
  const task = taskQuery.data;
  const ownerIds = new Set((ownersQuery.data ?? []).map((o) => o.user_id));
  const teamIds = new Set((teamsLinkQuery.data ?? []).map((t) => t.team_id));

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button aria-label="סגור" className="flex-1 bg-slate-900/40" onClick={close} />
      <div role="dialog" aria-modal="true" aria-label={isCreate ? "משימה חדשה" : "כרטיס משימה"} className="h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">{isCreate ? "משימה חדשה" : task?.title ?? "כרטיס משימה"}</h2>
          <button onClick={close} aria-label="סגור" title="סגירת החלון" className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100">
            ✕
          </button>
        </div>

        {!isCreate && task && (
          <div className="mb-4 flex items-center gap-2">
            <StatusBadge severity={STATUS_SEVERITY[task.status]} label={STATUS_LABEL[task.status]} />
            {canEdit && (
              <select
                value={task.status}
                onChange={(e) => handleFieldSave({ status: e.target.value as TaskStatus })}
                className="input-field w-auto text-xs"
              >
                {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {error && (
          <div className="mb-3">
            <ErrorState message={error} />
          </div>
        )}

        {isCreate ? (
          <div className="space-y-3">
            {(templatesQuery.data ?? []).length > 0 && (
              <div>
                <label className="field-label">התחלה מתבנית (לא חובה)</label>
                <select value={selectedTemplateId} onChange={(e) => applyTemplate(e.target.value)} className="input-field">
                  <option value="">— ללא —</option>
                  {(templatesQuery.data ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="field-label">כותרת</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="field-label">תיאור</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="input-field" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label">עדיפות</label>
                <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className="input-field">
                  {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">קטגוריה</label>
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input-field">
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
              <label className="field-label">תאריך יעד</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="field-label">אחראים</label>
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                {(usersQuery.data ?? []).map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedOwners.includes(u.id)}
                      onChange={(e) =>
                        setSelectedOwners((prev) => (e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id)))
                      }
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
                      checked={selectedTeams.includes(t.id)}
                      onChange={(e) =>
                        setSelectedTeams((prev) => (e.target.checked ? [...prev, t.id] : prev.filter((id) => id !== t.id)))
                      }
                    />
                    {t.label_he}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={close} className="btn-secondary text-sm">
                ביטול
              </button>
              <button onClick={handleCreate} disabled={saving} className="btn-primary text-sm">
                {saving ? "יוצרת…" : "יצירה"}
              </button>
            </div>
          </div>
        ) : taskQuery.isLoading ? (
          <LoadingState rows={5} />
        ) : !task ? (
          <ErrorState message="שגיאה בטעינת המשימה, או שאין לך הרשאה לצפות בה." />
        ) : (
          <>
            <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} ariaLabel="לשוניות משימה" />

            {activeTab === "details" && (
              <div className="space-y-3">
                <div>
                  <label className="field-label">כותרת</label>
                  <input
                    defaultValue={task.title}
                    disabled={!canEdit}
                    onBlur={(e) => e.target.value !== task.title && handleFieldSave({ title: e.target.value })}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="field-label">תיאור</label>
                  <textarea
                    defaultValue={task.description ?? ""}
                    disabled={!canEdit}
                    rows={3}
                    onBlur={(e) => e.target.value !== (task.description ?? "") && handleFieldSave({ description: e.target.value || null })}
                    className="input-field"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="field-label">עדיפות</label>
                    <select
                      value={task.priority}
                      disabled={!canEdit}
                      onChange={(e) => handleFieldSave({ priority: e.target.value as TaskPriority })}
                      className="input-field"
                    >
                      {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => (
                        <option key={p} value={p}>
                          {PRIORITY_LABEL[p]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="field-label">קטגוריה</label>
                    <select
                      value={task.category_id ?? ""}
                      disabled={!canEdit}
                      onChange={(e) => handleFieldSave({ category_id: e.target.value || null })}
                      className="input-field"
                    >
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
                  <label className="field-label">תאריך יעד</label>
                  <input
                    type="date"
                    value={task.due_date ?? ""}
                    disabled={!canEdit}
                    onChange={(e) => handleFieldSave({ due_date: e.target.value || null })}
                    className="input-field"
                  />
                </div>

                <div>
                  <label className="field-label">אחראים</label>
                  <div className="flex flex-wrap gap-1.5">
                    {(usersQuery.data ?? [])
                      .filter((u) => ownerIds.has(u.id))
                      .map((u) => (
                        <span key={u.id} className="inline-flex items-center gap-1 rounded-full bg-tasks-light px-2 py-0.5 text-xs text-tasks">
                          {u.full_name}
                          {canAssignUsers && (
                            <button onClick={() => toggleOwner(u.id, true)} aria-label={`הסר את ${u.full_name}`} title={`הסרת ${u.full_name} מהאחראים`} className="text-tasks/70 hover:text-tasks">
                              ✕
                            </button>
                          )}
                        </span>
                      ))}
                  </div>
                  {canAssignUsers && (
                    <select
                      value=""
                      onChange={(e) => e.target.value && toggleOwner(e.target.value, false)}
                      className="input-field mt-1.5 text-xs"
                    >
                      <option value="">+ הוספת אחראי</option>
                      {(usersQuery.data ?? [])
                        .filter((u) => !ownerIds.has(u.id))
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.full_name}
                          </option>
                        ))}
                    </select>
                  )}
                </div>

                <div>
                  <label className="field-label">צוותים</label>
                  <div className="flex flex-wrap gap-1.5">
                    {(teamsQuery.data ?? [])
                      .filter((t) => teamIds.has(t.id))
                      .map((t) => (
                        <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                          {t.label_he}
                          {canAssignTeams && (
                            <button onClick={() => toggleTeam(t.id, true)} aria-label={`הסר את ${t.label_he}`} title={`הסרת צוות ${t.label_he}`} className="text-slate-500 hover:text-slate-800">
                              ✕
                            </button>
                          )}
                        </span>
                      ))}
                  </div>
                  {canAssignTeams && (
                    <select
                      value=""
                      onChange={(e) => e.target.value && toggleTeam(e.target.value, false)}
                      className="input-field mt-1.5 text-xs"
                    >
                      <option value="">+ הוספת צוות</option>
                      {(teamsQuery.data ?? [])
                        .filter((t) => !teamIds.has(t.id))
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label_he}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
              </div>
            )}

            {activeTab === "checklist" && <TaskChecklistTab taskId={task.id} canEdit={canEdit} />}
            {activeTab === "reminders" && (
              <TaskRemindersTab taskId={task.id} canEdit={canEdit} userId={userId} hasDueDate={!!task.due_date} />
            )}
            {activeTab === "comments" && <TaskCommentsTab taskId={task.id} canEdit={canEdit} userId={userId} />}
            {activeTab === "links" && <TaskLinksTab taskId={task.id} canEdit={canEdit} userId={userId} />}
            {activeTab === "history" && <TaskHistoryTab taskId={task.id} />}
          </>
        )}
      </div>
    </div>
  );
}
