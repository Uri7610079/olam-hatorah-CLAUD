-- שלב 25 (המשך): יבוא Excel לקודי לימוד. אותו דפוס בדיוק כמו יבוא תלמידים (076) וכל
-- דומיין קודם - פרופיל יבוא ייעודי + commit ספציפי-דומיין שקורא מ-import_rows.raw
-- וכותב ל-study_codes בפועל. לא נוגע במנוע הגנרי (013) ולא ב-16 הקודים שכבר הוזנעו
-- ב-012 - אלה נשארים כפי שהם, זה נתיב הוספה נוסף לקודים חדשים/עתידיים.
--
-- ייחוד קוד לימוד הוא code בלבד, גלובלי (012, unique) - לא צירוף עם description/category.
-- שורה עם code שכבר קיים ב-study_codes מסומנת invalid ונספרת בנפרד (duplicate_count)
-- מ"שגוי בגלל שדה חובה חסר" (invalid_count) - לא חוסמת את שאר האצווה, אותו עיקרון
-- בדיוק כמו commit_students_import_batch (076).
--
-- הרשאה: study_codes.manage - אותה הרשאה בדיוק שמגנה על יצירה ידנית ב-StudyCodesScreen.tsx
-- (מוענקת ל-system_admin בלבד, ר' 012), לא הרשאת import כללית חדשה.

insert into import_profiles (key, label_he, description) values
  ('study_codes', 'יבוא קודי לימוד מאקסל',
   'עמודות: קוד (חובה, ייחודי גלובלית), תיאור (חובה), קטגוריה (לא חובה). קוד קיים כבר במערכת מדולג ונספר בנפרד.');

create or replace function commit_study_codes_import_batch(p_batch_id uuid)
returns table (created_count integer, duplicate_count integer, invalid_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_open_rows integer;
  v_batch_status text;
  v_code text;
  v_description text;
  v_category text;
  v_created integer := 0;
  v_duplicate integer := 0;
  v_invalid integer := 0;
begin
  if not has_permission('study_codes', 'manage') then
    raise exception 'permission denied';
  end if;

  -- בדיקת סטטוס-אצווה מוקדמת ומפורשת - אותה תוספת שנעשתה ב-063 לכל commit RPC אחר.
  select ib.status into v_batch_status
  from import_batches ib join import_profiles ip on ip.id = ib.profile_id
  where ib.id = p_batch_id and ip.key = 'study_codes';
  if v_batch_status is null then
    raise exception 'האצווה אינה מפרופיל יבוא קודי לימוד';
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
      v_code := nullif(trim(v_row.raw ->> 'קוד'), '');
      v_description := nullif(trim(v_row.raw ->> 'תיאור'), '');
      v_category := nullif(trim(v_row.raw ->> 'קטגוריה'), '');

      if v_code is null or v_description is null then
        update import_rows set status = 'invalid', error_message = 'חסר קוד ו/או תיאור' where id = v_row.id;
        v_invalid := v_invalid + 1;
        continue;
      end if;

      if exists (select 1 from study_codes where code = v_code) then
        update import_rows set status = 'invalid', error_message = 'קוד לימוד זה כבר קיים' where id = v_row.id;
        v_duplicate := v_duplicate + 1;
        continue;
      end if;

      insert into study_codes (code, description, category) values (v_code, v_description, v_category);

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
    'commit_study_codes_import_batch', 'study_codes', p_batch_id::text,
    jsonb_build_object('created', v_created, 'duplicate', v_duplicate, 'invalid', v_invalid)
  );

  created_count := v_created;
  duplicate_count := v_duplicate;
  invalid_count := v_invalid;
  return next;
end;
$$;

grant execute on function commit_study_codes_import_batch(uuid) to authenticated;
