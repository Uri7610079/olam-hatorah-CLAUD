-- שלב 4: תלמידים, שיוכים היסטוריים וחשבונות בנק. בלי זכאות ותשלום - אלה משלב 6 ואילך.

create table students (
  id uuid primary key default gen_random_uuid(),
  id_type text not null default 'israeli_id' check (id_type in ('israeli_id', 'passport', 'other')),
  -- מזהה עסקי כמחרוזת (לא integer) - שומר אפסים מובילים ותומך בכל סוגי המזהים.
  external_id text not null,
  full_name text not null,
  birth_date date,
  phone_raw text,
  phone_normalized text,
  address text,
  -- study_code/student_type יהפכו ל-FK לטבלאות dictionaries/study_codes אמיתיות בשלב 5 -
  -- כרגע טקסט חופשי בלבד, בלי לקבע רשימת ערכים שלא אושרה.
  student_type text,
  study_code text,
  -- מכונת מצבים מלאה לפי אפיון V3 §10: draft -> ready_for_talmud -> sent_to_talmud ->
  -- active/active_with_error, או inactive (יציאה) מכל שלב. sent_to_talmud/active/
  -- active_with_error נקבעים בשלב 6 (יצוא/יבוא זכאות/שגויים); כאן רק מוגדר טווח הערכים.
  -- המעבר נאכף רק דרך פונקציות ייעודיות (advance_student_status()/exit_student() כאן,
  -- ופונקציות שלב 6) כדי לאכוף כללים עסקיים. חשוב: RLS לבדה לא יכולה להגביל עמודה
  -- בודדת (students_update ב-009 מתירה עדכון כל שדה, כדי לאפשר עריכת פרטים רגילה) -
  -- האכיפה בפועל שאף אחד לא ישנה status ישירות היא הטריגר enforce_student_status_transition
  -- (בהמשך הקובץ), לא ה-RLS.
  status text not null default 'draft' check (status in ('draft', 'ready_for_talmud', 'sent_to_talmud', 'active', 'active_with_error', 'inactive')),
  exit_date date,
  exit_reason text,
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  -- בדיקת כפילות לפי מזהה (לא לפי שם) - דרישה מפורשת באפיון. ייחודי לפי סוג+מזהה יחד.
  unique (id_type, external_id)
);

create trigger students_set_updated_at
  before update on students
  for each row execute function set_updated_at();

