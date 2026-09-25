-- תיקונים מבדיקת הקוד המקיפה (ספטמבר 2026)
--
-- שתיים מהמיגרציות הקודמות נבנו מגרסה ישנה של פונקציה במקום מהאחרונה,
-- ובכך ביטלו בשקט תיקון שכבר נעשה. כל פונקציה כאן נבנתה מהגרסה האחרונה
-- שלה בחילוץ ותיקון נקודתי - לא בהקלדה מחדש, שהיא בדיוק מה שגרם לזה.
--
--   1. יבוא תלמידים (106 בנתה מ-094): חזרה להשוואת ת.ז מדויקת, ביטול
--      התיקון של 098. תלמיד 066107285 היה נוצר פעמיים מול 66107285.
--   2. יבוא כללי עמלה (109 הוקלדה מחדש): שורות "דורש החלטה" דולגו בשקט
--      והאצווה סומנה כנקלטה; נשמטו גם בדיקת תאריך חסר ובדיקת עד >= מ.
--   3. נרמול טלפון: +972-052-1234567 נהיה 00521234567. וגם: האינדקס על
--      טלפון ראש הקבוצה נבנה על הפונקציה, ולא נבנה מחדש מאז ששונתה ב-106.
--   4. השלמת שורות שנדחו: עיבדה גם שורות שהמפעיל דחה בכוונה.
--   5. מרכז החריגות: הציג אותן שורות ככסף להשלמה.
--   6. הזמנת משתמש: ההרשאה ניתנה למי שנרשם ראשון עם הכתובת, לפני שאימת
--      שהיא שלו.

-- ===== 1. יבוא תלמידים: זהה ל-106, למעט השוואת ת.ז (החזרת התיקון של 098) =====
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

