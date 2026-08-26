-- נרמול טלפון אחיד: המרת קידומת בינלאומית בכל מקום
--
-- הנרמול של טלפון תלמיד היה regexp_replace(phone, '[^0-9]', '', 'g') -
-- ספרות בלבד, בלי טיפול בקידומת בינלאומית:
--
--     052-1234567      →  0521234567
--     +972-52-1234567  →  972521234567
--
-- אותו אדם, שתי מחרוזות. ההתאמה בין תלמידים לרשימות טלפון (043) משווה
-- את students.phone_normalized ל-phone_list_entries.normalized_phone
-- ישירות, ולכן טלפון שהוקלד בצורה הבינלאומית פשוט לא נמצא. זו אותה
-- משפחת כשל של באג האפס המוביל בת.ז שתוקן ב-098.
--
-- normalize_phone_for_match() כבר קיימת מ-090 ומטפלת ב-972 - אבל היא
-- הייתה בשימוש לראשי קבוצה בלבד. כאן היא הופכת לנרמול היחיד, ומקבלת
-- את הסייג שהיה חסר בה: "972" בתחילת המספר הוא קידומת מדינה רק כשאורך
-- המספר מעיד על כך. בלעדיו מספר מקומי שמתחיל ב-0972 היה נחתך.

create or replace function normalize_phone_for_match(p_phone text)
returns text
language sql
immutable
as $$
  with d as (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as digits)
  select nullif(
    case
      -- 00972 - צורת חיוג בינלאומי נפוצה בישראל
      when d.digits like '00972%' then '0' || substring(d.digits from 6)
      -- 972 בהתחלה, ורק כשהאורך מתאים למספר בינלאומי מלא. מספר ישראלי
      -- מקומי הוא תשע או עשר ספרות ומתחיל ב-0, ולכן לעולם לא ייחתך כאן.
      when d.digits like '972%' and length(d.digits) >= 11 then '0' || substring(d.digits from 4)
      else d.digits
    end, '')
  from d;
$$;

comment on function normalize_phone_for_match(text) is
  'הצורה הקנונית של טלפון להשוואה: מקומי, ספרות בלבד, קידומת בינלאומית מומרת ל-0. ראה מיגרציה 106.';

-- ===== יבוא התלמידים: זהה ל-094, למעט שורת נרמול הטלפון =====
create or replace function commit_students_import_batch(p_batch_id uuid)
returns table (created_count integer, duplicate_count integer, invalid_count integer, assigned_count integer, bank_account_count integer)
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
  v_student_id uuid;
  v_group_name text;
  v_org_number text;
  v_branch_code text;
  v_bank_input text;
  v_bank_code text;
  v_bank_name text;
  v_bank_branch text;
  v_account_number text;
  v_org_id uuid;
  v_branch_id uuid;
  v_group_id uuid;
  v_assigned integer := 0;
  v_accounts integer := 0;
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
      v_phone_normalized := normalize_phone_for_match(v_phone_raw);
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

      v_group_name := nullif(trim(v_row.raw ->> 'שם קבוצה'), '');
      v_org_number := nullif(trim(v_row.raw ->> 'סמל מוסד'), '');
      v_branch_code := nullif(trim(v_row.raw ->> 'מספר סניף'), '');
      -- אותו נרמול כמו ביבוא קובץ האב: "1" ו-"01" הם אותו סניף.
      if v_branch_code ~ '^[0-9]+$' then v_branch_code := lpad(v_branch_code, 2, '0'); end if;
      v_bank_input := nullif(trim(v_row.raw ->> 'בנק'), '');
      v_bank_branch := nullif(trim(v_row.raw ->> 'סניף בנק'), '');
      v_account_number := nullif(trim(v_row.raw ->> 'מספר חשבון'), '');

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
        address_street, address_house_number, address_city, study_code, passport_country, status,
        source_import_batch_id
      )
      values (
        v_id_type, v_external_id, v_full_name, v_phone_raw, v_phone_normalized, v_birth_date,
        v_address_street, v_address_house_number, v_address_city, v_study_code, v_passport_country, 'draft',
        p_batch_id
      )
      returning id into v_student_id;

      -- שיוך לקבוצה דרך השרשרת המלאה עמותה -> סניף -> קבוצה, ולא לפי שם הקבוצה
      -- לבדו: אותו שם חוזר בכמה סניפים ובכמה עמותות (למשל "כללי"), ושיוך לפי שם
      -- בלבד היה מצמיד תלמיד לקבוצה של עמותה אחרת. חוליה חסרה = אין שיוך, אבל
      -- התלמיד עדיין נוצר, והספירה בסוף מראה כמה נשארו בלי שיוך.
      v_org_id := null; v_branch_id := null; v_group_id := null;
      if v_org_number is not null then
        select id into v_org_id from organizations where org_number = v_org_number limit 1;
      end if;
      if v_org_id is not null and v_branch_code is not null then
        select id into v_branch_id from branches where organization_id = v_org_id and talmud_branch_code = v_branch_code;
      end if;
      if v_branch_id is not null and v_group_name is not null then
        select id into v_group_id from groups where branch_id = v_branch_id and name = v_group_name;
      end if;
      if v_group_id is not null then
        insert into student_assignments (student_id, organization_id, branch_id, group_id, start_date, is_active)
        values (v_student_id, v_org_id, v_branch_id, v_group_id, current_date, true);
        v_assigned := v_assigned + 1;
      end if;

      -- חשבון בנק. הקוד מושלם משם הבנק וההפך, כך שגם "פועלים" וגם "12" מגיעים
      -- לאותה תוצאה.
      --
      -- verification_status נשאר 'pending' במכוון: חשבון שנקלט מקובץ לא נבדק מול
      -- מסמך, והמערכת חוסמת תשלום לחשבון לא מאומת. יבוא לא אמור לעקוף בדיקה.
      if v_account_number is not null then
        v_bank_code := resolve_bank_code(v_bank_input);
        v_bank_name := coalesce(bank_name_for_code(v_bank_code), v_bank_input);
        insert into student_bank_accounts (student_id, bank_name, bank_code, bank_branch_code, account_number, is_active)
        values (v_student_id, v_bank_name, v_bank_code, v_bank_branch, v_account_number, true);
        v_accounts := v_accounts + 1;
      end if;

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
    jsonb_build_object('created', v_created, 'duplicate', v_duplicate, 'invalid', v_invalid, 'assigned', v_assigned, 'bank_accounts', v_accounts)
  );

  created_count := v_created;
  duplicate_count := v_duplicate;
  invalid_count := v_invalid;
  assigned_count := v_assigned;
  bank_account_count := v_accounts;
  return next;
end;
$$;

-- ===== יישור הנתונים הקיימים =====
--
-- בלי זה התיקון חל רק על מה שייכנס מעכשיו, ורשומה שנשמרה בעבר בצורה
-- הבינלאומית תישאר בלתי ניתנת להתאמה לנצח.

update students
set phone_normalized = normalize_phone_for_match(phone_raw)
where phone_raw is not null
  and phone_normalized is distinct from normalize_phone_for_match(phone_raw);

update phone_list_entries
set normalized_phone = normalize_phone_for_match(raw_phone)
where raw_phone is not null
  and normalized_phone is distinct from normalize_phone_for_match(raw_phone);

-- אינדקס להתאמה עצמה. ההשוואה היא בין העמודות השמורות, ולכן האינדקס
-- על העמודה ולא על הפונקציה.
create index if not exists students_phone_normalized_idx
  on students (phone_normalized) where phone_normalized is not null;
