-- שלב 25 (חלק א'): יבוא Excel לתלמידים (יצירה בכמות). אותו דפוס מוכח בדיוק כמו
-- זכאות/שגויים/ביקורות/קובץ אב (018/019/042/054): פרופיל יבוא ייעודי + commit
-- ספציפי-דומיין שקורא מ-import_rows.raw (JSON גולמי לפי כותרת עמודה, ר' מנוע היבוא
-- הגנרי ב-013) וכותב ל-students בפועל. אינו נוגע בתשתית הגנרית עצמה (import_profiles/
-- import_batches/import_rows) - רק מוסיף עליה פרופיל ופונקציית commit, כמו כל דומיין קודם.
--
-- status על תלמיד חדש תמיד 'draft' - students_enforce_status_transition (008) חוסמת
-- כל דבר אחר ב-INSERT ממילא (raise exception אם status <> 'draft'), כך שה-commit הזה
-- לא נלחם בטריגר, רק נותן את אותו ערך במפורש כדי שהכוונה תהיה גלויה בקוד.
--
-- ייחוד תלמיד הוא (id_type, external_id) - לא לפי שם (008, אילוץ unique). שורה שכבר
-- קיימת בטבלת students מסומנת invalid ונספרת בנפרד (duplicate_count) מ"שגוי בגלל שדה
-- חובה חסר" (invalid_count) - לא כדי לחסום את שאר האצווה, רק את השורה הזו, אותו עיקרון
-- בדיוק כמו commit_eligibility_batch/commit_master_data_import_batch/commit_audit_attendance_batch.
--
-- נרמול טלפון: regexp_replace(phone_raw, '[^0-9]', '', 'g') - זהה בדיוק לנרמול בצד לקוח
-- ב-StudentsListScreen.tsx (handleCreate, form.phone.replace(/\D/g, "")), רק מבוצע כאן
-- בשרת כי היבוא לא עובר דרך אותו קוד React.
--
-- סוג מזהה: העמודה בקובץ עשויה להכיל גם את ערך ה-enum באנגלית (israeli_id/passport/
-- other, אם הקובץ הופק מיצוא של המערכת עצמה) וגם את התווית העברית שמוצגת בטופס הידני
-- (ת"ז/דרכון/אחר, ר' ID_TYPE_LABEL ב-types.ts) - שתי הצורות מתקבלות. כל ערך אחר, כולל
-- ריק, מקבל ברירת המחדל הרגילה של הטבלה עצמה: israeli_id.

insert into import_profiles (key, label_he, description) values
  ('students', 'יבוא תלמידים מאקסל',
   'עמודות: סוג מזהה (ת"ז/דרכון/אחר - לא חובה, ברירת מחדל ת"ז), מזהה חיצוני (חובה), שם מלא (חובה), טלפון, תאריך לידה, כתובת, קוד לימוד. כל תלמיד חדש נוצר בסטטוס טיוטה, בדיוק כמו יצירה ידנית של תלמיד בודד.');

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
  v_address text;
  v_study_code text;
  v_created integer := 0;
  v_duplicate integer := 0;
  v_invalid integer := 0;
begin
  if not has_permission('students', 'manage') then
    raise exception 'permission denied';
  end if;

  -- בדיקת סטטוס-אצווה מוקדמת ומפורשת - אותה תוספת שנעשתה ב-063 לכל commit RPC אחר,
  -- כדי לא לחזור על אותה חוסר-עקביות שנתפסה שם בביקורת (הסתמכות רק על סינון valid).
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

      -- כפילות לפי (id_type, external_id) מול תלמידים קיימים - לא חריגה שמפילה את
      -- כל האצווה, רק דילוג על השורה הזו וספירתה בנפרד מ"שגוי" (ר' הערת הפתיחה).
      if exists (select 1 from students where id_type = v_id_type and external_id = v_external_id) then
        update import_rows set status = 'invalid', error_message = 'כבר קיים תלמיד עם אותו סוג מזהה ומספר מזהה' where id = v_row.id;
        v_duplicate := v_duplicate + 1;
        continue;
      end if;

      v_phone_raw := nullif(trim(v_row.raw ->> 'טלפון'), '');
      v_phone_normalized := nullif(regexp_replace(coalesce(v_phone_raw, ''), '[^0-9]', '', 'g'), '');
      v_address := nullif(trim(v_row.raw ->> 'כתובת'), '');
      v_study_code := nullif(trim(v_row.raw ->> 'קוד לימוד'), '');

      -- תאריך לידה לא חובה ולא במבנה קשיח בקובץ מקור - פרסור כושל (טקסט חופשי וכו')
      -- לא אמור להפיל את כל השורה, רק להשאיר את השדה ריק.
      v_birth_date := null;
      begin
        if nullif(trim(v_row.raw ->> 'תאריך לידה'), '') is not null then
          v_birth_date := (v_row.raw ->> 'תאריך לידה')::date;
        end if;
      exception when others then
        v_birth_date := null;
      end;

      insert into students (id_type, external_id, full_name, phone_raw, phone_normalized, birth_date, address, study_code, status)
      values (v_id_type, v_external_id, v_full_name, v_phone_raw, v_phone_normalized, v_birth_date, v_address, v_study_code, 'draft');

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
