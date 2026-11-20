-- מיגרציה 136: תיקונים מביקורת האבטחה של 20.11.2026
--
-- 1. צילום ת"ז מהפורטל: סוג הקובץ נקבע לפי התוכן שלו, ולא לפי מה שהדפדפן של ראש
--    הקבוצה הצהיר. מתקבלים רק תמונה (JPG/PNG/GIF/WEBP/HEIC) או PDF. עד היום קובץ HTML
--    שהוצהר כתמונה נשמר כמו שהוא, ונפתח במשרד כדף שמריץ קוד בהרשאות העובד.
-- 2. סימון דמו (is_demo / demo_batch_id): אי אפשר יותר לשנות אותו ברשומה קיימת.
--    מחיקת חבילת דמו מוחקת כל עמותה ותלמיד שמסומנים בה, עם כל מה שתלוי בהם. עד היום
--    מי שיכול לערוך עמותה יכול היה לסמן עמותה אמיתית, ואז מחיקת הדמו מחקה אותה.
--    יצירת דמו לא נפגעת: היא מכניסה רשומות חדשות ולא מעדכנת קיימות.
-- 3. מספר חשבון בבקשות "תלמיד חדש" מהפורטל: מוצג מלא רק למי שיש לו הרשאה לנתונים
--    רגישים (bank_accounts.view_sensitive), כמו בכל שאר המערכת (מיגרציה 060). כל השאר
--    קוראים דרך portal_change_requests_view, שם המספר ממוסך. אישור הבקשה לא משתנה:
--    הוא רץ בשרת ורואה את המספר המלא.
-- 4. שורות יבוא וקבצי יבוא של תלמידים, נתוני יסוד ותרומות (מספרי חשבון, אסמכתת
--    תורם): אחרי שהיבוא נקלט, רק מי שיש לו הרשאה לנתונים רגישים קורא אותם. לפני
--    הקליטה - כמו היום, כי מי שמייבא צריך לסקור את השורות.
-- 5. חיזוק: משתמש שלא נכנס למערכת לא מקבל גישת קריאה לתצוגות. (הן כבר החזירו לו
--    אפס שורות, כי כל תצוגה בודקת הרשאה. זו שכבת הגנה נוספת.)
--
-- שום נתון לא נמחק ולא משתנה. משתנים רק כללי גישה, ונוספים בדיקות ותצוגה.

-- ===== 1. סוג קובץ לפי התוכן =====

-- מזהה את סוג הקובץ לפי הבתים הראשונים שלו. מחזירה null לכל דבר שאינו תמונה או PDF.
create or replace function sniff_safe_file_type(p_data bytea)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_data is null or octet_length(p_data) < 12 then null
    when substring(p_data from 1 for 3) = '\xffd8ff'::bytea then 'image/jpeg'
    when substring(p_data from 1 for 8) = '\x89504e470d0a1a0a'::bytea then 'image/png'
    when substring(p_data from 1 for 4) = '\x47494638'::bytea then 'image/gif'
    when substring(p_data from 1 for 4) = '\x52494646'::bytea
     and substring(p_data from 9 for 4) = '\x57454250'::bytea then 'image/webp'
    when substring(p_data from 1 for 5) = '\x255044462d'::bytea then 'application/pdf'
    -- HEIC (צילום מאייפון): "ftyp" בבית 5, ואחריו סוג heic/heix/hevc/mif1/msf1
    when substring(p_data from 5 for 4) = '\x66747970'::bytea
     and substring(p_data from 9 for 4) in ('\x68656963'::bytea, '\x68656978'::bytea, '\x68657663'::bytea,
                                             '\x6d696631'::bytea, '\x6d736631'::bytea) then 'image/heic'
    else null
  end;
$$;

create or replace function portal_request_attachments_check_type()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_type text;
begin
  v_type := sniff_safe_file_type(new.data);
  if v_type is null then
    raise exception 'צילום הת"ז חייב להיות תמונה (JPG או PNG) או קובץ PDF';
  end if;
  -- הסוג שהדפדפן הצהיר עליו לא נשמר. נשמר רק מה שזוהה בפועל.
  new.file_type := v_type;
  return new;
end;
$$;

drop trigger if exists portal_request_attachments_check_type on portal_request_attachments;
create trigger portal_request_attachments_check_type
  before insert or update of data, file_type on portal_request_attachments
  for each row execute function portal_request_attachments_check_type();

-- ===== 2. סימון דמו לא משתנה ברשומה קיימת =====

create or replace function prevent_demo_marking_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (to_jsonb(new) -> 'demo_batch_id') is distinct from (to_jsonb(old) -> 'demo_batch_id')
     or (to_jsonb(new) -> 'is_demo') is distinct from (to_jsonb(old) -> 'is_demo') then
    raise exception 'אי אפשר לשנות את סימון הדמו של רשומה קיימת';
  end if;
  return new;
