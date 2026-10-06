-- שלב 35ב: פורטל ראשי קבוצות - תלמיד חדש עם פרטי חובה, צילום ת"ז לפי קבוצה,
-- מצב משפחתי והיקף לימוד, וקוד לימוד אוטומטי.
--
-- החלטות הלקוח:
--   - פרטי חובה לתלמיד חדש מהפורטל: ת"ז תקינה (ספרת ביקורת), ובדרכון - ארץ
--     הדרכון; תאריך לידה בגיל 16 עד 67; טלפון; מצב משפחתי (ולנשוי - היקף
--     לימוד); חשבון בנק (בנק, סניף, מספר, שם בעל החשבון). בלי אישור בנק.
--   - צילום ת"ז - חובה רק בקבוצות שהמשרד סימן.
--   - קוד הלימוד נגזר ממצב משפחתי והיקף לימוד: בחור 300, יום שלם 600,
--     חצי יום בוקר 700, חצי יום אחה"צ 720 (ולא 605/705/725 - החלטת הלקוח).
--     הטבלה ניתנת לשינוי במשרד (מסך הפורטל, לשונית הגדרות) בלי תכנות.
--   - שדות החובה חלים רק על הפורטל. הוספת תלמיד במשרד וייבוא המשרד ללא שינוי.
--   - תלמיד שכבר קיים: הבקשה לא נחסמת. משה מקבל הערה (ראש הקבוצה לא רואה
--     אותה), ובאישור התלמיד הקיים עובר לקבוצה של ראש הקבוצה שביקש - לא נוצר
--     כפול. פרטים חסרים מתמלאים; חשבון בנק קיים אינו מוחלף.

-- ===== 1. עמודות חדשות =====
alter table students add column if not exists marital_status text
  check (marital_status in ('single', 'married'));
alter table students add column if not exists study_scope text
  check (study_scope in ('full_day', 'half_day_morning', 'half_day_afternoon'));
alter table groups add column if not exists require_id_photo boolean not null default false;
-- הערה למשרד בלבד. portal_my_requests אינה מחזירה אותה.
alter table portal_change_requests add column if not exists office_note text;

-- ===== 2. טבלת קודי הלימוד =====
create table if not exists portal_study_code_map (
  key text primary key check (key in ('single', 'full_day', 'half_day_morning', 'half_day_afternoon')),
  study_code text,
  updated_at timestamptz,
  updated_by uuid references auth.users(id)
);
alter table portal_study_code_map enable row level security;
drop policy if exists portal_study_code_map_select on portal_study_code_map;
create policy portal_study_code_map_select on portal_study_code_map for select to authenticated
  using ((select has_permission('area_ops', 'access')));
insert into portal_study_code_map (key, study_code) values
  ('single', '300'), ('full_day', '600'), ('half_day_morning', '700'), ('half_day_afternoon', '720')
on conflict (key) do nothing;

-- ===== 3. קבצים מצורפים לבקשה (צילום ת"ז) =====
create table if not exists portal_request_attachments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references portal_change_requests(id) on delete cascade,
  kind text not null check (kind in ('id_photo')),
  file_name text,
  file_type text,
  data bytea not null,
  created_at timestamptz not null default now()
);
create index if not exists portal_request_attachments_request_idx on portal_request_attachments (request_id);
alter table portal_request_attachments enable row level security;
drop policy if exists portal_request_attachments_select on portal_request_attachments;
create policy portal_request_attachments_select on portal_request_attachments for select to authenticated
  using ((select has_permission('area_ops', 'access')));

-- ===== 4. בדיקות =====

-- ספרת ביקורת של ת"ז - אותו אלגוריתם בדיוק כמו lib/israeliId.ts, כדי
-- שמסך ושרת לא יחלקו לעולם על אותו מספר.
create or replace function is_valid_israeli_id(p_id text)
returns boolean
language plpgsql
immutable
as $$
declare
  d text := regexp_replace(coalesce(p_id, ''), '[^0-9]', '', 'g');
  s integer := 0;
  v integer;
begin
  if length(d) = 0 or length(d) > 9 then return false; end if;
  d := lpad(d, 9, '0');
  for i in 1..9 loop
    v := substr(d, i, 1)::integer * (case when i % 2 = 1 then 1 else 2 end);
    if v > 9 then v := v - 9; end if;
    s := s + v;
  end loop;
  return s % 10 = 0;
end;
$$;

