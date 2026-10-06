-- שלב 37: "קובץ לתלמוד" - קובץ קליטת תלמידים בתבנית של משרד החינוך
--
-- תלמידים שנוספו או עזבו דרך פורטל ראשי הקבוצות, ואושרו במשרד, צריכים להירשם
-- גם במערכת תלמוד. במקום להקליד אותם אחד-אחד, המשרד מוריד קובץ xls בתבנית של
-- המשרד ("רישום תלמידים במערכת תלמוד.xls") וקולט אותו בתלמוד. הקובץ עצמו נבנה
-- במסך (src/lib/talmudFile.ts); כאן: השדות שהתבנית צריכה, וסימון "ירד בקובץ"
-- כדי שאותו תלמיד לא יירד פעמיים.
--
-- בתבנית שם פרטי ושם משפחה בעמודות נפרדות. אצלנו השם המלא נשמר "משפחה פרטי",
-- ופיצול לפי רווח שוגה בשם משפחה של שתי מילים ("בן שושן"). לכן שדות נפרדים:
-- הפורטל ממלא אותם מעכשיו, ובכרטיס התלמיד אפשר לתקן. תלמיד בלי שדות נפרדים -
-- השם מפוצל אוטומטית, עם הערה לבדיקה.

-- ===== 1. שדות חדשים =====

alter table students add column if not exists first_name text;
alter table students add column if not exists last_name text;
-- אשרה: רק לתלמיד בדרכון, לא חובה. סוג האשרה = הקוד בתבנית של תלמוד.
alter table students add column if not exists visa_number text;
alter table students add column if not exists visa_type integer;
alter table students add column if not exists visa_expiry date;

alter table portal_change_requests add column if not exists talmud_file_at timestamptz;
alter table portal_change_requests add column if not exists talmud_file_by uuid references auth.users(id);
create index if not exists portal_change_requests_talmud_file_idx
  on portal_change_requests (talmud_file_at)
  where status = 'approved' and kind in ('new_student', 'student_left');

-- ===== 2. סימון "ירד בקובץ לתלמוד" =====
--
-- המסך מוריד את הקובץ ואז מסמן. מסמן רק בקשה שאושרה, מסוג תלמיד חדש/עזב, ועוד
-- לא סומנה - כך שלחיצה כפולה או שני עובדים במקביל לא משנים את התאריך הראשון.
-- מחזיר כמה סומנו.

