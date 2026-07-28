export type TaskStatus =
  | "draft"
  | "open"
  | "in_progress"
  | "waiting"
  | "blocked"
  | "completed"
  | "cancelled"
  | "archived";

export type TaskPriority = "low" | "normal" | "high" | "urgent";

export const STATUS_LABEL: Record<TaskStatus, string> = {
  draft: "טיוטה",
  open: "פתוחה",
  in_progress: "בטיפול",
  waiting: "ממתינה",
  blocked: "חסומה",
  completed: "הושלמה",
  cancelled: "בוטלה",
  archived: "בארכיון",
};

export const STATUS_SEVERITY: Record<TaskStatus, "critical" | "high" | "medium" | "ok" | "neutral"> = {
  draft: "neutral",
  open: "neutral",
  in_progress: "medium",
  waiting: "medium",
  blocked: "high",
  completed: "ok",
  cancelled: "neutral",
  archived: "neutral",
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "נמוכה",
  normal: "רגילה",
  high: "גבוהה",
  urgent: "דחופה",
};

// עדיפות משמשת לסידור עבודה בלבד - לא למדידת עובד (סעיף 9 באפיון). אין "severity"
// אדום/צהוב/ירוק מקושר אליה בכוונה, כדי לא ליצור רושם של "ציון" למשימה/לעובד.

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  category_id: string | null;
  parent_task_id: string | null;
  due_date: string | null;
  source: "manual" | "whatsapp" | "template" | "automation";
  created_by: string;
  created_at: string;
  updated_at: string | null;
}

export interface TaskCategory {
  id: string;
  key: string;
  label_he: string;
  is_active: boolean;
}

export interface Team {
  id: string;
  key: string;
  label_he: string;
  is_active: boolean;
}

export interface AssignableUser {
  id: string;
  full_name: string;
}

export interface TaskOwner {
  id: string;
  task_id: string;
  user_id: string;
}

export interface TaskTeam {
  id: string;
  task_id: string;
  team_id: string;
}

export interface TaskWatcher {
  id: string;
  task_id: string;
  user_id: string;
  kind: "watcher" | "participant";
}

export interface TaskChecklistItem {
  id: string;
  task_id: string;
  text: string;
  is_done: boolean;
  position: number;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_id: string;
  body: string;
  created_at: string;
  updated_at: string | null;
}

export interface TaskAttachment {
  id: string;
  task_id: string;
  file_path: string;
  original_filename: string;
  uploaded_by: string;
  created_at: string;
}

export const ENTITY_TYPE_LABEL: Record<string, string> = {
  organization: "עמותה",
  branch: "סניף",
  group: "קבוצה",
  student: "תלמיד",
  document: "מסמך",
  import_batch: "אצוות יבוא",
  talmud_error: "שגיאת תלמוד",
  financial_period: "חודש כספי",
  donation: "תרומה",
  distribution_batch: "חלוקה",
  masav_batch: "מס\"ב",
  bank_transaction: "תנועת בנק",
  bank_match: "התאמת בנק",
  audit: "ביקורת",
};

export interface TaskLink {
  id: string;
  task_id: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
}

export interface TaskHistoryEvent {
  id: string;
  task_id: string;
  actor_id: string | null;
  event_type: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface TaskReminder {
  id: string;
  task_id: string;
  user_id: string | null;
  remind_at: string | null;
  days_before_due: number | null;
  snoozed_until: string | null;
  is_dismissed: boolean;
}

export interface DueReminder {
  id: string;
  task_id: string;
  task_title: string;
  effective_at: string;
}

export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly" | "custom";

export const FREQUENCY_LABEL: Record<RecurrenceFrequency, string> = {
  daily: "יומית",
  weekly: "שבועית",
  monthly: "חודשית",
  yearly: "שנתית",
  custom: "מותאם (כל N ימים)",
};

export const DAY_OF_WEEK_LABEL = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export interface TaskRecurrenceRule {
  id: string;
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
  is_active: boolean;
  last_generated_date: string | null;
}

export interface WhatsAppGroup {
  id: string;
  provider: string | null;
  external_group_id: string;
  label: string;
  team_id: string | null;
  is_active: boolean;
}

export type WhatsAppMessageStatus = "pending" | "converted" | "not_a_task";

export interface WhatsAppMessage {
  id: string;
  group_id: string;
  source_message_id: string;
  sender_name: string | null;
  body: string | null;
  attachment_url: string | null;
  received_at: string;
  status: WhatsAppMessageStatus;
  converted_task_id: string | null;
}

export interface TaskTemplate {
  id: string;
  title: string;
  description: string | null;
  category_id: string | null;
  priority: TaskPriority;
  due_in_days: number | null;
  is_active: boolean;
}

export interface TaskTemplateChecklistItem {
  id: string;
  template_id: string;
  text: string;
  position: number;
}

export const HISTORY_EVENT_LABEL: Record<string, string> = {
  created: "נוצרה",
  status_changed: "שינוי סטטוס",
  owner_added: "אחראי נוסף",
  owner_removed: "אחראי הוסר",
  team_added: "צוות נוסף",
  team_removed: "צוות הוסר",
  due_date_changed: "שינוי תאריך יעד",
  completed: "הושלמה",
  cancelled: "בוטלה",
  reopened: "נפתחה מחדש",
  converted_from_whatsapp: "הומרה מהודעת WhatsApp",
};
