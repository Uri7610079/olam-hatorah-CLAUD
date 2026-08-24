-- Patch לפרויקט החי: התאמת תלמיד לפי ת.ז בקליטת דוחות "תלמוד" (021, כבר רץ).
--
-- הבעיה שהתגלתה בקליטה אמיתית: "תלמוד" מנפיק ת.ז מרופדת לתשע ספרות
-- (066107285), ואילו במערכת אותו תלמיד רשום כפי שהוקלד במקור, בלי האפס
-- (66107285). ההשוואה הייתה מחרוזתית מדויקת, ולכן 447 תלמידים - כמעט
-- שליש מהמרשם - נדחו כ"לא נמצא תלמיד עם מזהה זה", והכסף שלהם לא נכנס.
--
-- הנרמול מסיר אפסים מובילים כשהערך כולו ספרות. דרכון ("A03639807") אינו
-- מספר ולכן נשאר כמות שהוא, רק מנוקה רווחים ובאותיות גדולות - אחרת
-- "a03639807" ו-"A03639807" ייחשבו לשני אנשים.
--
-- אין סכנת התנגשות: שני ערכים שנבדלים רק באפס מוביל הם אותו מספר זהות.

create or replace function normalize_identity(p_value text)
returns text
language sql
immutable
as $$
  select case
    when p_value is null then null
    when btrim(p_value) ~ '^[0-9]+$'
      then coalesce(nullif(ltrim(btrim(p_value), '0'), ''), '0')
    else upper(btrim(p_value))
  end
$$;

comment on function normalize_identity(text) is
  'השוואת ת.ז/דרכון ללא תלות באפסים מובילים וברישיות. ראה מיגרציה 098.';

-- בלי אינדקס פונקציונלי כל שורה בדוח סורקת את מרשם התלמידים כולו,
-- וקובץ אחד של "תלמוד" מכיל כ-2,000 שורות.
create index if not exists students_identity_normalized_idx
  on students (normalize_identity(external_id));

-- ===== commit_eligibility_batch: זהה ל-021, למעט שורת ההתאמה =====
create or replace function commit_eligibility_batch(p_batch_id uuid, p_month date)
returns table (matched_count integer, unmatched_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open_rows integer;
  v_row record;
  v_student_id uuid;
  v_org_id uuid;
  v_matched integer := 0;
  v_unmatched integer := 0;
begin
  if not has_permission('talmud', 'import') then
    raise exception 'permission denied';
  end if;

  select count(*) into v_open_rows from import_rows where batch_id = p_batch_id and status = 'needs_decision';
  if v_open_rows > 0 then
    raise exception 'לא ניתן לקלוט אצווה עם % שורות שטרם הוכרעו במרכז היבוא', v_open_rows;
  end if;

  select organization_id into v_org_id from import_batches where id = p_batch_id;

  for v_row in select * from import_rows where batch_id = p_batch_id and status = 'valid' loop
    begin
      select id into v_student_id from students
      where normalize_identity(external_id) = normalize_identity(v_row.raw ->> 'מזהה תלמיד')
      limit 1;

      if v_student_id is null then
        update import_rows set status = 'invalid', error_message = 'לא נמצא תלמיד עם מזהה זה' where id = v_row.id;
        v_unmatched := v_unmatched + 1;
        continue;
      end if;

      declare
        v_branch_id uuid;
        v_group_id uuid;
        v_amount numeric(12, 2);
      begin
        select sa.branch_id, sa.group_id into v_branch_id, v_group_id
        from student_assignments sa where sa.student_id = v_student_id and sa.is_active = true limit 1;

        if v_branch_id is null then
          update import_rows set status = 'invalid', error_message = 'לתלמיד אין שיוך פעיל' where id = v_row.id;
          v_unmatched := v_unmatched + 1;
          continue;
        end if;

        v_amount := (regexp_replace(v_row.raw ->> 'סכום ברוטו', '[^0-9.\-]', '', 'g'))::numeric;

        update monthly_eligibility set status = 'superseded'
        where student_id = v_student_id and month = p_month and status = 'active';

        insert into monthly_eligibility (student_id, organization_id, branch_id, group_id, month, gross_amount, score_or_payment_type, source_batch_id)
        values (v_student_id, v_org_id, v_branch_id, v_group_id, p_month, v_amount, v_row.raw ->> 'ניקוד/סוג תשלום', p_batch_id);

        update import_rows set status = 'committed' where id = v_row.id;

        perform set_config('app.allow_student_status_change', 'true', true);
        update students set status = 'active' where id = v_student_id and status = 'sent_to_talmud';

        v_matched := v_matched + 1;
      exception when others then
        update import_rows set status = 'invalid', error_message = 'שגיאה בעיבוד השורה: ' || sqlerrm where id = v_row.id;
        v_unmatched := v_unmatched + 1;
      end;
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
    'commit_eligibility_batch', 'import_batches', p_batch_id::text,
    jsonb_build_object('month', p_month, 'matched', v_matched, 'unmatched', v_unmatched)
  );

  return query select v_matched, v_unmatched;
