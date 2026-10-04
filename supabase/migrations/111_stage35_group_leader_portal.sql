-- שלב 35: פורטל ראשי קבוצות - שלב 1.
--
-- ראש קבוצה נכנס מכל מחשב עם מייל (או טלפון, למי שאין מייל) וסיסמה, רואה
-- את התלמידים שלו ואת הזכאות שלהם, מעדכן פרטים ושואל את המשרד.
--
-- החלטות הלקוח שהקוד הזה מממש:
--   - סיסמה ראשונית: 4 הספרות האחרונות של הטלפון. רק המשרד קובע ומשנה.
--     החלפת טלפון אינה משנה את הסיסמה - לכן ברירת המחדל נקבעת פעם אחת
--     ונשמרת, ואינה מחושבת מחדש מהטלפון בכל כניסה.
--   - שום נתון כספי: רק זכאי / לא זכאי, ולמי שאינו זכאי - הסיבה מדוח
--     השגיאות של תלמוד.
--   - טלפון וכתובת מתעדכנים מיד. שם ות.ז, תלמיד חדש ותלמיד שעזב - רק
--     באישור עובד משרד שיש לו הרשאה.
--   - ראש קבוצה בכמה עמותות רואה את כל התלמידים יחד.
--
-- איך זה בנוי: ראש קבוצה אינו משתמש של Supabase. אין לו חשבון, אין לו
-- תפקיד, ואין לו גישה לאף טבלה. כל מה שהוא עושה עובר דרך פונקציות
-- security definer שמקבלות אסימון (token) ובודקות אותו בעצמן, וכל שאילתה
-- בהן מסוננת לפי ראש הקבוצה שהאסימון שייך לו - לעולם לא לפי מזהה שהדפדפן
-- שולח. זה אותו דפוס שבו כבר עובדים הוואטסאפ והסקרייפר (מפתח ציבורי +
-- פונקציה שבודקת סוד).
--
-- search_path כולל את extensions: ב-Supabase שם יושב pgcrypto (crypt,
-- digest). במסד המקומי הסכמה לא קיימת, וזה לא מפריע.

-- ===== 1. גישה לפורטל: טבלה נפרדת, לא עמודות ב-group_leaders =====
--
-- group_leaders קריאה לכל מי שיש לו גישה לתפעול. גיבוב סיסמה שם היה גלוי
-- לכולם, וגיבוב של 4 ספרות נפרץ בשניות. כאן RLS פעיל בלי אף מדיניות: אין
-- קריאה ישירה בכלל, רק דרך הפונקציות שלמטה.
create table if not exists group_leader_portal_access (
  group_leader_id uuid primary key references group_leaders(id) on delete cascade,
  password_hash text,
  password_is_default boolean not null default true,
  enabled boolean not null default true,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  password_set_at timestamptz,
  updated_at timestamptz
);
alter table group_leader_portal_access enable row level security;

