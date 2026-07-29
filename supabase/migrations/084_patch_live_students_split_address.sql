-- Patch לפרויקט החי (076 כבר רץ בפועל - Chani אישרה "הרצתי 76-82"): לבקשת הלקוח (דרך
-- Chani, בתשובה למייל שאלות על מבנה הנתונים) - כתובת תלמיד נשמרת מפוצלת (רחוב/מספר
-- בית/עיר), לא שדה טקסט חופשי אחד. הקובץ הרשמי של משרד הדתות מייצא בדיוק בפיצול הזה
-- ("כתובת"=רחוב, "מס בית", "עיר" - 3 עמודות נפרדות).
--
-- העמודה הישנה students.address (טקסט חופשי) נשארת בכוונה בסכימה - לא drop. ייתכן שכבר
-- הוזנו בה נתונים; היא רק מפסיקה לשמש במסכים/יבוא/ייצוא החדשים מכאן ואילך.

alter table students
  add column address_street text,
  add column address_house_number text,
  add column address_city text;

-- commit_students_import_batch (076): אותו signature בדיוק (create or replace מספיק,
-- אין צורך ב-DROP) - רק הגוף משתנה כדי לקרוא 3 עמודות כתובת נפרדות במקום "כתובת" יחידה,
-- ולכתוב ל-3 העמודות החדשות במקום לעמודת address הישנה.
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
  v_id_type_raw text;
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
      v_id_type_raw := nullif(trim(v_row.raw ->> 'סוג מזהה'), '');
      v_id_type := case v_id_type_raw
        when 'israeli_id' then 'israeli_id'
        when 'passport' then 'passport'
        when 'other' then 'other'
        when 'ת"ז' then 'israeli_id'
        when 'תז' then 'israeli_id'
        when 'דרכון' then 'passport'
        when 'אחר' then 'other'
        else 'israeli_id'
      end;

      v_external_id := nullif(trim(v_row.raw ->> 'מזהה חיצוני'), '');
      v_full_name := nullif(trim(v_row.raw ->> 'שם מלא'), '');

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
      -- כתובת מפוצלת - "כתובת" נשאר שם העמודה לרחוב (תואם את הקובץ הרשמי של משרד
      -- הדתות מילה-במילה), "מס בית" ו"עיר" הן שתי עמודות חדשות.
      v_address_street := nullif(trim(v_row.raw ->> 'כתובת'), '');
      v_address_house_number := nullif(trim(v_row.raw ->> 'מס בית'), '');
      v_address_city := nullif(trim(v_row.raw ->> 'עיר'), '');
      v_study_code := nullif(trim(v_row.raw ->> 'קוד לימוד'), '');

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
        address_street, address_house_number, address_city, study_code, status
      )
      values (
        v_id_type, v_external_id, v_full_name, v_phone_raw, v_phone_normalized, v_birth_date,
        v_address_street, v_address_house_number, v_address_city, v_study_code, 'draft'
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

update import_profiles
set description = 'עמודות: סוג מזהה (ת"ז/דרכון/אחר - לא חובה, ברירת מחדל ת"ז), מזהה חיצוני (חובה), שם מלא (חובה), טלפון, תאריך לידה, כתובת (רחוב), מס בית, עיר, קוד לימוד. כל תלמיד חדש נוצר בסטטוס טיוטה, בדיוק כמו יצירה ידנית של תלמיד בודד.'
where key = 'students';
