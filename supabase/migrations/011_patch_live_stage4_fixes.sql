-- Patch למי שכבר הריץ את הגרסה הישנה (הלא-מתוקנת) של 008/009 נגד הפרויקט החי.
-- עושה ALTER על מה שכבר קיים, לא CREATE מאפס - אין מחיקת נתונים, רק סגירת שני החורים
-- שתוארו בביקורת (RLS עוקף מכונת מצבים; חשבון בנק לא נסגר). ר' README.md להסבר מלא
-- למה זה migration נפרד ולא עריכה של 008/009 עצמם.
--
-- כל הפעולות כאן idempotent-safe (IF EXISTS / CREATE OR REPLACE) - בטוח להריץ גם על
-- פרויקט חדש שכבר קיבל את 008/009 המתוקנים (למשל אם מישהו בונה סביבה טרייה בעתיד
-- ומריץ את כל ה-migrations ברצף כולל 011 בטעות) - הפקודות פשוט לא ישנו כלום במקרה הזה.

-- 1. הסרת ה-policies שהתירו עקיפה ישירה של reassign_student()/add_student_bank_account()/
--    set_student_bank_account_verification(). אלה security definer ולא זקוקות ל-policy.
drop policy if exists student_assignments_insert on student_assignments;
drop policy if exists student_assignments_update on student_assignments;
drop policy if exists student_bank_accounts_insert on student_bank_accounts;
drop policy if exists student_bank_accounts_update on student_bank_accounts;

-- 2. טריגר guard: חוסם שינוי ישיר של students.status מחוץ ל-advance_student_status()/exit_student().
-- מעודכן (ביקורת רוחבית לקראת שלב 11): בודק גם INSERT, לא רק UPDATE - ר' הערה מלאה ב-008.
create or replace function enforce_student_status_transition()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'תלמיד חדש תמיד נוצר בסטטוס טיוטה';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status
     and coalesce(current_setting('app.allow_student_status_change', true), '') <> 'true' then
    raise exception 'שינוי סטטוס תלמיד מותר רק דרך advance_student_status() או exit_student()';
  end if;
  return new;
end;
$$;

drop trigger if exists students_enforce_status_transition on students;
create trigger students_enforce_status_transition
  before insert or update on students
  for each row execute function enforce_student_status_transition();

-- 3. עדכון advance_student_status()/exit_student() כך שיפעילו את הדגל שהטריגר בודק
--    (create or replace עם אותה חתימה - לא נדרש DROP, ולא נוגע בשום קריאה קיימת ל-RPC).
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

  if p_target_status not in ('ready_for_talmud', 'active') then
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

-- 4. RPC חדש: הוספת חשבון בנק תלמיד שסוגר אטומית כל חשבון פעיל קודם.
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

  return v_new_id;
end;
$$;

grant execute on function add_student_bank_account(uuid, text, text, text, text, text, text, date) to authenticated;
