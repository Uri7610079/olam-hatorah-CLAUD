import { supabase } from "@/lib/supabase";
import { addDaysIso } from "./dateUtils";
import type {
  AssignableUser,
  DueReminder,
  RecurrenceFrequency,
  Task,
  TaskAttachment,
  TaskCategory,
  TaskChecklistItem,
  TaskComment,
  TaskHistoryEvent,
  TaskLink,
  TaskOwner,
  TaskPriority,
  TaskRecurrenceRule,
  TaskReminder,
  TaskStatus,
  TaskTeam,
  TaskTemplate,
  TaskTemplateChecklistItem,
  TaskWatcher,
  Team,
  WhatsAppGroup,
  WhatsAppMessage,
} from "./types";

export async function fetchAssignableUsers(): Promise<AssignableUser[]> {
  const { data, error } = await supabase.rpc("list_assignable_users");
  if (error) throw error;
  return data ?? [];
}

export async function fetchTeams(): Promise<Team[]> {
  const { data, error } = await supabase.from("teams").select("id, key, label_he, is_active").eq("is_active", true).order("label_he");
  if (error) throw error;
  return data ?? [];
}

export async function fetchCategories(): Promise<TaskCategory[]> {
  const { data, error } = await supabase
    .from("task_categories")
    .select("id, key, label_he, is_active")
    .eq("is_active", true)
    .order("label_he");
  if (error) throw error;
  return data ?? [];
}

export interface TaskWithRelations extends Task {
  owners: string[];
  team_ids: string[];
}

async function attachRelations(tasks: Task[]): Promise<TaskWithRelations[]> {
  if (tasks.length === 0) return [];
  const ids = tasks.map((t) => t.id);
  const [{ data: owners, error: ownersError }, { data: teams, error: teamsError }] = await Promise.all([
    supabase.from("task_owners").select("task_id, user_id").in("task_id", ids),
    supabase.from("task_teams").select("task_id, team_id").in("task_id", ids),
  ]);
  if (ownersError) throw ownersError;
  if (teamsError) throw teamsError;

  return tasks.map((t) => ({
    ...t,
    owners: (owners ?? []).filter((o) => o.task_id === t.id).map((o) => o.user_id),
    team_ids: (teams ?? []).filter((tm) => tm.task_id === t.id).map((tm) => tm.team_id),
  }));
}

const TASK_COLUMNS = "id, title, description, status, priority, category_id, parent_task_id, due_date, source, created_by, created_at, updated_at";

export async function fetchMyTasks(userId: string): Promise<TaskWithRelations[]> {
  const { data: ownedIds, error: ownedError } = await supabase.from("task_owners").select("task_id").eq("user_id", userId);
  if (ownedError) throw ownedError;
  const { data: watchedIds, error: watchedError } = await supabase.from("task_watchers").select("task_id").eq("user_id", userId);
  if (watchedError) throw watchedError;
  const ids = Array.from(new Set([...(ownedIds ?? []).map((r) => r.task_id), ...(watchedIds ?? []).map((r) => r.task_id)]));
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .in("id", ids)
    .not("status", "in", "(cancelled,archived)")
    .order("due_date", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return attachRelations(data ?? []);
}

export async function fetchAllTasks(): Promise<TaskWithRelations[]> {
  const { data, error } = await supabase.from("tasks").select(TASK_COLUMNS).order("created_at", { ascending: false });
  if (error) throw error;
  return attachRelations(data ?? []);
}

export async function fetchTeamTasks(teamIds: string[]): Promise<TaskWithRelations[]> {
  if (teamIds.length === 0) return [];
  const { data: links, error: linksError } = await supabase.from("task_teams").select("task_id").in("team_id", teamIds);
  if (linksError) throw linksError;
  const ids = Array.from(new Set((links ?? []).map((l) => l.task_id)));
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("tasks").select(TASK_COLUMNS).in("id", ids).order("due_date", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return attachRelations(data ?? []);
}

export async function fetchMyTeamIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase.from("team_members").select("team_id").eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((r) => r.team_id);
}

export interface CreateTaskInput {
  title: string;
  description: string | null;
  priority: TaskPriority;
  category_id: string | null;
  due_date: string | null;
  created_by: string;
  owner_ids: string[];
  team_ids: string[];
}

export async function createTask(input: CreateTaskInput): Promise<string> {
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title: input.title,
      description: input.description,
      priority: input.priority,
      category_id: input.category_id,
      due_date: input.due_date,
      created_by: input.created_by,
    })
    .select("id")
    .single();
  if (error) throw error;
  const taskId = data.id as string;

  // היוצר תמיד נכלל באחראים, גם אם לא סימן את עצמו בטופס - אחרת, אם יש לו רק
  // tasks.view_assigned (בלי view_team/view_all), הוא לא יכול לראות את המשימה שהוא עצמו
  // יצר (can_view_task דורש היות אחראי/צופה/צוות תואם) - נתפס בביקורת תקינות ייעודית.
  const ownerIds = Array.from(new Set([...input.owner_ids, input.created_by]));
  const { error: ownerError } = await supabase.from("task_owners").insert(ownerIds.map((user_id) => ({ task_id: taskId, user_id })));
  if (ownerError) throw ownerError;

  if (input.team_ids.length > 0) {
    const { error: teamError } = await supabase.from("task_teams").insert(input.team_ids.map((team_id) => ({ task_id: taskId, team_id })));
    if (teamError) throw teamError;
  }
  return taskId;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  category_id?: string | null;
  due_date?: string | null;
}

