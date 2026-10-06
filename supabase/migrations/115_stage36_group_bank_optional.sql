-- שלב 36ב: קבוצות שבהן חשבון בנק אינו חובה
--
-- החלטת צ'ני (2026-10-06): המשרד בוחר (במסך "הגדרות") קבוצות שבהן לא דורשים מספר
-- חשבון בנק. בקבוצה כזו:
--   * תלמיד עובר ל"מוכן לתלמוד" גם בלי חשבון בנק (student_ready_blocker).
--   * ראש הקבוצה יכול לשלוח מהפורטל תלמיד חדש בלי פרטי בנק. אם מילא פרטי בנק -
--     הם נבדקים כרגיל (חלקי = שגיאה, כדי שלא יישמר חצי חשבון).
-- מה שלא משתנה: תשלום. תלמיד בלי חשבון בנק תקין עדיין לא יכול לקבל כסף - שערי
-- החלוקה ומס"ב (031/032) לא נגעו. הקבוצה רק לא חוסמת את המעבר לתלמוד.

alter table groups add column if not exists bank_account_optional boolean not null default false;

comment on column groups.bank_account_optional is
  'בקבוצה זו חשבון בנק אינו חובה למעבר ל"מוכן לתלמוד" ולתלמיד חדש מהפורטל. תשלום עדיין דורש חשבון תקין. ראה מיגרציה 115.';

-- ===== 1. התנאים ל"מוכן לתלמוד" - זהה ל-114, ונוסף הפטור =====

create or replace function student_ready_blocker(p_student_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from students where id = p_student_id and length(trim(coalesce(phone_normalized, ''))) > 0) then
    return 'missing_phone';
  end if;
  if not exists (select 1 from student_assignments where student_id = p_student_id and is_active = true) then
    return 'missing_assignment';
  end if;
  -- קבוצה שהוגדרה "חשבון בנק אינו חובה" - אין בדיקת בנק בכלל.
  if exists (
    select 1 from student_assignments sa join groups g on g.id = sa.group_id
    where sa.student_id = p_student_id and sa.is_active = true and g.bank_account_optional
  ) then
    return null;
  end if;
  if not exists (select 1 from student_bank_accounts where student_id = p_student_id and is_active = true) then
    return 'missing_bank';
  end if;
  if not exists (
    select 1 from student_bank_accounts
    where student_id = p_student_id and is_active = true and verification_status = 'verified'
  ) then
    return 'invalid_bank';
  end if;
  return null;
end;
$$;

revoke execute on function student_ready_blocker(uuid) from public, anon, authenticated;

-- ===== 2. הגדרה מהמסך =====
--
-- כשקבוצה מסומנת "לא חובה", התלמידים שלה שחיכו בטיוטה רק בגלל הבנק עוברים מיד.

create or replace function set_group_bank_account_optional(p_group_id uuid, p_optional boolean)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_advanced integer := 0;
  v_id uuid;
begin
  if not has_permission('groups', 'manage') then raise exception 'permission denied'; end if;

  update groups set bank_account_optional = p_optional where id = p_group_id;
  if not found then raise exception 'הקבוצה לא נמצאה'; end if;

  if p_optional then
    for v_id in
      select s.id from students s
      join student_assignments sa on sa.student_id = s.id and sa.is_active and sa.group_id = p_group_id
      where s.status = 'draft'
    loop
      if auto_advance_student(v_id) then v_advanced := v_advanced + 1; end if;
    end loop;
  end if;

  perform insert_audit_event('set_group_bank_account_optional', 'groups', p_group_id::text,
    jsonb_build_object('optional', p_optional, 'advanced', v_advanced));
  return v_advanced;
end;
$$;

grant execute on function set_group_bank_account_optional(uuid, boolean) to authenticated;

-- ===== 3. הפורטל: הקבוצות של ראש הקבוצה - זהה ל-112, ונוסף bank_account_optional =====

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
          'require_id_photo', g.require_id_photo,
          'bank_account_optional', g.bank_account_optional)
          order by g.name, b.internal_name)
        from groups g
        join branches b on b.id = g.branch_id
        join organizations o on o.id = b.organization_id
        where g.group_leader_id = v_leader and g.status = 'active'), '[]'::jsonb))
    from group_leaders gl where gl.id = v_leader);
end;
$$;

