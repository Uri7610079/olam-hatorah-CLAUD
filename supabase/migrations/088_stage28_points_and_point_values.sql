-- שלב 28: מנגנון ניקוד ושווי נקודה - לפי תשובות הלקוח:
--   "משרד החינוך קובע [את הניקוד]"
--   "משתנים אחת לתקופה (לא כל חודש). צריך שהחישוב יישאר כמו בחודש קודם אם אין שינוי מפורש"
--   [מלגה] "זו אותה מערכת. נקבע על ידי משרד החינוך"
--
-- הדרישה השנייה היא הלב של המבנה כאן. אילו שמרנו ערך יחיד ומעדכנים אותו במקום,
-- כל עדכון היה משנה למפרע את החישוב של כל החודשים שכבר נסגרו - כולל חודשים שכבר
-- שולמו בפועל. לכן כל ערך נשמר עם חודש תחילת תוקף, לעולם לא נדרס, והחישוב לחודש
-- מסוים מחפש את הערך שהיה בתוקף באותו חודש. "אין שינוי מפורש" מתבטא בכך שפשוט
-- אין שורה חדשה, והשורה הקודמת ממשיכה לחול.
--
-- שווי נקודה הוא כלל-מערכתי (לא פר-עמותה) - כך מסר הלקוח, ולכן אין כאן organization_id.

-- שווי נקודה בשקלים, נקבע ומתפרסם ע"י משרד החינוך.
create table point_values (
  id uuid primary key default gen_random_uuid(),
  -- תמיד ה-1 בחודש: הזכאות מחושבת ברמת חודש, ושינוי באמצע חודש היה יוצר
  -- דו-משמעות באיזה ערך להשתמש לאותו חודש.
  effective_from date not null unique check (extract(day from effective_from) = 1),
  value numeric(12, 4) not null check (value > 0),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz
);

create trigger point_values_set_updated_at
  before update on point_values
  for each row execute function set_updated_at();

-- ניקוד לכל קוד לימוד (אברך 1.8, בחור 1, חצי יום 0.9 וכו). study_code הוא הקוד
-- העסקי עצמו ולא FK ל-id, בהתאם לאופן שבו study_code כבר נשמר על students
-- ו-commission_rules במערכת.
create table study_code_points (
  id uuid primary key default gen_random_uuid(),
  study_code text not null references study_codes(code),
  effective_from date not null check (extract(day from effective_from) = 1),
  points numeric(8, 3) not null check (points > 0),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz,
  unique (study_code, effective_from)
);

create trigger study_code_points_set_updated_at
  before update on study_code_points
  for each row execute function set_updated_at();

create index study_code_points_lookup_idx on study_code_points (study_code, effective_from desc);

alter table point_values enable row level security;
alter table study_code_points enable row level security;

-- קריאה פתוחה לכל מאושר (זה נתון הגדרה, לא מידע רגיש), כתיבה רק למי שמנהל ערכי
-- מערכת - אותה הרשאה שכבר שולטת במסך "קודי לימוד וערכי מערכת".
create policy point_values_select on point_values for select to authenticated using (true);
create policy point_values_insert on point_values for insert to authenticated
  with check (has_permission('study_codes', 'manage'));
create policy point_values_update on point_values for update to authenticated
  using (has_permission('study_codes', 'manage'))
  with check (has_permission('study_codes', 'manage'));
create policy point_values_delete on point_values for delete to authenticated
  using (has_permission('study_codes', 'manage'));

create policy study_code_points_select on study_code_points for select to authenticated using (true);
create policy study_code_points_insert on study_code_points for insert to authenticated
  with check (has_permission('study_codes', 'manage'));
create policy study_code_points_update on study_code_points for update to authenticated
  using (has_permission('study_codes', 'manage'))
  with check (has_permission('study_codes', 'manage'));
create policy study_code_points_delete on study_code_points for delete to authenticated
  using (has_permission('study_codes', 'manage'));

-- שלוש פונקציות החיפוש - כאן מיושמת בפועל הדרישה "יישאר כמו בחודש קודם": נבחרת
-- תמיד השורה האחרונה שתחילת תוקפה אינה מאוחרת מהחודש המבוקש. חודש שקדם לכל
-- הערכים מחזיר null (ולא 0), כדי שהמסך יוכל לומר "לא הוגדר" במקום להציג אפס שנראה
-- כמו סכום אמיתי.
create or replace function point_value_for_month(p_month date)
returns numeric
language sql
stable
as $$
  select pv.value
  from point_values pv
  where pv.effective_from <= date_trunc('month', p_month)::date
  order by pv.effective_from desc
  limit 1;
$$;

create or replace function study_code_points_for_month(p_study_code text, p_month date)
returns numeric
language sql
stable
as $$
  select scp.points
  from study_code_points scp
  where scp.study_code = p_study_code
    and scp.effective_from <= date_trunc('month', p_month)::date
  order by scp.effective_from desc
  limit 1;
