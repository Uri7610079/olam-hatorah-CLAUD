-- שלב 40: תלמוד הוא מערכת האמת לנתוני התלמידים
--
-- החלטת צ'ני (2026-11-18): "כל הנתונים שנמצאים בתלמוד הם נתוני האמת שצריכים
-- לקבוע". עד עכשיו "דוח הזכאים" (רשימת התלמידים לפי חודש, 116) רק התאים שורות
-- לתלמידים קיימים, ומי שלא נמצא נשאר ברשימת "זכאים שלא נמצאו במערכת".
--
-- מעכשיו, בכל קליטה של הדוח:
--   1. תלמיד שאינו במערכת - נוצר, עם כל מה שתלמוד יודע עליו, בסטטוס "פעיל".
--   2. תלמיד קיים - כל נתון שיש בתלמוד מחליף את מה שבמערכת. כל החלפה נרשמת
--      ב-student_talmud_changes (מה היה, מה נהיה, מאיזה דוח).
--   3. תלמיד בטיוטה / מוכן לתלמוד / נשלח לתלמוד - עובר ל"פעיל" (הוא רשום שם).
--
-- מה *לא* משתנה לבד, ורק מסומן במרכז החריגות:
--   * תלמיד שיצא אצלנו ועדיין רשום בתלמוד - כנראה היציאה לא דווחה לתלמוד.
--   * תלמיד שתלמוד רושם בסניף אחר - מעבר סניף דורש לבחור ראש קבוצה.
-- ומה שתלמוד לא יודע (טלפון, כתובת, בנק, ראש קבוצה) מסומן "חסר נתון".
--
-- הגנה מפני דוח ישן: תלמיד חדש נוצר רק מהדוח האחרון של העמותה, ונתון של תלמיד
-- קיים מוחלף רק מדוח שאינו ישן מהדוח שעדכן אותו לאחרונה (talmud_synced_month).
-- כך קליטה מאוחרת של דוח מלפני חצי שנה לא מחזירה נתונים שהתיישנו.

-- ===== 1. עמודות =====
alter table students add column if not exists gender text;
alter table students add column if not exists talmud_start_date date;
alter table students add column if not exists talmud_end_date text;
alter table students add column if not exists talmud_synced_month date;
alter table students add column if not exists talmud_synced_at timestamptz;
alter table students add column if not exists created_from_talmud boolean not null default false;

-- בתלמוד יש ארבעה מצבים משפחתיים; במערכת היו רק בחור/נשוי (112).
alter table students drop constraint if exists students_marital_status_check;
alter table students add constraint students_marital_status_check
  check (marital_status in ('single', 'married', 'divorced', 'widowed'));

-- ===== 2. יומן השינויים שתלמוד עשה =====
create table if not exists student_talmud_changes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  list_id uuid references talmud_eligibility_lists(id) on delete set null,
  month date,
  field text not null,
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);
create index if not exists student_talmud_changes_student_idx on student_talmud_changes (student_id, created_at desc);

alter table student_talmud_changes enable row level security;
drop policy if exists student_talmud_changes_select on student_talmud_changes;
create policy student_talmud_changes_select on student_talmud_changes for select to authenticated
  using ((select has_permission('area_ops', 'access')));

-- ===== 3. הסנכרון =====
--
-- פנימית (בלי בדיקת הרשאה), כדי שגם ההשלמה החד-פעמית בסוף הקובץ תוכל להריץ
-- אותה. סגורה ללקוח; נקראת מ-import_talmud_eligibility_list ומ-sync_students_from_talmud_list.

