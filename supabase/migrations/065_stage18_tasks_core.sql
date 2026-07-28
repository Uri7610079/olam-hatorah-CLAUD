-- שלב 18: מודול "ניהול משימות" - ליבה: מסד נתונים, הרשאות ו-RLS.
-- מקור: אפיון_מקצועי_משימות_ותזכורות_עולם_התורה_V2.docx (גרסה 2.0). ר' TASKS_MODULE_PLAN.md.
--
-- החלטות עיצוב מרכזיות (לתיעוד, לא לשינוי בלי לחזור לאפיון):
-- 1. אין בטבלאות המודול הזה עמודות is_demo/demo_batch_id בכלל - האפיון דורש זאת במפורש
--    (section 10, 25). המודול לא נכנס לרשימת ה-19 הטבלאות ב-delete_demo_batch()/
--    preview_demo_batch_deletion() (052) ואסור להוסיף אותו לשם.
-- 2. אין הענקת הרשאות תפקיד אוטומטית לשום תפקיד עסקי - רק system_admin (כמו בכל שאר
--    המערכת, זהו "סופר-משתמש" טכני ולא תפקיד עסקי). שאר ההרשאות מוגדרות ידנית ממסך
--    הניהול הקיים כבר היום (/admin/users -> UserPermissionsDrawer, שקוראת מ-permissions
--    באופן גנרי לגמרי - ההרשאות החדשות כאן יופיעו שם אוטומטית, בלי לגעת ב-UI).
-- 3. "צוותים" הוא קונסטרוקט חדש לגמרי שלא קיים היום במערכת (אין team_id בשום מקום).
--    לפי השימוש בפועל שתואר (Chani): שלוש קבוצות שיוך - אורי (מנהל), כללי, משה-תפעול.
--    נזרעות כשלוש שורות ריקות; שיוך משתמשים בפועל ל-team_members ייעשה ממסך /tasks/settings
--    בשלב 19 (לא מנחשים כאן מזהי משתמשים מתוך migration).
-- 4. תצוגת "מי רואה מה" מרוכזת בפונקציה אחת - can_view_task() - כדי לא לשכפל את הביטוי
--    המשולש (view_all / view_team / view_assigned) בשמונה טבלאות שונות בנפרד.
-- 5. עריכה/צפייה בכל טבלת-בת (checklist/comments/attachments/links/watchers/owners/teams)
--    נשענת תמיד על can_view_task()/can_edit_task() של המשימה עצמה - קישור למשימה לא
--    "בורח" מהרשאות המשימה.
-- 6. task_history הוא append-only (כמו audit_events) - נכתב רק מטריגרים SECURITY DEFINER,
--    אין למשתמש שום דרך לכתוב/לשנות/למחוק שורה בו ישירות.

-- ---------------------------------------------------------------------------
-- הרשאות
-- ---------------------------------------------------------------------------

insert into permissions (resource, action, label_he) values
  ('area_tasks', 'access', 'גישה לאזור ניהול משימות'),
  ('tasks', 'view_assigned', 'צפייה במשימות שהמשתמש אחראי עליהן'),
  ('tasks', 'view_team', 'צפייה במשימות צוותים מורשים'),
  ('tasks', 'view_all', 'צפייה רוחבית בכל המשימות'),
  ('tasks', 'create', 'יצירת משימה'),
  ('tasks', 'edit', 'עריכת משימות מורשות'),
  ('tasks', 'assign_users', 'שיוך משתמשים למשימה'),
  ('tasks', 'assign_teams', 'שיוך צוותים למשימה'),
  ('tasks', 'complete', 'השלמת משימה'),
  ('tasks', 'reopen', 'פתיחה מחדש'),
  ('tasks', 'manage_templates', 'ניהול תבניות'),
  ('tasks', 'manage_settings', 'ניהול קטגוריות, צוותים והגדרות'),
  ('tasks', 'manage_whatsapp', 'חיבור וניהול קבוצות WhatsApp'),
  ('tasks', 'convert_whatsapp', 'המרת הודעה שנקלטה למשימה');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p
  on p.resource in ('area_tasks', 'tasks')
