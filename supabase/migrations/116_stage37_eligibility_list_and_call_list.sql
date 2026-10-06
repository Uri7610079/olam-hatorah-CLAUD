-- שלב 37: "דוח זכאים" מתלמוד, ורשימת חיוג שנבנית ממנו
--
-- החלטת צ'ני (2026-10-07): רשימות טלפוניות נבנות מדוח הזכאים - רק תלמידים שתלמוד
-- סימן "זכאי" בחודש מקבלים התראה טלפונית לפני ביקורת, ולא כל הרשומים במערכת.
-- הטלפון נלקח מכרטיס התלמיד (הוא לא מופיע בדוח).
--
-- הדוח ("רשימת תלמידים לפי חודש דיווח") שונה מ"דוח דרישת תשלום" שנקלט ב-018/098:
-- אין בו סכומים, רק זכאי/אינו זכאי. לכן הוא נשמר בטבלאות משלו ולא נוגע ב-
-- monthly_eligibility, בחישובי העמלה או בסטטוס התלמיד. הקליטה כאן לא משנה שום
-- נתון קיים - רק מוסיפה את הדוח ומתאימה כל שורה לתלמיד.
--
-- דוח חדש לאותה עמותה ואותו חודש מחליף את הקודם (הקודם מסומן superseded ונשמר),
-- כדי שרשימת החיוג תמיד תיבנה מהנתונים העדכניים.

create table if not exists talmud_eligibility_lists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  month date not null,
  file_name text not null,
  file_hash text not null unique,
  row_count integer not null default 0,
  eligible_count integer not null default 0,
  not_eligible_count integer not null default 0,
  matched_count integer not null default 0,
  unmatched_eligible_count integer not null default 0,
  status text not null default 'active' check (status in ('active', 'superseded')),
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists talmud_eligibility_lists_org_month_idx on talmud_eligibility_lists (organization_id, month);

-- רק דוח פעיל אחד לכל עמותה+חודש
create unique index if not exists talmud_eligibility_lists_one_active
  on talmud_eligibility_lists (organization_id, month) where status = 'active';

create table if not exists talmud_eligibility_list_rows (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references talmud_eligibility_lists(id) on delete cascade,
  branch_code text,
  external_id text not null,
  id_type text,
  first_name text,
  last_name text,
  eligible boolean not null,
  study_code text,
  start_date date,
  end_date text,
  birth_date date,
  marital_status text,
  gender text,
  origin text,
  student_id uuid references students(id)
);

create index if not exists talmud_eligibility_list_rows_list_idx on talmud_eligibility_list_rows (list_id);
create index if not exists talmud_eligibility_list_rows_student_idx on talmud_eligibility_list_rows (student_id);

-- קריאה: כמו שאר נתוני התפעול. כתיבה: רק דרך הפונקציה למטה (אין policy לכתיבה).
alter table talmud_eligibility_lists enable row level security;
alter table talmud_eligibility_list_rows enable row level security;

drop policy if exists talmud_eligibility_lists_select on talmud_eligibility_lists;
create policy talmud_eligibility_lists_select on talmud_eligibility_lists for select to authenticated
  using ((select has_permission('area_ops', 'access')));

drop policy if exists talmud_eligibility_list_rows_select on talmud_eligibility_list_rows;
create policy talmud_eligibility_list_rows_select on talmud_eligibility_list_rows for select to authenticated
  using ((select has_permission('area_ops', 'access')));

-- ===== 1. קליטת הדוח =====
--
-- הפענוח נעשה במסך (src/lib/talmudEligibilityList.ts - הקובץ בנוי מחלק לכל סניף),
-- והשורות מגיעות לכאן כ-JSON. כאן: שמירה, התאמה לתלמיד לפי ת.ז/דרכון (בלי תלות
-- באפס מוביל - normalize_identity מ-098), והחלפת דוח קודם של אותו חודש.

