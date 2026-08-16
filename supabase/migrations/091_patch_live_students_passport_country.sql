-- Patch לפרויקט החי: מדינת דרכון לתלמיד.
--
-- בקובץ אמיתי של הלקוח 40 מתוך 1583 התלמידים מזוהים בדרכון ולא בתעודת זהות.
-- מספר דרכון אינו ייחודי בעולם - שתי מדינות יכולות להנפיק את אותו מספר - ולכן
-- בלי המדינה המספר לבדו אינו מזהה. עד כה לא הייתה עמודה כזו בכלל.
--
-- הפונקציה נוצרת מחדש מתוך הגרסה שבדיסק (086) בשלוש עריכות ממוקדות בלבד:
-- משתנה, שליפת הערך, והוספה ל-INSERT. כל השאר זהה בייט-לבייט.

alter table students add column if not exists passport_country text;

-- אינדקס חלקי: רלוונטי רק לתלמידי דרכון, שהם מיעוט קטן.
create index if not exists students_passport_country_idx
  on students (passport_country) where id_type = 'passport';

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
  v_passport_country text;
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
      -- סוג מזהה: מתקבל גם מהעמודה הפשוטה ("סוג מזהה") וגם מהדוח הרשמי, ששם הערך
      -- שמופיע בפועל הוא "תעודת זהות" (לא "ת\"ז") - ר' הערת הפתיחה, זו לא טעות בקובץ.
      v_id_type_raw := nullif(trim(coalesce(v_row.raw ->> 'סוג מזהה', v_row.raw ->> 'מזהה תלמיד')), '');
      v_id_type := case v_id_type_raw
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

      v_external_id := nullif(trim(coalesce(v_row.raw ->> 'מזהה חיצוני', v_row.raw ->> 'ת.ז/דרכון')), '');

      -- שם מלא: מהעמודה הפשוטה, או צירוף "שם תלמיד" + "שם משפחה" מהדוח הרשמי (שני
      -- שדות נפרדים שם, לא אחד).
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
      -- עיר: מהעמודה הפשוטה, או "ישוב מגורים" מהדוח הרשמי (המידע היחיד על כתובת שקיים
      -- שם - אין רחוב/מספר בית בדוח הרשמי בכלל).
      v_address_city := nullif(trim(coalesce(v_row.raw ->> 'עיר', v_row.raw ->> 'ישוב מגורים')), '');
      -- קוד לימוד: מהעמודה הפשוטה, או "קוד סוג לימוד" מהדוח הרשמי.
      v_study_code := nullif(trim(coalesce(v_row.raw ->> 'קוד לימוד', v_row.raw ->> 'קוד סוג לימוד')), '');
      -- מדינת הדרכון נשמרת רק כשסוג המזהה הוא דרכון. לתעודת זהות ישראלית אין
      -- משמעות למדינה, ושמירה שלה שם רק הייתה מייצרת נתון מטעה.
      v_passport_country := case when v_id_type = 'passport'
        then nullif(trim(v_row.raw ->> 'מדינת דרכון'), '') else null end;

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
        address_street, address_house_number, address_city, study_code, passport_country, status
      )
      values (
        v_id_type, v_external_id, v_full_name, v_phone_raw, v_phone_normalized, v_birth_date,
        v_address_street, v_address_house_number, v_address_city, v_study_code, v_passport_country, 'draft'
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
