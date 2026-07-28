-- שלב 22: מודול "ניהול משימות" - תבניות משימה.
-- מקור: אפיון V2 §16 (רק תבניות - אוטומציות על אירועי-מערכת שרירותיים נדחו במכוון,
-- ר' TASKS_MODULE_PLAN.md/README: לוח-זמנים כבר מכוסה ע"י משימות חוזרות משלב 20,
-- ו"אירוע מקור" גנרי דורש תשתית triggers רוחבית על כל המערכת שלא הוגדרה באפיון בפירוט
-- מספיק כדי לבנות בלי להמציא כללים).

create table task_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category_id uuid references task_categories(id),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  -- יעד יחסי מרגע יצירת המשימה מהתבנית (סעיף 16: "יעד יחסי") - לא תאריך מוחלט.
  due_in_days integer,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger task_templates_set_updated_at
  before update on task_templates
  for each row execute function set_updated_at();

create table task_template_checklist_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references task_templates(id) on delete cascade,
  text text not null,
  position integer not null default 0
);

alter table task_templates enable row level security;
alter table task_template_checklist_items enable row level security;

create policy task_templates_select on task_templates for select to authenticated using (has_permission('area_tasks', 'access'));
create policy task_templates_manage on task_templates for all to authenticated
  using (has_permission('tasks', 'manage_templates'))
  with check (has_permission('tasks', 'manage_templates'));

create policy task_template_checklist_items_select on task_template_checklist_items for select to authenticated using (has_permission('area_tasks', 'access'));
create policy task_template_checklist_items_manage on task_template_checklist_items for all to authenticated
  using (has_permission('tasks', 'manage_templates'))
  with check (has_permission('tasks', 'manage_templates'));

create trigger task_templates_audit after insert or update on task_templates for each row execute function audit_table_change();