-- ===== 2. יבוא כללי עמלה: זהה ל-098, ועליו צעד העיגול ו"עיגול על" של 109 =====
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
  v_step numeric;
  v_target text;
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
      v_calc_type := case v_calc_type
        when 'אחוז' then 'percentage' when 'אחוזים' then 'percentage'
        when 'קבוע' then 'fixed' when 'סכום קבוע' then 'fixed'
        when 'משולב' then 'combined'
        else v_calc_type end;
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
      v_rounding := case v_rounding
        when 'ללא' then 'none' when 'ללא עיגול' then 'none'
        when 'לקרוב' then 'round_int' when 'לקרוב ביותר' then 'round_int'
        when 'כלפי מעלה' then 'ceil_int' when 'למעלה' then 'ceil_int'
        when 'כלפי מטה' then 'floor_int' when 'למטה' then 'floor_int'
        else v_rounding end;
      if v_rounding is null then
        v_rounding := 'none';
      elsif v_rounding not in ('none', 'round_int', 'ceil_int', 'floor_int') then
        update import_rows set status = 'invalid', error_message = 'כלל עיגול לא תקין: "' || v_rounding || '"' where id = v_row.id;
        v_invalid := v_invalid + 1;
        continue;
      end if;

      -- ===== חדש ב-109 =====
      v_text := nullif(trim(coalesce(v_row.raw ->> 'צעד עיגול', '')), '');
      if v_text is null then
        v_step := 1;
      else
        begin v_step := v_text::numeric; exception when others then v_step := null; end;
        if v_step is null or v_step <= 0 then
          update import_rows set status = 'invalid', error_message = 'צעד עיגול לא תקין (חייב להיות גדול מ-0)' where id = v_row.id;
          v_invalid := v_invalid + 1;
          continue;
        end if;
      end if;

      v_target := nullif(trim(coalesce(v_row.raw ->> 'עיגול על', '')), '');
      if v_target is null then
        v_target := 'commission';
      elsif v_target in ('נטו', 'תלמיד', 'net') then
        v_target := 'net';
      elsif v_target in ('עמלה', 'commission') then
        v_target := 'commission';
      else
        update import_rows set status = 'invalid', error_message = 'עיגול על - ערך לא תקין (נדרש עמלה/נטו): "' || v_target || '"' where id = v_row.id;
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
        percentage, fixed_amount, rounding_rule, rounding_step, rounding_target,
        priority, effective_from, effective_until, notes
      ) values (
        p_organization_id, v_group_id, v_study_code, v_student_id, v_calc_type,
        v_percentage, v_fixed_amount, v_rounding, v_step, v_target,
        v_priority, v_from, v_until,
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

-- ===== 3. נרמול טלפון: +972-052 → 052, לא 0052 =====
create or replace function normalize_phone_for_match(p_phone text)
returns text
language sql
immutable
as $$
  with d as (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as digits)
  select nullif(
    case
      -- 00972 - צורת חיוג בינלאומי נפוצה בישראל
      when d.digits like '00972%' then '0' || regexp_replace(substring(d.digits from 6), '^0', '')
      -- 972 בהתחלה, ורק כשהאורך מתאים למספר בינלאומי מלא. מספר ישראלי
      -- מקומי הוא תשע או עשר ספרות ומתחיל ב-0, ולכן לעולם לא ייחתך כאן.
      when d.digits like '972%' and length(d.digits) >= 11 then '0' || regexp_replace(substring(d.digits from 4), '^0', '')
      else d.digits
    end, '')
  from d;
$$;

-- יישור הנתונים שנשמרו בצורה השגויה, ובניית האינדקס מחדש. אינדקס על
-- ביטוי שומר את תוצאת הפונקציה; כשהפונקציה משתנה הוא לא מתעדכן לבד.
update students
set phone_normalized = normalize_phone_for_match(phone_raw)
where phone_raw is not null
  and phone_normalized is distinct from normalize_phone_for_match(phone_raw);

update phone_list_entries
set normalized_phone = normalize_phone_for_match(raw_phone)
where raw_phone is not null
  and normalized_phone is distinct from normalize_phone_for_match(raw_phone);

reindex index group_leaders_phone_match_idx;


-- ===== 4. השלמת שורות שנדחו: זהה ל-100, למעט דילוג על דחייה ידנית =====
create or replace function retry_rejected_eligibility_rows(p_batch_id uuid)
returns table (recovered_count integer, already_had_count integer, still_rejected_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_org_id uuid;
  v_month date;
  v_student_id uuid;
  v_branch_id uuid;
  v_group_id uuid;
  v_amount numeric(12, 2);
  v_recovered integer := 0;
  v_already integer := 0;
  v_left integer := 0;
begin
  if not has_permission('talmud', 'import') then
    raise exception 'permission denied';
  end if;

  select b.organization_id, b.period_month into v_org_id, v_month
  from import_batches b
  join import_profiles p on p.id = b.profile_id
  where b.id = p_batch_id and b.status = 'committed' and p.key = 'talmud_eligibility';

  if v_month is null then
    raise exception 'אצווה זו אינה דוח זכאות שנקלט, ולכן אין בה שורות להשלמה';
  end if;

  for v_row in select * from import_rows where batch_id = p_batch_id and status = 'invalid'
                  and error_message is distinct from 'נדחתה ידנית בבדיקה' loop
    begin
      select id into v_student_id from students
      where normalize_identity(external_id) = normalize_identity(v_row.raw ->> 'מזהה תלמיד')
      limit 1;

      if v_student_id is null then
        v_left := v_left + 1;
        continue;
      end if;

      select sa.branch_id, sa.group_id into v_branch_id, v_group_id
      from student_assignments sa
      where sa.student_id = v_student_id and sa.is_active = true
      limit 1;

      if v_branch_id is null then
        v_left := v_left + 1;
        continue;
      end if;

      -- לתלמיד כבר נזקפה זכאות פעילה לחודש הזה. השורה תקינה מבחינת הנתונים,
      -- אבל אסור לזקוף שוב - זו בדיוק הזכאות הכפולה שחסימת ה-hash מונעת.
      -- מסמנים אותה כמטופלת כדי שתפסיק לצוף כחריגה, בלי להוסיף כסף.
      if exists (
        select 1 from monthly_eligibility
        where student_id = v_student_id and month = v_month and status = 'active'
      ) then
        update import_rows set status = 'committed', error_message = null where id = v_row.id;
        v_already := v_already + 1;
        continue;
      end if;

      v_amount := (regexp_replace(v_row.raw ->> 'סכום ברוטו', '[^0-9.\-]', '', 'g'))::numeric;

      insert into monthly_eligibility (
        student_id, organization_id, branch_id, group_id, month,
        gross_amount, score_or_payment_type, source_batch_id
      )
      values (
        v_student_id, v_org_id, v_branch_id, v_group_id, v_month,
        v_amount, v_row.raw ->> 'ניקוד/סוג תשלום', p_batch_id
      );

      update import_rows set status = 'committed', error_message = null where id = v_row.id;

      perform set_config('app.allow_student_status_change', 'true', true);
      update students set status = 'active' where id = v_student_id and status = 'sent_to_talmud';

      v_recovered := v_recovered + 1;
    exception when others then
      update import_rows set error_message = 'השלמה נכשלה: ' || sqlerrm where id = v_row.id;
      v_left := v_left + 1;
    end;
  end loop;

  -- סנכרון הספירות, מאותו טעם שתוקן ב-021: אחרת ההיסטוריה תמשיך להציג
  -- את המספרים מרגע הקליטה ולא את המצב בפועל.
  update import_batches set
    valid_count = (select count(*) from import_rows where batch_id = p_batch_id and status in ('valid', 'committed')),
    invalid_count = (select count(*) from import_rows where batch_id = p_batch_id and status = 'invalid')
  where id = p_batch_id;

  perform insert_audit_event(
    'retry_rejected_eligibility_rows', 'import_batches', p_batch_id::text,
    jsonb_build_object('month', v_month, 'recovered', v_recovered,
                       'already_had', v_already, 'still_rejected', v_left)
  );

  return query select v_recovered, v_already, v_left;
end;
$$;

-- ===== 5. מרכז החריגות: זהה ל-101, למעט אותו דילוג =====
create or replace view unified_exceptions
with (security_invoker = true)
as
-- materialized במפורש: בלעדיו Postgres משכפל את ה-CTE לתוך כל אחד
-- מחמשת הענפים, וזו בדיוק הבעיה שהמיגרציה הזו מתקנת.
with talmud_gap as materialized (
  select
    ir.id as row_id,
    ir.status as row_status,
    ir.raw as raw,
    b.organization_id,
    b.period_month,
    nullif(btrim(ir.raw ->> 'סניף'), '') as branch_code,
    coalesce(nullif(regexp_replace(coalesce(ir.raw ->> 'סכום ברוטו', ''), '[^0-9.\-]', '', 'g'), '')::numeric, 0) as amount,
    s.id as student_id,
    (asg.student_id is not null) as has_assignment,
    (el.student_id is not null) as has_eligibility,
    (br.id is not null) as branch_exists
  from import_rows ir
  join import_batches b on b.id = ir.batch_id and b.status = 'committed'
  join import_profiles p on p.id = b.profile_id and p.key = 'talmud_eligibility'
  left join students s
    on normalize_identity(s.external_id) = normalize_identity(ir.raw ->> 'מזהה תלמיד')
  left join lateral (
    select sa.student_id from student_assignments sa
    where sa.student_id = s.id and sa.is_active = true limit 1
  ) asg on true
  left join lateral (
    select me.student_id from monthly_eligibility me
    where me.student_id = s.id and me.month = b.period_month and me.status = 'active' limit 1
  ) el on true
  left join branches br
    on br.organization_id = b.organization_id
   and br.talmud_branch_code = btrim(ir.raw ->> 'סניף')
  -- שורה שהמפעיל דחה בכוונה אינה פער לתיקון (110)
  where ir.error_message is distinct from 'נדחתה ידנית בבדיקה'
)
select ue.* from (
  select exception_type, (case when severity = 'warning' then 'medium' else severity end) as severity,
    organization_id, related_table, related_id, amount, related_date, description
  from bank_reconciliation_exceptions

  union all

  select 'talmud_error', case when te.is_recurring then 'high' else 'medium' end,
    te.organization_id, 'talmud_errors', te.id, null, te.month,
    te.error_code || coalesce(': ' || te.error_description, '')
  from talmud_errors te
  where te.status in ('open', 'in_progress', 'pending_info')

  union all

  select 'audit_attendance', case when aa.is_recurring then 'high' else 'medium' end,
    a.organization_id, 'audit_attendance', aa.id, null, a.audit_date,
    'חוסר בביקורת: ' || coalesce(aa.external_student_ref, '(תלמיד מותאם)')
  from audit_attendance aa
  join audits a on a.id = aa.audit_id
  where aa.status in ('open', 'in_progress', 'pending_info')

  union all

  select 'document_expiry',
    case
      when d.expiry_date < current_date then 'critical'
      when d.expiry_date - current_date <= 7 then 'critical'
      when d.expiry_date - current_date <= 14 then 'high'
      else 'medium'
    end,
    d.organization_id, 'documents', d.id, null, d.expiry_date,
    'תוקף מסמך: ' || d.title
  from documents d
  where d.status = 'active' and d.expiry_date is not null and d.expiry_date - current_date <= 30

  union all

  select 'payment_return_open', 'medium',
    mb.organization_id, 'payment_returns', pr.id, pr.amount, pr.return_date,
    'החזרה פתוחה: ' || pr.reason
  from payment_returns pr
  join masav_lines ml on ml.id = pr.masav_line_id
  join masav_batches mb on mb.id = ml.batch_id
  where pr.status = 'open'

  union all

  select 'masav_needs_correction', 'high',
    mb.organization_id, 'masav_batches', mb.id, mb.total_amount, mb.period_month,
    'אצוות מס"ב דורשת תיקון' || coalesce(': ' || mb.status_reason, '')
  from masav_batches mb
  where mb.status = 'needs_correction'

  union all

  select 'bank_auto_sync_issue', case when r.status = 'failed' then 'critical' else 'high' end,
    oba.organization_id, 'bank_auto_sync_runs', r.id, null, r.started_at::date,
    coalesce(r.gap_detail, 'משיכת תנועות בנק אוטומטית נכשלה: ' || coalesce(r.error_message, 'שגיאה לא ידועה'))
  from bank_auto_sync_runs r
  join bank_auto_sync_settings s on s.id = r.setting_id
  join organization_bank_accounts oba on oba.id = s.organization_bank_account_id
  where r.is_resolved = false and (r.status = 'failed' or r.gap_detected = true)

  union all

  -- ===== מה שחסר כדי שדוח "תלמוד" ייקלט במלואו =====
  --
  -- כל חמשת הענפים מנקים את עצמם: הם קוראים את המצב הנוכחי מתוך
  -- talmud_gap, לא את מה שהיה בזמן הקליטה. ברגע שהתלמיד נוסף, שויך,
  -- או שהסניף נפתח - החריגה נעלמת מעצמה. חריגה שנשארת אחרי שתוקנה
  -- מאמנת להתעלם מהמסך, וזה גרוע מלא להציג אותו בכלל.

  -- 1. תלמיד עם זכאות בפועל שאינו קיים במערכת. זה כסף שלא נכנס.
  select 'talmud_student_missing', 'high',
    g.organization_id, 'import_rows', g.row_id, g.amount, g.period_month,
    'תלמיד שאינו במערכת: ' || coalesce(nullif(g.raw ->> 'שם', ''), '(ללא שם)') ||
      ' · ת.ז ' || coalesce(g.raw ->> 'מזהה תלמיד', '—') ||
      ' · סניף ' || coalesce(g.branch_code, '—') ||
      ' · יש לייבא אותו במסך תלמידים'
  from talmud_gap g
  where g.row_status = 'invalid' and g.student_id is null and g.amount > 0

  union all

  -- 2. תלמיד קיים אך בלי שיוך פעיל. הקליטה קוראת את הסניף והקבוצה
  --    מהשיוך, ולכן הוא נדחה למרות שהוא במערכת - וזה הכי מבלבל.
  select 'talmud_student_unassigned', 'high',
    g.organization_id, 'import_rows', g.row_id, g.amount, g.period_month,
    'תלמיד ללא שיוך פעיל לסניף/קבוצה: ' || coalesce(nullif(g.raw ->> 'שם', ''), '(ללא שם)') ||
      ' · ת.ז ' || coalesce(g.raw ->> 'מזהה תלמיד', '—') ||
      ' · הוא קיים במערכת, רק חסר לו שיוך'
  from talmud_gap g
  where g.row_status = 'invalid' and g.student_id is not null and not g.has_assignment

  union all

  -- 3. סניף שמופיע בדוח ואינו קיים. שורה אחת לכל קוד סניף, לא לכל תלמיד.
  select 'talmud_branch_missing', 'medium',
    g.organization_id, 'import_rows', (array_agg(g.row_id order by g.row_id))[1], null, g.period_month,
    'סניף ' || g.branch_code || ' מופיע בדוח תלמוד ואינו קיים במערכת' ||
      ' · הזכאות תיזקף לפי השיוך שבמערכת, לא לפי הקובץ'
  from talmud_gap g
  where g.branch_code is not null and not g.branch_exists
  group by g.organization_id, g.period_month, g.branch_code

  union all

  -- 4. חסרים ללא זכאות החודש, מסוכמים לשורה אחת לכל דוח בכוונה: בקבצים
  --    אמיתיים אלה מאות שורות של 0.00, והצגתן אחת-אחת הייתה מטביעה את
  --    החריגות שבאמת עולות כסף.
  select 'talmud_students_missing_no_amount', 'low',
    g.organization_id, 'import_rows', (array_agg(g.row_id order by g.row_id))[1], null, g.period_month,
    count(*) || ' תלמידים בדוח אינם קיימים במערכת, אך ללא זכאות החודש (0.00 ש"ח)' ||
      ' · אין השפעה כספית, אבל כדאי להוסיף אותם'
  from talmud_gap g
  where g.row_status = 'invalid' and g.student_id is null and g.amount = 0
  group by g.organization_id, g.period_month

  union all

  -- 5. שורה שנדחתה, והנתונים שחסרו לה הוזנו מאז. ארבעת הענפים שמעל
  --    שותקים כאן - התלמיד כבר לא חסר ולא חסר שיוך - אבל הכסף שלו לא
  --    נזקף, כי הקליטה כבר רצה. בלי הענף הזה הפער בלתי נראה.
  select 'talmud_row_recoverable', 'high',
    g.organization_id, 'import_rows', g.row_id, g.amount, g.period_month,
    'זכאות שנדחתה וניתן להשלים: ' || coalesce(nullif(g.raw ->> 'שם', ''), '(ללא שם)') ||
      ' · ת.ז ' || coalesce(g.raw ->> 'מזהה תלמיד', '—') ||
      ' · התלמיד קיים ומשויך כעת · יש להריץ "השלמת שורות שנדחו" במסך זכאות'
  from talmud_gap g
  where g.row_status = 'invalid' and g.student_id is not null
    and g.has_assignment and not g.has_eligibility and g.amount > 0
) ue
left join organizations o on o.id = ue.organization_id
where coalesce(o.is_demo, false) = false;

grant select on unified_exceptions to authenticated;

-- ===== 6. הזמנות: ההרשאה ניתנת רק לכתובת מאומתת =====
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv user_invitations;
begin
  select * into v_inv
  from user_invitations
  where lower(email) = lower(new.email)
    and accepted_at is null and revoked_at is null
    -- רק כתובת מאומתת. בלי זה מי שנרשם ראשון עם הכתובת מקבל את
    -- ההרשאה, לפני שהוכיח שהיא שלו (110).
    and new.email_confirmed_at is not null
  limit 1;

  if v_inv.id is not null then
    insert into profiles (id, full_name, email, status, role_id, default_area)
    values (new.id, new.raw_user_meta_data ->> 'full_name', new.email,
            'approved', v_inv.role_id, v_inv.default_area);

    update user_invitations
    set accepted_at = now(), accepted_user_id = new.id
    where id = v_inv.id;

    -- הבקשה נרשמת כמאושרת ולא מדולגת, כדי שההיסטוריה תישאר רציפה:
    -- לכל משתמש יש שורת בקשה, גם כשההכרעה נעשתה מראש.
    insert into access_requests (user_id, message, decision, decided_by, decided_at)
    values (new.id, new.raw_user_meta_data ->> 'request_message',
            'approved', v_inv.invited_by, now());
  else
    insert into profiles (id, full_name, email)
    values (new.id, new.raw_user_meta_data ->> 'full_name', new.email);

    insert into access_requests (user_id, message)
    values (new.id, new.raw_user_meta_data ->> 'request_message');
  end if;

  return new;
end;
$$;

-- ההזמנה נצרכת כשהכתובת מאומתת - גם אם זה קרה אחרי ההרשמה. כשאימות
-- הכתובת כבוי ב-Supabase, email_confirmed_at מתמלא כבר בהרשמה והטריגר
-- שמעל מטפל בזה; כשהוא דלוק, זה קורה כאן, בלחיצה על הקישור שבמייל.
create or replace function handle_user_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv user_invitations;
begin
  if old.email_confirmed_at is not null or new.email_confirmed_at is null then
    return new;
  end if;

  select * into v_inv
  from user_invitations
  where lower(email) = lower(new.email)
    and accepted_at is null and revoked_at is null
  limit 1;

  if v_inv.id is null then
    return new;
  end if;

  -- רק פרופיל שעדיין ממתין. פרופיל שכבר אושר או הושבת הוכרע בידי אדם,
  -- והזמנה ישנה לא דורסת את ההכרעה הזו.
  update profiles
  set status = 'approved', role_id = v_inv.role_id, default_area = v_inv.default_area
  where id = new.id and status = 'pending';

  if found then
    update user_invitations
    set accepted_at = now(), accepted_user_id = new.id
    where id = v_inv.id;

    update access_requests
    set decision = 'approved', decided_by = v_inv.invited_by, decided_at = now()
    where user_id = new.id and decision is null;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_email_confirmed on auth.users;
create trigger on_auth_user_email_confirmed
  after update of email_confirmed_at on auth.users
  for each row execute function handle_user_email_confirmed();
