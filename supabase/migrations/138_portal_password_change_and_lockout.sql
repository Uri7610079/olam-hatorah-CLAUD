-- 138: פורטל ראשי קבוצות - חובת החלפת סיסמה ונעילה מתארכת (ביקורת אבטחה 20.11, ממצאים 4 ו-18).
--
-- 1. חובת החלפת סיסמה: הכניסה הראשונה נשארת עם 4 הספרות האחרונות של הטלפון (החלטת
--    הלקוח), אבל מיד אחריה ראש הקבוצה חייב לבחור סיסמה משלו. עד שהחליף - אף פעולה
--    בפורטל לא עובדת חוץ מהחלפת הסיסמה. אותו דבר אחרי שהמשרד קבע או איפס סיסמה:
--    סיסמה שהמשרד מכיר מוחלפת בכניסה הבאה.
--      "חייב להחליף" = password_is_default (4 ספרות) או must_change_password (סיסמה
--      שהמשרד קבע מעכשיו). העמודה החדשה מתחילה false, כך ששום שורה קיימת לא משתנה:
--      מי שעדיין על 4 הספרות - כבר מסומן password_is_default ויחויב להחליף.
--
-- 2. נעילה מתארכת: עד היום כל 5 ניסיונות שגויים נעלו לרבע שעה - בלי סוף, כך שאפשר היה
--    לנחש 4 ספרות לאט (כ-10 ימים). מעכשיו כל נעילה ברצף כפולה מהקודמת: 15 דקות, חצי
--    שעה, שעה, שעתיים... עד יממה. כניסה מוצלחת, או שחרור/סיסמה מהמשרד, מאפסים את הרצף.
--    המשרד רואה במסך "גישה לפורטל" מי ננעל כמה פעמים ברצף.
--
-- שום נתון קיים לא משתנה: שתי עמודות חדשות עם ברירת מחדל, ופונקציות שמוחלפות באותה
-- חתימה (portal_session_leader, portal_login, portal_set_leader_password,
-- portal_set_leader_access) ושלוש חדשות.

alter table group_leader_portal_access
  add column if not exists must_change_password boolean not null default false,
  add column if not exists lockout_count integer not null default 0;

-- ===== חיפוש חיבור, בלי בדיקת "חייב להחליף סיסמה" =====
-- פנימית בלבד: portal_session_leader (כל פעולה בפורטל) ו-portal_change_password.
create or replace function portal_session_lookup(p_token text)
returns table (session_id uuid, leader_id uuid, must_change boolean)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
  select s.id, s.group_leader_id, (a.password_is_default or a.must_change_password)
  from portal_sessions s
  join group_leader_portal_access a on a.group_leader_id = s.group_leader_id
  join group_leaders gl on gl.id = s.group_leader_id
  where s.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and s.revoked_at is null
    and s.expires_at > now()
    and s.last_seen_at > now() - interval '30 minutes'
    and a.enabled
    and gl.status = 'active';
end;
$$;

