-- עיגול: קודם לשקל שלם, ורק אז לכפולה
--
-- התגלה מהשוואה למערכת שהלקוח עובד בה בפועל. באקסלים של אוגוסט 2026 יש
-- 2,343 שורות עם ברוטו, אחוז וסכום לתשלום, וחישוב ישיר של
-- floor(value/5)*5 מסביר 95.26% מהן בלבד. הפערים אינם מקריים:
--
--   675 × 90% = 607.50  →  605   (floor ישיר: 605 ✓)
--   405 × 90% = 364.50  →  365   (floor ישיר: 360 ✗)
--   405 × 95% = 384.75  →  385   (floor ישיר: 380 ✗)
--   337.5 × 90% = 303.75 → 300   (floor ישיר: 300 ✓)
--
-- הכלל שמסביר את כולם: מעגלים קודם לשקל שלם, ורק אז כלפי מטה לכפולה.
-- 364.50 → 365 → 365; 607.50 → 608 → 605; 303.75 → 304 → 300.
-- אחוז ההסבר עולה ל-97.18%, והשארית היא חריגים פרטניים לתלמיד ולא
-- כלל חישוב.
--
-- למה זה הגיוני: אין במערכת הזו סכומים בפרוטות. הסכום נקבע כמספר שלם
-- של שקלים, ורק אחר כך מוחל העיגול לכפולה.
--
-- הקדם-עיגול חל רק כשהצעד גדול מ-1. בצעד 1 הכיוון *הוא* העיגול, וקדם-
-- עיגול היה מוחק אותו: "כלפי מטה לשקל שלם" של 67.5 היה הופך ל-68.

create or replace function apply_rounding(p_value numeric, p_rule text, p_step numeric)
returns numeric
language sql
immutable
as $$
  select case
    when p_value is null then null
    when p_rule = 'none' or coalesce(p_step, 0) <= 0 then p_value
    else
      case p_rule
        when 'round_int' then round(v.base / p_step) * p_step
        when 'ceil_int'  then ceil(v.base / p_step) * p_step
        when 'floor_int' then floor(v.base / p_step) * p_step
        else p_value
      end
  end
  from (select case when coalesce(p_step, 1) > 1 then round(p_value) else p_value end as base) v;
$$;

comment on function apply_rounding(numeric, text, numeric) is
  'עיגול לכפולה של p_step בכיוון p_rule. בצעד גדול מ-1 הערך מעוגל תחילה לשקל שלם. ראה מיגרציות 105 ו-109.';

-- ===== הייבוא מאקסל: צעד העיגול והיעד =====
--
-- 105 הוסיפה את שני השדות, אך הייבוא לא ידע עליהם, ולכן כלל שנוצר
-- מאקסל תמיד קיבל צעד 1 ועיגול על העמלה - כלומר בדיוק מה שאינו נדרש.
-- זהה ל-098 בכל השאר.

