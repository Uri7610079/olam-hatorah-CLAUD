-- שלב 36: בדיקה אוטומטית של מספר חשבון בנק, ואישור אוטומטי של תלמיד ל"מוכן לתלמוד"
--
-- החלטת צ'ני (2026-10-06): אין צורך באימות ידני של חשבון בנק. במקומו המערכת בודקת
-- בעצמה שמספר החשבון אפשרי - לפי נוסחת ספרת הביקורת של כל בנק (הנוסחה של מס"ב).
-- ותלמיד שיש לו כל מה שצריך עובר ל"מוכן לתלמוד" לבד, בלי ללחוץ על כל אחד.
--
-- מה הבדיקה יודעת ומה לא: היא תופסת טעות הקלדה (ספרה שגויה, שתי ספרות שהתחלפו).
-- היא לא יודעת אם החשבון באמת קיים, או שהוא שייך לתלמיד. את זה רק הבנק יודע -
-- ואם החשבון לא קיים, ההעברה במס"ב תחזור ותיראה במסך החזרות.
--
-- איך זה משתלב בלי לגעת בתשלומים: verification_status נשאר השדה שכל השערים
-- בודקים (אישור חלוקה 031, מס"ב 032, החזרות 040, לוחות 048/053). מה שמשתנה הוא
-- מי ממלא אותו: במקום לחיצה ידנית - הבדיקה האוטומטית.
--   מספר תקין            -> verified
--   בנק בלי נוסחה ידועה  -> verified (אין מה לבדוק, ואימות ידני בוטל)
--   מספר שגוי            -> rejected (חוסם תשלום - ההעברה הייתה נכשלת ממילא)
-- הכפתור הידני נשאר רק כעקיפה: "אישור למרות זאת" על חשבון שהבדיקה פסלה.

-- ===== 1. נוסחת ספרת הביקורת =====
--
-- זהה בדיוק ל-checkIsraeliBankAccount ב-src/lib/israeliBankAccount.ts. שינוי באחד
-- מחייב שינוי בשני. מקור: il-bank-account-validator (MIT), נבדק מול חצי מיליון
-- מספרים אקראיים בלי אף הבדל.

create or replace function bank_account_check_result(p_bank_code text, p_branch text, p_account text)
returns text
language plpgsql
immutable
as $$
declare
  v_bank_digits text := regexp_replace(coalesce(p_bank_code, ''), '[^0-9]', '', 'g');
  v_branch_digits text := ltrim(regexp_replace(coalesce(p_branch, ''), '[^0-9]', '', 'g'), '0');
  v_acc_digits text := ltrim(regexp_replace(coalesce(p_account, ''), '[^0-9]', '', 'g'), '0');
  v_bank integer;
  v_branch integer;
  a integer[];  -- ספרות החשבון מימין: a[1]=אחדות, a[2]=עשרות ... a[9]
  b integer[];  -- ספרות הסניף מימין: b[1]=אחדות, b[2]=עשרות, b[3]=מאות
  v_padded text;
  v_w6 integer;
  v_w9 integer;
  v_branch_sum integer;
  v_sum integer;
  v_r integer;
  i integer;
begin
  if v_bank_digits = '' then return 'unknown'; end if;
  v_bank := v_bank_digits::integer;
  if v_acc_digits = '' then return 'invalid'; end if;
  if v_bank not in (4, 9, 10, 11, 12, 13, 14, 17, 20, 22, 31, 34, 46, 52) then return 'unknown'; end if;
  -- אף בנק נתמך לא מנפיק חשבון של יותר מתשע ספרות, וסניף הוא עד שלוש.
  if length(v_acc_digits) > 9 or length(v_branch_digits) > 3 then return 'invalid'; end if;

  v_branch := coalesce(nullif(v_branch_digits, '')::integer, 0);
  -- מזרחי טפחות: סניפים 401 ומעלה הם סניפי טפחות לשעבר - הנוסחה עובדת על המספר פחות 400.
  if v_bank = 20 and v_branch > 400 then v_branch := v_branch - 400; end if;

  v_padded := lpad(v_acc_digits, 9, '0');
  a := array[]::integer[];
  for i in 1..9 loop
    a := a || substr(v_padded, 10 - i, 1)::integer;
  end loop;
  v_padded := lpad(v_branch::text, 3, '0');
  b := array[substr(v_padded, 3, 1)::integer, substr(v_padded, 2, 1)::integer, substr(v_padded, 1, 1)::integer];

  v_w6 := a[1] * 1 + a[2] * 2 + a[3] * 3 + a[4] * 4 + a[5] * 5 + a[6] * 6;
  v_w9 := v_w6 + a[7] * 7 + a[8] * 8 + a[9] * 9;
  v_branch_sum := b[1] * 7 + b[2] * 8 + b[3] * 9;

  -- לאומי, אגוד, ערבי ישראלי: שתי הספרות האחרונות הן ספרות הביקורת ונספרות כמספר
  -- דו-ספרתי (משקלות 1 ו-10).
  if v_bank in (10, 13, 34) then
    v_sum := a[1] * 1 + a[2] * 10 + a[3] * 2 + a[4] * 3 + a[5] * 4 + a[6] * 5 + a[7] * 6 + a[8] * 7
           + b[1] * 8 + b[2] * 9 + b[3] * 10;
    return case when v_sum % 100 in (90, 72, 70, 60, 20) then 'valid' else 'invalid' end;
  end if;

  -- יהב, הפועלים, מזרחי טפחות
  if v_bank in (4, 12, 20) then
    v_r := (v_w6 + v_branch_sum) % 11;
    if v_bank = 4 then return case when v_r in (0, 2) then 'valid' else 'invalid' end; end if;
    if v_bank = 20 then return case when v_r in (0, 2, 4) then 'valid' else 'invalid' end; end if;
    return case when v_r in (0, 2, 4, 6) then 'valid' else 'invalid' end;
  end if;

  -- דיסקונט, מרכנתיל
  if v_bank in (11, 17) then
    return case when v_w9 % 11 in (0, 2, 4) then 'valid' else 'invalid' end;
  end if;

  -- הבינלאומי, פאג"י
  if v_bank in (31, 52) then
    if v_w9 % 11 in (0, 6) then return 'valid'; end if;
    return case when v_w6 % 11 in (0, 6) then 'valid' else 'invalid' end;
  end if;

  -- הדואר
  if v_bank = 9 then
    return case when v_w9 % 10 = 0 then 'valid' else 'invalid' end;
  end if;

  -- סיטיבנק: הספרה האחרונה היא ספרת הביקורת
  if v_bank = 22 then
    v_sum := a[2] * 2 + a[3] * 3 + a[4] * 4 + a[5] * 5 + a[6] * 6 + a[7] * 7 + a[8] * 2 + a[9] * 3;
    return case when 11 - (v_sum % 11) = a[1] then 'valid' else 'invalid' end;
  end if;

  -- אוצר החייל, מסד
  v_r := (v_w6 + v_branch_sum) % 11;
  if v_r = 0 then return 'valid'; end if;
  if v_bank = 46 and v_r = 2 and v_branch in (154, 166, 178, 181, 183, 191, 192, 503, 505, 507, 515, 516, 527, 539) then
    return 'valid';
  end if;
  if v_bank = 14 then
    if v_r = 2 and v_branch in (385, 384, 365, 347, 363, 362, 361) then return 'valid'; end if;
    if v_r = 4 and v_branch in (363, 362, 361) then return 'valid'; end if;
  end if;
  if v_w9 % 11 = 0 then return 'valid'; end if;
  return case when v_w6 % 11 = 0 then 'valid' else 'invalid' end;
end;
$$;

comment on function bank_account_check_result(text, text, text) is
  'בדיקת ספרת ביקורת לחשבון בנק ישראלי: valid / invalid / unknown (בנק בלי נוסחה). זהה ל-src/lib/israeliBankAccount.ts. ראה מיגרציה 114.';

grant execute on function bank_account_check_result(text, text, text) to authenticated;

-- ===== 2. תוצאת הבדיקה נשמרת על החשבון =====

alter table student_bank_accounts add column if not exists check_digit_result text
  check (check_digit_result in ('valid', 'invalid', 'unknown'));

-- ה-view הממוסך: זהה ל-060, ונוספה העמודה בסוף (CREATE OR REPLACE VIEW מרשה רק
-- להוסיף עמודות בסוף).
create or replace view student_bank_accounts_view
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
  updated_at,
  check_digit_result
from student_bank_accounts
where has_permission('area_ops', 'access') or has_permission('area_finance', 'access');

alter view student_bank_accounts_view reset (security_invoker);

-- ===== 3. יישור החשבונות הקיימים =====
--
-- רץ לפני שהטריגר נוצר, כדי לא לגעת בהחלטה ידנית שכבר התקבלה: חשבון שמישהו כבר
-- אישר או דחה בידיים נשאר כמו שהוא, ורק מקבל את תוצאת הבדיקה לתצוגה. רק מה שחיכה
-- לאימות ("ממתין") מוכרע עכשיו לפי הבדיקה.

update student_bank_accounts
set bank_code = coalesce(bank_code, resolve_bank_code(bank_name))
where bank_code is null and bank_name is not null;

update student_bank_accounts
set check_digit_result = bank_account_check_result(bank_code, bank_branch_code, account_number);

update student_bank_accounts
set verification_status = case when check_digit_result = 'invalid' then 'rejected' else 'verified' end,
    verified_at = now(),
    verified_by = null
where verification_status = 'pending';

-- ===== 4. מעכשיו: כל חשבון נבדק ברגע שנשמר =====
--
-- הבדיקה רצה רק כשפרטי החשבון עצמם משתנים (בנק/סניף/מספר). אישור ידני "למרות
-- זאת" משנה רק את verification_status, ולכן לא נדרס בעדכון הבא.

create or replace function apply_student_bank_account_check()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.bank_code is not distinct from old.bank_code
     and new.bank_name is not distinct from old.bank_name
     and new.bank_branch_code is not distinct from old.bank_branch_code
     and new.account_number is not distinct from old.account_number then
    return new;
  end if;

  -- חשבון שנוסף מהמסך נשמר עם שם בנק בלבד (add_student_bank_account לא מקבלת
  -- קוד). בלי קוד אין בדיקה, וגם קובץ מס"ב יוצא בלי קוד בנק.
  if new.bank_code is null or (tg_op = 'UPDATE' and new.bank_name is distinct from old.bank_name and new.bank_code is not distinct from old.bank_code) then
    new.bank_code := coalesce(resolve_bank_code(new.bank_name), new.bank_code);
  end if;

  new.check_digit_result := bank_account_check_result(new.bank_code, new.bank_branch_code, new.account_number);
  new.verification_status := case when new.check_digit_result = 'invalid' then 'rejected' else 'verified' end;
  new.verified_at := now();
  new.verified_by := null;
  return new;
end;
$$;

drop trigger if exists student_bank_accounts_apply_check on student_bank_accounts;
create trigger student_bank_accounts_apply_check
  before insert or update on student_bank_accounts
  for each row execute function apply_student_bank_account_check();

-- ===== 5. מה חסר לתלמיד כדי להיות "מוכן לתלמוד" =====
--
-- מקור אחד לתנאים, במקום שלושה עותקים (לחיצה בכרטיס, אישור קבוצתי, אוטומטי).
-- מחזירה null כשהכול תקין, אחרת את הסיבה הראשונה.

create or replace function student_ready_blocker(p_student_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from students where id = p_student_id and length(trim(coalesce(phone_normalized, ''))) > 0) then
    return 'missing_phone';
  end if;
  if not exists (select 1 from student_assignments where student_id = p_student_id and is_active = true) then
    return 'missing_assignment';
  end if;
  if not exists (select 1 from student_bank_accounts where student_id = p_student_id and is_active = true) then
    return 'missing_bank';
  end if;
  if not exists (
    select 1 from student_bank_accounts
    where student_id = p_student_id and is_active = true and verification_status = 'verified'
  ) then
    return 'invalid_bank';
  end if;
  return null;
end;
$$;

revoke execute on function student_ready_blocker(uuid) from public, anon, authenticated;

-- הלחיצה בכרטיס התלמיד: אותם תנאים, מהמקור המשותף.
create or replace function advance_student_status(p_student_id uuid, p_target_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_blocker text;
begin
  if not has_permission('students', 'manage') then
    raise exception 'permission denied';
  end if;

  if p_target_status <> 'ready_for_talmud' then
    raise exception 'invalid target status: % (active/active_with_error נקבעים דרך תהליך התלמוד בשלב 6)', p_target_status;
  end if;

  v_blocker := student_ready_blocker(p_student_id);
  if v_blocker = 'missing_phone' then raise exception 'לא ניתן להתקדם בלי טלפון תקין'; end if;
  if v_blocker = 'missing_assignment' then raise exception 'לא ניתן להתקדם בלי שיוך פעיל'; end if;
  if v_blocker = 'missing_bank' then raise exception 'לא ניתן להתקדם בלי חשבון בנק'; end if;
  if v_blocker = 'invalid_bank' then raise exception 'לא ניתן להתקדם: מספר חשבון הבנק שגוי'; end if;

  perform set_config('app.allow_student_status_change', 'true', true);
  update students set status = p_target_status where id = p_student_id;

  perform insert_audit_event('advance_student_status', 'students', p_student_id::text, jsonb_build_object('target_status', p_target_status));
end;
$$;

-- ===== 6. מעבר אוטומטי =====
--
-- פונקציה פנימית: לא נחשפת ללקוח (ר' revoke). מקבלת תלמיד בטיוטה, ואם אין לו
-- חסר - מעבירה אותו ל"מוכן לתלמוד". הדגל app.allow_student_status_change מוחזר
-- לערכו הקודם בסוף, כדי שלא יישאר דלוק לשאר הטרנזקציה ויתיר שינוי סטטוס אחר.

create or replace function auto_advance_student(p_student_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_flag text;
begin
  if not exists (select 1 from students where id = p_student_id and status = 'draft') then
    return false;
  end if;
  if student_ready_blocker(p_student_id) is not null then
    return false;
  end if;

  v_prev_flag := coalesce(current_setting('app.allow_student_status_change', true), '');
  perform set_config('app.allow_student_status_change', 'true', true);
  update students set status = 'ready_for_talmud' where id = p_student_id and status = 'draft';
  perform set_config('app.allow_student_status_change', v_prev_flag, true);

  perform insert_audit_event('auto_advance_student', 'students', p_student_id::text, jsonb_build_object('target_status', 'ready_for_talmud'));
  return true;
end;
$$;

revoke execute on function auto_advance_student(uuid) from public, anon, authenticated;

-- טריגרים: כל שינוי שיכול להשלים את החסר (טלפון, שיוך, חשבון בנק) בודק מחדש.
-- כך גם יבוא מאקסל, גם הוספה ידנית בכרטיס וגם תלמיד חדש מפורטל ראשי הקבוצות
-- מגיעים ל"מוכן לתלמוד" לבד ברגע שהפרט האחרון נכנס.

create or replace function trg_auto_advance_student()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'students' then
    perform auto_advance_student(new.id);
  else
    perform auto_advance_student(new.student_id);
  end if;
  return null;
end;
$$;

drop trigger if exists students_auto_advance on students;
create trigger students_auto_advance
  after insert or update on students
  for each row when (new.status = 'draft')
  execute function trg_auto_advance_student();

drop trigger if exists student_assignments_auto_advance on student_assignments;
create trigger student_assignments_auto_advance
  after insert or update on student_assignments
  for each row when (new.is_active)
  execute function trg_auto_advance_student();

drop trigger if exists student_bank_accounts_auto_advance on student_bank_accounts;
create trigger student_bank_accounts_auto_advance
  after insert or update on student_bank_accounts
  for each row when (new.is_active and new.verification_status = 'verified')
  execute function trg_auto_advance_student();

-- ===== 7. אישור קבוצתי - לחצן במסך התלמידים =====
--
-- עובר על כל התלמידים בטיוטה, מעביר את מי שמוכן, ומחזיר כמה נשארו ולמה - כדי
-- שהמשרד יידע מה להשלים.

create or replace function bulk_advance_ready_students()
returns table (advanced integer, missing_phone integer, missing_assignment integer, missing_bank integer, invalid_bank integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_blocker text;
begin
  if not has_permission('students', 'manage') then
    raise exception 'permission denied';
  end if;

  advanced := 0; missing_phone := 0; missing_assignment := 0; missing_bank := 0; invalid_bank := 0;

  for v_id in select id from students where status = 'draft' loop
    v_blocker := student_ready_blocker(v_id);
    if v_blocker is null then
      if auto_advance_student(v_id) then advanced := advanced + 1; end if;
    elsif v_blocker = 'missing_phone' then missing_phone := missing_phone + 1;
    elsif v_blocker = 'missing_assignment' then missing_assignment := missing_assignment + 1;
    elsif v_blocker = 'missing_bank' then missing_bank := missing_bank + 1;
    else invalid_bank := invalid_bank + 1;
    end if;
  end loop;

  perform insert_audit_event('bulk_advance_ready_students', 'students', null,
    jsonb_build_object('advanced', advanced, 'missing_phone', missing_phone, 'missing_assignment', missing_assignment,
                       'missing_bank', missing_bank, 'invalid_bank', invalid_bank));
  return next;
end;
$$;

grant execute on function bulk_advance_ready_students() to authenticated;

-- ===== 8. התלמידים שכבר במערכת =====
--
-- כל מי שיושב היום בטיוטה ועומד בתנאים עובר עכשיו, בלי לחכות ללחיצה.

select auto_advance_student(id) from students where status = 'draft';
