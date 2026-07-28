-- שלב 20: מודול "ניהול משימות" - תזכורות ומשימות חוזרות.
-- מקור: אפיון V2 §13-14, TASKS_MODULE_PLAN.md.
--
-- הבהרת עיצוב ל"מנוע תזכורות שרתי, לא תלוי בדפדפן פתוח" (סעיף 13): אין באפיון דרישה
-- לערוץ שליחה חיצוני (מייל/SMS/Push) - "תזכורת בתוך המערכת היא ערוץ הבסיס" בלבד, ואין
-- חובת Daily Digest. לכן "שרתי" מתפרש כאן כ: זמן ה-"הגיע-הזמן" מחושב תמיד ב-SQL מתאריך
-- מאוחסן (remind_at), לא מ-setTimeout בצד לקוח שנעלם כשהטאב נסגר - לא נבנה כאן דיימון
-- Push, כי לא התבקש ואין ערוץ שליחה חיצוני קיים במערכת בכלל.
-- לעומת זאת, "משימות חוזרות" כן דורשות משהו רץ בפועל (ליצור שורת tasks חדשה בזמן הנכון,
-- לא רק לחשב read-time) - זה נבנה עם pg_cron (נתמך ב-Supabase), לא מומצא.

-- ---------------------------------------------------------------------------
-- תזכורות
-- ---------------------------------------------------------------------------

create table task_reminders (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  -- null = לכל האחראים הנוכחיים של המשימה (סעיף 13: "תזכורת לכל האחראים או למשתמשים מסוימים").
  user_id uuid references auth.users(id) on delete cascade,
  remind_at timestamptz,
  -- יחסי ליעד (סעיף 13: "יום לפני, מספר ימים לפני או ביום היעד") - 0 = ביום היעד עצמו.
  -- כשהוא לא null, remind_at מחושב אוטומטית (למטה) ומתעדכן אם תאריך היעד של המשימה משתנה.
  days_before_due integer,
  snoozed_until timestamptz,
  is_dismissed boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (remind_at is not null or days_before_due is not null)
);

create index task_reminders_task_idx on task_reminders (task_id);
create index task_reminders_due_idx on task_reminders (is_dismissed) where is_dismissed = false;

-- חישוב/עדכון remind_at לתזכורות יחסיות - נקרא גם ב-INSERT/UPDATE של task_reminders עצמה
-- (days_before_due הוזן/השתנה) וגם מטריגר על tasks.due_date (למטה).
create or replace function resolve_relative_reminder(p_task_id uuid, p_days_before_due integer)
returns timestamptz
language sql
stable
as $$
  select (t.due_date - (p_days_before_due || ' days')::interval)::timestamptz
  from tasks t where t.id = p_task_id and t.due_date is not null;
$$;

create or replace function task_reminders_resolve_relative()
returns trigger
language plpgsql
as $$
begin
  if new.days_before_due is not null then
    new.remind_at := resolve_relative_reminder(new.task_id, new.days_before_due);
  end if;
  return new;
end;
$$;

create trigger task_reminders_resolve_before_write
  before insert or update on task_reminders
  for each row execute function task_reminders_resolve_relative();

-- כשתאריך היעד של משימה משתנה, כל תזכורת יחסית שלה מתעדכנת בהתאם - אחרת היא "נתקעת"
-- על תאריך היעד הישן (נתפס תוך כדי תכנון השלב, לא נמצא בבדיקה חיה).
create or replace function tasks_recompute_relative_reminders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.due_date is distinct from old.due_date then
    update task_reminders
    set remind_at = resolve_relative_reminder(new.id, days_before_due)
    where task_id = new.id and days_before_due is not null;
  end if;
  return new;
end;
$$;

create trigger tasks_recompute_reminders_on_due_date_change
  after update on tasks
  for each row execute function tasks_recompute_relative_reminders();

alter table task_reminders enable row level security;

create policy task_reminders_select on task_reminders for select to authenticated using (can_view_task(task_id));
create policy task_reminders_insert on task_reminders for insert to authenticated with check (can_edit_task(task_id));
create policy task_reminders_delete on task_reminders for delete to authenticated using (can_edit_task(task_id));
-- אין UPDATE ישיר דרך RLS - snooze/דחייה עוברים דרך snooze_reminder()/dismiss_reminder()
-- למטה, כדי לאפשר גם למי שהתזכורת מיועדת לו אישית (גם בלי tasks.edit) לנהל אותה.

