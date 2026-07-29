-- שלב 25: יבוא תרומות בכמות (Bulk import). משתמש בתשתית היבוא הגנרית משלב 5
-- (import_profiles/batches/rows) לצורך Preview/staging, בדיוק כמו commit_eligibility_batch
-- (018) - רק commit ייעודי-דומיין חדש שכותב בפועל ל-donations (030). שלא כמו זכאות
-- (שם שורת "דורש החלטה" חוסמת סגירת אצווה כי היא דורשת התאמת תלמיד), כאן "דורש החלטה"
-- הוא רק כפילות שורה מדויקת בתוך הקובץ (classifyRows הגנרי) - אין סיבה לחסום תרומה
-- כפולה-לכאורה מלהיקלט, לכן מעובדות גם שורות valid וגם needs_decision.
--
-- v1: מטא-דאטה בלבד, בלי קובץ מקור פר-שורה - source_file_path נשאר null; העלאת קובץ
-- בודד לכל תרומה (כמו ב-DonationsScreen הידני) לא מתאימה לזרימת יבוא בכמות. התרומה
-- נוצרת תמיד בסטטוס 'pending' (ברירת המחדל של העמודה; enforce_donation_mutation_guard
-- ב-030 חוסם כל ערך אחר ב-INSERT ממילא) - זהה ליצירה ידנית, ה-RPC לא קובע סטטוס במפורש.
--
-- עמודות הקובץ (הנחה סבירה, כמו בכל דומיין יבוא אחר עד לדוגמת קובץ אמיתית): תאריך
-- תרומה, סכום, שם קבוצה (לא חובה), אסמכתת תורם (לא חובה), אסמכתה (לא חובה), הערות
-- (לא חובה).

insert into import_profiles (key, label_he, description) values
  ('donations', 'יבוא תרומות',
   'עמודות צפויות: תאריך תרומה, סכום, שם קבוצה (לא חובה), אסמכתת תורם (לא חובה), אסמכתה (לא חובה), הערות (לא חובה). כל תרומה נוצרת בסטטוס "ממתינה לאישור", ללא קובץ מקור.');

create or replace function commit_donations_import_batch(p_batch_id uuid)
returns table (created_count integer, invalid_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_org_id uuid;
  v_created integer := 0;
  v_invalid integer := 0;
  v_group_name text;
  v_group_id uuid;
  v_amount numeric(12, 2);
  v_date date;
begin
  if not has_permission('donations', 'manage') then
    raise exception 'permission denied';
  end if;

  -- העמותה נלקחת מהאצווה עצמה (import_batches.organization_id, שכבר הוזנה ב-
  -- createImportBatch), אותה מוסכמה בדיוק כמו commit_eligibility_batch - לא פרמטר נפרד.
  select organization_id into v_org_id from import_batches where id = p_batch_id;
  if v_org_id is null then
    raise exception 'לאצווה זו אין עמותה משויכת';
  end if;

  for v_row in select * from import_rows where batch_id = p_batch_id and status in ('valid', 'needs_decision') loop
    begin
      v_group_id := null;

      begin
        v_date := trim(v_row.raw ->> 'תאריך תרומה')::date;
      exception when others then
        v_date := null;
      end;
      if v_date is null then
        update import_rows set status = 'invalid', error_message = 'תאריך תרומה חסר או לא תקין' where id = v_row.id;
        v_invalid := v_invalid + 1;
        continue;
      end if;

      begin
        v_amount := (regexp_replace(coalesce(v_row.raw ->> 'סכום', ''), '[^0-9.\-]', '', 'g'))::numeric;
      exception when others then
        v_amount := null;
      end;
      if v_amount is null or v_amount <= 0 then
        update import_rows set status = 'invalid', error_message = 'סכום חסר או לא תקין (חייב להיות גדול מאפס)' where id = v_row.id;
        v_invalid := v_invalid + 1;
        continue;
      end if;

      v_group_name := trim(coalesce(v_row.raw ->> 'שם קבוצה', ''));
      if length(v_group_name) > 0 then
        select g.id into v_group_id
        from groups g
        join branches b on b.id = g.branch_id
        where b.organization_id = v_org_id and g.name = v_group_name
        limit 1;

        if v_group_id is null then
          update import_rows set status = 'invalid', error_message = 'לא נמצאה קבוצה בשם "' || v_group_name || '" בעמותה זו' where id = v_row.id;
          v_invalid := v_invalid + 1;
          continue;
        end if;
      end if;

      insert into donations (organization_id, group_id, donation_date, amount, donor_reference, reference, notes)
      values (
        v_org_id,
        v_group_id,
        v_date,
        v_amount,
        nullif(trim(coalesce(v_row.raw ->> 'אסמכתת תורם', '')), ''),
        nullif(trim(coalesce(v_row.raw ->> 'אסמכתה', '')), ''),
        nullif(trim(coalesce(v_row.raw ->> 'הערות', '')), '')
      );

      update import_rows set status = 'committed' where id = v_row.id;
      v_created := v_created + 1;
    exception when others then
      -- שורה בודדת שנכשלה (למשל שגיאה בלתי צפויה) לא מפילה את כל האצווה - אותו עיקרון
      -- בדיוק כמו commit_eligibility_batch.
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
    'commit_donations_import_batch', 'import_batches', p_batch_id::text,
    jsonb_build_object('organization_id', v_org_id, 'created', v_created, 'invalid', v_invalid)
  );

  return query select v_created, v_invalid;
end;
$$;

grant execute on function commit_donations_import_batch(uuid) to authenticated;