create or replace function _sync_students_from_talmud_list(p_list_id uuid)
returns table (created_count integer, updated_count integer, activated_count integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_list talmud_eligibility_lists%rowtype;
  v_is_latest boolean;
  r record;
  s students%rowtype;
  v_sid uuid;
  v_idtype text;
  v_ext text;
  v_marital text;
  v_full text;
  v_new jsonb;
  v_old jsonb;
  v_key text;
  v_val text;
  v_changes integer;
  v_created integer := 0;
  v_updated integer := 0;
  v_activated integer := 0;
begin
  select * into v_list from talmud_eligibility_lists where id = p_list_id;
  if not found or v_list.status <> 'active' then
    return query select 0, 0, 0;
    return;
  end if;

  -- תלמיד חדש נוצר רק מהדוח האחרון של העמותה
  v_is_latest := not exists (
    select 1 from talmud_eligibility_lists l
    where l.organization_id = v_list.organization_id and l.status = 'active' and l.month > v_list.month);

  -- שורה אחת לכל תלמיד: תלמיד עם שני סוגי לימוד מופיע פעמיים. עדיפות לשורה
  -- הזכאית, ואחריה לזו שהתחילה אחרונה.
  for r in
    select distinct on (normalize_identity(x.external_id)) x.*
    from talmud_eligibility_list_rows x
    where x.list_id = p_list_id
    order by normalize_identity(x.external_id), x.eligible desc, x.start_date desc nulls last, x.id
  loop
    v_idtype := case when coalesce(r.id_type, '') like '%דרכון%' then 'passport' else 'israeli_id' end;
    -- ת.ז. לתלמוד = 9 ספרות (אפסים מובילים). דרכון - כמו שהוא.
    v_ext := case
      when v_idtype = 'israeli_id' and r.external_id ~ '^[0-9]+$' and length(r.external_id) < 9 then lpad(r.external_id, 9, '0')
      else upper(r.external_id) end;
    v_marital := case
      when r.marital_status like 'רווק%' then 'single'
      when r.marital_status like 'נשוי%' then 'married'
      when r.marital_status like 'גרוש%' then 'divorced'
      when r.marital_status like 'אלמן%' then 'widowed'
      else null end;
    v_full := nullif(btrim(coalesce(r.last_name, '') || ' ' || coalesce(r.first_name, '')), '');

    v_sid := r.student_id;
    if v_sid is null then
      select st.id into v_sid from students st
      where normalize_identity(st.external_id) = normalize_identity(r.external_id)
      order by st.created_at limit 1;
    end if;

    if v_sid is null then
      if not v_is_latest then
        continue;
      end if;
      insert into students (
        id_type, external_id, full_name, first_name, last_name, birth_date, marital_status, gender,
        study_code, passport_country, talmud_start_date, talmud_end_date, talmud_synced_month,
        talmud_synced_at, created_from_talmud, status)
      values (
        v_idtype, v_ext, coalesce(v_full, v_ext), r.first_name, r.last_name, r.birth_date, v_marital, r.gender,
        r.study_code, case when v_idtype = 'passport' then r.origin end, r.start_date, r.end_date, v_list.month,
        now(), true, 'draft')
      returning id into v_sid;

      perform set_config('app.allow_student_status_change', 'true', true);
      update students set status = 'active' where id = v_sid;
      perform set_config('app.allow_student_status_change', '', true);

      insert into student_talmud_changes (student_id, list_id, month, field, old_value, new_value)
      values (v_sid, p_list_id, v_list.month, 'created', null, 'נוצר מדוח תלמוד');
      v_created := v_created + 1;

    else
      select * into s from students where id = v_sid;

      if s.talmud_synced_month is null or s.talmud_synced_month <= v_list.month then
        v_new := jsonb_strip_nulls(jsonb_build_object(
          'first_name', r.first_name,
          'last_name', r.last_name,
          'full_name', v_full,
          'birth_date', r.birth_date,
          'marital_status', v_marital,
          'gender', r.gender,
          'study_code', r.study_code,
          'passport_country', case when v_idtype = 'passport' then nullif(btrim(r.origin), '') end,
          'talmud_start_date', r.start_date,
          'talmud_end_date', r.end_date,
          'id_type', v_idtype,
          'external_id', v_ext));

        -- מזהה שכבר תפוס בתלמיד אחר (כפילות ישנה) - לא נוגעים בו, כדי לא לשבור את הייחודיות
        if exists (select 1 from students o where o.id <> v_sid and o.id_type = v_idtype and o.external_id = v_ext) then
          v_new := v_new - 'id_type' - 'external_id';
        end if;

        v_old := to_jsonb(s);
        v_changes := 0;
        for v_key, v_val in select key, value #>> '{}' from jsonb_each(v_new) loop
          if (v_old ->> v_key) is distinct from v_val then
            insert into student_talmud_changes (student_id, list_id, month, field, old_value, new_value)
            values (v_sid, p_list_id, v_list.month, v_key, v_old ->> v_key, v_val);
            v_changes := v_changes + 1;
          end if;
        end loop;

        update students set
          first_name = coalesce(v_new ->> 'first_name', first_name),
          last_name = coalesce(v_new ->> 'last_name', last_name),
          full_name = coalesce(v_new ->> 'full_name', full_name),
          birth_date = coalesce((v_new ->> 'birth_date')::date, birth_date),
          marital_status = coalesce(v_new ->> 'marital_status', marital_status),
          gender = coalesce(v_new ->> 'gender', gender),
          study_code = coalesce(v_new ->> 'study_code', study_code),
          passport_country = coalesce(v_new ->> 'passport_country', passport_country),
          talmud_start_date = coalesce((v_new ->> 'talmud_start_date')::date, talmud_start_date),
          talmud_end_date = coalesce(v_new ->> 'talmud_end_date', talmud_end_date),
          id_type = coalesce(v_new ->> 'id_type', id_type),
          external_id = coalesce(v_new ->> 'external_id', external_id),
          talmud_synced_month = v_list.month,
          talmud_synced_at = now()
        where id = v_sid;
        if v_changes > 0 then v_updated := v_updated + 1; end if;
      end if;

      -- רשום בתלמוד = לא טיוטה. "יצא" לא משתנה כאן (מסומן במרכז החריגות).
      if s.status in ('draft', 'ready_for_talmud', 'sent_to_talmud') then
        perform set_config('app.allow_student_status_change', 'true', true);
        update students set status = 'active' where id = v_sid;
        perform set_config('app.allow_student_status_change', '', true);
        insert into student_talmud_changes (student_id, list_id, month, field, old_value, new_value)
        values (v_sid, p_list_id, v_list.month, 'status', s.status, 'active');
        v_activated := v_activated + 1;
      end if;
    end if;

    update talmud_eligibility_list_rows x set student_id = v_sid
    where x.list_id = p_list_id and x.student_id is null
      and normalize_identity(x.external_id) = normalize_identity(r.external_id);
  end loop;

  -- הספירות של הדוח משקפות את המצב אחרי היצירה
  update talmud_eligibility_lists l set
    matched_count = (select count(*) from talmud_eligibility_list_rows x where x.list_id = p_list_id and x.student_id is not null),
    unmatched_eligible_count = (select count(distinct normalize_identity(x.external_id)) from talmud_eligibility_list_rows x
                                where x.list_id = p_list_id and x.eligible and x.student_id is null)
  where l.id = p_list_id;

  return query select v_created, v_updated, v_activated;
end;
$$;

revoke all on function _sync_students_from_talmud_list(uuid) from public, anon, authenticated;

-- הרצה ידנית מחדש לדוח שכבר נקלט (מסך דוח הזכאים)
create or replace function sync_students_from_talmud_list(p_list_id uuid)
returns table (created_count integer, updated_count integer, activated_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
begin
  if not has_permission('talmud', 'import') then
    raise exception 'permission denied';
  end if;
  select * into v from _sync_students_from_talmud_list(p_list_id);
  perform insert_audit_event('sync_students_from_talmud_list', 'talmud_eligibility_lists', p_list_id::text,
    jsonb_build_object('created', v.created_count, 'updated', v.updated_count, 'activated', v.activated_count));
  return query select v.created_count, v.updated_count, v.activated_count;
end;
$$;

revoke all on function sync_students_from_talmud_list(uuid) from public, anon;
grant execute on function sync_students_from_talmud_list(uuid) to authenticated;

-- ===== 4. קליטת דוח הזכאים: זהה ל-116, ובסוף - הסנכרון =====
-- (שתי עמודות חדשות בתוצאה, ולכן drop: אי אפשר לשנות סוג החזרה ב-create or replace)
drop function if exists import_talmud_eligibility_list(uuid, date, text, text, jsonb);

create or replace function import_talmud_eligibility_list(
  p_organization_id uuid,
  p_month date,
  p_file_name text,
  p_file_hash text,
  p_rows jsonb
)
returns table (list_id uuid, row_count integer, eligible_count integer, matched_count integer, unmatched_eligible_count integer,
               replaced_previous boolean, created_count integer, updated_count integer, activated_count integer)
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
  v_sync record;
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

  update talmud_eligibility_list_rows r set student_id = (
    select s.id from students s
    where normalize_identity(s.external_id) = normalize_identity(r.external_id)
    order by s.created_at limit 1)
  where r.list_id = v_list;

  -- תלמוד = מערכת האמת: יצירת החסרים ועדכון הקיימים (ר' ראש הקובץ)
  select * into v_sync from _sync_students_from_talmud_list(v_list);

  select count(*), count(*) filter (where eligible), count(*) filter (where student_id is not null)
    into v_rows, v_eligible, v_matched
  from talmud_eligibility_list_rows where talmud_eligibility_list_rows.list_id = v_list;

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
                       'eligible', v_eligible, 'matched', v_matched, 'replaced_previous', v_replaced,
                       'students_created', v_sync.created_count, 'students_updated', v_sync.updated_count,
                       'students_activated', v_sync.activated_count));

  return query select v_list, v_rows, v_eligible, v_matched, v_unmatched, v_replaced,
    v_sync.created_count, v_sync.updated_count, v_sync.activated_count;
end;
$$;

revoke all on function import_talmud_eligibility_list(uuid, date, text, text, jsonb) from public, anon;
grant execute on function import_talmud_eligibility_list(uuid, date, text, text, jsonb) to authenticated;

-- ===== 5. מסך השיוך המרוכז: גם תלמידים מדוח הזכאים =====
--
-- זהה ל-103, ובנוסף: תלמיד שמופיע בדוח הזכאים האחרון של העמותה ואין לו שיוך פעיל
-- (בעיקר מי שנוצר כאן). הסניף - מהדוח. הסכום 0: זה לא דוח כספי.
create or replace view talmud_unassigned_students
with (security_invoker = true)
as
select distinct on (u.student_id) u.*
from (
  select
    s.id as student_id,
    s.full_name,
    s.external_id,
    b.organization_id,
    o.legal_name as organization_name,
    btrim(ir.raw ->> 'סניף') as branch_code,
    br.id as branch_id,
    br.internal_name as branch_name,
    b.period_month,
    coalesce(nullif(regexp_replace(coalesce(ir.raw ->> 'סכום ברוטו', ''), '[^0-9.\-]', '', 'g'), '')::numeric, 0) as amount
  from import_rows ir
  join import_batches b on b.id = ir.batch_id and b.status = 'committed'
  join import_profiles p on p.id = b.profile_id and p.key = 'talmud_eligibility'
  join organizations o on o.id = b.organization_id
  join students s
    on normalize_identity(s.external_id) = normalize_identity(ir.raw ->> 'מזהה תלמיד')
  left join branches br
    on br.organization_id = b.organization_id
   and br.talmud_branch_code = btrim(ir.raw ->> 'סניף')
  where ir.status = 'invalid'

  union all

  select
    s.id, s.full_name, s.external_id, l.organization_id, o.legal_name, x.branch_code,
    br.id, br.internal_name, l.month, 0::numeric
  from talmud_eligibility_lists l
  join talmud_eligibility_list_rows x on x.list_id = l.id
  join students s on s.id = x.student_id
  join organizations o on o.id = l.organization_id
  left join branches br on br.organization_id = l.organization_id and br.talmud_branch_code = x.branch_code
  where l.status = 'active'
    and s.status <> 'inactive'
    and not exists (select 1 from talmud_eligibility_lists l2
                    where l2.organization_id = l.organization_id and l2.status = 'active' and l2.month > l.month)
) u
where not exists (
  select 1 from student_assignments sa
  where sa.student_id = u.student_id and sa.is_active = true
)
order by u.student_id, u.amount desc, u.period_month desc;

comment on view talmud_unassigned_students is
  'תלמידים בלי שיוך פעיל שתלמוד מייחס לסניף: מדוח דרישת התשלום (103) ומדוח הזכאים האחרון (122).';

grant select on talmud_unassigned_students to authenticated;

create index if not exists talmud_eligibility_list_rows_identity_idx
  on talmud_eligibility_list_rows (list_id, normalize_identity(external_id));

-- ===== 6. הדוח האחרון של כל עמותה =====
create or replace view talmud_latest_lists
with (security_invoker = true)
as
select l.* from talmud_eligibility_lists l
where l.status = 'active'
  and not exists (select 1 from talmud_eligibility_lists l2
                  where l2.organization_id = l.organization_id and l2.status = 'active' and l2.month > l.month);

grant select on talmud_latest_lists to authenticated;

-- ===== 7. "חסר נתון" =====
--
-- מה שתלמוד לא יודע ונחוץ לעבודה, לכל תלמיד שלא יצא. העמותה: מהשיוך הפעיל, ואם
-- אין - מהדוח האחרון שבו הופיע. משמש גם את כרטיס התלמיד וגם את מרכז החריגות.
create or replace view student_missing_data
with (security_invoker = true)
as
select * from (
  select
    s.id as student_id,
    s.full_name,
    s.external_id,
    coalesce(asg.organization_id, lst.organization_id) as organization_id,
    array_remove(array[
      case when coalesce(nullif(btrim(s.phone_normalized), ''), nullif(btrim(s.phone_raw), '')) is null then 'טלפון' end,
      case when coalesce(nullif(btrim(s.address_city), ''), nullif(btrim(s.address_street), ''), nullif(btrim(s.address), '')) is null then 'כתובת' end,
      -- קבוצה שהוגדרה 'חשבון בנק אינו חובה' (115) - לא חסר
      case when bank.student_id is null and not coalesce(asg.bank_optional, false) then 'חשבון בנק' end,
      case when asg.student_id is null then 'ראש קבוצה' end,
      case when s.birth_date is null then 'תאריך לידה' end,
      case when s.marital_status is null then 'מצב משפחתי' end
    ], null) as missing
  from students s
  left join lateral (
    select sa.student_id, sa.organization_id, g.bank_account_optional as bank_optional from student_assignments sa
    join groups g on g.id = sa.group_id
    where sa.student_id = s.id and sa.is_active = true
    order by sa.start_date desc limit 1
  ) asg on true
  left join lateral (
    select b.student_id from student_bank_accounts b
    where b.student_id = s.id and b.is_active = true and b.verification_status <> 'rejected'
    limit 1
  ) bank on true
  left join lateral (
    select l.organization_id from talmud_eligibility_list_rows x
    join talmud_eligibility_lists l on l.id = x.list_id and l.status = 'active'
    where x.student_id = s.id
    order by l.month desc limit 1
  ) lst on true
  where s.status <> 'inactive' and coalesce(s.is_demo, false) = false
) t
where cardinality(t.missing) > 0;

grant select on student_missing_data to authenticated;

-- ===== 8. מרכז החריגות: זהה ל-110, ובסוף שלושה ענפים חדשים =====
create or replace view unified_exceptions
with (security_invoker = true)
as
-- materialized במפורש: בלעדיו Postgres משכפל את ה-CTE לתוך כל אחד
-- מחמשת הענפים, וזו בדיוק הבעיה שהמיגרציה הזו מתקנת.
with talmud_gap as materialized (
  select
    ir.id as row_id,
    ir.status as row_status,
    ir.raw as raw,
    b.organization_id,
    b.period_month,
    nullif(btrim(ir.raw ->> 'סניף'), '') as branch_code,
    coalesce(nullif(regexp_replace(coalesce(ir.raw ->> 'סכום ברוטו', ''), '[^0-9.\-]', '', 'g'), '')::numeric, 0) as amount,
    s.id as student_id,
    (asg.student_id is not null) as has_assignment,
    (el.student_id is not null) as has_eligibility,
    (br.id is not null) as branch_exists
  from import_rows ir
  join import_batches b on b.id = ir.batch_id and b.status = 'committed'
  join import_profiles p on p.id = b.profile_id and p.key = 'talmud_eligibility'
  left join students s
    on normalize_identity(s.external_id) = normalize_identity(ir.raw ->> 'מזהה תלמיד')
  left join lateral (
    select sa.student_id from student_assignments sa
    where sa.student_id = s.id and sa.is_active = true limit 1
  ) asg on true
  left join lateral (
    select me.student_id from monthly_eligibility me
    where me.student_id = s.id and me.month = b.period_month and me.status = 'active' limit 1
  ) el on true
  left join branches br
    on br.organization_id = b.organization_id
   and br.talmud_branch_code = btrim(ir.raw ->> 'סניף')
  -- שורה שהמפעיל דחה בכוונה אינה פער לתיקון (110)
  where ir.error_message is distinct from 'נדחתה ידנית בבדיקה'
)
select ue.* from (
  select exception_type, (case when severity = 'warning' then 'medium' else severity end) as severity,
    organization_id, related_table, related_id, amount, related_date, description
  from bank_reconciliation_exceptions

  union all

  select 'talmud_error', case when te.is_recurring then 'high' else 'medium' end,
    te.organization_id, 'talmud_errors', te.id, null, te.month,
    te.error_code || coalesce(': ' || te.error_description, '')
  from talmud_errors te
  where te.status in ('open', 'in_progress', 'pending_info')

  union all

  select 'audit_attendance', case when aa.is_recurring then 'high' else 'medium' end,
    a.organization_id, 'audit_attendance', aa.id, null, a.audit_date,
    'חוסר בביקורת: ' || coalesce(aa.external_student_ref, '(תלמיד מותאם)')
  from audit_attendance aa
  join audits a on a.id = aa.audit_id
  where aa.status in ('open', 'in_progress', 'pending_info')

  union all

  select 'document_expiry',
    case
      when d.expiry_date < current_date then 'critical'
      when d.expiry_date - current_date <= 7 then 'critical'
      when d.expiry_date - current_date <= 14 then 'high'
      else 'medium'
    end,
    d.organization_id, 'documents', d.id, null, d.expiry_date,
    'תוקף מסמך: ' || d.title
  from documents d
  where d.status = 'active' and d.expiry_date is not null and d.expiry_date - current_date <= 30

  union all

  select 'payment_return_open', 'medium',
    mb.organization_id, 'payment_returns', pr.id, pr.amount, pr.return_date,
    'החזרה פתוחה: ' || pr.reason
  from payment_returns pr
  join masav_lines ml on ml.id = pr.masav_line_id
  join masav_batches mb on mb.id = ml.batch_id
  where pr.status = 'open'

  union all

  select 'masav_needs_correction', 'high',
    mb.organization_id, 'masav_batches', mb.id, mb.total_amount, mb.period_month,
    'אצוות מס"ב דורשת תיקון' || coalesce(': ' || mb.status_reason, '')
  from masav_batches mb
  where mb.status = 'needs_correction'

  union all

  select 'bank_auto_sync_issue', case when r.status = 'failed' then 'critical' else 'high' end,
    oba.organization_id, 'bank_auto_sync_runs', r.id, null, r.started_at::date,
    coalesce(r.gap_detail, 'משיכת תנועות בנק אוטומטית נכשלה: ' || coalesce(r.error_message, 'שגיאה לא ידועה'))
  from bank_auto_sync_runs r
  join bank_auto_sync_settings s on s.id = r.setting_id
  join organization_bank_accounts oba on oba.id = s.organization_bank_account_id
  where r.is_resolved = false and (r.status = 'failed' or r.gap_detected = true)

  union all

  -- ===== מה שחסר כדי שדוח "תלמוד" ייקלט במלואו =====
  --
  -- כל חמשת הענפים מנקים את עצמם: הם קוראים את המצב הנוכחי מתוך
  -- talmud_gap, לא את מה שהיה בזמן הקליטה. ברגע שהתלמיד נוסף, שויך,
  -- או שהסניף נפתח - החריגה נעלמת מעצמה. חריגה שנשארת אחרי שתוקנה
  -- מאמנת להתעלם מהמסך, וזה גרוע מלא להציג אותו בכלל.

  -- 1. תלמיד עם זכאות בפועל שאינו קיים במערכת. זה כסף שלא נכנס.
  select 'talmud_student_missing', 'high',
    g.organization_id, 'import_rows', g.row_id, g.amount, g.period_month,
    'תלמיד שאינו במערכת: ' || coalesce(nullif(g.raw ->> 'שם', ''), '(ללא שם)') ||
      ' · ת.ז ' || coalesce(g.raw ->> 'מזהה תלמיד', '—') ||
      ' · סניף ' || coalesce(g.branch_code, '—') ||
      ' · יש לייבא אותו במסך תלמידים'
  from talmud_gap g
  where g.row_status = 'invalid' and g.student_id is null and g.amount > 0

  union all

  -- 2. תלמיד קיים אך בלי שיוך פעיל. הקליטה קוראת את הסניף והקבוצה
  --    מהשיוך, ולכן הוא נדחה למרות שהוא במערכת - וזה הכי מבלבל.
  select 'talmud_student_unassigned', 'high',
    g.organization_id, 'import_rows', g.row_id, g.amount, g.period_month,
    'תלמיד ללא שיוך פעיל לסניף/קבוצה: ' || coalesce(nullif(g.raw ->> 'שם', ''), '(ללא שם)') ||
      ' · ת.ז ' || coalesce(g.raw ->> 'מזהה תלמיד', '—') ||
      ' · הוא קיים במערכת, רק חסר לו שיוך'
  from talmud_gap g
  where g.row_status = 'invalid' and g.student_id is not null and not g.has_assignment

  union all

  -- 3. סניף שמופיע בדוח ואינו קיים. שורה אחת לכל קוד סניף, לא לכל תלמיד.
  select 'talmud_branch_missing', 'medium',
    g.organization_id, 'import_rows', (array_agg(g.row_id order by g.row_id))[1], null, g.period_month,
    'סניף ' || g.branch_code || ' מופיע בדוח תלמוד ואינו קיים במערכת' ||
      ' · הזכאות תיזקף לפי השיוך שבמערכת, לא לפי הקובץ'
  from talmud_gap g
  where g.branch_code is not null and not g.branch_exists
  group by g.organization_id, g.period_month, g.branch_code

  union all

  -- 4. חסרים ללא זכאות החודש, מסוכמים לשורה אחת לכל דוח בכוונה: בקבצים
  --    אמיתיים אלה מאות שורות של 0.00, והצגתן אחת-אחת הייתה מטביעה את
  --    החריגות שבאמת עולות כסף.
  select 'talmud_students_missing_no_amount', 'low',
    g.organization_id, 'import_rows', (array_agg(g.row_id order by g.row_id))[1], null, g.period_month,
    count(*) || ' תלמידים בדוח אינם קיימים במערכת, אך ללא זכאות החודש (0.00 ש"ח)' ||
      ' · אין השפעה כספית, אבל כדאי להוסיף אותם'
  from talmud_gap g
  where g.row_status = 'invalid' and g.student_id is null and g.amount = 0
  group by g.organization_id, g.period_month

  union all

  -- 5. שורה שנדחתה, והנתונים שחסרו לה הוזנו מאז. ארבעת הענפים שמעל
  --    שותקים כאן - התלמיד כבר לא חסר ולא חסר שיוך - אבל הכסף שלו לא
  --    נזקף, כי הקליטה כבר רצה. בלי הענף הזה הפער בלתי נראה.
  select 'talmud_row_recoverable', 'high',
    g.organization_id, 'import_rows', g.row_id, g.amount, g.period_month,
    'זכאות שנדחתה וניתן להשלים: ' || coalesce(nullif(g.raw ->> 'שם', ''), '(ללא שם)') ||
      ' · ת.ז ' || coalesce(g.raw ->> 'מזהה תלמיד', '—') ||
      ' · התלמיד קיים ומשויך כעת · יש להריץ "השלמת שורות שנדחו" במסך זכאות'
  from talmud_gap g
  where g.row_status = 'invalid' and g.student_id is not null
    and g.has_assignment and not g.has_eligibility and g.amount > 0

  union all

  -- ===== תלמוד = מערכת האמת (122) =====
  -- שלושת הענפים מנקים את עצמם, כמו הענפים שמעל: ברגע שהנתון הוזן, או
  -- שהתלמיד הועבר סניף - השורה נעלמת.

  -- 6. "חסר נתון": מה שתלמוד לא יודע ונחוץ לעבודה. שורה אחת לכל תלמיד.
  --    בינוני כשחסר מה שמעכב תשלום (בנק, ראש קבוצה); אחרת - לידיעה.
  select 'student_missing_data',
    case when md.missing && array['חשבון בנק', 'ראש קבוצה'] then 'medium' else 'low' end,
    md.organization_id, 'students', md.student_id, null, null,
    'חסר נתון: ' || array_to_string(md.missing, ', ') || ' · ' || md.full_name || ' · ' || md.external_id
  from student_missing_data md

  union all

  -- 7. יצא אצלנו, ותלמוד עדיין רושם אותו בדוח האחרון (אחרי תאריך היציאה).
  --    לא מחזירים ל"פעיל" לבד: כנראה פשוט לא דווחה היציאה לתלמוד.
  (select distinct on (s.id) 'talmud_exited_but_listed', 'high',
    l.organization_id, 'students', s.id, null, l.month,
    'יצא במערכת' || coalesce(' (' || to_char(s.exit_date, 'DD/MM/YYYY') || ')', '') ||
      ' ועדיין רשום בתלמוד בחודש ' || to_char(l.month, 'MM/YYYY') ||
      ' (' || case when x.eligible then 'זכאי' else 'אינו זכאי' end || ')' ||
      ' · ' || s.full_name || ' · ' || s.external_id ||
      ' · יש לדווח את היציאה לתלמוד, או להחזיר אותו לפעיל'
  from talmud_latest_lists l
  join talmud_eligibility_list_rows x on x.list_id = l.id
  join students s on s.id = x.student_id
  where s.status = 'inactive'
    and coalesce(s.exit_date, date '1900-01-01') < l.month
  order by s.id, x.eligible desc)

  union all

  -- 8. תלמוד רושם אותו בסניף אחר מהשיוך שלנו. לא מעבירים לבד: מעבר סניף
  --    הוא גם מעבר ראש קבוצה, ואת זה תלמוד לא יודע.
  (select distinct on (s.id) 'talmud_branch_differs', 'medium',
    l.organization_id, 'students', s.id, null, l.month,
    'בתלמוד: ' || o.legal_name || ' סניף ' || coalesce(x.branch_code, '—') ||
      ' · במערכת: ' || coalesce(ao.legal_name, '—') || ' סניף ' || coalesce(ab.talmud_branch_code, '—') ||
      ' · ' || s.full_name || ' · ' || s.external_id ||
      ' · יש להעביר לסניף שבתלמוד ולבחור ראש קבוצה'
  from talmud_latest_lists l
  join organizations o on o.id = l.organization_id
  join talmud_eligibility_list_rows x on x.list_id = l.id
  join students s on s.id = x.student_id and s.status <> 'inactive'
  join student_assignments sa on sa.student_id = s.id and sa.is_active = true
  join organizations ao on ao.id = sa.organization_id
  join branches ab on ab.id = sa.branch_id
  where not exists (
    -- אחת השורות שלו בדוח תואמת שיוך פעיל כלשהו שלו
    select 1 from talmud_eligibility_list_rows x2
    join student_assignments sa2 on sa2.student_id = x2.student_id and sa2.is_active = true
    join branches b2 on b2.id = sa2.branch_id
    where x2.list_id = l.id and x2.student_id = s.id
      and sa2.organization_id = l.organization_id and b2.talmud_branch_code = x2.branch_code
  )
  order by s.id, x.eligible desc)
) ue
left join organizations o on o.id = ue.organization_id
where coalesce(o.is_demo, false) = false;

grant select on unified_exceptions to authenticated;

-- ===== 9. השלמה חד-פעמית: הדוח האחרון של כל עמותה שכבר נקלט =====
-- אלפי תלמידים - בלי מגבלת הזמן של עורך ה-SQL (חל רק על החיבור הזה)
set statement_timeout = 0;

do $$
declare
  v record;
begin
  for v in select id from talmud_latest_lists order by month, created_at loop
    perform _sync_students_from_talmud_list(v.id);
  end loop;
end;
$$;