create or replace function import_talmud_eligibility_list(
  p_organization_id uuid,
  p_month date,
  p_file_name text,
  p_file_hash text,
  p_rows jsonb
)
returns table (list_id uuid, row_count integer, eligible_count integer, matched_count integer, unmatched_eligible_count integer, replaced_previous boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_list uuid;
  v_month date := date_trunc('month', p_month)::date;
  v_replaced boolean := false;
  v_rows integer;
  v_eligible integer;
  v_matched integer;
  v_unmatched integer;
begin
  if not has_permission('talmud', 'import') then
    raise exception 'permission denied';
  end if;
  if not exists (select 1 from organizations where id = p_organization_id) then
    raise exception 'העמותה לא נמצאה';
  end if;
  if p_month is null then raise exception 'חסר חודש הדיווח'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'אין בקובץ שורות תלמידים';
  end if;
  if exists (select 1 from talmud_eligibility_lists where file_hash = p_file_hash) then
    raise exception 'הקובץ הזה כבר נקלט בעבר';
  end if;

  update talmud_eligibility_lists set status = 'superseded'
  where organization_id = p_organization_id and month = v_month and status = 'active';
  v_replaced := found;

  insert into talmud_eligibility_lists (organization_id, month, file_name, file_hash, uploaded_by)
  values (p_organization_id, v_month, p_file_name, p_file_hash, auth.uid())
  returning id into v_list;

  insert into talmud_eligibility_list_rows (
    list_id, branch_code, external_id, id_type, first_name, last_name, eligible, study_code,
    start_date, end_date, birth_date, marital_status, gender, origin
  )
  select v_list, nullif(btrim(r.branch_code), ''), btrim(r.external_id), nullif(btrim(r.id_type), ''),
         nullif(btrim(r.first_name), ''), nullif(btrim(r.last_name), ''), coalesce(r.eligible, false),
         nullif(btrim(r.study_code), ''), r.start_date, nullif(btrim(r.end_date), ''), r.birth_date,
         nullif(btrim(r.marital_status), ''), nullif(btrim(r.gender), ''), nullif(btrim(r.origin), '')
  from jsonb_to_recordset(p_rows) as r(
    branch_code text, external_id text, id_type text, first_name text, last_name text, eligible boolean,
    study_code text, start_date date, end_date text, birth_date date, marital_status text, gender text, origin text)
  where coalesce(btrim(r.external_id), '') <> '';

  -- התאמה לתלמיד. אם יש כמה תלמידים עם אותו מזהה (לא אמור לקרות) - הוותיק ביותר.
  update talmud_eligibility_list_rows r set student_id = (
    select s.id from students s
    where normalize_identity(s.external_id) = normalize_identity(r.external_id)
    order by s.created_at limit 1)
  where r.list_id = v_list;

  select count(*), count(*) filter (where eligible), count(*) filter (where student_id is not null)
    into v_rows, v_eligible, v_matched
  from talmud_eligibility_list_rows where talmud_eligibility_list_rows.list_id = v_list;

  -- זכאים שלא נמצאו - לפי תלמיד ולא לפי שורה (תלמיד עם שני סוגי לימוד מופיע פעמיים)
  select count(distinct normalize_identity(external_id)) into v_unmatched
  from talmud_eligibility_list_rows
  where talmud_eligibility_list_rows.list_id = v_list and eligible and student_id is null;

  update talmud_eligibility_lists set
    row_count = v_rows,
    eligible_count = v_eligible,
    not_eligible_count = v_rows - v_eligible,
    matched_count = v_matched,
    unmatched_eligible_count = v_unmatched
  where id = v_list;

  perform insert_audit_event('import_talmud_eligibility_list', 'talmud_eligibility_lists', v_list::text,
    jsonb_build_object('organization_id', p_organization_id, 'month', v_month, 'rows', v_rows,
                       'eligible', v_eligible, 'matched', v_matched, 'replaced_previous', v_replaced));

  return query select v_list, v_rows, v_eligible, v_matched, v_unmatched, v_replaced;
end;
$$;

grant execute on function import_talmud_eligibility_list(uuid, date, text, text, jsonb) to authenticated;

-- ===== 2. רשימת החיוג =====
--
-- כל תלמיד שבדוח הפעיל של העמותה והחודש מסומן "זכאי" (לפחות באחת מהשורות שלו),
-- פעם אחת לכל תלמיד, עם הטלפון מכרטיס התלמיד. category:
--   ready      - נמצא במערכת ויש לו טלפון
--   no_phone   - נמצא במערכת, אבל אין לו טלפון
--   not_found  - לא נמצא במערכת בכלל
-- השם נלקח מהדוח (שם פרטי ומשפחה בנפרד, כמו שהמערכת הטלפונית צריכה).

create or replace function get_eligibility_call_list(p_organization_id uuid, p_month date, p_branch_code text default null)
returns table (
  student_id uuid,
  external_id text,
  first_name text,
  last_name text,
  branch_code text,
  branch_name text,
  group_name text,
  phone text,
  category text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_list uuid;
begin
  if not has_permission('area_ops', 'access') then
    raise exception 'permission denied';
  end if;

  select l.id into v_list from talmud_eligibility_lists l
  where l.organization_id = p_organization_id and l.month = date_trunc('month', p_month)::date and l.status = 'active';
  if v_list is null then return; end if;

  return query
  with eligible_rows as (
    select distinct on (normalize_identity(r.external_id))
      r.student_id, r.external_id, r.first_name, r.last_name, r.branch_code
    from talmud_eligibility_list_rows r
    where r.list_id = v_list and r.eligible
      and (p_branch_code is null or r.branch_code = p_branch_code)
    order by normalize_identity(r.external_id), r.branch_code
  )
  select e.student_id, e.external_id, e.first_name, e.last_name, e.branch_code,
         b.internal_name, g.name,
         nullif(btrim(coalesce(s.phone_normalized, s.phone_raw, '')), ''),
         case when e.student_id is null then 'not_found'
              when nullif(btrim(coalesce(s.phone_normalized, s.phone_raw, '')), '') is null then 'no_phone'
              else 'ready' end
  from eligible_rows e
  left join students s on s.id = e.student_id
  left join branches b on b.organization_id = p_organization_id and b.talmud_branch_code = e.branch_code
  left join lateral (
    select gr.name from student_assignments sa join groups gr on gr.id = sa.group_id
    where sa.student_id = e.student_id and sa.is_active
    limit 1
  ) g on true
  order by e.branch_code, e.last_name, e.first_name;
end;
$$;

grant execute on function get_eligibility_call_list(uuid, date, text) to authenticated;
