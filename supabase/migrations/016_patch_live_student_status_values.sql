-- Patch לפרויקט החי: 008 כבר רץ עם רשימת סטטוסים חלקית (draft/ready_for_talmud/active/
-- inactive). מכונת המצבים המלאה באפיון V3 §10 כוללת גם sent_to_talmud (אחרי יצוא) ו-
-- active_with_error (תלמיד שהופיע בדוח שגויים) - ר' 008 המעודכן על הדיסק להסבר המלא.
-- זהו ALTER על מה שכבר קיים, לא CREATE - אין מחיקת נתונים.

alter table students drop constraint if exists students_status_check;
alter table students add constraint students_status_check
  check (status in ('draft', 'ready_for_talmud', 'sent_to_talmud', 'active', 'active_with_error', 'inactive'));

-- advance_student_status() אפשרה גם מעבר ידני ל-'active' - זה כבר לא נכון: active/
-- active_with_error נקבעים אך ורק על ידי הפונקציות של שלב 6 (לאחר יבוא זכאות/שגויים
-- אמיתי מתלמוד), לא בלחיצת כפתור. יש להסיר את הכפתור המתאים ב-StudentDetailScreen.tsx
-- (בוצע באותו commit) - כאן רק הצד השרתי: הפונקציה עצמה כבר לא מקבלת 'active'.
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

  if p_target_status <> 'ready_for_talmud' then
    raise exception 'invalid target status: % (active/active_with_error נקבעים דרך תהליך התלמוד בשלב 6)', p_target_status;
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