create table if not exists portal_sessions (
  id uuid primary key default gen_random_uuid(),
  group_leader_id uuid not null references group_leaders(id) on delete cascade,
  -- נשמר הגיבוב בלבד. מי שקורא את הטבלה לא יכול להתחזות לחיבור קיים.
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists portal_sessions_leader_idx on portal_sessions (group_leader_id);
alter table portal_sessions enable row level security;

-- ===== 2. בקשות ושאלות =====
create table if not exists portal_change_requests (
  id uuid primary key default gen_random_uuid(),
  group_leader_id uuid not null references group_leaders(id),
  student_id uuid references students(id),
  group_id uuid references groups(id),
  -- contact: טלפון/כתובת - נכנס מיד, נשמר כאן לתיעוד (status = applied).
  -- identity: שם ות.ז. new_student: תלמיד חדש. student_left: תלמיד שעזב.
  kind text not null check (kind in ('contact', 'identity', 'new_student', 'student_left')),
  payload jsonb not null,
  previous jsonb,
  status text not null default 'pending' check (status in ('pending', 'applied', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);
create index if not exists portal_change_requests_status_idx on portal_change_requests (status, created_at desc);
create index if not exists portal_change_requests_student_idx on portal_change_requests (student_id);
create index if not exists portal_change_requests_leader_idx on portal_change_requests (group_leader_id, created_at desc);
alter table portal_change_requests enable row level security;

create table if not exists portal_questions (
  id uuid primary key default gen_random_uuid(),
  group_leader_id uuid not null references group_leaders(id),
  student_id uuid references students(id),
  month date,
  -- מה ראש הקבוצה ראה כששאל ("לא זכאי - הסיבה: ..."). נשמר כצילום מצב,
  -- כדי שהמשרד יבין את השאלה גם אחרי שהנתון השתנה.
  context text,
  body text not null,
  attachment_name text,
  attachment_type text,
  attachment_data bytea,
  status text not null default 'open' check (status in ('open', 'answered')),
  answer text,
  answered_by uuid references auth.users(id),
  answered_at timestamptz,
  task_id uuid references tasks(id),
  created_at timestamptz not null default now()
);
create index if not exists portal_questions_status_idx on portal_questions (status, created_at desc);
create index if not exists portal_questions_student_idx on portal_questions (student_id);
create index if not exists portal_questions_leader_idx on portal_questions (group_leader_id, created_at desc);
alter table portal_questions enable row level security;

-- המשרד קורא את שתי הטבלאות ישירות (עם RLS); כותב רק דרך הפונקציות.
drop policy if exists portal_change_requests_select on portal_change_requests;
create policy portal_change_requests_select on portal_change_requests for select to authenticated
  using ((select has_permission('area_ops', 'access')));
drop policy if exists portal_questions_select on portal_questions;
create policy portal_questions_select on portal_questions for select to authenticated
  using ((select has_permission('area_ops', 'access')));

-- שאלה שהועברה למשימה - המשימה יודעת מאיפה הגיעה, כמו הודעת וואטסאפ
alter table tasks add column if not exists source_portal_question_id uuid references portal_questions(id);
alter table tasks drop constraint if exists tasks_source_check;
alter table tasks add constraint tasks_source_check
  check (source in ('manual', 'whatsapp', 'template', 'automation', 'portal'));

-- ===== 3. סיסמת ברירת מחדל =====
-- גיבוב סיסמה במקום אחד. ב-Supabase הפונקציות של pgcrypto יושבות בסכמת
-- extensions, ולכן גם המילוי ההתחלתי שלמטה עובר דרך כאן ולא קורא ל-crypt ישירות.
create or replace function portal_hash_password(p_password text)
returns text
language sql
volatile
set search_path = public, extensions
as $$
  select crypt(p_password, gen_salt('bf'));
$$;

create or replace function portal_phone_last4(p_phone text)
returns text
language sql
immutable
as $$
  select case
    when length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) >= 4
      then right(regexp_replace(p_phone, '[^0-9]', '', 'g'), 4)
  end;
$$;

-- נקבעת פעם אחת, כשלראש הקבוצה יש לראשונה טלפון. החלפת טלפון אחר כך אינה
-- נוגעת בה - זו החלטת הלקוח, ובלעדיה ראש קבוצה שהחליף מספר היה ננעל בחוץ
-- בלי להבין למה.
create or replace function portal_ensure_default_password()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_last4 text := portal_phone_last4(new.phone);
begin
  insert into group_leader_portal_access (group_leader_id, password_hash, password_is_default, password_set_at)
  values (new.id, case when v_last4 is not null then portal_hash_password(v_last4) end,
          true, case when v_last4 is not null then now() end)
  on conflict (group_leader_id) do update
    set password_hash = excluded.password_hash,
        password_set_at = excluded.password_set_at,
        updated_at = now()
    where group_leader_portal_access.password_hash is null
      and excluded.password_hash is not null;
  return new;
end;
$$;

drop trigger if exists group_leaders_portal_default_password on group_leaders;
create trigger group_leaders_portal_default_password
  after insert or update of phone on group_leaders
  for each row execute function portal_ensure_default_password();

-- ראשי הקבוצות שכבר קיימים
insert into group_leader_portal_access (group_leader_id, password_hash, password_is_default, password_set_at)
select gl.id,
       case when portal_phone_last4(gl.phone) is not null then portal_hash_password(portal_phone_last4(gl.phone)) end,
       true,
       case when portal_phone_last4(gl.phone) is not null then now() end
from group_leaders gl
on conflict (group_leader_id) do nothing;

-- ===== 4. כניסה ובדיקת חיבור =====

-- מזהה כניסה -> ראש קבוצה. מייל קודם; טלפון רק לראש קבוצה שאין לו מייל.
-- יותר מהתאמה אחת - אין כניסה. עדיף לחסום ולתקן ברשימה מאשר לנחש.
create or replace function portal_find_leader(p_identifier text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_ident text := lower(btrim(coalesce(p_identifier, '')));
  v_ids uuid[];
begin
  if v_ident = '' then return null; end if;
  if position('@' in v_ident) > 0 then
    select array_agg(id) into v_ids from group_leaders
    where lower(btrim(email)) = v_ident and status = 'active';
  else
    select array_agg(id) into v_ids from group_leaders
    where nullif(btrim(coalesce(email, '')), '') is null
      and normalize_phone_for_match(phone) = normalize_phone_for_match(v_ident)
      and normalize_phone_for_match(v_ident) is not null
      and status = 'active';
  end if;
  if coalesce(array_length(v_ids, 1), 0) <> 1 then return null; end if;
  return v_ids[1];
end;
$$;

create or replace function portal_login(p_identifier text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_leader uuid;
  v_acc group_leader_portal_access;
  v_token text;
  v_minutes integer;
begin
  if coalesce(btrim(p_identifier), '') = '' or coalesce(p_password, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'missing');
  end if;

  v_leader := portal_find_leader(p_identifier);
  if v_leader is null then
    return jsonb_build_object('ok', false, 'error', 'bad_credentials');
  end if;

  select * into v_acc from group_leader_portal_access where group_leader_id = v_leader for update;
  if not found or v_acc.password_hash is null then
    return jsonb_build_object('ok', false, 'error', 'no_password');
  end if;
  if not v_acc.enabled then
    return jsonb_build_object('ok', false, 'error', 'blocked');
  end if;
  if v_acc.locked_until is not null and v_acc.locked_until > now() then
    v_minutes := ceil(extract(epoch from (v_acc.locked_until - now())) / 60.0);
    return jsonb_build_object('ok', false, 'error', 'locked', 'minutes', v_minutes);
  end if;

  if v_acc.password_hash <> crypt(p_password, v_acc.password_hash) then
    -- חמישה ניסיונות, ואז נעילה של רבע שעה. בלי זה 4 ספרות מנוחשות בדקות.
    if v_acc.failed_attempts + 1 >= 5 then
      update group_leader_portal_access
        set failed_attempts = 0, locked_until = now() + interval '15 minutes', updated_at = now()
        where group_leader_id = v_leader;
      perform insert_audit_event('portal_lockout', 'group_leaders', v_leader::text,
        jsonb_build_object('locked_until', now() + interval '15 minutes'));
      return jsonb_build_object('ok', false, 'error', 'locked', 'minutes', 15);
    end if;
    update group_leader_portal_access
      set failed_attempts = failed_attempts + 1, updated_at = now()
      where group_leader_id = v_leader;
    return jsonb_build_object('ok', false, 'error', 'bad_credentials');
  end if;

  if not exists (select 1 from groups where group_leader_id = v_leader and status = 'active') then
    return jsonb_build_object('ok', false, 'error', 'no_groups');
  end if;

  update group_leader_portal_access
    set failed_attempts = 0, locked_until = null, last_login_at = now(), updated_at = now()
    where group_leader_id = v_leader;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into portal_sessions (group_leader_id, token_hash, expires_at)
  values (v_leader, encode(digest(v_token, 'sha256'), 'hex'), now() + interval '12 hours');

  perform insert_audit_event('portal_login', 'group_leaders', v_leader::text, null);

  return jsonb_build_object('ok', true, 'token', v_token,
    'name', (select full_name from group_leaders where id = v_leader));
end;
$$;

-- כל פונקציה של הפורטל מתחילה כאן. חיבור תקף: לא בוטל, לא עברו 12 שעות,
-- ולא עברו 30 דקות בלי פעילות. הגישה פעילה, וראש הקבוצה עדיין פעיל.
create or replace function portal_session_leader(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_session uuid;
  v_leader uuid;
begin
  select s.id, s.group_leader_id into v_session, v_leader
  from portal_sessions s
  join group_leader_portal_access a on a.group_leader_id = s.group_leader_id
  join group_leaders gl on gl.id = s.group_leader_id
  where s.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and s.revoked_at is null
    and s.expires_at > now()
    and s.last_seen_at > now() - interval '30 minutes'
    and a.enabled
    and gl.status = 'active';

  if v_session is null then
    raise exception 'portal_session_expired';
  end if;

  update portal_sessions set last_seen_at = now() where id = v_session;
  return v_leader;
end;
$$;

create or replace function portal_logout(p_token text)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  update portal_sessions set revoked_at = now()
  where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and revoked_at is null;
$$;

-- ===== 5. מה ראש הקבוצה רואה =====

-- התלמיד שייך לראש הקבוצה: שיוך פעיל לקבוצה פעילה שהוא ראש שלה כרגע.
-- ראש קבוצה שהוחלף - הקבוצה כבר לא רשומה על שמו, והגישה נסגרת מעצמה.
create or replace function portal_owns_student(p_leader uuid, p_student uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from student_assignments sa
    join groups g on g.id = sa.group_id
    where sa.student_id = p_student and sa.is_active
      and g.group_leader_id = p_leader and g.status = 'active');
$$;

-- זכאי / לא זכאי / אין נתון, וסיבות. בלי סכומים: הסכום משמש כאן רק
-- להכרעה אם התלמיד זכאי (תלמוד רושם 0 למי שאינו זכאי), ואינו יוצא מהפונקציה.
create or replace function portal_student_eligibility(p_student uuid, p_month date)
returns table (eligibility text, reasons text[])
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select max(gross_amount) as gross, count(*) as n
    from monthly_eligibility
    where student_id = p_student and month = p_month and status = 'active'
  ), te as (
    select array_agg(distinct coalesce(nullif(btrim(error_description), ''), 'שגיאה ' || error_code)) as reasons
    from talmud_errors
    where student_id = p_student and month = p_month
  )
  select
    case
      when me.gross > 0 then 'eligible'
      when me.n > 0 or te.reasons is not null then 'not_eligible'
      else 'no_data'
    end,
    case when coalesce(me.gross, 0) > 0 then '{}'::text[] else coalesce(te.reasons, '{}'::text[]) end
  from me, te;
$$;

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
          'id', g.id, 'name', g.name, 'branch', b.internal_name, 'organization', o.legal_name)
          order by g.name, b.internal_name)
        from groups g
        join branches b on b.id = g.branch_id
        join organizations o on o.id = b.organization_id
        where g.group_leader_id = v_leader and g.status = 'active'), '[]'::jsonb))
    from group_leaders gl where gl.id = v_leader);