-- כל פונקציה של הפורטל מתחילה כאן. כמו קודם (חיבור תקף, גישה פעילה, ראש קבוצה פעיל),
-- ובנוסף: מי שעוד לא החליף את הסיסמה הראשונית - לא עובר.
create or replace function portal_session_leader(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record;
begin
  select * into r from portal_session_lookup(p_token);
  if not found then
    raise exception 'portal_session_expired';
  end if;
  if r.must_change then
    raise exception 'portal_password_change_required';
  end if;
  update portal_sessions set last_seen_at = now() where id = r.session_id;
  return r.leader_id;
end;
$$;

-- ===== כניסה =====
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
    -- חמישה ניסיונות, ואז נעילה. כל נעילה ברצף כפולה מהקודמת: 15, 30, 60... עד 1440 דקות.
    if v_acc.failed_attempts + 1 >= 5 then
      v_minutes := least(15 * power(2, least(v_acc.lockout_count, 7))::integer, 1440);
      update group_leader_portal_access
        set failed_attempts = 0, lockout_count = lockout_count + 1,
            locked_until = now() + make_interval(mins => v_minutes), updated_at = now()
        where group_leader_id = v_leader;
      perform insert_audit_event('portal_lockout', 'group_leaders', v_leader::text,
        jsonb_build_object('locked_until', now() + make_interval(mins => v_minutes),
                           'lockout_count', v_acc.lockout_count + 1));
      return jsonb_build_object('ok', false, 'error', 'locked', 'minutes', v_minutes);
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
    set failed_attempts = 0, lockout_count = 0, locked_until = null, last_login_at = now(), updated_at = now()
    where group_leader_id = v_leader;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into portal_sessions (group_leader_id, token_hash, expires_at)
  values (v_leader, encode(digest(v_token, 'sha256'), 'hex'), now() + interval '12 hours');

  perform insert_audit_event('portal_login', 'group_leaders', v_leader::text, null);

  return jsonb_build_object('ok', true, 'token', v_token,
    'name', (select full_name from group_leaders where id = v_leader),
    'must_change', (v_acc.password_is_default or v_acc.must_change_password));
end;
$$;

-- ===== החלפת סיסמה על ידי ראש הקבוצה =====
-- דורשת את הסיסמה הנוכחית. הסיסמה החדשה: לפחות 6 תווים, שונה מהנוכחית, לא ספרות מתוך
-- הטלפון של ראש הקבוצה, ולא רצף פשוט (111111, 123456). אחרי ההחלפה כל שאר החיבורים
-- של ראש הקבוצה נסגרים, והחיבור הנוכחי ממשיך.
create or replace function portal_change_password(p_token text, p_current text, p_new text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record;
  v_hash text;
  v_new text := coalesce(p_new, '');
  v_phone text;
begin
  select * into r from portal_session_lookup(p_token);
  if not found then
    raise exception 'portal_session_expired';
  end if;

  select password_hash into v_hash from group_leader_portal_access where group_leader_id = r.leader_id for update;
  if v_hash is null or v_hash <> crypt(coalesce(p_current, ''), v_hash) then
    return jsonb_build_object('ok', false, 'error', 'wrong_current');
  end if;
  if length(v_new) < 6 then
    return jsonb_build_object('ok', false, 'error', 'too_short');
  end if;
  if v_new = coalesce(p_current, '') then
    return jsonb_build_object('ok', false, 'error', 'same');
  end if;
  v_phone := regexp_replace(coalesce((select phone from group_leaders where id = r.leader_id), ''), '[^0-9]', '', 'g');
  if v_new ~ '^[0-9]+$' and v_phone <> '' and position(v_new in v_phone) > 0 then
    return jsonb_build_object('ok', false, 'error', 'from_phone');
  end if;
  if v_new ~ '^(.)\1*$'
     or position(v_new in '01234567890') > 0
     or position(v_new in '09876543210') > 0 then
    return jsonb_build_object('ok', false, 'error', 'too_simple');
  end if;

  update group_leader_portal_access
    set password_hash = portal_hash_password(v_new), password_is_default = false, must_change_password = false,
        password_set_at = now(), updated_at = now()
    where group_leader_id = r.leader_id;
  update portal_sessions set revoked_at = now()
    where group_leader_id = r.leader_id and revoked_at is null and id <> r.session_id;
  update portal_sessions set last_seen_at = now() where id = r.session_id;

  perform insert_audit_event('portal_password_changed_by_leader', 'group_leaders', r.leader_id::text, null);
  return jsonb_build_object('ok', true);
end;
$$;

-- ===== המשרד: קביעה/איפוס סיסמה =====
-- כמו קודם, ובנוסף: כל סיסמה שהמשרד קובע מוחלפת בכניסה הבאה, והרצף של הנעילות מתאפס.
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

  insert into group_leader_portal_access (group_leader_id, password_hash, password_is_default, must_change_password,
                                          password_set_at, failed_attempts, lockout_count, locked_until, updated_at)
  values (p_leader_id, portal_hash_password(v_password), v_default, true, now(), 0, 0, null, now())
  on conflict (group_leader_id) do update set
    password_hash = excluded.password_hash, password_is_default = excluded.password_is_default,
    must_change_password = true, password_set_at = now(), failed_attempts = 0, lockout_count = 0,
    locked_until = null, updated_at = now();

  update portal_sessions set revoked_at = now() where group_leader_id = p_leader_id and revoked_at is null;
  perform insert_audit_event('portal_password_set', 'group_leaders', p_leader_id::text,
    jsonb_build_object('is_default', v_default));
end;
$$;

-- ===== המשרד: חסימה ושחרור =====
-- כמו קודם; שחרור מאפס גם את רצף הנעילות.
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
    lockout_count = case when p_enabled then 0 else group_leader_portal_access.lockout_count end,
    locked_until = case when p_enabled then null else group_leader_portal_access.locked_until end,
    updated_at = now();
  if not p_enabled then
    update portal_sessions set revoked_at = now() where group_leader_id = p_leader_id and revoked_at is null;
  end if;
  perform insert_audit_event(case when p_enabled then 'portal_access_enabled' else 'portal_access_blocked' end,
    'group_leaders', p_leader_id::text, null);
end;
$$;

-- ===== המשרד: מצב הסיסמה והנעילות =====
-- רשימה נפרדת (ולא עמודות ב-portal_leader_access_list), כדי לא לשנות את החתימה הקיימת.
create or replace function portal_leader_password_status()
returns table (group_leader_id uuid, must_change boolean, chosen_by_leader boolean, lockout_count integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('area_ops', 'access') then
    raise exception 'permission denied';
  end if;
  return query
  select a.group_leader_id,
    (a.password_is_default or a.must_change_password),
    (a.password_hash is not null and not a.password_is_default and not a.must_change_password
       and exists (select 1 from audit_events e where e.action = 'portal_password_changed_by_leader'
                     and e.resource_id = a.group_leader_id::text)),
    a.lockout_count
  from group_leader_portal_access a;
end;
$$;

revoke execute on function portal_session_lookup(text) from public, anon, authenticated;
revoke execute on function portal_change_password(text, text, text) from public;
grant execute on function portal_change_password(text, text, text) to anon, authenticated;
revoke execute on function portal_leader_password_status() from public, anon;
grant execute on function portal_leader_password_status() to authenticated;
