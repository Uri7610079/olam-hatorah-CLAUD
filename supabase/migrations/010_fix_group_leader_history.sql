-- תיקון: group_leader_assignments - ישות היסטורית נפרדת לשיוך ראש קבוצה, כפי שמוגדר
-- באפיון V3 §9.1 (ולא רק groups.group_leader_id כ-FK רגיל בלי מעקב). זהו migration נפרד
-- ולא עריכה של 005 כי שלב 3 כבר committed וסביר שכבר רץ מול הפרויקט החי.
--
-- עד עכשיו לא היה מסך להחלפת ראש קבוצה אחרי היצירה, אז זה עדיין לא גרם לאובדן מידע
-- בפועל - אבל צריך להיסגר לפני שנוצרים נתונים אמיתיים. groups.group_leader_id נשאר
-- כעמודה נוחה ל"ראש הקבוצה הנוכחי" (שאילתות מהירות בלי JOIN), אך משתנה אך ורק דרך
-- reassign_group_leader() - לא UPDATE ישיר, נאכף בטריגר (אותה שיטה בדיוק כמו
-- students.status ב-008).

create table group_leader_assignments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete restrict,
  group_leader_id uuid not null references group_leaders(id),
  start_date date not null,
  end_date date,
  end_reason text,
  is_active boolean not null default true,
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger group_leader_assignments_set_updated_at
  before update on group_leader_assignments
  for each row execute function set_updated_at();

create index group_leader_assignments_group_idx on group_leader_assignments (group_id);
create index group_leader_assignments_leader_idx on group_leader_assignments (group_leader_id);

create trigger group_leader_assignments_audit
  after insert or update on group_leader_assignments
  for each row execute function audit_table_change();

alter table group_leader_assignments enable row level security;

create policy group_leader_assignments_select on group_leader_assignments for select to authenticated
  using (has_permission('area_ops', 'access'));

-- אין INSERT/UPDATE policy ללקוח בכוונה - אותו עיקרון כמו student_assignments (009):
-- reassign_group_leader() היא security definer ולא זקוקה ל-policy כדי לפעול.

-- backfill: לקבוצות קיימות שכבר יש להן group_leader_id (נוצרו לפני התיקון הזה), יוצר
-- שורת שיוך היסטורית תואמת כדי שהמידע הקיים לא "ייעלם" מבחינת ההיסטוריה.
insert into group_leader_assignments (group_id, group_leader_id, start_date, is_active)
select id, group_leader_id, created_at::date, true
from groups
where group_leader_id is not null;

-- enforce_group_leader_transition(): כמו enforce_student_status_transition ב-008 - RLS
-- לא יכולה להגביל עדכון לעמודה בודדת, אז groups_update (006) עדיין מתירה עדכון כל שדה
-- (נחוץ לשינוי name/status/default_distribution_method). הטריגר הזה חוסם ספציפית שינוי
-- ישיר של group_leader_id מחוץ ל-reassign_group_leader().
create or replace function enforce_group_leader_transition()
returns trigger
language plpgsql
as $$
begin
  if new.group_leader_id is distinct from old.group_leader_id
     and coalesce(current_setting('app.allow_group_leader_change', true), '') <> 'true' then
    raise exception 'שינוי ראש קבוצה מותר רק דרך reassign_group_leader()';
  end if;
  return new;
end;
$$;

create trigger groups_enforce_leader_transition
  before update on groups
  for each row execute function enforce_group_leader_transition();

-- reassign_group_leader(): סוגר שיוך פעיל קודם (אם יש) ופותח שיוך חדש, אטומית - גם
-- לשיוך ראשון של קבוצה חדשה (בלי שיוך פעיל קודם) וגם להחלפת ראש קבוצה קיים. מעדכן גם
-- את groups.group_leader_id (עם set_config כדי לעבור את הטריגר) לנוחות שאילתה.
create or replace function reassign_group_leader(
  p_group_id uuid,
  p_group_leader_id uuid,
  p_start_date date,
  p_end_reason text default 'reassigned'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('groups', 'manage') then
    raise exception 'permission denied';
  end if;

  update group_leader_assignments
  set is_active = false, end_date = p_start_date, end_reason = p_end_reason
  where group_id = p_group_id and is_active = true;

  insert into group_leader_assignments (group_id, group_leader_id, start_date, is_active)
  values (p_group_id, p_group_leader_id, p_start_date, true);

  perform set_config('app.allow_group_leader_change', 'true', true);
  update groups set group_leader_id = p_group_leader_id where id = p_group_id;

  perform insert_audit_event(
    'reassign_group_leader', 'groups', p_group_id::text,
    jsonb_build_object('group_leader_id', p_group_leader_id, 'start_date', p_start_date)
  );
end;
$$;

grant execute on function reassign_group_leader(uuid, uuid, date, text) to authenticated;