create or replace function portal_mark_talmud_file(p_request_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not has_permission('talmud', 'export') then
    raise exception 'permission denied';
  end if;

  update portal_change_requests
    set talmud_file_at = now(), talmud_file_by = auth.uid()
    where id = any(coalesce(p_request_ids, '{}'))
      and status = 'approved'
      and kind in ('new_student', 'student_left')
      and talmud_file_at is null;
  get diagnostics v_count = row_count;

  if v_count > 0 then
    perform insert_audit_event('portal_talmud_file', 'portal_change_requests', null,
      jsonb_build_object('count', v_count, 'request_ids', to_jsonb(p_request_ids)));
  end if;
  return v_count;
end;
$$;

revoke execute on function portal_mark_talmud_file(uuid[]) from public, anon;
grant execute on function portal_mark_talmud_file(uuid[]) to authenticated;

-- ===== 3. תלמיד חדש מהפורטל: שם פרטי ושם משפחה בנפרד, ואשרה לדרכון =====
--
-- זהה ל-115, למעט: p_full_name הוחלף ב-p_first_name + p_last_name (השם המלא נבנה
-- מהם, "משפחה פרטי"), ושלושה פרמטרים אחרונים של אשרה - לא חובה, ונשמרים רק לדרכון.

drop function if exists portal_request_new_student(text, uuid, text, text, text, text, date, text, text, text, text, text, text, text, text, text, text, date, text, text, text);

create or replace function portal_request_new_student(
  p_token text,
  p_group_id uuid,
  p_first_name text,
  p_last_name text,
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
  p_id_photo_base64 text,
  p_visa_number text default null,
  p_visa_type integer default null,
  p_visa_expiry date default null
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
  -- השם המלא נשמר כמו תמיד במערכת: "משפחה פרטי"
  v_full_name text := btrim(coalesce(p_last_name, '')) || ' ' || btrim(coalesce(p_first_name, ''));
  v_visa_number text := case when p_id_type = 'passport' then nullif(btrim(p_visa_number), '') end;
  v_visa_type integer := case when p_id_type = 'passport' then p_visa_type end;
  v_visa_expiry date := case when p_id_type = 'passport' then p_visa_expiry end;
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
  if coalesce(btrim(p_first_name), '') = '' then raise exception 'חסר שם פרטי'; end if;
  if coalesce(btrim(p_last_name), '') = '' then raise exception 'חסר שם משפחה'; end if;

  if p_id_type = 'israeli_id' then
    if v_id = '' then raise exception 'חסר מספר תעודת זהות'; end if;
    if v_id !~ '^[0-9]{5,9}$' or not is_valid_israeli_id(v_id) then
      raise exception 'מספר תעודת הזהות שגוי (ספרת ביקורת לא מתאימה)';
    end if;
  elsif p_id_type = 'passport' then
    if v_id = '' then raise exception 'חסר מספר דרכון'; end if;
    if coalesce(btrim(p_passport_country), '') = '' then raise exception 'חסרה ארץ הדרכון'; end if;
    -- פרטי אשרה אינם חובה. מה שנמסר - נבדק מול רשימת סוגי האשרה של תלמוד.
    if v_visa_type is not null and v_visa_type not in (1, 2, 3, 4, 5, 8, 16, 32, 64, 128, 256, 1023, 1535, 2047, 2559, 3071, 3583, 3585) then
      raise exception 'סוג האשרה אינו ברשימה';
    end if;
    if v_visa_number is not null and v_visa_number !~ '^[0-9A-Za-z]{1,20}$' then
      raise exception 'מספר האשרה יכול להכיל ספרות ואותיות לועזיות בלבד';
    end if;
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
      case when v_existing.full_name <> v_full_name then '. השם הרשום: ' || v_existing.full_name else '' end ||
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
    'full_name', v_full_name,
    'first_name', btrim(p_first_name),
    'last_name', btrim(p_last_name),
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
  if v_visa_number is not null or v_visa_type is not null or v_visa_expiry is not null then
    v_payload := v_payload || jsonb_strip_nulls(jsonb_build_object(
      'visa_number', v_visa_number, 'visa_type', v_visa_type, 'visa_expiry', v_visa_expiry));
  end if;
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

grant execute on function portal_request_new_student(text, uuid, text, text, text, text, text, date, text, text, text, text, text, text, text, text, text, text, date, text, text, text, text, integer, date) to anon, authenticated;

-- ===== 4. אישור הבקשה במשרד - זהה ל-115, ובנוסף שם פרטי/משפחה ואשרה =====
--
-- תלמיד חדש: נשמרים כמו שהם. תלמיד קיים: ממלאים רק מה שחסר, כמו בשאר הפרטים.
-- עדכון שם (identity): אם השם השתנה - שם פרטי/משפחה מתאפסים.

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
      -- שם שהשתנה: שם פרטי/משפחה הישנים כבר לא נכונים. בקובץ לתלמוד יפוצל
      -- השם המלא (עם הערה) עד שיתוקן בכרטיס.
      first_name = case when full_name is distinct from r.payload ->> 'full_name' then null else first_name end,
      last_name = case when full_name is distinct from r.payload ->> 'full_name' then null else last_name end,
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
        first_name = coalesce(first_name, r.payload ->> 'first_name'),
        last_name = coalesce(last_name, r.payload ->> 'last_name'),
        visa_number = coalesce(visa_number, r.payload ->> 'visa_number'),
        visa_type = coalesce(visa_type, (r.payload ->> 'visa_type')::integer),
        visa_expiry = coalesce(visa_expiry, (r.payload ->> 'visa_expiry')::date),
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
                            address_street, address_house_number, address_city,
                            first_name, last_name, visa_number, visa_type, visa_expiry)
      values (r.payload ->> 'id_type', r.payload ->> 'external_id', r.payload ->> 'full_name',
              r.payload ->> 'phone', normalize_phone_for_match(r.payload ->> 'phone'), (r.payload ->> 'birth_date')::date,
              r.payload ->> 'marital_status', r.payload ->> 'study_scope', r.payload ->> 'study_code', r.payload ->> 'passport_country',
              r.payload ->> 'address_street', r.payload ->> 'address_house_number', r.payload ->> 'address_city',
              r.payload ->> 'first_name', r.payload ->> 'last_name', r.payload ->> 'visa_number',
              (r.payload ->> 'visa_type')::integer, (r.payload ->> 'visa_expiry')::date)
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
