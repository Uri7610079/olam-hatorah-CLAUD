-- שלב 25 (חלק א'): יבוא מרובה של אירועי ביקורת עצמם (הקונטיינר), לא רשימת החסרים שלהם.
-- אירוע ביקורת (042, שלב 13) הוא רשומה מנהלית קלה - עמותה+סניף (לא חובה)+תאריך - שנוצרת
-- היום ידנית שורה-שורה (AuditsScreen.tsx, INSERT ישיר, בלי RPC). הבקשה כאן היא יבוא
-- קבוצתי של הרשומות האלה עצמן מאקסל - שונה לגמרי מהיבוא הקיים (audit_attendance, גם הוא
-- 042) שמייבא רשימת חסרים *לתוך* אירוע ביקורת קיים בודד. שני היבואים משתמשים באותו מנוע
-- גנרי (013) אבל בפרופיל יבוא נפרד ('audits_container', לא 'audit_attendance') כדי
-- שההיסטוריה/הסיווג לא יתערבבו בין שני סוגי היבוא באותו מסך.
--
-- אין אילוץ ייחודיות על (organization_id, branch_id, audit_date) בטבלת audits עצמה
-- (042) - כפילות מותרת טכנית בסכימה, לא הומצא כאן כלל ייחודיות חדש. במקום זאת, אם אותו
-- שילוב עמותה/סניף/תאריך מופיע פעמיים *באותו קובץ שמיובא עכשיו*, המופע השני מסומן
-- needs_decision ("ייתכן כפילות") ולא נחסם/נדחה - אותו עיקרון בדיוק כמו הכלל הגנרי
-- ב-classifyRows (012) לשורה שחוזרת בדיוק על שורה קודמת באותו קובץ. הבדיקה כאן מוגבלת
-- במפורש ל-source_batch_id = האצווה הנוכחית (לא כל ההיסטוריה) - כדי לא לחסום יבוא של
-- אותו סניף/תאריך בקובץ נפרד ביום אחר, מצב לגיטימי לגמרי היום (למשל ביקורת חוזרת).

insert into import_profiles (key, label_he, description) values
  ('audits_container', 'יצירת אירועי ביקורת מאקסל (קבוצתי)',
   'עמודות: סניף (לא חובה - קוד סניף בתלמוד או שם פנימי; ריק = כל הסניפים), תאריך ביקורת (חובה). ' ||
   'שונה מ"רשימת חסרים לביקורת" - זה יוצר את אירועי הביקורת עצמם, לא רשימת תלמידים בתוך ביקורת קיימת. ' ||
   'שורה עם אותה עמותה/סניף/תאריך שכבר נוצרה מאותו קובץ מסומנת "ייתכן כפילות" (דורש החלטה) - אין אילוץ ייחודיות בטבלה עצמה.');

-- commit_audits_import_batch(): קוראת מ-import_rows (Preview כבר עבר דרך מרכז היבוא
-- הכללי), מוצאת סניף לפי קוד תלמוד או שם פנימי (בהיקף העמותה), מפרסרת תאריך, ויוצרת
-- שורת audits חדשה (תמיד draft, כמו כל יצירה - 042 אוכפת זאת ממילא). מזהה כפילות בתוך-
-- הקובץ מול מה שכבר נוצר מאותה אצווה עצמה ומסמנת needs_decision במקום ליצור כפול.
create or replace function commit_audits_import_batch(p_batch_id uuid, p_organization_id uuid)
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
  v_branch_raw text;
  v_branch_id uuid;
  v_date_raw text;
  v_audit_date date;
  v_duplicate boolean;
  v_created integer := 0;
  v_invalid integer := 0;
begin
  if not has_permission('audits', 'manage') then
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
      v_branch_id := null;
      v_branch_raw := nullif(trim(v_row.raw ->> 'סניף'), '');
      if v_branch_raw is not null then
        select id into v_branch_id from branches
        where organization_id = p_organization_id
          and (talmud_branch_code = v_branch_raw or internal_name = v_branch_raw)
        limit 1;
        if v_branch_id is null then
          update import_rows set status = 'invalid', error_message = 'סניף לא נמצא: ' || v_branch_raw where id = v_row.id;
          v_invalid := v_invalid + 1;
          continue;
        end if;
      end if;

      v_date_raw := nullif(trim(v_row.raw ->> 'תאריך ביקורת'), '');
      if v_date_raw is null then
        update import_rows set status = 'invalid', error_message = 'חסר תאריך ביקורת' where id = v_row.id;
        v_invalid := v_invalid + 1;
        continue;
      end if;

      begin
        v_audit_date := v_date_raw::date;
      exception when others then
        update import_rows set status = 'invalid', error_message = 'תאריך ביקורת לא תקין: ' || v_date_raw where id = v_row.id;
        v_invalid := v_invalid + 1;
        continue;
      end;

      -- כפילות רק מול מה שכבר נוצר *מאותה אצווה עצמה* (source_batch_id = p_batch_id) -
      -- לא מול כל היסטוריית audits - ביקורת חוזרת לאותו סניף/תאריך בקובץ אחר, ביום
      -- אחר, היא מצב לגיטימי ולא כפילות.
      select exists (
        select 1 from audits a
        where a.organization_id = p_organization_id
          and a.audit_date = v_audit_date
          and a.source_batch_id = p_batch_id
          and coalesce(a.branch_id::text, '') = coalesce(v_branch_id::text, '')
      ) into v_duplicate;

      if v_duplicate then
        update import_rows set status = 'needs_decision',
          error_message = 'ייתכן כפילות - אירוע ביקורת עם אותה עמותה/סניף/תאריך כבר נוצר מקובץ זה'
        where id = v_row.id;
        continue;
      end if;

      insert into audits (organization_id, branch_id, audit_date, source_batch_id)
      values (p_organization_id, v_branch_id, v_audit_date, p_batch_id);

      update import_rows set status = 'committed' where id = v_row.id;
      v_created := v_created + 1;
    exception when others then
      update import_rows set status = 'invalid', error_message = 'שגיאה בעיבוד השורה: ' || sqlerrm where id = v_row.id;
      v_invalid := v_invalid + 1;
    end;
  end loop;

  -- מסנכרן את ספירות הבקרה על import_batches מול מה שקרה בפועל בלולאה - כולל שורות
  -- שהפכו needs_decision באמצע commit (לא רק valid->invalid/committed), אותו עיקרון
  -- כמו commit_eligibility_batch/commit_audit_attendance_batch (018/042).
  update import_batches set
    valid_count = (select count(*) from import_rows where batch_id = p_batch_id and status in ('valid', 'committed')),
    needs_decision_count = (select count(*) from import_rows where batch_id = p_batch_id and status = 'needs_decision'),
    invalid_count = (select count(*) from import_rows where batch_id = p_batch_id and status = 'invalid')
  where id = p_batch_id;

  -- הבטחה מכוונת: שורות needs_decision שהתגלו כאן (כפילות בתוך-קובץ) אינן חוסמות סגירת
  -- האצווה - "לא חסימה קשה" כפי שנדרש. הן נשארות גלויות בהיסטוריה/בלשונית "דורש החלטה"
  -- לצורך בדיקה ידנית, אך אינן מונעות מהשורות התקינות האחרות להיקלט.
  perform set_config('app.allow_batch_commit', 'true', true);
  update import_batches set status = 'committed', committed_at = now() where id = p_batch_id;

  perform insert_audit_event(
    'commit_audits_import_batch', 'import_batches', p_batch_id::text,
    jsonb_build_object('organization_id', p_organization_id, 'created', v_created, 'invalid', v_invalid)
  );

  return query select v_created, v_invalid;
end;
$$;

revoke execute on function commit_audits_import_batch(uuid, uuid) from public, anon;
grant execute on function commit_audits_import_batch(uuid, uuid) to authenticated;