end;
$$;

-- ===== commit_errors_batch (דוח שגויים מתלמוד): זהה ל-021, למעט שורת ההתאמה =====
create or replace function commit_errors_batch(p_batch_id uuid, p_month date)
returns table (matched_count integer, unmatched_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open_rows integer;
  v_row record;
  v_student_id uuid;
  v_org_id uuid;
  v_code text;
  v_recurring boolean;
  v_matched integer := 0;
  v_unmatched integer := 0;
begin
  if not has_permission('talmud', 'import') then
    raise exception 'permission denied';
  end if;

  select count(*) into v_open_rows from import_rows where batch_id = p_batch_id and status = 'needs_decision';
  if v_open_rows > 0 then
    raise exception 'לא ניתן לקלוט אצווה עם % שורות שטרם הוכרעו במרכז היבוא', v_open_rows;
  end if;

  select organization_id into v_org_id from import_batches where id = p_batch_id;

  for v_row in select * from import_rows where batch_id = p_batch_id and status = 'valid' loop
    begin
      select id into v_student_id from students
      where normalize_identity(external_id) = normalize_identity(v_row.raw ->> 'מזהה תלמיד')
      limit 1;
      v_code := trim(v_row.raw ->> 'קוד שגיאה');

      if v_code is null or length(v_code) = 0 then
        update import_rows set status = 'invalid', error_message = 'חסר קוד שגיאה' where id = v_row.id;
        v_unmatched := v_unmatched + 1;
        continue;
      end if;

      v_recurring := false;
      if v_student_id is not null then
        select exists(
          select 1 from talmud_errors
          where student_id = v_student_id and error_code = v_code
            and month = (p_month - interval '1 month')::date
        ) into v_recurring;
      end if;

      insert into talmud_errors (student_id, external_student_ref, organization_id, month, error_code, error_description, is_recurring, source_batch_id)
      values (v_student_id, v_row.raw ->> 'מזהה תלמיד', v_org_id, p_month, v_code, v_row.raw ->> 'תיאור שגיאה', v_recurring, p_batch_id);

      update import_rows set status = 'committed' where id = v_row.id;

      if v_student_id is not null then
        perform set_config('app.allow_student_status_change', 'true', true);
        update students set status = 'active_with_error' where id = v_student_id and status = 'sent_to_talmud';
      end if;

      v_matched := v_matched + 1;
    exception when others then
      update import_rows set status = 'invalid', error_message = 'שגיאה בעיבוד השורה: ' || sqlerrm where id = v_row.id;
      v_unmatched := v_unmatched + 1;
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
    'commit_errors_batch', 'import_batches', p_batch_id::text,
    jsonb_build_object('month', p_month, 'matched', v_matched, 'unmatched', v_unmatched)
  );

  return query select v_matched, v_unmatched;
end;
$$;

