-- שלב 27: ביטול יבוא תלמידים - לבקשת Chani אחרי שיובא בטעות קובץ מתלמוד כרשימת
-- תלמידים, ולא הייתה שום דרך להסיר את מה שנוצר: לטבלת students יש policy לקריאה,
-- יצירה ועדכון בלבד (009/028) ואין policy למחיקה כלל, כך שמחיקה חסומה לגמרי דרך
-- ה-API. זו הייתה החלטה נכונה (מערכת כספית - רשומות לא נמחקות), אבל היא הותירה יבוא
-- שגוי כנתון קבוע. הפונקציות כאן הן הנתיב היחיד והמבוקר למחיקה: SECURITY DEFINER
-- (עוקף RLS בדיוק כמו delete_demo_batch משלב 15), מוגן בהרשאה, מתועד ביומן, ורק על
-- תלמידים שנוצרו באצווה מסוימת ושלא נעשה בהם שימוש בפועל.
--
-- למה עמודת קישור ולא התאמה לפי מזהה בזמן אמת: אם מישהו יערוך את המזהה החיצוני של
-- תלמיד אחרי היבוא, התאמה לפי (id_type, external_id) לא תמצא אותו - או גרוע מכך,
-- תמצא תלמיד אחר. עמודה מפורשת קושרת את השורה לאצווה שיצרה אותה, אחת ולתמיד.
alter table students add column source_import_batch_id uuid references import_batches(id);

create index students_source_import_batch_idx on students (source_import_batch_id);

-- שני helpers - אותה נגזרת בדיוק שמשמשת גם את ה-commit (086) וגם את הביטול, כדי
-- ששניהם לעולם לא יתפצלו. הדוח הרשמי של תלמוד מגיע בכותרות אחרות מהפורמט הפשוט,
-- ושתי הצורות נתמכות (086).
create or replace function students_import_id_type(p_raw jsonb)
returns text
language sql
immutable
as $$
  select case nullif(trim(coalesce(p_raw ->> 'סוג מזהה', p_raw ->> 'מזהה תלמיד')), '')
    when 'israeli_id' then 'israeli_id'
    when 'passport' then 'passport'
    when 'other' then 'other'
    when 'ת"ז' then 'israeli_id'
    when 'תז' then 'israeli_id'
    when 'תעודת זהות' then 'israeli_id'
    when 'דרכון' then 'passport'
    when 'אחר' then 'other'
    else 'israeli_id'
  end;
$$;

create or replace function students_import_external_id(p_raw jsonb)
returns text
language sql
immutable
as $$
  select nullif(trim(coalesce(p_raw ->> 'מזהה חיצוני', p_raw ->> 'ת.ז/דרכון')), '');
$$;

-- מילוי למפרע לאצוות שכבר נקלטו לפני שהעמודה קיימת (כולל היבוא השגוי שהוליד את
-- הצורך) - התאמה חד-פעמית לפי המזהה, שנכונה כל עוד איש לא ערך את המזהה עצמו בינתיים.
-- מכאן ואילך הקישור נכתב ישירות ב-commit ואינו תלוי בהתאמה.
update students s
set source_import_batch_id = ir.batch_id
from import_rows ir
join import_batches ib on ib.id = ir.batch_id
join import_profiles ip on ip.id = ib.profile_id
where ip.key = 'students'
  and ir.status = 'committed'
  and s.source_import_batch_id is null
  and s.id_type = students_import_id_type(ir.raw)
  and s.external_id = students_import_external_id(ir.raw);