-- טלפון ישראלי תקין - כמו isValidIsraeliPhone: נייד, VoIP או קווי, באורך הנכון
create or replace function is_valid_israeli_phone(p_phone text)
returns boolean
language sql
immutable
as $$
  select coalesce(normalize_phone_for_match(p_phone) ~ '^(05[0-689][0-9]{7}|07[1-46-9][0-9]{7}|0[23489][0-9]{7})$', false);
$$;

-- קוד הלימוד לפי מצב משפחתי והיקף לימוד
create or replace function portal_study_code_for(p_marital text, p_scope text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select study_code from portal_study_code_map
  where key = case when p_marital = 'single' then 'single' else p_scope end;
$$;

-- ===== 5. בקשה להוספת תלמיד - עם כל פרטי החובה =====
--
-- החתימה הישנה (10 פרמטרים) נמחקת: שתי גרסאות באותו שם מבלבלות את
-- PostgREST, ושום מסך לא אמור להמשיך לשלוח בקשה בלי פרטי החובה.
drop function if exists portal_request_new_student(text, uuid, text, text, text, text, text, text, text, date);

create or replace function portal_request_new_student(
  p_token text,
  p_group_id uuid,
  p_full_name text,
  p_id_type text,
  p_external_id text,
  p_passport_country text,
  p_birth_date date,
  p_phone text,
  p_marital_status text,
  p_study_scope text,
  p_bank_code text,
  p_bank_branch text,
  p_account_number text,
  p_account_holder text,
  p_street text,
  p_house_number text,
  p_city text,
  p_start_date date,
  p_id_photo_name text,
  p_id_photo_type text,
  p_id_photo_base64 text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_leader uuid := portal_session_leader(p_token);
  v_require_photo boolean;
  v_id text := btrim(coalesce(p_external_id, ''));
  v_age integer;
  v_photo bytea;
  v_note text;
  v_existing record;
  v_other record;
  v_request uuid;
begin
  select require_id_photo into v_require_photo
  from groups where id = p_group_id and group_leader_id = v_leader and status = 'active';
  if not found then raise exception 'יש לבחור אחת מהקבוצות שלך'; end if;

  -- כל בדיקה כאן חוזרת על הבדיקה שבמסך. המסך הוא לנוחות; זו ההגנה.
  if coalesce(btrim(p_full_name), '') = '' then raise exception 'חסר שם מלא'; end if;

  if p_id_type = 'israeli_id' then
    if v_id = '' then raise exception 'חסר מספר תעודת זהות'; end if;
    if v_id !~ '^[0-9]{5,9}$' or not is_valid_israeli_id(v_id) then
      raise exception 'מספר תעודת הזהות שגוי (ספרת ביקורת לא מתאימה)';
    end if;
  elsif p_id_type = 'passport' then
    if v_id = '' then raise exception 'חסר מספר דרכון'; end if;
    if coalesce(btrim(p_passport_country), '') = '' then raise exception 'חסרה ארץ הדרכון'; end if;
  else
    raise exception 'יש לבחור תעודת זהות או דרכון';
  end if;

  if p_birth_date is null then raise exception 'חסר תאריך לידה'; end if;
  v_age := extract(year from age(current_date, p_birth_date))::integer;
  if v_age < 16 or v_age > 67 then
    raise exception 'גיל התלמיד צריך להיות בין 16 ל-67 (לפי תאריך הלידה: %)', v_age;
  end if;

  if coalesce(btrim(p_phone), '') = '' then raise exception 'חסר טלפון'; end if;
  if not is_valid_israeli_phone(p_phone) then raise exception 'מספר הטלפון אינו תקין'; end if;

  if p_marital_status not in ('single', 'married') or p_marital_status is null then
    raise exception 'יש לבחור בחור או נשוי';
  end if;
  if p_marital_status = 'married'
     and (p_study_scope is null or p_study_scope not in ('full_day', 'half_day_morning', 'half_day_afternoon')) then
    raise exception 'לנשוי יש לבחור היקף לימוד: יום שלם, חצי יום בוקר או חצי יום אחה"צ';
  end if;

  if not exists (select 1 from banks where code = btrim(coalesce(p_bank_code, '')) and is_active) then
    raise exception 'יש לבחור בנק מהרשימה';
  end if;
  if btrim(coalesce(p_bank_branch, '')) !~ '^[0-9]{1,4}$' then raise exception 'מספר סניף הבנק צריך להכיל ספרות בלבד'; end if;
  if btrim(coalesce(p_account_number, '')) !~ '^[0-9]{2,13}$' then raise exception 'מספר החשבון צריך להכיל ספרות בלבד'; end if;
  if coalesce(btrim(p_account_holder), '') = '' then raise exception 'חסר שם בעל החשבון'; end if;

  if coalesce(p_id_photo_base64, '') <> '' then
    v_photo := decode(p_id_photo_base64, 'base64');
    if octet_length(v_photo) > 5 * 1024 * 1024 then raise exception 'צילום הת"ז גדול מ-5MB'; end if;
  end if;
  if v_require_photo and v_photo is null then
    raise exception 'בקבוצה זו חובה לצרף צילום תעודת זהות';
  end if;

  -- תלמיד שכבר קיים - לא חוסמים. הערה למשרד בלבד.
  select s.full_name, g.name as group_name, gl.full_name as leader_name into v_existing
  from students s
  left join student_assignments sa on sa.student_id = s.id and sa.is_active
  left join groups g on g.id = sa.group_id
  left join group_leaders gl on gl.id = g.group_leader_id
  where normalize_identity(s.external_id) = normalize_identity(v_id)
  order by sa.is_active nulls last
  limit 1;
  if found then
    v_note := 'התלמיד כבר קיים במערכת' ||
      case when v_existing.group_name is not null
        then ' - בקבוצת ' || v_existing.group_name || coalesce(' (ראש קבוצה: ' || v_existing.leader_name || ')', '')
        else ' - בלי שיוך פעיל' end ||
      case when v_existing.full_name <> btrim(p_full_name) then '. השם הרשום: ' || v_existing.full_name else '' end ||
      '. באישור הוא יועבר לקבוצה החדשה.';
  end if;

  select gl.full_name as leader_name into v_other
  from portal_change_requests r
  join group_leaders gl on gl.id = r.group_leader_id
  where r.kind = 'new_student' and r.status = 'pending'
    and normalize_identity(r.payload ->> 'external_id') = normalize_identity(v_id)
  limit 1;
  if found then
    v_note := concat_ws(' ', v_note, 'בקשה נוספת לאותו מספר ממתינה לאישור (מאת ' || v_other.leader_name || ').');
  end if;

  insert into portal_change_requests (group_leader_id, group_id, kind, payload, office_note)
  values (v_leader, p_group_id, 'new_student', jsonb_build_object(
    'full_name', btrim(p_full_name),
    'id_type', p_id_type,
    'external_id', v_id,
    'passport_country', case when p_id_type = 'passport' then btrim(p_passport_country) end,
    'birth_date', p_birth_date,
    'phone', btrim(p_phone),
    'marital_status', p_marital_status,
    'study_scope', case when p_marital_status = 'married' then p_study_scope end,
    'study_code', portal_study_code_for(p_marital_status, p_study_scope),
    'bank_code', btrim(p_bank_code),
    'bank_name', bank_name_for_code(btrim(p_bank_code)),
    'bank_branch', btrim(p_bank_branch),
    'account_number', btrim(p_account_number),
    'account_holder', btrim(p_account_holder),
    'address_street', nullif(btrim(p_street), ''),
    'address_house_number', nullif(btrim(p_house_number), ''),
    'address_city', nullif(btrim(p_city), ''),
    'start_date', coalesce(p_start_date, current_date),
    'has_id_photo', v_photo is not null),
    v_note)
  returning id into v_request;

  if v_photo is not null then
    insert into portal_request_attachments (request_id, kind, file_name, file_type, data)
    values (v_request, 'id_photo', nullif(btrim(p_id_photo_name), ''), nullif(btrim(p_id_photo_type), ''), v_photo);
  end if;

  return v_request;
end;
$$;

-- ===== 6. מה המסך בפורטל צריך כדי למלא את הטופס =====
-- בנקים (שם + מספר) וקודי הלימוד (קוד + תיאור). לפורטל אין גישה לטבלאות.
create or replace function portal_reference(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_leader uuid := portal_session_leader(p_token);
begin
  return jsonb_build_object(
    'banks', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name) order by name)
                       from banks where is_active), '[]'::jsonb),
    'study_codes', coalesce((select jsonb_object_agg(m.key, jsonb_build_object('code', m.study_code, 'description', sc.description))
                             from portal_study_code_map m
                             left join study_codes sc on sc.code = m.study_code), '{}'::jsonb));
