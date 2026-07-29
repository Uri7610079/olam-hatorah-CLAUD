-- שלב 25 (חלק ב'): יבוא מרובה של מסמכי עמותה - מטא-דאטה בלבד, בלי קובץ מצורף פר-שורה.
-- documents (044, שלב 13) דורשת file_path או external_link (check constraint, שורה 27
-- שם) - יבוא מאקסל לא יכול לצרף קובץ פר-שורה בפועל, אז גרסה זו (v1) מגבילה את עצמה
-- למסמכים עם קישור חיצוני בלבד: external_link הוא שדה חובה בקובץ המיובא, ו-file_path
-- נשאר null תמיד עבור שורות שיובאו כך. מסמך עם קובץ מצורף אמיתי ממשיך להיווצר כרגיל
-- ב-DocumentsScreen.tsx (טופס ידני, submitDocument()).
--
-- document_type נשאר טקסט חופשי בטבלה עצמה (044: "לא רשימה סגורה, החלטה עסקית פתוחה") -
-- אין enum/check constraint על העמודה בסכימה הקיימת, ולכן ה-commit כאן לא ממציא רשימה
-- סגורה משלו; הבדיקה היחידה היא "לא ריק", כמו כותרת.

insert into import_profiles (key, label_he, description) values
  ('documents_metadata', 'יבוא מטא-דאטה של מסמכים מאקסל (קבוצתי)',
   'עמודות: סוג מסמך (חובה), כותרת (חובה), תאריך הנפקה (לא חובה), תאריך תפוגה (לא חובה), ' ||
   'קישור חיצוני (חובה - יבוא זה אינו תומך בצירוף קובץ פר-שורה), רגיש (כן/לא, ברירת מחדל לא). ' ||
   'מסמך עם קובץ מצורף בפועל יש להעלות ידנית במסך הרגיל.');

-- commit_documents_import_batch(): קוראת מ-import_rows (Preview כבר עבר דרך מרכז היבוא
-- הכללי), בודקת שדות חובה (סוג מסמך/כותרת/קישור חיצוני), מפרסרת תאריכים אופציונליים,
-- ופרסור בוליאני סובלני ל"רגיש". יוצרת שורת documents חדשה עם file_path=null תמיד.
create or replace function commit_documents_import_batch(p_batch_id uuid, p_organization_id uuid)
returns table (created_count integer, invalid_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_status text;
  v_batch_org uuid;
  v_open_rows integer;
  v_row record;
  v_doc_type text;
  v_title text;
  v_issued_raw text;
  v_issued_date date;
  v_expiry_raw text;
  v_expiry_date date;
  v_link text;
  v_sensitive_raw text;
  v_is_sensitive boolean;
  v_created integer := 0;
  v_invalid integer := 0;
begin
  if not has_permission('documents', 'manage') then
    raise exception 'permission denied';
  end if;

  select status, organization_id into v_batch_status, v_batch_org from import_batches where id = p_batch_id;
  if v_batch_status is null then
    raise exception 'אצוות יבוא לא נמצאה';
  end if;
  if v_batch_status not in ('uploaded', 'previewed') then
    raise exception 'לא ניתן לקלוט אצווה בסטטוס %', v_batch_status;
  end if;
  if v_batch_org is distinct from p_organization_id then
    raise exception 'העמותה שהתקבלה אינה תואמת את העמותה שנקבעה בעת יצירת האצווה';
  end if;

  select count(*) into v_open_rows from import_rows where batch_id = p_batch_id and status = 'needs_decision';
  if v_open_rows > 0 then
    raise exception 'לא ניתן לקלוט קובץ עם % שורות שטרם הוכרעו', v_open_rows;
  end if;

  for v_row in select * from import_rows where batch_id = p_batch_id and status = 'valid' order by row_number loop
    begin
      v_doc_type := nullif(trim(v_row.raw ->> 'סוג מסמך'), '');
      v_title := nullif(trim(v_row.raw ->> 'כותרת'), '');
      v_link := nullif(trim(v_row.raw ->> 'קישור חיצוני'), '');

      if v_doc_type is null then
        update import_rows set status = 'invalid', error_message = 'חסר סוג מסמך' where id = v_row.id;
        v_invalid := v_invalid + 1;
        continue;
      end if;

      if v_title is null then
        update import_rows set status = 'invalid', error_message = 'חסרה כותרת' where id = v_row.id;
        v_invalid := v_invalid + 1;
        continue;
      end if;

      if v_link is null then
        update import_rows set status = 'invalid',
          error_message = 'חסר קישור חיצוני - יבוא קבוצתי דורש קישור לכל שורה, לא ניתן לצרף קובץ דרך אקסל'
        where id = v_row.id;
        v_invalid := v_invalid + 1;
        continue;
      end if;

      v_issued_date := null;
      v_issued_raw := nullif(trim(v_row.raw ->> 'תאריך הנפקה'), '');
      if v_issued_raw is not null then
        begin
          v_issued_date := v_issued_raw::date;
        exception when others then
          update import_rows set status = 'invalid', error_message = 'תאריך הנפקה לא תקין: ' || v_issued_raw where id = v_row.id;
          v_invalid := v_invalid + 1;
          continue;
        end;
      end if;

      v_expiry_date := null;
      v_expiry_raw := nullif(trim(v_row.raw ->> 'תאריך תפוגה'), '');
      if v_expiry_raw is not null then
        begin
          v_expiry_date := v_expiry_raw::date;
        exception when others then
          update import_rows set status = 'invalid', error_message = 'תאריך תפוגה לא תקין: ' || v_expiry_raw where id = v_row.id;
          v_invalid := v_invalid + 1;
          continue;
        end;
      end if;

      v_sensitive_raw := trim(coalesce(v_row.raw ->> 'רגיש', ''));
      v_is_sensitive := v_sensitive_raw = 'כן' or lower(v_sensitive_raw) in ('true', 'yes', '1');

      insert into documents (organization_id, document_type, title, issued_date, expiry_date, file_path, external_link, is_sensitive)
      values (p_organization_id, v_doc_type, v_title, v_issued_date, v_expiry_date, null, v_link, v_is_sensitive);

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
    'commit_documents_import_batch', 'import_batches', p_batch_id::text,
    jsonb_build_object('organization_id', p_organization_id, 'created', v_created, 'invalid', v_invalid)
  );

  return query select v_created, v_invalid;
end;
$$;

revoke execute on function commit_documents_import_batch(uuid, uuid) from public, anon;
grant execute on function commit_documents_import_batch(uuid, uuid) to authenticated;