create or replace function snooze_reminder(p_reminder_id uuid, p_snoozed_until timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task_id uuid;
  v_user_id uuid;
begin
  select task_id, user_id into v_task_id, v_user_id from task_reminders where id = p_reminder_id;
  if v_task_id is null then
    raise exception 'reminder not found';
  end if;

  if not (
    can_edit_task(v_task_id)
    or v_user_id = auth.uid()
    or (v_user_id is null and exists (select 1 from task_owners where task_id = v_task_id and user_id = auth.uid()))
  ) then
    raise exception 'permission denied';
  end if;

  update task_reminders set snoozed_until = p_snoozed_until where id = p_reminder_id;
end;
$$;

grant execute on function snooze_reminder(uuid, timestamptz) to authenticated;

create or replace function dismiss_reminder(p_reminder_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task_id uuid;
  v_user_id uuid;
begin
  select task_id, user_id into v_task_id, v_user_id from task_reminders where id = p_reminder_id;
  if v_task_id is null then
    raise exception 'reminder not found';
  end if;

  if not (
    can_edit_task(v_task_id)
    or v_user_id = auth.uid()
    or (v_user_id is null and exists (select 1 from task_owners where task_id = v_task_id and user_id = auth.uid()))
  ) then
    raise exception 'permission denied';
  end if;

  update task_reminders set is_dismissed = true where id = p_reminder_id;
end;
$$;

grant execute on function dismiss_reminder(uuid) to authenticated;

-- תזכורות שהגיע זמנן עבור המשתמש המחובר - "לי" = אני יעד מפורש, או שהתזכורת היא
-- ל"כל האחראים" ואני אחראי בפועל על המשימה.
create or replace function due_reminders_for_me()
returns table (id uuid, task_id uuid, task_title text, effective_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
    select r.id, r.task_id, t.title, coalesce(r.snoozed_until, r.remind_at)
    from task_reminders r
    join tasks t on t.id = r.task_id
    where r.is_dismissed = false
      and coalesce(r.snoozed_until, r.remind_at) <= now()
      and (
        r.user_id = auth.uid()
        or (r.user_id is null and exists (select 1 from task_owners too where too.task_id = r.task_id and too.user_id = auth.uid()))
      )
    order by coalesce(r.snoozed_until, r.remind_at);
end;
$$;

grant execute on function due_reminders_for_me() to authenticated;

-- ---------------------------------------------------------------------------
-- משימות חוזרות
-- ---------------------------------------------------------------------------

alter table tasks add column recurrence_rule_id uuid;
create index tasks_recurrence_rule_idx on tasks (recurrence_rule_id);

create table task_recurrence_rules (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category_id uuid references task_categories(id),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly', 'yearly', 'custom')),
  -- daily = כל יום. weekly = חייב day_of_week. monthly = חייב day_of_month (נצמד לתאריך
  -- האחרון האפשרי בחודש אם היום לא קיים בו, למשל 31 בפברואר). yearly = יום/חודש מ-start_date.
  -- custom = כל interval_days ימים.
  day_of_week smallint check (day_of_week between 0 and 6),
  day_of_month smallint check (day_of_month between 1 and 31),
  interval_days integer check (interval_days > 0),
  start_date date not null,
  end_date date,
  -- אם false (ברירת מחדל): לא נוצר מופע חדש כל עוד המופע הקודם שנוצר מהכלל הזה לא
  -- completed/cancelled (סעיף 14: "האם ליצור מופע חדש גם אם הקודם טרם הושלם").
  create_next_even_if_previous_incomplete boolean not null default false,
  reminder_days_before_due integer,
  is_active boolean not null default true,
  last_generated_date date,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  check (
    (frequency = 'weekly' and day_of_week is not null)
    or (frequency = 'monthly' and day_of_month is not null)
    or (frequency = 'custom' and interval_days is not null)
    or (frequency in ('daily', 'yearly'))
  )
);

create trigger task_recurrence_rules_set_updated_at
  before update on task_recurrence_rules
  for each row execute function set_updated_at();

create table task_recurrence_owners (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references task_recurrence_rules(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  unique (rule_id, user_id)
);

create table task_recurrence_teams (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references task_recurrence_rules(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  unique (rule_id, team_id)
);

alter table task_recurrence_rules enable row level security;
alter table task_recurrence_owners enable row level security;
alter table task_recurrence_teams enable row level security;

create policy task_recurrence_rules_select on task_recurrence_rules for select to authenticated using (has_permission('area_tasks', 'access'));
create policy task_recurrence_rules_manage on task_recurrence_rules for all to authenticated
  using (has_permission('tasks', 'manage_settings'))
  with check (has_permission('tasks', 'manage_settings'));

create policy task_recurrence_owners_select on task_recurrence_owners for select to authenticated using (has_permission('area_tasks', 'access'));
create policy task_recurrence_owners_manage on task_recurrence_owners for all to authenticated
  using (has_permission('tasks', 'manage_settings'))
  with check (has_permission('tasks', 'manage_settings'));

create policy task_recurrence_teams_select on task_recurrence_teams for select to authenticated using (has_permission('area_tasks', 'access'));
create policy task_recurrence_teams_manage on task_recurrence_teams for all to authenticated
  using (has_permission('tasks', 'manage_settings'))
  with check (has_permission('tasks', 'manage_settings'));

create trigger task_recurrence_rules_audit after insert or update on task_recurrence_rules for each row execute function audit_table_change();

-- מחשב את מופע היעד הבא של הכלל, אחרי last_generated_date (או start_date - יום אם
-- עוד לא נוצר מופע כלל). מיישר day_of_month לתאריך התקף האחרון בחודש (למשל 31 בפברואר -> 28/29).
create or replace function next_recurrence_date(p_rule task_recurrence_rules)
returns date
language plpgsql
as $$
declare
  v_base date;
  v_candidate date;
  v_month_start date;
  v_last_day_of_month integer;
begin
  v_base := coalesce(p_rule.last_generated_date, p_rule.start_date - 1);

  if p_rule.frequency = 'daily' then
    return v_base + 1;
  elsif p_rule.frequency = 'custom' then
    return v_base + p_rule.interval_days;
  elsif p_rule.frequency = 'weekly' then
    v_candidate := v_base + 1;
    while extract(dow from v_candidate) <> p_rule.day_of_week loop
      v_candidate := v_candidate + 1;
    end loop;
    return v_candidate;
  elsif p_rule.frequency = 'monthly' then
    v_month_start := date_trunc('month', v_base + 1)::date;
    loop
      v_last_day_of_month := extract(day from (v_month_start + interval '1 month - 1 day'));
      v_candidate := v_month_start + (least(p_rule.day_of_month, v_last_day_of_month) - 1);
      exit when v_candidate > v_base;
      v_month_start := (v_month_start + interval '1 month')::date;
    end loop;
    return v_candidate;
  elsif p_rule.frequency = 'yearly' then
    v_candidate := (v_base + interval '1 year')::date;
    return v_candidate;
  end if;
  return null;
end;
$$;

-- ה"מנוע" בפועל - נקרא יומית ע"י pg_cron (למטה). SECURITY DEFINER כי הוא כותב tasks/
-- task_owners/task_teams/task_reminders בשם system, לא בשם משתמש מחובר (רץ ללא session).
create or replace function generate_due_recurrences()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule task_recurrence_rules;
  v_next_date date;
  v_last_task_id uuid;
  v_last_task_status text;
  v_new_task_id uuid;
  v_created_count integer := 0;
begin
  for v_rule in select * from task_recurrence_rules where is_active = true and (end_date is null or end_date >= current_date) loop
    v_next_date := next_recurrence_date(v_rule);
    exit when v_next_date is null;

    if v_next_date > current_date then
      continue;
    end if;

    if not v_rule.create_next_even_if_previous_incomplete then
      select id, status into v_last_task_id, v_last_task_status
      from tasks where recurrence_rule_id = v_rule.id
      order by created_at desc limit 1;

      if v_last_task_id is not null and v_last_task_status not in ('completed', 'cancelled') then
        continue;
      end if;
    end if;

    insert into tasks (title, description, category_id, priority, due_date, source, recurrence_rule_id, created_by)
    values (v_rule.title, v_rule.description, v_rule.category_id, v_rule.priority, v_next_date, 'automation', v_rule.id, v_rule.created_by)
    returning id into v_new_task_id;

    insert into task_owners (task_id, user_id)
    select v_new_task_id, tro.user_id from task_recurrence_owners tro where tro.rule_id = v_rule.id;

    insert into task_teams (task_id, team_id)
    select v_new_task_id, trt.team_id from task_recurrence_teams trt where trt.rule_id = v_rule.id;

    if v_rule.reminder_days_before_due is not null then
      insert into task_reminders (task_id, days_before_due, created_by)
      values (v_new_task_id, v_rule.reminder_days_before_due, v_rule.created_by);
    end if;

    update task_recurrence_rules set last_generated_date = v_next_date where id = v_rule.id;
    v_created_count := v_created_count + 1;
  end loop;

  return v_created_count;
end;
$$;

-- תזמון ההרצה היומית עצמה (pg_cron) נמצא במיגרציה נפרדת (068) בכוונה: אם ההרחבה
-- חסומה בתוכנית ה-Supabase הנוכחית, אסור שזה יפיל את כל שאר המיגרציה הזו (טבלאות,
-- הרשאות, פונקציות) - לקח מהניסיון עם storage.objects ב-064 (כישלון שורה אחת מחזיר
-- את כל הטרנזקציה, כולל דברים שלא קשורים אליה).
