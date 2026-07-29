-- שלב 25 (המשך): יבוא כללי עמלה בכמות (Bulk import). אותה תשתית ואותו דפוס בדיוק כמו
-- 078 (יבוא תרומות) ו-018 (זכאות) - Preview/staging דרך המנוע הגנרי, commit ייעודי-
-- דומיין שכותב ל-commission_rules (025). שורות valid וגם needs_decision (כפילות מדויקת
-- בקובץ בלבד, לא אי-ודאות עסקית) מעובדות שתיהן - אותו נימוק כמו 078.
--
-- כאן העמותה כן מגיעה כפרמטר מפורש (p_organization_id) ולא נלקחת מהאצווה - שלא כמו
-- 078/018 - כי כללי עמלה נבדקים כאן מול מגבלות הטבלה (percentage/fixed_amount/תאריכים)
-- שדורשות את זהות העמותה מוקדם בבדיקת כל שורה (חיפוש קבוצה), ומפורש בדרישה המקורית.
--
-- בדיקות ה-CHECK של הטבלה (025) מבוצעות כאן מראש בעצמנו לפני ה-INSERT (לא מסתמכים על
-- שהאילה תיכשל) - כך ששורה שגויה לא מפילה את כל האצווה, רק את עצמה.
--
-- עמודות הקובץ (הנחה סבירה עד לדוגמת קובץ אמיתית): שם קבוצה (לא חובה), קוד לימוד
-- (לא חובה), מזהה תלמיד חיצוני (לא חובה - חריג לתלמיד ספציפי), סוג חישוב (חובה: אחוז/
-- קבוע/משולב), אחוז, סכום קבוע, כלל עיגול (לא חובה, ברירת מחדל ללא עיגול), עדיפות
-- (לא חובה, ברירת מחדל 0), תקף מתאריך (חובה), תקף עד תאריך (לא חובה), הערות.

insert into import_profiles (key, label_he, description) values
  ('commission_rules', 'יבוא כללי עמלה',
   'עמודות צפויות: שם קבוצה (לא חובה), קוד לימוד (לא חובה), מזהה תלמיד חיצוני (לא חובה), סוג חישוב (percentage/fixed/combined), אחוז, סכום קבוע, כלל עיגול, עדיפות (ברירת מחדל 0), תקף מתאריך, תקף עד תאריך (לא חובה), הערות.');

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
        select id into v_student_id from students where external_id = v_student_external_id limit 1;
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

grant execute on function commit_commission_rules_import_batch(uuid, uuid) to authenticated;