end;
$$;

-- לכל טבלה שיש בה סימון דמו. הטריגר רץ רק כשהעדכון נוגע בעמודות האלה, כך שאין
-- עלות לעדכונים רגילים.
do $$
declare
  r record;
begin
  for r in
    select c.table_name, string_agg(quote_ident(c.column_name), ', ' order by c.column_name) as cols
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name in ('demo_batch_id', 'is_demo')
    group by c.table_name
  loop
    execute format('drop trigger if exists prevent_demo_marking_change on public.%I', r.table_name);
    execute format(
      'create trigger prevent_demo_marking_change before update of %s on public.%I for each row execute function prevent_demo_marking_change()',
      r.cols, r.table_name);
  end loop;
end;
$$;

-- ===== 3. מספר חשבון בבקשות מהפורטל =====

-- מחליפה את מספר החשבון בגרסה ממוסכת (4 ספרות אחרונות), אם יש כזה.
create or replace function mask_portal_payload(p jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case
    when p is null or jsonb_typeof(p) <> 'object' or not (p ? 'account_number') then p
    else p || jsonb_build_object('account_number', mask_account_number(p ->> 'account_number'))
  end;
$$;

-- רצה כבעלים (לא security_invoker) בכוונה, כמו התצוגות של 060: הטבלה עצמה פתוחה
-- עכשיו רק לבעלי הרשאה רגישה, וכלל הראייה המקורי (area_ops) משוכפל כאן ב-WHERE.
create or replace view portal_change_requests_view
as
select
  id,
  group_leader_id,
  student_id,
  group_id,
  kind,
  case when has_permission('bank_accounts', 'view_sensitive') then payload else mask_portal_payload(payload) end as payload,
  case when has_permission('bank_accounts', 'view_sensitive') then previous else mask_portal_payload(previous) end as previous,
  status,
  decided_by,
  decided_at,
  decision_note,
  created_at,
  office_note,
  talmud_file_at,
  talmud_file_by
from portal_change_requests
where has_permission('area_ops', 'access');

alter view portal_change_requests_view reset (security_invoker);
revoke all on portal_change_requests_view from anon, public;
grant select on portal_change_requests_view to authenticated;

drop policy if exists portal_change_requests_select on portal_change_requests;
create policy portal_change_requests_select on portal_change_requests for select to authenticated
  using ((select has_permission('area_ops', 'access')) and (select has_permission('bank_accounts', 'view_sensitive')));

-- ===== 4. שורות וקבצי יבוא רגישים אחרי הקליטה =====

-- סוגי יבוא שהשורות שלהם כוללות מספר חשבון או אסמכתת תורם. security definer כדי
-- שהתשובה לא תלויה במה שהמשתמש עצמו רשאי לקרוא (אחרת "לא מצאתי" היה פותח גישה).
create or replace function import_batch_is_sensitive_committed(p_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from import_batches b
    join import_profiles p on p.id = b.profile_id
    where b.id = p_batch_id
      and b.status = 'committed'
      and p.key in ('students', 'master_data', 'donations')
  );
$$;

create or replace function import_file_is_sensitive_committed(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from import_batches b
    join import_profiles p on p.id = b.profile_id
    where b.file_path = p_path
      and b.status = 'committed'
      and p.key in ('students', 'master_data', 'donations')
  );
$$;

revoke all on function import_batch_is_sensitive_committed(uuid) from public, anon;
revoke all on function import_file_is_sensitive_committed(text) from public, anon;
grant execute on function import_batch_is_sensitive_committed(uuid) to authenticated;
grant execute on function import_file_is_sensitive_committed(text) to authenticated;

drop policy if exists import_rows_select on import_rows;
create policy import_rows_select on import_rows for select to authenticated
  using (
    has_permission('import', 'perform')
    and exists (select 1 from import_batches b where b.id = batch_id)
    and (not import_batch_is_sensitive_committed(batch_id) or has_permission('bank_accounts', 'view_sensitive'))
  );

drop policy if exists import_files_select on storage.objects;
create policy import_files_select on storage.objects for select to authenticated
  using (
    bucket_id = 'import-files'
    and public.has_permission('import', 'perform')
    and (
      public.has_permission('bank_accounts', 'view_sensitive')
      or not public.import_file_is_sensitive_committed(objects.name)
    )
  );

-- ===== 5. בלי גישת קריאה לתצוגות למי שלא נכנס =====

do $$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
  loop
    execute format('revoke all on public.%I from anon', r.relname);
  end loop;
end;
$$;