-- ===== 4. הפורטל: תלמיד חדש - זהה ל-112, למעט בדיקת הבנק =====
--
-- בקבוצה רגילה: בנק חובה, כמו קודם. בקבוצה "לא חובה": אפשר להשאיר את כל פרטי הבנק
-- ריקים. מה שקובע "מילא בנק" הוא בנק/סניף/מספר חשבון - לא שם בעל החשבון, כי
-- הטופס ממלא אותו לבד משם התלמיד. בקשה בלי בנק נשמרת בלי מפתחות הבנק בכלל, כך
-- ש-portal_decide_request (r.payload ? 'account_number') לא תיצור חשבון ריק.

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
  v_bank_optional boolean;
  v_has_bank boolean;
  v_id text := btrim(coalesce(p_external_id, ''));
  v_age integer;
  v_photo bytea;
  v_note text;
  v_existing record;
  v_other record;
  v_request uuid;
  v_payload jsonb;
begin
  select require_id_photo, bank_account_optional into v_require_photo, v_bank_optional
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

  v_has_bank := coalesce(btrim(p_bank_code), '') <> '' or coalesce(btrim(p_bank_branch), '') <> ''
             or coalesce(btrim(p_account_number), '') <> '';
  if v_has_bank or not v_bank_optional then
    if not exists (select 1 from banks where code = btrim(coalesce(p_bank_code, '')) and is_active) then
      raise exception 'יש לבחור בנק מהרשימה';
    end if;
    if btrim(coalesce(p_bank_branch, '')) !~ '^[0-9]{1,4}$' then raise exception 'מספר סניף הבנק צריך להכיל ספרות בלבד'; end if;
    if btrim(coalesce(p_account_number, '')) !~ '^[0-9]{2,13}$' then raise exception 'מספר החשבון צריך להכיל ספרות בלבד'; end if;
    if coalesce(btrim(p_account_holder), '') = '' then raise exception 'חסר שם בעל החשבון'; end if;
    v_has_bank := true;
  end if;

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

  if not v_has_bank then
    v_note := concat_ws(' ', v_note, 'נשלח בלי חשבון בנק (בקבוצה זו חשבון בנק אינו חובה).');
  end if;

  v_payload := jsonb_build_object(
    'full_name', btrim(p_full_name),
    'id_type', p_id_type,
    'external_id', v_id,
    'passport_country', case when p_id_type = 'passport' then btrim(p_passport_country) end,
    'birth_date', p_birth_date,
    'phone', btrim(p_phone),
    'marital_status', p_marital_status,
    'study_scope', case when p_marital_status = 'married' then p_study_scope end,
    'study_code', portal_study_code_for(p_marital_status, p_study_scope),
    'address_street', nullif(btrim(p_street), ''),
    'address_house_number', nullif(btrim(p_house_number), ''),
    'address_city', nullif(btrim(p_city), ''),
    'start_date', coalesce(p_start_date, current_date),
    'has_id_photo', v_photo is not null);
  if v_has_bank then
    v_payload := v_payload || jsonb_build_object(
      'bank_code', btrim(p_bank_code),
      'bank_name', bank_name_for_code(btrim(p_bank_code)),
      'bank_branch', btrim(p_bank_branch),
      'account_number', btrim(p_account_number),
      'account_holder', btrim(p_account_holder));
  end if;

  insert into portal_change_requests (group_leader_id, group_id, kind, payload, office_note)
  values (v_leader, p_group_id, 'new_student', v_payload, v_note)
  returning id into v_request;

  if v_photo is not null then
    insert into portal_request_attachments (request_id, kind, file_name, file_type, data)
    values (v_request, 'id_photo', nullif(btrim(p_id_photo_name), ''), nullif(btrim(p_id_photo_type), ''), v_photo);
  end if;

  return v_request;
end;
$$;

grant execute on function portal_request_new_student(text, uuid, text, text, text, text, date, text, text, text, text, text, text, text, text, text, text, date, text, text, text) to anon, authenticated;

-- ===== 5. אישור הבקשה במשרד - זהה ל-112, למעט שני מקומות =====
--
-- תלמיד שכבר קיים: חשבון חדש נוצר, או הבדל נרשם, רק אם בבקשה בכלל יש חשבון. בלי
-- התיקון בקשה בלי בנק הייתה יוצרת חשבון ריק, או רושמת "החשבון שונה" על כלום.

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
      if r.payload ? 'account_number' then
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

      -- בקשה בלי בנק (גרסה קודמת, או קבוצה שבה בנק אינו חובה) - אין מה ליצור
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