create or replace function commit_commission_rules_import_batch(p_batch_id uuid, p_organization_id uuid)
returns table (created_count integer, invalid_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_group_name text;
  v_group_id uuid;
  v_study_code text;
  v_student_external_id text;
  v_student_id uuid;
  v_calc_type text;
  v_percentage numeric;
  v_fixed_amount numeric;
  v_rounding text;
  v_step numeric;
  v_target text;
  v_priority integer;
  v_from date;
  v_until date;
  v_text text;
  v_created integer := 0;
  v_invalid integer := 0;
begin
  if not has_permission('commission_rules', 'manage') then
    raise exception 'permission denied';
  end if;

  for v_row in select * from import_rows where batch_id = p_batch_id and status = 'valid' order by row_number loop
    begin
      v_group_id := null; v_student_id := null;
      v_percentage := null; v_fixed_amount := null; v_until := null;

      v_group_name := trim(coalesce(v_row.raw ->> 'שם קבוצה', ''));
      if v_group_name <> '' then
        select g.id into v_group_id
        from groups g join branches b on b.id = g.branch_id
        where b.organization_id = p_organization_id and g.name = v_group_name
        limit 1;
        if v_group_id is null then
          update import_rows set status = 'invalid', error_message = 'קבוצה לא נמצאה בעמותה: "' || v_group_name || '"' where id = v_row.id;
          v_invalid := v_invalid + 1;
          continue;
        end if;
      end if;

      v_study_code := nullif(trim(coalesce(v_row.raw ->> 'קוד לימוד', '')), '');
      if v_study_code is not null and not exists (select 1 from study_codes where code = v_study_code) then
        update import_rows set status = 'invalid', error_message = 'קוד לימוד לא קיים: "' || v_study_code || '"' where id = v_row.id;
        v_invalid := v_invalid + 1;
        continue;
      end if;

      v_student_external_id := nullif(trim(coalesce(v_row.raw ->> 'מזהה תלמיד חיצוני', '')), '');
      if v_student_external_id is not null then
        -- normalize_identity ולא השוואה מדויקת: ת.ז נשמרת לא פעם בלי
        -- האפס המוביל, וזה בדיוק הבאג שתוקן ב-098.
        select id into v_student_id from students
        where normalize_identity(external_id) = normalize_identity(v_student_external_id) limit 1;
        if v_student_id is null then
          update import_rows set status = 'invalid', error_message = 'תלמיד לא נמצא: "' || v_student_external_id || '"' where id = v_row.id;
          v_invalid := v_invalid + 1;
          continue;
        end if;
      end if;

      v_calc_type := trim(coalesce(v_row.raw ->> 'סוג חישוב', ''));
      if v_calc_type not in ('percentage', 'fixed', 'combined') then
        update import_rows set status = 'invalid', error_message = 'סוג חישוב לא תקין (נדרש percentage/fixed/combined): "' || v_calc_type || '"' where id = v_row.id;
        v_invalid := v_invalid + 1;
        continue;
      end if;

      v_text := nullif(trim(coalesce(v_row.raw ->> 'אחוז', '')), '');
      if v_text is not null then
        begin v_percentage := v_text::numeric; exception when others then v_percentage := null; end;
        if v_percentage is null or v_percentage < 0 or v_percentage > 100 then
          update import_rows set status = 'invalid', error_message = 'אחוז לא תקין (חייב להיות בין 0 ל-100)' where id = v_row.id;
          v_invalid := v_invalid + 1;
          continue;
        end if;
      end if;

      v_text := nullif(trim(coalesce(v_row.raw ->> 'סכום קבוע', '')), '');
      if v_text is not null then
        begin v_fixed_amount := v_text::numeric; exception when others then v_fixed_amount := null; end;
        if v_fixed_amount is null or v_fixed_amount < 0 then
          update import_rows set status = 'invalid', error_message = 'סכום קבוע לא תקין (חייב להיות 0 ומעלה)' where id = v_row.id;
          v_invalid := v_invalid + 1;
          continue;
        end if;
      end if;

      v_rounding := nullif(trim(coalesce(v_row.raw ->> 'כלל עיגול', '')), '');
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

      v_text := nullif(trim(coalesce(v_row.raw ->> 'עדיפות', '')), '');
      if v_text is null then
        v_priority := 0;
      else
        begin v_priority := v_text::integer; exception when others then v_priority := null; end;
        if v_priority is null then
          update import_rows set status = 'invalid', error_message = 'עדיפות לא תקינה' where id = v_row.id;
          v_invalid := v_invalid + 1;
          continue;
        end if;
      end if;

      begin
        v_from := trim(v_row.raw ->> 'תקף מתאריך')::date;
      exception when others then
        update import_rows set status = 'invalid', error_message = 'תקף מתאריך - תאריך לא תקין' where id = v_row.id;
        v_invalid := v_invalid + 1;
        continue;
      end;

      v_text := nullif(trim(coalesce(v_row.raw ->> 'תקף עד תאריך', '')), '');
      if v_text is not null then
        begin
          v_until := v_text::date;
        exception when others then
          update import_rows set status = 'invalid', error_message = 'תקף עד תאריך - תאריך לא תקין' where id = v_row.id;
          v_invalid := v_invalid + 1;
          continue;
        end;
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
    invalid_count = (select count(*) from import_rows where batch_id = p_batch_id and status = 'invalid')
  where id = p_batch_id;

  perform set_config('app.allow_batch_commit', 'true', true);
  update import_batches set status = 'committed', committed_at = now() where id = p_batch_id;

  perform insert_audit_event(
    'commit_commission_rules_import_batch', 'import_batches', p_batch_id::text,
    jsonb_build_object('created', v_created, 'invalid', v_invalid)
  );

  return query select v_created, v_invalid;
end;
$$;