-- אין דריסת שיוך קודם: שינוי שיוך תמיד יוצר שורה חדשה (ר' reassign_student למטה),
-- לא UPDATE של group_id בשורה קיימת. אין UNIQUE על "שיוך פעיל יחיד" - החלטה עסקית
-- פתוחה, בדיוק כמו organization_bank_accounts.is_active בשלב 3.
-- אין ללקוח INSERT/UPDATE ישיר על הטבלה הזו בכלל (ר' 009) - הדרך היחידה לכתוב היא
-- reassign_student(), שהיא security definer ולכן לא זקוקה ל-policy כדי לפעול.
create table student_assignments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete restrict,
  organization_id uuid not null references organizations(id),
  branch_id uuid not null references branches(id),
  group_id uuid not null references groups(id),
  start_date date not null,
  end_date date,
  end_reason text,
  is_active boolean not null default true,
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger student_assignments_set_updated_at
  before update on student_assignments
  for each row execute function set_updated_at();

create table student_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete restrict,
  bank_name text,
  bank_branch_code text,
  account_number text,
  account_holder_name text,
  student_relationship text check (student_relationship in ('self', 'parent', 'guardian', 'other')),
  supporting_document_path text,
  verification_status text not null default 'pending' check (verification_status in ('pending', 'verified', 'rejected')),
  verified_at timestamptz,
  verified_by uuid references auth.users(id),
  is_active boolean not null default true,
  opened_at date,
  closed_at date,
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger student_bank_accounts_set_updated_at
  before update on student_bank_accounts
  for each row execute function set_updated_at();

create index student_assignments_student_idx on student_assignments (student_id);
create index student_assignments_group_idx on student_assignments (group_id);
create index student_bank_accounts_student_idx on student_bank_accounts (student_id);

-- מיסוך מספר חשבון תלמיד - אותה תבנית מדויקת כמו organization_bank_accounts בשלב 3
-- (view עם security_invoker + endpoint reveal מבוקר ומתועד). לא מומצא כלל חדש.
create view student_bank_accounts_view
with (security_invoker = true)
as
select
  id,
  student_id,
  bank_name,
  bank_branch_code,
  mask_account_number(account_number) as account_number_masked,
  account_holder_name,
  student_relationship,
  supporting_document_path,
  verification_status,
  verified_at,
  verified_by,
  is_active,
  opened_at,
  closed_at,
  is_demo,
  demo_batch_id,
  created_at,
  updated_at
from student_bank_accounts;

grant select on student_bank_accounts_view to authenticated;

create or replace function reveal_student_bank_account_number(p_account_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_value text;
begin
  if not has_permission('bank_accounts', 'view_sensitive') then
    raise exception 'permission denied';
  end if;

  select account_number into v_value from student_bank_accounts where id = p_account_id;

  perform insert_audit_event('reveal_bank_account_number', 'student_bank_accounts', p_account_id::text, null);

  return v_value;
end;
$$;

grant execute on function reveal_student_bank_account_number(uuid) to authenticated;

-- הרשאה חדשה לשלב 4: מכסה students + student_assignments + student_bank_accounts יחד,
-- באותה תבנית שבה organizations.manage כיסה גם officeholders וגם bank_accounts בשלב 3.
insert into permissions (resource, action, label_he) values
  ('students', 'manage', 'יצירה/עריכה/שיוך/יציאה של תלמידים');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'students' and p.action = 'manage'
where r.key in ('system_admin', 'operations_manager');

-- reassign_student(): הדרך היחידה לשנות שיוך - סוגרת את השיוך הפעיל הקודם (end_date+end_reason)
-- ופותחת שורה חדשה, אטומית. אף מסך לא מעדכן group_id בשורה קיימת ישירות.
create or replace function reassign_student(
  p_student_id uuid,
  p_organization_id uuid,
  p_branch_id uuid,
  p_group_id uuid,
  p_start_date date,
  p_end_reason text default 'reassigned'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('students', 'manage') then
    raise exception 'permission denied';
  end if;

  update student_assignments
  set is_active = false, end_date = p_start_date, end_reason = p_end_reason
  where student_id = p_student_id and is_active = true;

  insert into student_assignments (student_id, organization_id, branch_id, group_id, start_date, is_active)
  values (p_student_id, p_organization_id, p_branch_id, p_group_id, p_start_date, true);

  perform insert_audit_event(
    'reassign_student', 'students', p_student_id::text,
    jsonb_build_object('organization_id', p_organization_id, 'branch_id', p_branch_id, 'group_id', p_group_id, 'start_date', p_start_date)
  );
end;
$$;

grant execute on function reassign_student(uuid, uuid, uuid, uuid, date, text) to authenticated;

-- exit_student(): יציאה שומרת תאריך וסיבה (על התלמיד ועל השיוך הפעיל שנסגר יחד איתה).
create or replace function exit_student(p_student_id uuid, p_exit_date date, p_exit_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('students', 'manage') then
    raise exception 'permission denied';
  end if;

  perform set_config('app.allow_student_status_change', 'true', true);
  update students set status = 'inactive', exit_date = p_exit_date, exit_reason = p_exit_reason where id = p_student_id;

  update student_assignments
  set is_active = false, end_date = p_exit_date, end_reason = p_exit_reason
  where student_id = p_student_id and is_active = true;

  perform insert_audit_event(
    'exit_student', 'students', p_student_id::text,
    jsonb_build_object('exit_date', p_exit_date, 'exit_reason', p_exit_reason)
  );
end;
$$;

grant execute on function exit_student(uuid, date, text) to authenticated;

-- advance_student_status(): הדרך היחידה להעלות סטטוס ל-ready_for_talmud/active. אוכפת
-- בשרת (לא רק ב-UI) את הכלל המחייב: טלפון קיים, שיוך פעיל, חשבון בנק מאומת. "טלפון תקין"
-- לפי הגדרה מדויקת (למשל האם נדרש נייד דווקא) הוא נושא פתוח שאסור לקבע - כרגע רק בדיקת
-- "טלפון קיים ולא ריק", לא פורמט ספציפי.
create or replace function advance_student_status(p_student_id uuid, p_target_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_has_active_assignment boolean;
  v_has_verified_account boolean;
begin
  if not has_permission('students', 'manage') then
    raise exception 'permission denied';
  end if;

  -- 'active'/'active_with_error' אינם יעד ידני - הם נקבעים אך ורק דרך תהליך התלמוד
  -- (יצוא/יבוא זכאות/יבוא שגויים) בשלב 6, לא בלחיצת כפתור על ידי המשתמש.
  if p_target_status <> 'ready_for_talmud' then
    raise exception 'invalid target status: %', p_target_status;
  end if;

  select phone_normalized into v_phone from students where id = p_student_id;
  select exists(select 1 from student_assignments where student_id = p_student_id and is_active = true) into v_has_active_assignment;
  select exists(
    select 1 from student_bank_accounts
    where student_id = p_student_id and is_active = true and verification_status = 'verified'
  ) into v_has_verified_account;

  if v_phone is null or length(trim(v_phone)) = 0 then
    raise exception 'לא ניתן להתקדם בלי טלפון תקין';
  end if;
  if not v_has_active_assignment then
    raise exception 'לא ניתן להתקדם בלי שיוך פעיל';
  end if;
  if not v_has_verified_account then
    raise exception 'לא ניתן להתקדם בלי חשבון בנק מאומת';
  end if;

  perform set_config('app.allow_student_status_change', 'true', true);
  update students set status = p_target_status where id = p_student_id;

  perform insert_audit_event('advance_student_status', 'students', p_student_id::text, jsonb_build_object('target_status', p_target_status));
end;
$$;

grant execute on function advance_student_status(uuid, text) to authenticated;

-- אישור/דחיית חשבון בנק תלמיד - נפרד מ-reveal, לא חושף את המספר, רק קובע סטטוס אימות.
create or replace function set_student_bank_account_verification(p_account_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('students', 'manage') then
    raise exception 'permission denied';
  end if;

  if p_status not in ('verified', 'rejected') then
    raise exception 'invalid verification status: %', p_status;
  end if;

  update student_bank_accounts
  set verification_status = p_status, verified_at = now(), verified_by = auth.uid()
  where id = p_account_id;

  perform insert_audit_event('set_student_bank_account_verification', 'student_bank_accounts', p_account_id::text, jsonb_build_object('status', p_status));
end;
$$;

grant execute on function set_student_bank_account_verification(uuid, text) to authenticated;

-- add_student_bank_account(): הדרך היחידה להוסיף חשבון בנק לתלמיד. סוגרת אטומית כל חשבון
-- פעיל קודם (is_active=false, closed_at) לפני פתיחת החדש - "שינוי חשבון בנק סוגר את
-- הישן ופותח חדש" (דרישה מפורשת באפיון, לא החלטה פתוחה כמו אצל עמותות). אין ללקוח
-- INSERT ישיר על student_bank_accounts (ר' 009) - רק דרך הפונקציה הזו.
create or replace function add_student_bank_account(
  p_student_id uuid,
  p_bank_name text,
  p_bank_branch_code text,
  p_account_number text,
  p_account_holder_name text,
  p_student_relationship text,
  p_supporting_document_path text,
  p_opened_at date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_id uuid;
begin
  if not has_permission('students', 'manage') then
    raise exception 'permission denied';
  end if;

  update student_bank_accounts
  set is_active = false, closed_at = p_opened_at
  where student_id = p_student_id and is_active = true;

  insert into student_bank_accounts (
    student_id, bank_name, bank_branch_code, account_number, account_holder_name,
    student_relationship, supporting_document_path, opened_at, is_active
  )
  values (
    p_student_id, p_bank_name, p_bank_branch_code, p_account_number, p_account_holder_name,
    p_student_relationship, p_supporting_document_path, p_opened_at, true
  )
  returning id into v_new_id;

  -- הסגירה וההוספה עצמן כבר מתועדות אוטומטית על ידי טריגר audit_bank_account_change
  -- (INSERT/UPDATE על student_bank_accounts) - אין צורך בקריאה ידנית ל-insert_audit_event.
  return v_new_id;
end;
$$;

grant execute on function add_student_bank_account(uuid, text, text, text, text, text, text, date) to authenticated;

-- enforce_student_status_transition(): RLS לא יכולה להגביל עדכון לעמודה בודדת - students_update
-- (009) מתירה עדכון כל שדה כדי לאפשר עריכת פרטים רגילה (StudentDetailsTab). הטריגר הזה
-- הוא האכיפה האמיתית: שינוי status חסום אלא אם המשתנה app.allow_student_status_change
-- הוגדר ל-true באותה טרנזקציה - וזה קורה אך ורק בתוך advance_student_status()/exit_student()
-- לפני ה-UPDATE שלהן (is_local=true, כך שהערך מתאפס אוטומטית בסוף הטרנזקציה).
create or replace function enforce_student_status_transition()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('app.allow_student_status_change', true), '') <> 'true' then
    raise exception 'שינוי סטטוס תלמיד מותר רק דרך advance_student_status() או exit_student()';
  end if;
  return new;
end;
$$;

create trigger students_enforce_status_transition
  before update on students
  for each row execute function enforce_student_status_transition();

-- audit אוטומטי, כמו בשלב 3. student_bank_accounts משתמש בגרסה הממסכת (audit_bank_account_change).
create trigger students_audit
  after insert or update on students
  for each row execute function audit_table_change();

create trigger student_assignments_audit
  after insert or update on student_assignments
  for each row execute function audit_table_change();

create trigger student_bank_accounts_audit
  after insert or update on student_bank_accounts
  for each row execute function audit_bank_account_change();

-- bucket פרטי לאישורי חשבון בנק של תלמידים. RLS על storage.objects בקובץ ה-RLS (009).
insert into storage.buckets (id, name, public)
values ('student-documents', 'student-documents', false)
on conflict (id) do nothing;