end;
$$;

-- ===== 7. המשרד: הגדרות =====
create or replace function portal_set_group_id_photo(p_group_id uuid, p_required boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('groups', 'manage') then raise exception 'permission denied'; end if;
  update groups set require_id_photo = p_required where id = p_group_id;
  if not found then raise exception 'הקבוצה לא נמצאה'; end if;
  perform insert_audit_event('portal_group_id_photo', 'groups', p_group_id::text, jsonb_build_object('required', p_required));
end;
$$;

create or replace function portal_set_study_code(p_key text, p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('study_codes', 'manage') then raise exception 'permission denied'; end if;
  if p_code is not null and not exists (select 1 from study_codes where code = p_code) then
    raise exception 'קוד לימוד % לא קיים בטבלת הקודים', p_code;
  end if;
  update portal_study_code_map set study_code = p_code, updated_at = now(), updated_by = auth.uid() where key = p_key;
  if not found then raise exception 'הגדרה לא מוכרת: %', p_key; end if;
  perform insert_audit_event('portal_study_code_map', 'portal_study_code_map', p_key, jsonb_build_object('study_code', p_code));
end;
$$;

create or replace function portal_request_attachment(p_request_id uuid)
returns table (file_name text, file_type text, file_base64 text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('area_ops', 'access') then raise exception 'permission denied'; end if;
  return query
  select a.file_name, a.file_type, encode(a.data, 'base64')
  from portal_request_attachments a where a.request_id = p_request_id
  order by a.created_at limit 1;
end;
$$;

-- ===== 8. פונקציות קיימות - זהות ל-111, למעט התיקון שמצוין =====

-- בדיקת מזהה: נוספה ספרת ביקורת
create or replace function portal_check_identity(p_external_id text, p_id_type text, p_except_student uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id text := btrim(coalesce(p_external_id, ''));
begin
  if v_id = '' then return 'חסר מספר זהות'; end if;
  if p_id_type not in ('israeli_id', 'passport', 'other') then return 'סוג מזהה לא תקין'; end if;
  if p_id_type = 'israeli_id' and v_id !~ '^[0-9]{5,9}$' then
    return 'מספר תעודת זהות צריך להכיל עד 9 ספרות';
  end if;
  if p_id_type = 'israeli_id' and not is_valid_israeli_id(v_id) then
    return 'מספר תעודת הזהות שגוי (ספרת ביקורת לא מתאימה)';
  end if;
  if exists (select 1 from students
             where normalize_identity(external_id) = normalize_identity(v_id)
               and id is distinct from p_except_student) then
    return 'תלמיד עם מספר זהות זה כבר קיים במערכת. אם הוא צריך לעבור לקבוצה שלך, שלח שאלה למשרד.';
  end if;
  return null;
end;
$$;

-- portal_me: נוסף require_id_photo לכל קבוצה
create or replace function portal_me(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_leader uuid := portal_session_leader(p_token);
begin
  return (
    select jsonb_build_object(
      'name', gl.full_name,
      'groups', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', g.id, 'name', g.name, 'branch', b.internal_name, 'organization', o.legal_name,
          'require_id_photo', g.require_id_photo)
          order by g.name, b.internal_name)
        from groups g
        join branches b on b.id = g.branch_id
        join organizations o on o.id = b.organization_id
        where g.group_leader_id = v_leader and g.status = 'active'), '[]'::jsonb))
    from group_leaders gl where gl.id = v_leader);
end;
$$;

-- portal_students: נוספו תאריך לידה, מצב משפחתי, היקף וקוד לימוד, ארץ דרכון (לייצוא)
drop function if exists portal_students(text, date);
create or replace function portal_students(p_token text, p_month date)
returns table (
  student_id uuid, full_name text, external_id text, id_type text,
  phone text, address_street text, address_house_number text, address_city text,
  birth_date date, marital_status text, study_scope text, study_code text, passport_country text,
  group_id uuid, group_name text, branch_name text, organization_name text,
  eligibility text, reasons text[], has_bank_account boolean,
  pending_requests integer, open_questions integer
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_leader uuid := portal_session_leader(p_token);
begin
  return query
  select s.id, s.full_name, s.external_id, s.id_type,
         s.phone_raw, s.address_street, s.address_house_number, s.address_city,
         s.birth_date, s.marital_status, s.study_scope, s.study_code, s.passport_country,
         g.id, g.name, b.internal_name, o.legal_name,
         el.eligibility, el.reasons,
         exists (select 1 from student_bank_accounts ba where ba.student_id = s.id and ba.is_active),
         (select count(*)::int from portal_change_requests r where r.student_id = s.id and r.status = 'pending'),
         (select count(*)::int from portal_questions q where q.student_id = s.id and q.status = 'open')
  from student_assignments sa
  join students s on s.id = sa.student_id
  join groups g on g.id = sa.group_id
  join branches b on b.id = g.branch_id
  join organizations o on o.id = b.organization_id
  cross join lateral portal_student_eligibility(s.id, p_month) el
  where sa.is_active and g.group_leader_id = v_leader and g.status = 'active'
  order by s.full_name;
end;
$$;

-- portal_decide_request: ענף התלמיד החדש הוחלף; שאר הענפים זהים ל-111
create or replace function portal_decide_request(p_request_id uuid, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r portal_change_requests;
  v_problem text;
  v_student uuid;
  v_branch uuid;
  v_org uuid;
  v_bank_note text;
begin
  if not has_permission('students', 'manage') then
    raise exception 'permission denied';
  end if;

  select * into r from portal_change_requests where id = p_request_id for update;
  if not found or r.status <> 'pending' then
    raise exception 'הבקשה כבר טופלה';
  end if;

  if not p_approve then
    if coalesce(btrim(p_note), '') = '' then
      raise exception 'בדחייה יש לכתוב סיבה - היא מוצגת לראש הקבוצה';
    end if;
    update portal_change_requests
      set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = btrim(p_note)
      where id = p_request_id;
    perform insert_audit_event('portal_request_rejected', 'portal_change_requests', p_request_id::text,
      jsonb_build_object('kind', r.kind, 'note', p_note));
    return;
  end if;

  if r.kind = 'identity' then
    -- בדיקה חוזרת: מאז שהבקשה נשלחה ייתכן שנוסף תלמיד עם אותו מספר
    v_problem := portal_check_identity(r.payload ->> 'external_id', r.payload ->> 'id_type', r.student_id);
    if v_problem is not null then raise exception '%', v_problem; end if;
    update students set
      full_name = r.payload ->> 'full_name',
      external_id = r.payload ->> 'external_id',
      id_type = r.payload ->> 'id_type'
    where id = r.student_id;
    v_student := r.student_id;

  elsif r.kind = 'new_student' then
    select g.branch_id, b.organization_id into v_branch, v_org
    from groups g join branches b on b.id = g.branch_id
    where g.id = r.group_id and g.status = 'active';
    if v_branch is null then raise exception 'הקבוצה כבר אינה פעילה'; end if;

    -- תלמיד שכבר קיים (נבדק שוב עכשיו - ייתכן שנוסף מאז הבקשה): לא יוצרים
    -- כפול. הוא עובר לקבוצה של ראש הקבוצה שביקש, עם היסטוריה - החלטת הלקוח.
    select id into v_student from students
    where normalize_identity(external_id) = normalize_identity(r.payload ->> 'external_id')
    order by created_at limit 1;

    if v_student is not null then
      if not exists (select 1 from student_assignments
                     where student_id = v_student and group_id = r.group_id and is_active) then
        perform reassign_student(v_student, v_org, v_branch, r.group_id,
          coalesce((r.payload ->> 'start_date')::date, current_date), 'הועבר בבקשת ראש קבוצה');
      end if;

      -- רק פרטים שחסרים אצל התלמיד מתמלאים. פרט קיים אינו נדרס.
      update students set
        birth_date = coalesce(birth_date, (r.payload ->> 'birth_date')::date),
        phone_raw = coalesce(phone_raw, r.payload ->> 'phone'),
        phone_normalized = coalesce(phone_normalized, normalize_phone_for_match(r.payload ->> 'phone')),
        marital_status = coalesce(marital_status, r.payload ->> 'marital_status'),
        study_scope = coalesce(study_scope, r.payload ->> 'study_scope'),
        study_code = coalesce(study_code, r.payload ->> 'study_code'),
        passport_country = coalesce(passport_country, r.payload ->> 'passport_country'),
        address_street = coalesce(address_street, r.payload ->> 'address_street'),
        address_house_number = coalesce(address_house_number, r.payload ->> 'address_house_number'),
        address_city = coalesce(address_city, r.payload ->> 'address_city')
      where id = v_student;

      -- חשבון בנק קיים אינו מוחלף: שינוי חשבון דרך ראש קבוצה אחר הוא בדיוק
      -- הדרך להסיט כסף. ההבדל נרשם למשרד, וההחלטה ידנית.
      if not exists (select 1 from student_bank_accounts where student_id = v_student and is_active) then
        insert into student_bank_accounts (student_id, bank_name, bank_code, bank_branch_code, account_number,
                                           account_holder_name, opened_at, is_active)
        values (v_student, r.payload ->> 'bank_name', r.payload ->> 'bank_code', r.payload ->> 'bank_branch',
                r.payload ->> 'account_number', r.payload ->> 'account_holder', current_date, true);
      elsif not exists (select 1 from student_bank_accounts
                        where student_id = v_student and is_active
                          and coalesce(bank_code, '') = coalesce(r.payload ->> 'bank_code', '')
                          and ltrim(coalesce(bank_branch_code, ''), '0') = ltrim(coalesce(r.payload ->> 'bank_branch', ''), '0')
                          and ltrim(coalesce(account_number, ''), '0') = ltrim(coalesce(r.payload ->> 'account_number', ''), '0')) then
        v_bank_note := 'חשבון הבנק שבבקשה (' || coalesce(r.payload ->> 'bank_name', '') || ' ' ||
          coalesce(r.payload ->> 'bank_branch', '') || '-' || coalesce(r.payload ->> 'account_number', '') ||
          ') שונה מהחשבון הקיים ולא הוחלף. אם צריך להחליף - בכרטיס התלמיד.';
      end if;
    else
      insert into students (id_type, external_id, full_name, phone_raw, phone_normalized, birth_date,
                            marital_status, study_scope, study_code, passport_country,
                            address_street, address_house_number, address_city)
      values (r.payload ->> 'id_type', r.payload ->> 'external_id', r.payload ->> 'full_name',
              r.payload ->> 'phone', normalize_phone_for_match(r.payload ->> 'phone'), (r.payload ->> 'birth_date')::date,
              r.payload ->> 'marital_status', r.payload ->> 'study_scope', r.payload ->> 'study_code', r.payload ->> 'passport_country',
              r.payload ->> 'address_street', r.payload ->> 'address_house_number', r.payload ->> 'address_city')
      returning id into v_student;

      insert into student_assignments (student_id, organization_id, branch_id, group_id, start_date, is_active)
      values (v_student, v_org, v_branch, r.group_id, (r.payload ->> 'start_date')::date, true);

      -- בקשה מגרסה קודמת (111) לא כוללת בנק - אז אין מה ליצור
      if r.payload ? 'account_number' then
        insert into student_bank_accounts (student_id, bank_name, bank_code, bank_branch_code, account_number,
                                           account_holder_name, opened_at, is_active)
        values (v_student, r.payload ->> 'bank_name', r.payload ->> 'bank_code', r.payload ->> 'bank_branch',
                r.payload ->> 'account_number', r.payload ->> 'account_holder', current_date, true);
      end if;
    end if;

    update portal_change_requests
      set student_id = v_student, office_note = concat_ws(' ', office_note, v_bank_note)
      where id = p_request_id;

  elsif r.kind = 'student_left' then
    perform exit_student(r.student_id, (r.payload ->> 'exit_date')::date,
                         coalesce(r.payload ->> 'reason', 'דווח בידי ראש הקבוצה'));
    v_student := r.student_id;
  end if;

  update portal_change_requests
    set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), '')
    where id = p_request_id;
  perform insert_audit_event('portal_request_approved', 'portal_change_requests', p_request_id::text,
    jsonb_build_object('kind', r.kind, 'student_id', v_student));
end;
$$;

-- ===== 9. הרשאות הרצה =====
revoke execute on function portal_study_code_for(text, text) from public, anon, authenticated;
grant execute on function portal_request_new_student(text, uuid, text, text, text, text, date, text, text, text, text, text, text, text, text, text, text, date, text, text, text) to anon, authenticated;
grant execute on function portal_reference(text) to anon, authenticated;
grant execute on function portal_students(text, date) to anon, authenticated;
revoke execute on function portal_set_group_id_photo(uuid, boolean) from public, anon;
revoke execute on function portal_set_study_code(text, text) from public, anon;
revoke execute on function portal_request_attachment(uuid) from public, anon;
grant execute on function portal_set_group_id_photo(uuid, boolean) to authenticated;
grant execute on function portal_set_study_code(text, text) to authenticated;
grant execute on function portal_request_attachment(uuid) to authenticated;