where r.key = 'system_admin';

-- ---------------------------------------------------------------------------
-- צוותים
-- ---------------------------------------------------------------------------

create table teams (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label_he text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger teams_set_updated_at
  before update on teams
  for each row execute function set_updated_at();

create table team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (team_id, user_id)
);

-- שלוש קבוצות השיוך בפועל (Chani, בעקבות הביקורת על האפיון) - חברות בפועל תתווסף
-- ידנית דרך מסך ההגדרות בשלב 19, לא כאן.
insert into teams (key, label_he) values
  ('uri', 'אורי'),
  ('general', 'כללי'),
  ('moshe_ops', 'משה - תפעול');

alter table teams enable row level security;
alter table team_members enable row level security;

create policy teams_select on teams for select to authenticated
  using (has_permission('area_tasks', 'access'));

create policy teams_manage on teams for all to authenticated
  using (has_permission('tasks', 'manage_settings'))
  with check (has_permission('tasks', 'manage_settings'));

create policy team_members_select on team_members for select to authenticated
  using (has_permission('area_tasks', 'access'));

create policy team_members_manage on team_members for all to authenticated
  using (has_permission('tasks', 'manage_settings'))
  with check (has_permission('tasks', 'manage_settings'));

create trigger teams_audit after insert or update on teams for each row execute function audit_table_change();

-- ---------------------------------------------------------------------------
-- קטגוריות
-- ---------------------------------------------------------------------------

