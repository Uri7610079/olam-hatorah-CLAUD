-- שלב 31 (חלק א'): טבלת בנקים והשלמת קוד משם.
--
-- הדרישה: "אם כתוב רק בנק, למשל פועלים, תוסיף אוטומטית מספר בנק 12."
--
-- למה טבלה ולא רשימה בקוד: ההשלמה נדרשת בתוך פונקציית הקליטה (SQL), ולא רק
-- במסך; רשימה בצד הדפדפן לא הייתה זמינה שם. בנוסף, הלקוח יכול להוסיף בנק או
-- כינוי בעצמו בלי שינוי קוד.
--
-- ולמה בכלל צריך קוד בנק: student_bank_accounts שמרה שם בנק בלבד. קובץ מס"ב
-- מזהה בנק במספר, לא בשם - כלומר בלי הקוד אי אפשר לשלם, וזה היה מתגלה רק
-- בתשלום הראשון.

create table banks (
  code text primary key,
  name text not null,
  -- כינויים שהמשתמשת עשויה לכתוב בפועל: "פועלים", "הפועלים", "בנק הפועלים".
  aliases text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger banks_set_updated_at
  before update on banks
  for each row execute function set_updated_at();

alter table banks enable row level security;

create policy banks_select on banks for select to authenticated using (true);
create policy banks_insert on banks for insert to authenticated with check (has_permission('study_codes', 'manage'));
create policy banks_update on banks for update to authenticated
  using (has_permission('study_codes', 'manage')) with check (has_permission('study_codes', 'manage'));
create policy banks_delete on banks for delete to authenticated using (has_permission('study_codes', 'manage'));

-- קודי הבנקים כפי שבנק ישראל מפרסם. הקוד נשמר כטקסט ולא כמספר, כדי לשמר אפס
-- מוביל ("04", "09") - בדיוק מאותה סיבה שקוד סניף נשמר כטקסט.
insert into banks (code, name, aliases) values
  ('04', 'בנק יהב', array['יהב', 'בנק יהב לעובדי המדינה']),
  ('09', 'בנק הדואר', array['דואר', 'הדואר', 'בנק דואר']),
  ('10', 'בנק לאומי', array['לאומי', 'בנק לאומי לישראל']),
  ('11', 'בנק דיסקונט', array['דיסקונט', 'בנק דיסקונט לישראל']),
  ('12', 'בנק הפועלים', array['פועלים', 'הפועלים', 'בנק פועלים']),
  ('13', 'בנק אגוד', array['אגוד', 'איגוד', 'בנק איגוד']),
  ('14', 'בנק אוצר החייל', array['אוצר החייל', 'אוצר']),
  ('17', 'בנק מרכנתיל דיסקונט', array['מרכנתיל', 'מרכנתיל דיסקונט']),
  ('20', 'בנק מזרחי טפחות', array['מזרחי', 'טפחות', 'מזרחי טפחות']),
  ('26', 'יובנק', array['יו בנק']),
  ('31', 'הבנק הבינלאומי הראשון', array['בינלאומי', 'הבינלאומי', 'בנק בינלאומי', 'הבנק הבינלאומי']),
  ('34', 'בנק ערבי ישראלי', array['ערבי ישראלי']),
  ('46', 'בנק מסד', array['מסד']),
  ('52', 'בנק פאג''י', array['פאגי', 'פאג''י', 'פועלי אגודת ישראל', 'בנק פועלי אגודת ישראל']),
  ('54', 'בנק ירושלים', array['ירושלים']),
  ('68', 'בנק דקסיה ישראל', array['דקסיה']);

-- השלמת קוד בנק מקלט חופשי: קוד, שם מלא, או כינוי.
--
-- ההתאמה מכוונת להיות מדויקת ולא "חכמה": קוד שגוי בחשבון בנק שולח כסף למקום
-- הלא נכון, ולכן עדיף להחזיר null ולתת למשתמשת להשלים מאשר לנחש. אין כאן חיפוש
-- מטושטש - רק התאמה מלאה אחרי ניקוי רווחים והמילה "בנק".
create or replace function resolve_bank_code(p_input text)
returns text
language sql
stable
as $$
  with cleaned as (
    select nullif(trim(regexp_replace(coalesce(p_input, ''), '\s+', ' ', 'g')), '') as raw
  ), normalized as (
    select
      raw,
      -- "בנק הפועלים" ו"הפועלים" ו"פועלים" צריכים כולם להגיע לאותה שורה.
      trim(regexp_replace(raw, '^(בנק\s+)?(ה)?', '', 'i')) as bare
    from cleaned
  )
  select b.code
  from banks b, normalized n
  where n.raw is not null
    and b.is_active
    and (
      -- קוד מספרי, עם או בלי אפס מוביל ("12", "012", "4" -> "04")
      b.code = n.raw
      or (n.raw ~ '^[0-9]{1,2}$' and b.code = lpad(n.raw, 2, '0'))
      or b.name = n.raw
      or n.raw = any (b.aliases)
      or b.name = n.bare
      or n.bare = any (b.aliases)
      or trim(regexp_replace(b.name, '^(בנק\s+)?(ה)?', '', 'i')) = n.bare
    )
  limit 1;
$$;

grant execute on function resolve_bank_code(text) to authenticated;

-- שם הבנק לפי קוד - לכיוון ההפוך, כשהקובץ נותן מספר בלבד (כמו בקובץ של הלקוח,
-- שבו כתוב 52 ולא "פאג'י").
create or replace function bank_name_for_code(p_code text)
returns text
language sql
stable
as $$
  select b.name from banks b
  where b.code = p_code or (p_code ~ '^[0-9]{1,2}$' and b.code = lpad(p_code, 2, '0'))
  limit 1;
$$;

grant execute on function bank_name_for_code(text) to authenticated;

-- קוד הבנק על חשבון התלמיד. לא היה קיים, ובלעדיו אי אפשר לייצר מס"ב.
alter table student_bank_accounts add column if not exists bank_code text;