-- ===== commit_audit_attendance_batch (נוכחות בביקורת): זהה ל-063 =====
create or replace function commit_audit_attendance_batch(p_batch_id uuid, p_audit_id uuid)
returns table (matched_count integer, unmatched_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open_rows integer;
  v_row record;
  v_student_id uuid;
  v_group_id uuid;
  v_org_id uuid;
  v_ref text;
  v_recurring boolean;
  v_matched integer := 0;
  v_unmatched integer := 0;
  v_batch_status text;
begin
  if not has_permission('audits', 'import') then
    raise exception 'permission denied';
  end if;

  select organization_id into v_org_id from audits where id = p_audit_id;
  if v_org_id is null then
    raise exception 'אירוע ביקורת לא נמצא';
  end if;

  select status into v_batch_status from import_batches where id = p_batch_id;
  if v_batch_status is null then
    raise exception 'אצוות יבוא לא נמצאה';
  end if;
  if v_batch_status not in ('uploaded', 'previewed') then
    raise exception 'לא ניתן לקלוט אצווה בסטטוס %', v_batch_status;
  end if;

  select count(*) into v_open_rows from import_rows where batch_id = p_batch_id and status = 'needs_decision';
  if v_open_rows > 0 then
    raise exception 'לא ניתן לקלוט קובץ עם % שורות שטרם הוכרעו', v_open_rows;
  end if;

  for v_row in select * from import_rows where batch_id = p_batch_id and status = 'valid' loop
    begin
      v_ref := trim(v_row.raw ->> 'מזהה תלמיד');
      if v_ref is null or length(v_ref) = 0 then
        update import_rows set status = 'invalid', error_message = 'חסר מזהה תלמיד' where id = v_row.id;
        v_unmatched := v_unmatched + 1;
        continue;
      end if;

      select id into v_student_id from students
      where normalize_identity(external_id) = normalize_identity(v_ref) limit 1;
      v_group_id := null;
      if v_student_id is not null then
        select group_id into v_group_id from student_assignments
        where student_id = v_student_id and is_active = true
        order by start_date desc limit 1;
      end if;

      v_recurring := false;
      if v_student_id is not null then
        select exists(
          select 1 from audit_attendance aa join audits a on a.id = aa.audit_id
          where aa.student_id = v_student_id and a.organization_id = v_org_id and aa.audit_id <> p_audit_id
        ) into v_recurring;
      end if;

      insert into audit_attendance (audit_id, external_student_ref, student_id, group_id, is_recurring, source_batch_id, created_by)
      values (p_audit_id, v_ref, v_student_id, v_group_id, v_recurring, p_batch_id, auth.uid());

      update import_rows set status = 'committed' where id = v_row.id;
      v_matched := v_matched + 1;
    exception when others then
      update import_rows set status = 'invalid', error_message = 'שגיאה בעיבוד השורה: ' || sqlerrm where id = v_row.id;
      v_unmatched := v_unmatched + 1;
    end;
  end loop;

  update import_batches set
    valid_count = (select count(*) from import_rows where batch_id = p_batch_id and status in ('valid', 'committed')),
    needs_decision_count = (select count(*) from import_rows where batch_id = p_batch_id and status = 'needs_decision'),
    invalid_count = (select count(*) from import_rows where batch_id = p_batch_id and status = 'invalid')
  where id = p_batch_id;

  perform set_config('app.allow_batch_commit', 'true', true);
  update import_batches set status = 'committed', committed_at = now() where id = p_batch_id;

  perform set_config('app.allow_audit_complete', 'true', true);
  update audits set status = 'completed', source_batch_id = p_batch_id where id = p_audit_id;

  perform insert_audit_event(
    'commit_audit_attendance_batch', 'audits', p_audit_id::text,
    jsonb_build_object('batch_id', p_batch_id, 'matched', v_matched, 'unmatched', v_unmatched)
  );

  return query select v_matched, v_unmatched;
end;
$$;

-- ===== commit_students_import_batch: זהה ל-094 =====
-- כאן הנרמול מחמיר את בדיקת הכפילות: בלעדיו תלמיד קיים שמגיע בקובץ
-- עם אפס מוביל היה נכנס פעם שנייה כרשומה חדשה, ומפצל את ההיסטוריה שלו.
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

      if exists (select 1 from students where id_type = v_id_type
                 and normalize_identity(external_id) = normalize_identity(v_external_id)) then
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

-- ===== commit_commission_rules_import_batch: זהה ל-079 =====
create or replace function commit_commission_rules_import_batch(p_batch_id uuid, p_organization_id uuid)
returns table (created_count integer, invalid_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_created integer := 0;
  v_invalid integer := 0;
  v_group_name text;
  v_group_id uuid;
  v_study_code text;
  v_student_external_id text;
  v_student_id uuid;
  v_calc_type text;
  v_percentage numeric(5, 2);
  v_fixed_amount numeric(12, 2);
  v_rounding text;
  v_priority integer;
  v_from date;
  v_until date;
  v_text text;
begin
  if not has_permission('commission_rules', 'manage') then
    raise exception 'permission denied';
  end if;

  for v_row in select * from import_rows where batch_id = p_batch_id and status in ('valid', 'needs_decision') loop
    begin
      v_group_id := null;
      v_student_id := null;
      v_percentage := null;
      v_fixed_amount := null;
      v_priority := 0;
      v_from := null;
      v_until := null;

      -- קבוצה (לא חובה)
      v_group_name := trim(coalesce(v_row.raw ->> 'שם קבוצה', ''));
      if length(v_group_name) > 0 then
        select g.id into v_group_id
        from groups g
        join branches b on b.id = g.branch_id
        where b.organization_id = p_organization_id and g.name = v_group_name
        limit 1;

        if v_group_id is null then
          update import_rows set status = 'invalid', error_message = 'לא נמצאה קבוצה בשם "' || v_group_name || '" בעמותה זו' where id = v_row.id;
          v_invalid := v_invalid + 1;
          continue;
        end if;
      end if;

      -- קוד לימוד (לא חובה)
      v_study_code := nullif(trim(coalesce(v_row.raw ->> 'קוד לימוד', '')), '');
      if v_study_code is not null and not exists (select 1 from study_codes where code = v_study_code) then
        update import_rows set status = 'invalid', error_message = 'קוד לימוד "' || v_study_code || '" לא קיים' where id = v_row.id;
        v_invalid := v_invalid + 1;
        continue;
      end if;

      -- חריג לתלמיד ספציפי (לא חובה) - לפי מזהה חיצוני
      v_student_external_id := nullif(trim(coalesce(v_row.raw ->> 'מזהה תלמיד חיצוני', '')), '');
      if v_student_external_id is not null then
        select id into v_student_id from students
          where normalize_identity(external_id) = normalize_identity(v_student_external_id) limit 1;
        if v_student_id is null then
          update import_rows set status = 'invalid', error_message = 'לא נמצא תלמיד עם מזהה חיצוני "' || v_student_external_id || '"' where id = v_row.id;
          v_invalid := v_invalid + 1;
          continue;
        end if;
      end if;

      -- סוג חישוב (חובה, מתוך רשימה סגורה - אין ניחוש ברירת מחדל)
      v_calc_type := trim(coalesce(v_row.raw ->> 'סוג חישוב', ''));
      if v_calc_type not in ('percentage', 'fixed', 'combined') then
        update import_rows set status = 'invalid', error_message = 'סוג חישוב לא תקין (נדרש percentage/fixed/combined): "' || v_calc_type || '"' where id = v_row.id;
        v_invalid := v_invalid + 1;
        continue;
      end if;

      -- אחוז (בדיקת ה-CHECK של הטבלה: 0-100, מראש)
      v_text := nullif(trim(coalesce(v_row.raw ->> 'אחוז', '')), '');
      if v_text is not null then
        begin
          v_percentage := v_text::numeric;
        exception when others then
          v_percentage := null;
        end;
        if v_percentage is null or v_percentage < 0 or v_percentage > 100 then
          update import_rows set status = 'invalid', error_message = 'אחוז לא תקין (חייב להיות בין 0 ל-100)' where id = v_row.id;
          v_invalid := v_invalid + 1;
          continue;
        end if;
      end if;

      -- סכום קבוע (בדיקת ה-CHECK של הטבלה: >= 0, מראש)
      v_text := nullif(trim(coalesce(v_row.raw ->> 'סכום קבוע', '')), '');
      if v_text is not null then
        begin
          v_fixed_amount := v_text::numeric;
        exception when others then
          v_fixed_amount := null;
        end;
        if v_fixed_amount is null or v_fixed_amount < 0 then
          update import_rows set status = 'invalid', error_message = 'סכום קבוע לא תקין (חייב להיות 0 ומעלה)' where id = v_row.id;
          v_invalid := v_invalid + 1;
          continue;
        end if;
      end if;

      -- כלל עיגול (לא חובה - ברירת מחדל none, כמו ברירת המחדל של העמודה עצמה)
      v_rounding := nullif(trim(coalesce(v_row.raw ->> 'כלל עיגול', '')), '');
      if v_rounding is null then
        v_rounding := 'none';
      elsif v_rounding not in ('none', 'round_int', 'ceil_int', 'floor_int') then
        update import_rows set status = 'invalid', error_message = 'כלל עיגול לא תקין: "' || v_rounding || '"' where id = v_row.id;
        v_invalid := v_invalid + 1;
        continue;
      end if;

      -- עדיפות (לא חובה - ברירת מחדל 0)
      v_text := nullif(trim(coalesce(v_row.raw ->> 'עדיפות', '')), '');
      if v_text is null then
        v_priority := 0;
      else
        begin
          v_priority := v_text::integer;
        exception when others then
          v_priority := null;
        end;
        if v_priority is null then
          update import_rows set status = 'invalid', error_message = 'עדיפות לא תקינה (חייב להיות מספר שלם)' where id = v_row.id;
          v_invalid := v_invalid + 1;
          continue;
        end if;
      end if;

      -- תקף מתאריך (חובה)
      begin
        v_from := trim(v_row.raw ->> 'תקף מתאריך')::date;
      exception when others then
        v_from := null;
      end;
      if v_from is null then
        update import_rows set status = 'invalid', error_message = 'תקף מתאריך חסר או לא תקין' where id = v_row.id;
        v_invalid := v_invalid + 1;
        continue;
      end if;

      -- תקף עד תאריך (לא חובה, אך אם קיים חייב שיהיה >= תקף מתאריך - בדיקת ה-CHECK מראש)
      v_text := nullif(trim(coalesce(v_row.raw ->> 'תקף עד תאריך', '')), '');
      if v_text is not null then
        begin
          v_until := v_text::date;
        exception when others then
          v_until := null;
        end;
        if v_until is null then
          update import_rows set status = 'invalid', error_message = 'תקף עד תאריך לא תקין' where id = v_row.id;
          v_invalid := v_invalid + 1;
          continue;
        end if;
        if v_until < v_from then
          update import_rows set status = 'invalid', error_message = 'תקף עד תאריך חייב להיות אחרי תקף מתאריך' where id = v_row.id;
          v_invalid := v_invalid + 1;
          continue;
        end if;
      end if;

      insert into commission_rules (
        organization_id, group_id, study_code, student_id, calculation_type,
        percentage, fixed_amount, rounding_rule, priority, effective_from, effective_until, notes
      ) values (
        p_organization_id, v_group_id, v_study_code, v_student_id, v_calc_type,
        v_percentage, v_fixed_amount, v_rounding, v_priority, v_from, v_until,
        nullif(trim(coalesce(v_row.raw ->> 'הערות', '')), '')
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
    'commit_commission_rules_import_batch', 'import_batches', p_batch_id::text,
    jsonb_build_object('organization_id', p_organization_id, 'created', v_created, 'invalid', v_invalid)
  );

  return query select v_created, v_invalid;
end;
$$;