$$;

-- הסכום הצפוי לתלמיד בקוד לימוד מסוים בחודש מסוים. מחזיר null אם חסר אחד
-- השניים - לא מנחשים ולא מחזירים אפס.
create or replace function expected_amount_for_month(p_study_code text, p_month date)
returns numeric
language sql
stable
as $$
  select case
    when study_code_points_for_month(p_study_code, p_month) is null then null
    when point_value_for_month(p_month) is null then null
    else round(study_code_points_for_month(p_study_code, p_month) * point_value_for_month(p_month), 2)
  end;
$$;

grant execute on function point_value_for_month(date) to authenticated;
grant execute on function study_code_points_for_month(text, date) to authenticated;
grant execute on function expected_amount_for_month(text, date) to authenticated;

-- הניקוד שדווח בפועל בדוח הזכאות, כדי שאפשר יהיה להשוות בין מה שהמשרד שילם למה
-- שהיה אמור לצאת לפי הניקוד ושווי הנקודה. העמודה הקיימת score_or_payment_type היא
-- טקסט חופשי (היא קולטת גם "שוטף"/"רטרו"), ולכן לא ניתן לחשב ממנה.
alter table monthly_eligibility add column reported_points numeric(8, 3);

-- השוואה בין המדווח לצפוי. מיועדת לבדיקה ולא לתיקון אוטומטי: הסכום שמשרד החינוך
-- שילם הוא הסכום הקובע, וכל פער הוא נושא לבירור אנושי - לא משהו שהמערכת מתקנת
-- לבד. הסטייה נמדדת מול הניקוד המדווח כשהוא קיים, ואחרת מול הניקוד שהוגדר לקוד
-- הלימוד של התלמיד.
create or replace function eligibility_amount_check(p_organization_id uuid, p_month date)
returns table (
  student_id uuid,
  full_name text,
  study_code text,
  reported_points numeric,
  expected_points numeric,
  point_value numeric,
  reported_amount numeric,
  expected_amount numeric,
  difference numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    me.student_id,
    s.full_name,
    s.study_code,
    me.reported_points,
    study_code_points_for_month(s.study_code, me.month),
    point_value_for_month(me.month),
    me.gross_amount,
    case
      when point_value_for_month(me.month) is null then null
      when coalesce(me.reported_points, study_code_points_for_month(s.study_code, me.month)) is null then null
      else round(coalesce(me.reported_points, study_code_points_for_month(s.study_code, me.month)) * point_value_for_month(me.month), 2)
    end,
    case
      when point_value_for_month(me.month) is null then null
      when coalesce(me.reported_points, study_code_points_for_month(s.study_code, me.month)) is null then null
      else round(me.gross_amount - coalesce(me.reported_points, study_code_points_for_month(s.study_code, me.month)) * point_value_for_month(me.month), 2)
    end
  from monthly_eligibility me
  join students s on s.id = me.student_id
  where me.organization_id = p_organization_id
    and me.month = date_trunc('month', p_month)::date
    and me.status = 'active'
    and has_permission('area_finance', 'access')
  order by s.full_name;
$$;

grant execute on function eligibility_amount_check(uuid, date) to authenticated;

-- מילוי reported_points מתוך העמודה הקיימת: בדוח הזכאות העמודה "ניקוד/סוג תשלום"
-- מכילה לפעמים ניקוד מספרי (1.8) ולפעמים טקסט ("שוטף"/"רטרו"), ולכן היא נשמרת
-- כטקסט חופשי ואי אפשר לחשב ממנה ישירות.
--
-- נעשה בטריגר ולא בתוך commit_eligibility_batch בכוונה: הפונקציה ההיא ארוכה ומטפלת
-- בכסף, ושכתוב מלא שלה רק כדי להוסיף שורה אחת היה מסכן לוגיקה עובדת בלי צורך.
-- הטריגר נוגע אך ורק בעמודה החדשה, ורק כשהיא ריקה - הוא לעולם לא דורס ערך שהוזן.
create or replace function set_eligibility_reported_points()
returns trigger
language plpgsql
as $$
begin
  if new.reported_points is null and new.score_or_payment_type is not null then
    begin
      -- מספר בלבד; כל טקסט אחר משאיר את השדה ריק בשקט (זה לא מצב שגיאה).
      if new.score_or_payment_type ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then
        new.reported_points := trim(new.score_or_payment_type)::numeric;
      end if;
    exception when others then
      new.reported_points := null;
    end;
  end if;
  return new;
end;
$$;

create trigger monthly_eligibility_set_reported_points
  before insert or update on monthly_eligibility
  for each row execute function set_eligibility_reported_points();

-- מילוי למפרע לשורות שכבר נקלטו לפני שהעמודה קיימת.
update monthly_eligibility
set reported_points = trim(score_or_payment_type)::numeric
where reported_points is null
  and score_or_payment_type ~ '^\s*[0-9]+(\.[0-9]+)?\s*$';