-- ה-commit (086) נכתב מחדש רק כדי לרשום את הקישור לאצווה ולהשתמש ב-helpers. שאר
-- הלוגיקה זהה לחלוטין - אותם שדות, אותן בדיקות, אותה התנהגות.
create or replace function commit_students_import_batch(p_batch_id uuid)
returns table (created_count integer, duplicate_count integer, invalid_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_open_rows integer;
  v_batch_status text;
  v_id_type text;
  v_external_id text;
  v_full_name text;
  v_phone_raw text;
  v_phone_normalized text;
  v_birth_date date;
  v_address_street text;
  v_address_house_number text;
  v_address_city text;
  v_study_code text;
  v_created integer := 0;
  v_duplicate integer := 0;
  v_invalid integer := 0;
begin
  if not has_permission('students', 'manage') then
    raise exception 'permission denied';
  end if;

  select ib.status into v_batch_status
  from import_batches ib join import_profiles ip on ip.id = ib.profile_id
  where ib.id = p_batch_id and ip.key = 'students';
  if v_batch_status is null then
    raise exception 'האצווה אינה מפרופיל יבוא תלמידים';
  end if;
  if v_batch_status not in ('uploaded', 'previewed') then
    raise exception 'לא ניתן לקלוט אצווה בסטטוס %', v_batch_status;
  end if;

  select count(*) into v_open_rows from import_rows where batch_id = p_batch_id and status = 'needs_decision';
  if v_open_rows > 0 then
    raise exception 'לא ניתן לקלוט אצווה עם % שורות שטרם הוכרעו ("דורש החלטה")', v_open_rows;
  end if;

  for v_row in select * from import_rows where batch_id = p_batch_id and status = 'valid' order by row_number loop
    begin
      v_id_type := students_import_id_type(v_row.raw);
      v_external_id := students_import_external_id(v_row.raw);

      v_full_name := nullif(trim(v_row.raw ->> 'שם מלא'), '');
      if v_full_name is null then
        v_full_name := nullif(trim(concat_ws(' ', nullif(trim(v_row.raw ->> 'שם תלמיד'), ''), nullif(trim(v_row.raw ->> 'שם משפחה'), ''))), '');
      end if;

      if v_external_id is null or v_full_name is null then
        update import_rows set status = 'invalid', error_message = 'חסר מזהה חיצוני ו/או שם מלא' where id = v_row.id;
        v_invalid := v_invalid + 1;
        continue;
      end if;

      if exists (select 1 from students where id_type = v_id_type and external_id = v_external_id) then
        update import_rows set status = 'invalid', error_message = 'כבר קיים תלמיד עם אותו סוג מזהה ומספר מזהה' where id = v_row.id;
        v_duplicate := v_duplicate + 1;
        continue;
      end if;

      v_phone_raw := nullif(trim(v_row.raw ->> 'טלפון'), '');
      v_phone_normalized := nullif(regexp_replace(coalesce(v_phone_raw, ''), '[^0-9]', '', 'g'), '');
      v_address_street := nullif(trim(v_row.raw ->> 'כתובת'), '');
      v_address_house_number := nullif(trim(v_row.raw ->> 'מס בית'), '');
      v_address_city := nullif(trim(coalesce(v_row.raw ->> 'עיר', v_row.raw ->> 'ישוב מגורים')), '');
      v_study_code := nullif(trim(coalesce(v_row.raw ->> 'קוד לימוד', v_row.raw ->> 'קוד סוג לימוד')), '');

      v_birth_date := null;
      begin
        if nullif(trim(v_row.raw ->> 'תאריך לידה'), '') is not null then
          v_birth_date := (v_row.raw ->> 'תאריך לידה')::date;
        end if;
      exception when others then
        v_birth_date := null;
      end;

      insert into students (
        id_type, external_id, full_name, phone_raw, phone_normalized, birth_date,
        address_street, address_house_number, address_city, study_code, status,
        source_import_batch_id
      )
      values (
        v_id_type, v_external_id, v_full_name, v_phone_raw, v_phone_normalized, v_birth_date,
        v_address_street, v_address_house_number, v_address_city, v_study_code, 'draft',
        p_batch_id
      );

      update import_rows set status = 'committed' where id = v_row.id;
      v_created := v_created + 1;
    exception when others then
      update import_rows set status = 'invalid', error_message = 'שגיאה בעיבוד השורה: ' || sqlerrm where id = v_row.id;
      v_invalid := v_invalid + 1;
    end;
  end loop;

  update import_batches set
    valid_count = (select count(*) from import_rows where batch_id = p_batch_id and status in ('valid', 'committed')),
    needs_decision_count = (select count(*) from import_rows where batch_id = p_batch_id and status = 'needs_decision'),
    invalid_count = (select count(*) from import_rows where batch_id = p_batch_id and status = 'invalid')
  where id = p_batch_id;

  perform set_config('app.allow_batch_commit', 'true', true);
  update import_batches set status = 'committed', committed_at = now() where id = p_batch_id;

  perform insert_audit_event(
    'commit_students_import_batch', 'students', p_batch_id::text,
    jsonb_build_object('created', v_created, 'duplicate', v_duplicate, 'invalid', v_invalid)
  );

  created_count := v_created;
  duplicate_count := v_duplicate;
  invalid_count := v_invalid;
  return next;
end;
$$;

grant execute on function commit_students_import_batch(uuid) to authenticated;

-- הסיבה החוסמת היחידה למחיקה: התלמיד כבר בשימוש בפועל. עריכה ידנית של פרטיו אינה
-- חוסמת (החלטת Chani: "למחוק גם אותו") - תלמיד שהגיע מיבוא שגוי נשאר שגוי גם אחרי
-- שתיקנו לו טלפון. 12 הטבלאות הן כל מי שמפנה ל-students, כך שאי אפשר לשבור FK
-- קיים או להשאיר רשומה כספית מיותמת.
create or replace function students_import_rollback_block_reason(p_student_id uuid, p_status text)
returns text
language sql
stable
as $$
  select case
    when p_status <> 'draft' then 'התלמיד כבר התקדם בתהליך (' || p_status || ')'
    when exists (select 1 from student_assignments where student_id = p_student_id) then 'קיים שיוך לקבוצה'
    when exists (select 1 from student_bank_accounts where student_id = p_student_id) then 'קיים חשבון בנק'
    when exists (select 1 from monthly_eligibility where student_id = p_student_id) then 'קיימת זכאות חודשית'
    when exists (select 1 from eligibility_financial_results where student_id = p_student_id) then 'קיימת תוצאה כספית'
    when exists (select 1 from masav_lines where student_id = p_student_id) then 'קיימת שורת תשלום במסב'
    when exists (select 1 from distribution_lines where student_id = p_student_id) then 'קיימת שורת חלוקה'
    when exists (select 1 from export_batch_students where student_id = p_student_id) then 'נכלל ביצוא לתלמוד'
    when exists (select 1 from talmud_errors where student_id = p_student_id) then 'קיימת שגיאת תלמוד'
    when exists (select 1 from payment_calculation_versions where student_id = p_student_id) then 'קיימת גרסת חישוב רטרו'
    when exists (select 1 from commission_rules where student_id = p_student_id) then 'קיים כלל עמלה ייעודי'
    when exists (select 1 from audit_attendance where student_id = p_student_id) then 'קיימת נוכחות בביקורת'
    when exists (select 1 from phone_list_entries where matched_student_id = p_student_id) then 'משויך לרשומה ברשימה טלפונית'
    else null
  end;
$$;

-- תצוגה מקדימה - מה יימחק ומה יישאר ולמה. חובה להציג אותה למשתמשת לפני המחיקה,
-- באותו דפוס בדיוק כמו preview_demo_batch_deletion (שלב 15).
create or replace function preview_students_import_rollback(p_batch_id uuid)
returns table (
  student_id uuid,
  full_name text,
  external_id text,
  will_delete boolean,
  block_reason text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('students', 'manage') then
    raise exception 'permission denied';
  end if;
  if not exists (
    select 1 from import_batches ib join import_profiles ip on ip.id = ib.profile_id
    where ib.id = p_batch_id and ip.key = 'students'
  ) then
    raise exception 'האצווה אינה מפרופיל יבוא תלמידים';
  end if;

  return query
  select
    s.id,
    s.full_name,
    s.external_id,
    students_import_rollback_block_reason(s.id, s.status) is null,
    students_import_rollback_block_reason(s.id, s.status)
  from students s
  where s.source_import_batch_id = p_batch_id
  order by s.full_name;
end;
$$;

grant execute on function preview_students_import_rollback(uuid) to authenticated;

-- הביטול עצמו. מוחק רק את מי שהתצוגה המקדימה סימנה כניתן למחיקה, ומחזיר את שתי
-- הספירות כדי שהמסך יוכל לדווח בדיוק מה קרה. שורות ה-import_rows מסומנות בחזרה
-- כ-valid, והאצווה חוזרת ל-previewed, כך שהיסטוריית היבוא משקפת שהקליטה בוטלה
-- ולא מעמידה פנים שהיא מעולם לא קרתה.
create or replace function rollback_students_import_batch(p_batch_id uuid)
returns table (deleted_count integer, kept_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
  v_kept integer := 0;
begin
  if not has_permission('students', 'manage') then
    raise exception 'permission denied';
  end if;
  if not exists (
    select 1 from import_batches ib join import_profiles ip on ip.id = ib.profile_id
    where ib.id = p_batch_id and ip.key = 'students'
  ) then
    raise exception 'האצווה אינה מפרופיל יבוא תלמידים';
  end if;

  select count(*) into v_kept
  from students s
  where s.source_import_batch_id = p_batch_id
    and students_import_rollback_block_reason(s.id, s.status) is not null;

  with removable as (
    select s.id from students s
    where s.source_import_batch_id = p_batch_id
      and students_import_rollback_block_reason(s.id, s.status) is null
  )
  delete from students where id in (select id from removable);
  get diagnostics v_deleted = row_count;

  update import_rows set status = 'valid'
  where batch_id = p_batch_id and status = 'committed';

  perform set_config('app.allow_batch_commit', 'true', true);
  update import_batches set status = 'previewed', committed_at = null where id = p_batch_id;

  perform insert_audit_event(
    'rollback_students_import_batch', 'students', p_batch_id::text,
    jsonb_build_object('deleted', v_deleted, 'kept', v_kept)
  );

  deleted_count := v_deleted;
  kept_count := v_kept;
  return next;
end;
$$;

grant execute on function rollback_students_import_batch(uuid) to authenticated;