export async function updateTask(taskId: string, patch: UpdateTaskInput): Promise<void> {
  const { error } = await supabase.from("tasks").update(patch).eq("id", taskId);
  if (error) throw error;
}

export async function fetchTaskOwners(taskId: string): Promise<TaskOwner[]> {
  const { data, error } = await supabase.from("task_owners").select("id, task_id, user_id").eq("task_id", taskId);
  if (error) throw error;
  return data ?? [];
}

export async function addTaskOwner(taskId: string, userId: string): Promise<void> {
  const { error } = await supabase.from("task_owners").insert({ task_id: taskId, user_id: userId });
  if (error) throw error;
}

export async function removeTaskOwner(taskId: string, userId: string): Promise<void> {
  const { error } = await supabase.from("task_owners").delete().eq("task_id", taskId).eq("user_id", userId);
  if (error) throw error;
}

export async function fetchTaskTeams(taskId: string): Promise<TaskTeam[]> {
  const { data, error } = await supabase.from("task_teams").select("id, task_id, team_id").eq("task_id", taskId);
  if (error) throw error;
  return data ?? [];
}

export async function addTaskTeam(taskId: string, teamId: string): Promise<void> {
  const { error } = await supabase.from("task_teams").insert({ task_id: taskId, team_id: teamId });
  if (error) throw error;
}

export async function removeTaskTeam(taskId: string, teamId: string): Promise<void> {
  const { error } = await supabase.from("task_teams").delete().eq("task_id", taskId).eq("team_id", teamId);
  if (error) throw error;
}

export async function fetchTaskWatchers(taskId: string): Promise<TaskWatcher[]> {
  const { data, error } = await supabase.from("task_watchers").select("id, task_id, user_id, kind").eq("task_id", taskId);
  if (error) throw error;
  return data ?? [];
}

export async function addTaskWatcher(taskId: string, userId: string, kind: "watcher" | "participant"): Promise<void> {
  const { error } = await supabase.from("task_watchers").insert({ task_id: taskId, user_id: userId, kind });
  if (error) throw error;
}

export async function removeTaskWatcher(taskId: string, userId: string): Promise<void> {
  const { error } = await supabase.from("task_watchers").delete().eq("task_id", taskId).eq("user_id", userId);
  if (error) throw error;
}

export async function fetchChecklist(taskId: string): Promise<TaskChecklistItem[]> {
  const { data, error } = await supabase
    .from("task_checklist_items")
    .select("id, task_id, text, is_done, position")
    .eq("task_id", taskId)
    .order("position");
  if (error) throw error;
  return data ?? [];
}

export async function addChecklistItem(taskId: string, text: string, position: number): Promise<void> {
  const { error } = await supabase.from("task_checklist_items").insert({ task_id: taskId, text, position });
  if (error) throw error;
}