create table task_categories (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label_he text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger task_categories_set_updated_at
  before update on task_categories
  for each row execute function set_updated_at();

-- דוגמאות בסיס מסעיף 7 באפיון (לא רשימה סגורה - ניתנות לעריכה/הוספה ממסך ההגדרות).
insert into task_categories (key, label_he) values
  ('general', 'כללי'),
  ('missing_info', 'השלמת חסר'),
  ('check', 'בדיקה'),
  ('follow_up', 'מעקב'),
  ('process_step', 'שלב בתהליך'),
  ('exception_handling', 'טיפול בחריגה');

alter table task_categories enable row level security;

create policy task_categories_select on task_categories for select to authenticated
  using (has_permission('area_tasks', 'access'));

create policy task_categories_manage on task_categories for all to authenticated
  using (has_permission('tasks', 'manage_settings'))
  with check (has_permission('tasks', 'manage_settings'));

create trigger task_categories_audit after insert or update on task_categories for each row execute function audit_table_change();

-- ---------------------------------------------------------------------------
-- משימות (טבלת ליבה)
-- ---------------------------------------------------------------------------

create table tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'open'
    check (status in ('draft', 'open', 'in_progress', 'waiting', 'blocked', 'completed', 'cancelled', 'archived')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  category_id uuid references task_categories(id),
  parent_task_id uuid references tasks(id),
  due_date date,
  -- source: מקור המשימה (סעיף 12). וואטסאפ/חזרות מתווספים בעמודות ייעודיות בשלבים 20-21
  -- (alter table בהמשך) - לא מומצאים כאן מראש.
  source text not null default 'manual' check (source in ('manual', 'whatsapp', 'template', 'automation')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger tasks_set_updated_at
  before update on tasks
  for each row execute function set_updated_at();

create index tasks_status_idx on tasks (status);
create index tasks_due_date_idx on tasks (due_date);
create index tasks_parent_idx on tasks (parent_task_id);

create table task_owners (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (task_id, user_id)
);

create table task_teams (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (task_id, team_id)
);

-- צופים (view בלבד) ומשתתפים (מעורבים, לא אחראים לביצוע) - סעיף 10.3. אף אחד מהם
-- לא הופך אוטומטית לאחראי (task_owners נשאר נפרד).
create table task_watchers (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'watcher' check (kind in ('watcher', 'participant')),
  created_at timestamptz not null default now(),
  unique (task_id, user_id)
);

create index task_owners_user_idx on task_owners (user_id);
create index task_teams_team_idx on task_teams (team_id);
create index task_watchers_user_idx on task_watchers (user_id);

create table task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  text text not null,
  is_done boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger task_checklist_items_set_updated_at
  before update on task_checklist_items
  for each row execute function set_updated_at();

-- הערות ניתנות לעריכה ללא הגבלת זמן (סעיף 19/22) - "נערך" מוצג ב-UI כש-updated_at not null,
-- אין צורך בעמודה נפרדת. עריכה מוגבלת בהמשך ב-RLS: המחבר עצמו, או מי שיש לו tasks.edit.
create table task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger task_comments_set_updated_at
  before update on task_comments
  for each row execute function set_updated_at();

create table task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  file_path text not null,
  original_filename text not null,
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- קישור פולימורפי לישויות קיימות (סעיף 17) - entity_id בלי FK אמיתי (לא ניתן FK יחיד
-- מול טבלאות מרובות); הרשאה לראות את המשימה אינה מעניקה הרשאה לראות את הישות המקושרת -
-- ה-RLS של הישות המקורית (למשל students/donations_view) נשאר בתוקף בפני עצמו, ללא קשר.
create table task_links (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  entity_type text not null check (entity_type in (
    'organization', 'branch', 'group', 'student', 'document', 'import_batch',
    'talmud_error', 'financial_period', 'donation', 'distribution_batch',
    'masav_batch', 'bank_transaction', 'bank_match', 'audit'
  )),
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  unique (task_id, entity_type, entity_id)
);

create index task_links_entity_idx on task_links (entity_type, entity_id);

-- יומן שינויים מינימלי (סעיף 20) - append-only, כמו audit_events (003). לתפעול/שחזור
-- תקלה/הבנת מצב משימה בלבד - לא לניתוח ביצועי עובדים, לא לחישוב זמני טיפול.
create table task_history (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  actor_id uuid references auth.users(id),
  event_type text not null check (event_type in (
    'created', 'status_changed', 'owner_added', 'owner_removed',
    'team_added', 'team_removed', 'due_date_changed',
    'completed', 'cancelled', 'reopened', 'converted_from_whatsapp'
  )),
  detail jsonb,
  created_at timestamptz not null default now()
);

create index task_history_task_idx on task_history (task_id, created_at);

create or replace function block_task_history_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'task_history is append-only: % not allowed', tg_op;
end;
$$;

create trigger task_history_no_update before update on task_history for each row execute function block_task_history_mutation();
create trigger task_history_no_delete before delete on task_history for each row execute function block_task_history_mutation();

-- ---------------------------------------------------------------------------
-- פונקציות "מי רואה מה" - נקודה אחת יחידה לכלל הראות (view_all/view_team/view_assigned)
-- ---------------------------------------------------------------------------

create or replace function can_view_task(p_task_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if has_permission('tasks', 'view_all') then
    return true;
  end if;

  if has_permission('tasks', 'view_team') and exists (
    select 1 from task_teams tt
    join team_members tm on tm.team_id = tt.team_id
    where tt.task_id = p_task_id and tm.user_id = auth.uid()
  ) then
    return true;
  end if;

  if has_permission('tasks', 'view_assigned') and (
    exists (select 1 from task_owners too where too.task_id = p_task_id and too.user_id = auth.uid())
    or exists (select 1 from task_watchers tw where tw.task_id = p_task_id and tw.user_id = auth.uid())
  ) then
    return true;
  end if;

  return false;
end;
$$;

grant execute on function can_view_task(uuid) to authenticated;

create or replace function can_edit_task(p_task_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return has_permission('tasks', 'edit') and can_view_task(p_task_id);
end;
$$;

grant execute on function can_edit_task(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- טריגר: אכיפת מעברי סטטוס רגישים (complete/reopen דורשים הרשאה ייעודית, לא רק tasks.edit)
-- אותו דפוס בדיוק כמו enforce_group_leader_transition/enforce_distribution_lines_mutation
-- בשאר המערכת - השוואת OLD מול NEW לא ניתנת לביטוי יחיד ב-RLS (using/with check רואים
-- רק שורה אחת כל אחד), ולכן חסימת המעבר הספציפי נאכפת כאן, בטריגר, לא ב-policy.
create or replace function enforce_task_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if new.status = 'completed' and not has_permission('tasks', 'complete') then
    raise exception 'permission denied: tasks.complete required to complete a task';
  end if;

  if old.status in ('completed', 'cancelled') and new.status not in ('completed', 'cancelled') and not has_permission('tasks', 'reopen') then
    raise exception 'permission denied: tasks.reopen required to reopen a task';
  end if;

  return new;
end;
$$;

create trigger tasks_enforce_status_transition
  before update on tasks
  for each row execute function enforce_task_status_transition();

-- ---------------------------------------------------------------------------
-- טריגרים: כתיבת task_history אוטומטית (SECURITY DEFINER - עוקף RLS על task_history עצמו,
-- כי אין policy שמתירה למשתמש לכתוב לשם ישירות; אותו עיקרון כמו insert_audit_event).
-- ---------------------------------------------------------------------------

create or replace function log_task_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into task_history (task_id, actor_id, event_type, detail)
  values (new.id, auth.uid(), 'created', jsonb_build_object('title', new.title));
  return new;
end;
$$;

create trigger tasks_log_created after insert on tasks for each row execute function log_task_created();

create or replace function log_task_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into task_history (task_id, actor_id, event_type, detail)
    values (
      new.id, auth.uid(),
      case
        when new.status = 'completed' then 'completed'
        when new.status = 'cancelled' then 'cancelled'
        when old.status in ('completed', 'cancelled') then 'reopened'
        else 'status_changed'
      end,
      jsonb_build_object('from', old.status, 'to', new.status)
    );
  end if;

  if new.due_date is distinct from old.due_date then
    insert into task_history (task_id, actor_id, event_type, detail)
    values (new.id, auth.uid(), 'due_date_changed', jsonb_build_object('from', old.due_date, 'to', new.due_date));
  end if;

  return new;
end;
$$;

create trigger tasks_log_updated after update on tasks for each row execute function log_task_updated();

create or replace function log_task_owner_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into task_history (task_id, actor_id, event_type, detail)
    values (new.task_id, auth.uid(), 'owner_added', jsonb_build_object('user_id', new.user_id));
    return new;
  else
    insert into task_history (task_id, actor_id, event_type, detail)
    values (old.task_id, auth.uid(), 'owner_removed', jsonb_build_object('user_id', old.user_id));
    return old;
  end if;
end;
$$;

create trigger task_owners_log after insert or delete on task_owners for each row execute function log_task_owner_change();

create or replace function log_task_team_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into task_history (task_id, actor_id, event_type, detail)
    values (new.task_id, auth.uid(), 'team_added', jsonb_build_object('team_id', new.team_id));
    return new;
  else
    insert into task_history (task_id, actor_id, event_type, detail)
    values (old.task_id, auth.uid(), 'team_removed', jsonb_build_object('team_id', old.team_id));
    return old;
  end if;
end;
$$;

create trigger task_teams_log after insert or delete on task_teams for each row execute function log_task_team_change();

-- ---------------------------------------------------------------------------
-- RLS: tasks
-- ---------------------------------------------------------------------------

alter table tasks enable row level security;

create policy tasks_select on tasks for select to authenticated using (can_view_task(id));

create policy tasks_insert on tasks for insert to authenticated
  with check (has_permission('tasks', 'create') and created_by = auth.uid());

create policy tasks_update on tasks for update to authenticated
  using (can_edit_task(id))
  with check (can_edit_task(id));

-- אין policy ל-delete בכלל (deny by default) - האפיון לא מזכיר מחיקת משימה, רק
-- ביטול/העברה לארכיון כסטטוס. מחיקה פיזית לא נתמכת בכוונה.

create trigger tasks_audit after insert or update on tasks for each row execute function audit_table_change();

-- ---------------------------------------------------------------------------
-- RLS: טבלאות-בת - כולן נשענות על can_view_task/can_edit_task של המשימה, לא על policy עצמאית
-- ---------------------------------------------------------------------------

alter table task_owners enable row level security;
alter table task_teams enable row level security;
alter table task_watchers enable row level security;
alter table task_checklist_items enable row level security;
alter table task_comments enable row level security;
alter table task_attachments enable row level security;
alter table task_links enable row level security;
alter table task_history enable row level security;

create policy task_owners_select on task_owners for select to authenticated using (can_view_task(task_id));
create policy task_owners_manage on task_owners for all to authenticated
  using (has_permission('tasks', 'assign_users') and can_view_task(task_id))
  with check (has_permission('tasks', 'assign_users') and can_view_task(task_id));

create policy task_teams_select on task_teams for select to authenticated using (can_view_task(task_id));
create policy task_teams_manage on task_teams for all to authenticated
  using (has_permission('tasks', 'assign_teams') and can_view_task(task_id))
  with check (has_permission('tasks', 'assign_teams') and can_view_task(task_id));

create policy task_watchers_select on task_watchers for select to authenticated using (can_view_task(task_id));
create policy task_watchers_manage on task_watchers for all to authenticated
  using (can_edit_task(task_id))
  with check (can_edit_task(task_id));

create policy task_checklist_items_select on task_checklist_items for select to authenticated using (can_view_task(task_id));
create policy task_checklist_items_manage on task_checklist_items for all to authenticated
  using (can_edit_task(task_id))
  with check (can_edit_task(task_id));

create policy task_comments_select on task_comments for select to authenticated using (can_view_task(task_id));

create policy task_comments_insert on task_comments for insert to authenticated
  with check (can_view_task(task_id) and author_id = auth.uid());

-- עריכת הערה: המחבר עצמו תמיד יכול (ללא הגבלת זמן, סעיף 19/22), או מי שיש לו tasks.edit.
create policy task_comments_update on task_comments for update to authenticated
  using (can_view_task(task_id) and (author_id = auth.uid() or has_permission('tasks', 'edit')))
  with check (can_view_task(task_id) and (author_id = auth.uid() or has_permission('tasks', 'edit')));

create policy task_attachments_select on task_attachments for select to authenticated using (can_view_task(task_id));
create policy task_attachments_insert on task_attachments for insert to authenticated
  with check (can_view_task(task_id) and uploaded_by = auth.uid());
create policy task_attachments_delete on task_attachments for delete to authenticated
  using (can_view_task(task_id) and (uploaded_by = auth.uid() or has_permission('tasks', 'edit')));

create policy task_links_select on task_links for select to authenticated using (can_view_task(task_id));
create policy task_links_manage on task_links for all to authenticated
  using (can_edit_task(task_id))
  with check (can_edit_task(task_id));

create policy task_history_select on task_history for select to authenticated using (can_view_task(task_id));
-- אין insert/update/delete policy ל-task_history - נכתב אך ורק דרך הטריגרים
-- ה-SECURITY DEFINER למעלה, בדיוק כמו audit_events.

-- ---------------------------------------------------------------------------
-- Storage: קבצים מצורפים למשימות
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('task-attachments', 'task-attachments', false)
on conflict (id) do nothing;

create policy task_attachments_files_select on storage.objects for select to authenticated
  using (
    bucket_id = 'task-attachments'
    and exists (select 1 from task_attachments a where a.file_path = storage.objects.name and can_view_task(a.task_id))
  );

create policy task_attachments_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'task-attachments' and has_permission('area_tasks', 'access'));
