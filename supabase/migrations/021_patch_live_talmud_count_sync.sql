-- Patch לפרויקט החי: commit_eligibility_batch()/commit_errors_batch() (020, כבר רץ) לא
-- סנכרנו בחזרה את valid_count/needs_decision_count/invalid_count על import_batches אחרי
-- שהלולאה שינתה סטטוס שורות (למשל שורה שהתבררה כלא-מותאמת והפכה ל-invalid) - ההיסטוריה
-- הייתה ממשיכה להציג את הספירות מרגע היצירה, לא את התוצאה בפועל. תוקן ב-018/019 על
-- הדיסק; זה ה-patch (create or replace, idempotent) לפרויקט הקיים.

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
      select id into v_student_id from students where external_id = trim(v_row.raw ->> 'מזהה תלמיד') limit 1;

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
      select id into v_student_id from students where external_id = trim(v_row.raw ->> 'מזהה תלמיד') limit 1;
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

-- תיקון רטרואקטיבי: מסנכרן ספירות על אצוות זכאות/שגויים שכבר נסגרו לפני ה-patch הזה
-- (כמו אצוות הבדיקה מהסבב הקודם) - כדי שההיסטוריה תציג נתונים נכונים מיידית, לא רק
-- עבור אצוות עתידיות.
update import_batches b set
  valid_count = (select count(*) from import_rows where batch_id = b.id and status in ('valid', 'committed')),
  needs_decision_count = (select count(*) from import_rows where batch_id = b.id and status = 'needs_decision'),
  invalid_count = (select count(*) from import_rows where batch_id = b.id and status = 'invalid')
where b.profile_id in (select id from import_profiles where key in ('talmud_eligibility', 'talmud_errors'));