export async function toggleChecklistItem(id: string, isDone: boolean): Promise<void> {
  const { error } = await supabase.from("task_checklist_items").update({ is_done: isDone }).eq("id", id);
  if (error) throw error;
}

export async function deleteChecklistItem(id: string): Promise<void> {
  const { error } = await supabase.from("task_checklist_items").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchComments(taskId: string): Promise<TaskComment[]> {
  const { data, error } = await supabase
    .from("task_comments")
    .select("id, task_id, author_id, body, created_at, updated_at")
    .eq("task_id", taskId)
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}

export async function addComment(taskId: string, authorId: string, body: string): Promise<void> {
  const { error } = await supabase.from("task_comments").insert({ task_id: taskId, author_id: authorId, body });
  if (error) throw error;
}

export async function updateComment(id: string, body: string): Promise<void> {
  const { error } = await supabase.from("task_comments").update({ body }).eq("id", id);
  if (error) throw error;
}

export async function fetchAttachments(taskId: string): Promise<TaskAttachment[]> {
  const { data, error } = await supabase
    .from("task_attachments")
    .select("id, task_id, file_path, original_filename, uploaded_by, created_at")
    .eq("task_id", taskId)
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}

export async function uploadAttachment(taskId: string, userId: string, file: File): Promise<void> {
  const path = `${taskId}/${Date.now()}_${file.name}`;
  const { error: uploadError } = await supabase.storage.from("task-attachments").upload(path, file);
  if (uploadError) throw uploadError;
  const { error } = await supabase
    .from("task_attachments")
    .insert({ task_id: taskId, file_path: path, original_filename: file.name, uploaded_by: userId });
  if (error) throw error;
}

export async function getAttachmentUrl(filePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from("task-attachments").createSignedUrl(filePath, 60 * 10);
  if (error) return null;
  return data.signedUrl;
}

export async function deleteAttachment(id: string, filePath: string): Promise<void> {
  const { error } = await supabase.from("task_attachments").delete().eq("id", id);
  if (error) throw error;
  await supabase.storage.from("task-attachments").remove([filePath]);
}

export async function fetchLinks(taskId: string): Promise<TaskLink[]> {
  const { data, error } = await supabase.from("task_links").select("id, task_id, entity_type, entity_id, created_at").eq("task_id", taskId);
  if (error) throw error;
  return data ?? [];
}

export async function addLink(taskId: string, createdBy: string, entityType: string, entityId: string): Promise<void> {
  const { error } = await supabase.from("task_links").insert({ task_id: taskId, entity_type: entityType, entity_id: entityId, created_by: createdBy });
  if (error) throw error;
}

export async function removeLink(id: string): Promise<void> {
  const { error } = await supabase.from("task_links").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchHistory(taskId: string): Promise<TaskHistoryEvent[]> {
  const { data, error } = await supabase
    .from("task_history")
    .select("id, task_id, actor_id, event_type, detail, created_at")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// חיפוש קצר לישויות נפוצות (4 מתוך 14 סוגי הישות ב-task_links) - עמותה/סניף/קבוצה/תלמיד
// נבחרו כי הם השימוש הנפוץ ביותר לפי האפיון. שאר הסוגים נתמכים ב-DB אך ללא Picker
// ייעודי בשלב הזה - היקף בסיסי, לא פער אבטחה (RLS על task_links לא תלוי בזה).
export async function searchLinkableEntities(entityType: string, term: string): Promise<{ id: string; label: string }[]> {
  const needle = `%${term}%`;
  if (entityType === "organization") {
    const { data, error } = await supabase.from("organizations").select("id, legal_name").ilike("legal_name", needle).limit(10);
    if (error) throw error;
    return (data ?? []).map((r) => ({ id: r.id, label: r.legal_name }));
  }
  if (entityType === "branch") {
    const { data, error } = await supabase.from("branches").select("id, internal_name").ilike("internal_name", needle).limit(10);
    if (error) throw error;
    return (data ?? []).map((r) => ({ id: r.id, label: r.internal_name }));
  }
  if (entityType === "group") {
    const { data, error } = await supabase.from("groups").select("id, name").ilike("name", needle).limit(10);
    if (error) throw error;
    return (data ?? []).map((r) => ({ id: r.id, label: r.name }));
  }
  if (entityType === "student") {
    const { data, error } = await supabase.from("students").select("id, full_name").ilike("full_name", needle).limit(10);
    if (error) throw error;
    return (data ?? []).map((r) => ({ id: r.id, label: r.full_name }));
  }
  return [];
}

// ---------------------------------------------------------------------------
// תזכורות
// ---------------------------------------------------------------------------

export async function fetchReminders(taskId: string): Promise<TaskReminder[]> {
  const { data, error } = await supabase
    .from("task_reminders")
    .select("id, task_id, user_id, remind_at, days_before_due, snoozed_until, is_dismissed")
    .eq("task_id", taskId)
    .order("remind_at");
  if (error) throw error;
  return data ?? [];
}

export interface CreateReminderInput {
  taskId: string;
  createdBy: string;
  userId: string | null;
  remindAt: string | null;
  daysBeforeDue: number | null;
}

export async function addReminder(input: CreateReminderInput): Promise<void> {
  const { error } = await supabase.from("task_reminders").insert({
    task_id: input.taskId,
    user_id: input.userId,
    remind_at: input.remindAt,
    days_before_due: input.daysBeforeDue,
    created_by: input.createdBy,
  });
  if (error) throw error;
}

export async function deleteReminder(id: string): Promise<void> {
  const { error } = await supabase.from("task_reminders").delete().eq("id", id);
  if (error) throw error;
}

export async function snoozeReminder(id: string, snoozedUntil: string): Promise<void> {
  const { error } = await supabase.rpc("snooze_reminder", { p_reminder_id: id, p_snoozed_until: snoozedUntil });
  if (error) throw error;
}

export async function dismissReminder(id: string): Promise<void> {
  const { error } = await supabase.rpc("dismiss_reminder", { p_reminder_id: id });
  if (error) throw error;
}

export async function fetchDueReminders(): Promise<DueReminder[]> {
  const { data, error } = await supabase.rpc("due_reminders_for_me");
  if (error) throw error;
  return data ?? [];
}

// ---------------------------------------------------------------------------
// משימות חוזרות
// ---------------------------------------------------------------------------

const RECURRENCE_COLUMNS =
  "id, title, description, category_id, priority, frequency, day_of_week, day_of_month, interval_days, start_date, end_date, create_next_even_if_previous_incomplete, reminder_days_before_due, is_active, last_generated_date";

export async function fetchRecurrenceRules(): Promise<TaskRecurrenceRule[]> {
  const { data, error } = await supabase.from("task_recurrence_rules").select(RECURRENCE_COLUMNS).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export interface CreateRecurrenceRuleInput {
  title: string;
  description: string | null;
  category_id: string | null;
  priority: TaskPriority;
  frequency: RecurrenceFrequency;
  day_of_week: number | null;
  day_of_month: number | null;
  interval_days: number | null;
  start_date: string;
  end_date: string | null;
  create_next_even_if_previous_incomplete: boolean;
  reminder_days_before_due: number | null;
  created_by: string;
  owner_ids: string[];
  team_ids: string[];
}

export async function createRecurrenceRule(input: CreateRecurrenceRuleInput): Promise<void> {
  const { owner_ids, team_ids, created_by, ...rule } = input;
  const { data, error } = await supabase.from("task_recurrence_rules").insert({ ...rule, created_by }).select("id").single();
  if (error) throw error;
  const ruleId = data.id as string;
  if (owner_ids.length > 0) {
    const { error: ownerError } = await supabase.from("task_recurrence_owners").insert(owner_ids.map((user_id) => ({ rule_id: ruleId, user_id })));
    if (ownerError) throw ownerError;
  }
  if (team_ids.length > 0) {
    const { error: teamError } = await supabase.from("task_recurrence_teams").insert(team_ids.map((team_id) => ({ rule_id: ruleId, team_id })));
    if (teamError) throw teamError;
  }
}

export async function toggleRecurrenceRuleActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.from("task_recurrence_rules").update({ is_active: isActive }).eq("id", id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

export async function fetchWhatsAppGroups(): Promise<WhatsAppGroup[]> {
  const { data, error } = await supabase.from("whatsapp_groups").select("id, provider, external_group_id, label, team_id, is_active").order("label");
  if (error) throw error;
  return data ?? [];
}

export async function addWhatsAppGroup(
  createdBy: string,
  externalGroupId: string,
  label: string,
  teamId: string | null,
  provider: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("whatsapp_groups")
    .insert({ external_group_id: externalGroupId, label, team_id: teamId, created_by: createdBy, provider });
  if (error) throw error;
}

export async function toggleWhatsAppGroupActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.from("whatsapp_groups").update({ is_active: isActive }).eq("id", id);
  if (error) throw error;
}

export async function fetchWhatsAppMessages(): Promise<WhatsAppMessage[]> {
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select("id, group_id, source_message_id, sender_name, body, attachment_url, received_at, status, converted_task_id")
    .order("received_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function markWhatsAppMessageNotATask(id: string): Promise<void> {
  const { error } = await supabase.rpc("mark_whatsapp_message_not_a_task", { p_message_id: id });
  if (error) throw error;
}

export interface ConvertWhatsAppInput {
  messageId: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  ownerIds: string[];
  teamIds: string[];
}

export async function convertWhatsAppMessageToTask(input: ConvertWhatsAppInput): Promise<string> {
  const { data, error } = await supabase.rpc("convert_whatsapp_message_to_task", {
    p_message_id: input.messageId,
    p_title: input.title,
    p_description: input.description,
    p_due_date: input.dueDate,
    p_owner_ids: input.ownerIds,
    p_team_ids: input.teamIds,
  });
  if (error) throw error;
  return data as string;
}

// ---------------------------------------------------------------------------
// תבניות
// ---------------------------------------------------------------------------

export async function fetchTemplates(activeOnly = true): Promise<TaskTemplate[]> {
  let query = supabase.from("task_templates").select("id, title, description, category_id, priority, due_in_days, is_active").order("title");
  if (activeOnly) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function fetchTemplateChecklist(templateId: string): Promise<TaskTemplateChecklistItem[]> {
  const { data, error } = await supabase
    .from("task_template_checklist_items")
    .select("id, template_id, text, position")
    .eq("template_id", templateId)
    .order("position");
  if (error) throw error;
  return data ?? [];
}

export interface CreateTemplateInput {
  title: string;
  description: string | null;
  category_id: string | null;
  priority: TaskPriority;
  due_in_days: number | null;
  created_by: string;
  checklistItems: string[];
}

export async function createTemplate(input: CreateTemplateInput): Promise<void> {
  const { checklistItems, created_by, ...rest } = input;
  const { data, error } = await supabase.from("task_templates").insert({ ...rest, created_by }).select("id").single();
  if (error) throw error;
  const templateId = data.id as string;
  if (checklistItems.length > 0) {
    const { error: itemsError } = await supabase
      .from("task_template_checklist_items")
      .insert(checklistItems.map((text, position) => ({ template_id: templateId, text, position })));
    if (itemsError) throw itemsError;
  }
}

export async function toggleTemplateActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.from("task_templates").update({ is_active: isActive }).eq("id", id);
  if (error) throw error;
}

// יצירת משימה מתבנית: כותרת/תיאור/קטגוריה/עדיפות/יעד יחסי מהתבנית + Checklist מועתק.
// לא RPC ייעודי - שתי כתיבות פשוטות ברצף (כמו createTask הרגיל), אין כאן טרנזקציה
// עסקית קריטית שדורשת אטומיות ברמת ה-DB.
export async function createTaskFromTemplate(
  template: TaskTemplate,
  checklistItems: TaskTemplateChecklistItem[],
  createdBy: string,
  ownerIds: string[],
  teamIds: string[],
): Promise<string> {
  const dueDate = template.due_in_days !== null ? addDaysIso(template.due_in_days) : null;
  const taskId = await createTask({
    title: template.title,
    description: template.description,
    priority: template.priority,
    category_id: template.category_id,
    due_date: dueDate,
    created_by: createdBy,
    owner_ids: ownerIds,
    team_ids: teamIds,
  });
  if (checklistItems.length > 0) {
    const { error } = await supabase
      .from("task_checklist_items")
      .insert(checklistItems.map((item, position) => ({ task_id: taskId, text: item.text, position })));
    if (error) throw error;
  }
  return taskId;
}