end;
$$;

-- החודשים שיש בהם נתון לתלמידים של ראש הקבוצה, מהחדש לישן
create or replace function portal_months(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_leader uuid := portal_session_leader(p_token);
begin
  return coalesce((
    select jsonb_agg(m order by m desc) from (
      select distinct x.month as m from (
        select me.month from monthly_eligibility me
        join student_assignments sa on sa.student_id = me.student_id and sa.is_active
        join groups g on g.id = sa.group_id and g.group_leader_id = v_leader and g.status = 'active'
        where me.status = 'active'
        union
        select te.month from talmud_errors te
        join student_assignments sa on sa.student_id = te.student_id and sa.is_active
        join groups g on g.id = sa.group_id and g.group_leader_id = v_leader and g.status = 'active'
      ) x
      order by x.month desc
      limit 24
    ) months), '[]'::jsonb);
end;
$$;

create or replace function portal_students(p_token text, p_month date)
returns table (
  student_id uuid, full_name text, external_id text, id_type text,
  phone text, address_street text, address_house_number text, address_city text,
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

-- ===== 6. עדכונים =====

-- טלפון וכתובת: נכנס מיד, ונרשם גם ביומן וגם כבקשה שבוצעה - כך שבמשרד
-- רואים לפני/אחרי ומי שינה.
create or replace function portal_update_contact(
  p_token text, p_student_id uuid, p_phone text,
  p_street text, p_house_number text, p_city text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_leader uuid := portal_session_leader(p_token);
  v_before jsonb;
  v_after jsonb;
begin
  if not portal_owns_student(v_leader, p_student_id) then
    raise exception 'התלמיד אינו שייך לקבוצה שלך';
  end if;

  select jsonb_build_object('phone', phone_raw, 'address_street', address_street,
                            'address_house_number', address_house_number, 'address_city', address_city)
  into v_before from students where id = p_student_id;

  v_after := jsonb_build_object('phone', nullif(btrim(p_phone), ''), 'address_street', nullif(btrim(p_street), ''),
                                'address_house_number', nullif(btrim(p_house_number), ''), 'address_city', nullif(btrim(p_city), ''));

  if v_before = v_after then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  update students set
    phone_raw = v_after ->> 'phone',
    phone_normalized = normalize_phone_for_match(v_after ->> 'phone'),
    address_street = v_after ->> 'address_street',
    address_house_number = v_after ->> 'address_house_number',
    address_city = v_after ->> 'address_city'
  where id = p_student_id;

  insert into portal_change_requests (group_leader_id, student_id, kind, payload, previous, status, decided_at)
  values (v_leader, p_student_id, 'contact', v_after, v_before, 'applied', now());

  perform insert_audit_event('portal_update_contact', 'students', p_student_id::text,
    jsonb_build_object('group_leader_id', v_leader, 'before', v_before, 'after', v_after));

  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

-- בדיקה משותפת למספר זהות שמגיע מראש קבוצה
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
  if exists (select 1 from students
             where normalize_identity(external_id) = normalize_identity(v_id)
               and id is distinct from p_except_student) then
    return 'תלמיד עם מספר זהות זה כבר קיים במערכת. אם הוא צריך לעבור לקבוצה שלך, שלח שאלה למשרד.';
  end if;
  return null;
end;
$$;

create or replace function portal_request_identity(
  p_token text, p_student_id uuid, p_full_name text, p_external_id text, p_id_type text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_leader uuid := portal_session_leader(p_token);
  v_problem text;
  v_before jsonb;
  v_after jsonb;
  v_id uuid;
begin
  if not portal_owns_student(v_leader, p_student_id) then
    raise exception 'התלמיד אינו שייך לקבוצה שלך';
  end if;
  if coalesce(btrim(p_full_name), '') = '' then raise exception 'חסר שם'; end if;
  v_problem := portal_check_identity(p_external_id, p_id_type, p_student_id);
  if v_problem is not null then raise exception '%', v_problem; end if;
  if exists (select 1 from portal_change_requests
             where student_id = p_student_id and kind = 'identity' and status = 'pending') then
    raise exception 'כבר נשלחה בקשה לשינוי פרטים של התלמיד, והיא ממתינה לאישור';
  end if;

  select jsonb_build_object('full_name', full_name, 'external_id', external_id, 'id_type', id_type)
  into v_before from students where id = p_student_id;
  v_after := jsonb_build_object('full_name', btrim(p_full_name), 'external_id', btrim(p_external_id), 'id_type', p_id_type);
  if v_before = v_after then raise exception 'לא שונה דבר'; end if;

  insert into portal_change_requests (group_leader_id, student_id, kind, payload, previous)
  values (v_leader, p_student_id, 'identity', v_after, v_before)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function portal_request_new_student(
  p_token text, p_group_id uuid, p_full_name text, p_external_id text, p_id_type text,
  p_phone text, p_street text, p_house_number text, p_city text, p_start_date date
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_leader uuid := portal_session_leader(p_token);
  v_problem text;
  v_id uuid;
begin
  if not exists (select 1 from groups where id = p_group_id and group_leader_id = v_leader and status = 'active') then
    raise exception 'יש לבחור אחת מהקבוצות שלך';
  end if;
  if coalesce(btrim(p_full_name), '') = '' then raise exception 'חסר שם'; end if;
  v_problem := portal_check_identity(p_external_id, p_id_type, null);
  if v_problem is not null then raise exception '%', v_problem; end if;
  if exists (select 1 from portal_change_requests
             where kind = 'new_student' and status = 'pending'
               and normalize_identity(payload ->> 'external_id') = normalize_identity(p_external_id)) then
    raise exception 'כבר נשלחה בקשה להוספת תלמיד זה, והיא ממתינה לאישור';
  end if;

  insert into portal_change_requests (group_leader_id, group_id, kind, payload)
  values (v_leader, p_group_id, 'new_student', jsonb_build_object(
    'full_name', btrim(p_full_name), 'external_id', btrim(p_external_id), 'id_type', p_id_type,
    'phone', nullif(btrim(p_phone), ''), 'address_street', nullif(btrim(p_street), ''),
    'address_house_number', nullif(btrim(p_house_number), ''), 'address_city', nullif(btrim(p_city), ''),
    'start_date', coalesce(p_start_date, current_date)))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function portal_request_student_left(
  p_token text, p_student_id uuid, p_exit_date date, p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_leader uuid := portal_session_leader(p_token);
  v_id uuid;
begin
  if not portal_owns_student(v_leader, p_student_id) then
    raise exception 'התלמיד אינו שייך לקבוצה שלך';
  end if;
  if p_exit_date is null then raise exception 'חסר תאריך עזיבה'; end if;
  if exists (select 1 from portal_change_requests
             where student_id = p_student_id and kind = 'student_left' and status = 'pending') then
    raise exception 'כבר נשלחה בקשה על עזיבת התלמיד, והיא ממתינה לאישור';
  end if;

  insert into portal_change_requests (group_leader_id, student_id, kind, payload)
  values (v_leader, p_student_id, 'student_left',
          jsonb_build_object('exit_date', p_exit_date, 'reason', nullif(btrim(p_reason), '')))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function portal_cancel_request(p_token text, p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_leader uuid := portal_session_leader(p_token);
begin
  update portal_change_requests set status = 'cancelled', decided_at = now()
  where id = p_request_id and group_leader_id = v_leader and status = 'pending';
  if not found then raise exception 'הבקשה כבר טופלה'; end if;
end;
$$;

create or replace function portal_my_requests(p_token text)
returns table (
  id uuid, kind text, student_name text, status text, payload jsonb, previous jsonb,
  decision_note text, created_at timestamptz, decided_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_leader uuid := portal_session_leader(p_token);
begin
  return query
  select r.id, r.kind, coalesce(s.full_name, r.payload ->> 'full_name'), r.status, r.payload, r.previous,
         r.decision_note, r.created_at, r.decided_at
  from portal_change_requests r
  left join students s on s.id = r.student_id
  where r.group_leader_id = v_leader
  order by r.created_at desc
  limit 200;
end;
$$;

-- ===== 7. שאלות למשרד =====
create or replace function portal_ask(
  p_token text, p_student_id uuid, p_month date, p_body text,
  p_file_name text, p_file_type text, p_file_base64 text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_leader uuid := portal_session_leader(p_token);
  v_context text;
  v_file bytea;
  v_el record;
  v_id uuid;
begin
  if coalesce(btrim(p_body), '') = '' then raise exception 'יש לכתוב את השאלה'; end if;

  if p_student_id is not null then
    if not portal_owns_student(v_leader, p_student_id) then
      raise exception 'התלמיד אינו שייך לקבוצה שלך';
    end if;
    if p_month is not null then
      select * into v_el from portal_student_eligibility(p_student_id, p_month);
      v_context := to_char(p_month, 'MM/YYYY') || ': ' ||
        case v_el.eligibility
          when 'eligible' then 'זכאי'
          when 'not_eligible' then 'לא זכאי' ||
            case when cardinality(v_el.reasons) > 0 then ' - ' || array_to_string(v_el.reasons, '; ') else '' end
          else 'אין נתון'
        end;
    end if;
  end if;

  if coalesce(p_file_base64, '') <> '' then
    v_file := decode(p_file_base64, 'base64');
    if octet_length(v_file) > 5 * 1024 * 1024 then
      raise exception 'הקובץ גדול מ-5MB';
    end if;
  end if;

  insert into portal_questions (group_leader_id, student_id, month, context, body,
                                attachment_name, attachment_type, attachment_data)
  values (v_leader, p_student_id, p_month, v_context, btrim(p_body),
          case when v_file is not null then nullif(btrim(p_file_name), '') end,
          case when v_file is not null then nullif(btrim(p_file_type), '') end,
          v_file)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function portal_my_questions(p_token text)
returns table (
  id uuid, student_name text, context text, body text, attachment_name text,
  status text, answer text, answered_at timestamptz, created_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_leader uuid := portal_session_leader(p_token);
begin
  return query
  select q.id, s.full_name, q.context, q.body, q.attachment_name, q.status, q.answer, q.answered_at, q.created_at
  from portal_questions q
  left join students s on s.id = q.student_id
  where q.group_leader_id = v_leader
  order by q.created_at desc
  limit 200;
end;
$$;

-- ===== 8. צד המשרד =====

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
    v_problem := portal_check_identity(r.payload ->> 'external_id', r.payload ->> 'id_type', null);
    if v_problem is not null then raise exception '%', v_problem; end if;
    select g.branch_id, b.organization_id into v_branch, v_org
    from groups g join branches b on b.id = g.branch_id
    where g.id = r.group_id and g.status = 'active';
    if v_branch is null then raise exception 'הקבוצה כבר אינה פעילה'; end if;

    insert into students (id_type, external_id, full_name, phone_raw, phone_normalized,
                          address_street, address_house_number, address_city)
    values (r.payload ->> 'id_type', r.payload ->> 'external_id', r.payload ->> 'full_name',
            r.payload ->> 'phone', normalize_phone_for_match(r.payload ->> 'phone'),
            r.payload ->> 'address_street', r.payload ->> 'address_house_number', r.payload ->> 'address_city')
    returning id into v_student;

    insert into student_assignments (student_id, organization_id, branch_id, group_id, start_date, is_active)
    values (v_student, v_org, v_branch, r.group_id, (r.payload ->> 'start_date')::date, true);

    update portal_change_requests set student_id = v_student where id = p_request_id;

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

create or replace function portal_answer_question(p_question_id uuid, p_answer text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('students', 'manage') then
    raise exception 'permission denied';
  end if;
  if coalesce(btrim(p_answer), '') = '' then raise exception 'יש לכתוב תשובה'; end if;
  update portal_questions
    set answer = btrim(p_answer), status = 'answered', answered_by = auth.uid(), answered_at = now()
    where id = p_question_id;
  if not found then raise exception 'השאלה לא נמצאה'; end if;
  perform insert_audit_event('portal_question_answered', 'portal_questions', p_question_id::text, null);
end;
$$;

create or replace function portal_question_to_task(p_question_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  q record;
  v_task uuid;
begin
  if not has_permission('tasks', 'create') then
    raise exception 'permission denied';
  end if;
  select pq.*, gl.full_name as leader_name, s.full_name as student_name
  into q
  from portal_questions pq
  join group_leaders gl on gl.id = pq.group_leader_id
  left join students s on s.id = pq.student_id
  where pq.id = p_question_id;
  if not found then raise exception 'השאלה לא נמצאה'; end if;
  if q.task_id is not null then return q.task_id; end if;

  insert into tasks (title, description, status, priority, source, created_by, source_portal_question_id)
  values (
    'שאלה מ' || q.leader_name || coalesce(' על ' || q.student_name, ''),
    q.body || coalesce(E'\n\n' || q.context, ''),
    'open', 'normal', 'portal', auth.uid(), p_question_id)
  returning id into v_task;
  insert into task_owners (task_id, user_id) values (v_task, auth.uid());

  update portal_questions set task_id = v_task where id = p_question_id;
  return v_task;
end;
$$;

create or replace function portal_question_attachment(p_question_id uuid)
returns table (file_name text, file_type text, file_base64 text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('area_ops', 'access') then
    raise exception 'permission denied';
  end if;
  return query
  select attachment_name, attachment_type, encode(attachment_data, 'base64')
  from portal_questions where id = p_question_id and attachment_data is not null;
end;
$$;

-- רשימת הגישה למסך המשרד. בלי גיבוב הסיסמה - רק אם יש סיסמה ואם היא ברירת המחדל.
create or replace function portal_leader_access_list()
returns table (
  group_leader_id uuid, full_name text, email text, phone text, login_identifier text,
  has_password boolean, password_is_default boolean, enabled boolean,
  locked_until timestamptz, last_login_at timestamptz, active_groups integer, problem text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('area_ops', 'access') then
    raise exception 'permission denied';
  end if;
  return query
  select gl.id, gl.full_name, gl.email, gl.phone,
    coalesce(nullif(btrim(gl.email), ''), gl.phone),
    a.password_hash is not null,
    coalesce(a.password_is_default, true),
    coalesce(a.enabled, true),
    case when a.locked_until > now() then a.locked_until end,
    a.last_login_at,
    (select count(*)::int from groups g where g.group_leader_id = gl.id and g.status = 'active'),
    case
      when nullif(btrim(coalesce(gl.email, '')), '') is null and normalize_phone_for_match(gl.phone) is null
        then 'אין מייל ואין טלפון - אין איך להיכנס'
      when nullif(btrim(coalesce(gl.email, '')), '') is not null and exists (
        select 1 from group_leaders o where o.id <> gl.id and o.status = 'active'
          and lower(btrim(o.email)) = lower(btrim(gl.email)))
        then 'אותו מייל רשום לראש קבוצה נוסף'
      when nullif(btrim(coalesce(gl.email, '')), '') is null and exists (
        select 1 from group_leaders o where o.id <> gl.id and o.status = 'active'
          and nullif(btrim(coalesce(o.email, '')), '') is null
          and normalize_phone_for_match(o.phone) = normalize_phone_for_match(gl.phone))
        then 'אותו טלפון רשום לראש קבוצה נוסף'
      when a.password_hash is null then 'אין סיסמה - יש לקבוע'
    end
  from group_leaders gl
  left join group_leader_portal_access a on a.group_leader_id = gl.id
  where gl.status = 'active'
  order by gl.full_name;
end;
$$;

-- קביעת סיסמה. ריק = חזרה לברירת המחדל (4 הספרות האחרונות של הטלפון הנוכחי).
-- כל חיבור פתוח נסגר, כדי שסיסמה חדשה באמת תחליף את הישנה.
create or replace function portal_set_leader_password(p_leader_id uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_password text := nullif(btrim(coalesce(p_password, '')), '');
  v_default boolean := false;
begin
  if not has_permission('groups', 'manage') then
    raise exception 'permission denied';
  end if;
  if v_password is null then
    v_password := portal_phone_last4((select phone from group_leaders where id = p_leader_id));
    if v_password is null then
      raise exception 'לראש הקבוצה אין טלפון במערכת. יש לקבוע סיסמה.';
    end if;
    v_default := true;
  elsif length(v_password) < 4 then
    raise exception 'סיסמה צריכה להכיל לפחות 4 תווים';
  end if;

  insert into group_leader_portal_access (group_leader_id, password_hash, password_is_default, password_set_at,
                                          failed_attempts, locked_until, updated_at)
  values (p_leader_id, portal_hash_password(v_password), v_default, now(), 0, null, now())
  on conflict (group_leader_id) do update set
    password_hash = excluded.password_hash, password_is_default = excluded.password_is_default,
    password_set_at = now(), failed_attempts = 0, locked_until = null, updated_at = now();

  update portal_sessions set revoked_at = now() where group_leader_id = p_leader_id and revoked_at is null;
  perform insert_audit_event('portal_password_set', 'group_leaders', p_leader_id::text,
    jsonb_build_object('is_default', v_default));
end;
$$;

create or replace function portal_set_leader_access(p_leader_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('groups', 'manage') then
    raise exception 'permission denied';
  end if;
  insert into group_leader_portal_access (group_leader_id, enabled, updated_at)
  values (p_leader_id, p_enabled, now())
  on conflict (group_leader_id) do update set enabled = p_enabled, failed_attempts = 0,
    locked_until = case when p_enabled then null else group_leader_portal_access.locked_until end,
    updated_at = now();
  if not p_enabled then
    update portal_sessions set revoked_at = now() where group_leader_id = p_leader_id and revoked_at is null;
  end if;
  perform insert_audit_event(case when p_enabled then 'portal_access_enabled' else 'portal_access_blocked' end,
    'group_leaders', p_leader_id::text, null);
end;
$$;

-- ===== 9. הרשאות הרצה =====
--
-- Supabase נותנת הרשאת הרצה לכל פונקציה חדשה ל-anon ול-authenticated. לכן
-- הפונקציות הפנימיות נסגרות במפורש: בלעדיהן אפשר היה לבדוק "האם התלמיד
-- הזה שייך לראש הקבוצה ההוא" בלי להיות מחובר.
revoke execute on function portal_hash_password(text) from public, anon, authenticated;
revoke execute on function portal_phone_last4(text) from public, anon, authenticated;
revoke execute on function portal_ensure_default_password() from public, anon, authenticated;
revoke execute on function portal_find_leader(text) from public, anon, authenticated;
revoke execute on function portal_session_leader(text) from public, anon, authenticated;
revoke execute on function portal_owns_student(uuid, uuid) from public, anon, authenticated;
revoke execute on function portal_student_eligibility(uuid, date) from public, anon, authenticated;
revoke execute on function portal_check_identity(text, text, uuid) from public, anon, authenticated;

-- הפורטל: ללא התחברות של Supabase, עם אסימון
grant execute on function portal_login(text, text) to anon, authenticated;
grant execute on function portal_logout(text) to anon, authenticated;
grant execute on function portal_me(text) to anon, authenticated;
grant execute on function portal_months(text) to anon, authenticated;
grant execute on function portal_students(text, date) to anon, authenticated;
grant execute on function portal_update_contact(text, uuid, text, text, text, text) to anon, authenticated;
grant execute on function portal_request_identity(text, uuid, text, text, text) to anon, authenticated;
grant execute on function portal_request_new_student(text, uuid, text, text, text, text, text, text, text, date) to anon, authenticated;
grant execute on function portal_request_student_left(text, uuid, date, text) to anon, authenticated;
grant execute on function portal_cancel_request(text, uuid) to anon, authenticated;
grant execute on function portal_my_requests(text) to anon, authenticated;
grant execute on function portal_ask(text, uuid, date, text, text, text, text) to anon, authenticated;
grant execute on function portal_my_questions(text) to anon, authenticated;

-- המשרד: משתמש מחובר עם הרשאה (נבדקת בתוך כל פונקציה)
revoke execute on function portal_decide_request(uuid, boolean, text) from public, anon;
revoke execute on function portal_answer_question(uuid, text) from public, anon;
revoke execute on function portal_question_to_task(uuid) from public, anon;
revoke execute on function portal_question_attachment(uuid) from public, anon;
revoke execute on function portal_leader_access_list() from public, anon;
revoke execute on function portal_set_leader_password(uuid, text) from public, anon;
revoke execute on function portal_set_leader_access(uuid, boolean) from public, anon;
grant execute on function portal_decide_request(uuid, boolean, text) to authenticated;
grant execute on function portal_answer_question(uuid, text) to authenticated;
grant execute on function portal_question_to_task(uuid) to authenticated;
grant execute on function portal_question_attachment(uuid) to authenticated;
grant execute on function portal_leader_access_list() to authenticated;
grant execute on function portal_set_leader_password(uuid, text) to authenticated;
grant execute on function portal_set_leader_access(uuid, boolean) to authenticated;
