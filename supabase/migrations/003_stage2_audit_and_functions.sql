-- שלב 2: יומן פעילות (append-only), ופונקציות ה-SQL שמאחורי ההרשאות ופעולות הניהול.

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id),
  action text not null,
  resource text not null,
  resource_id text,
  detail jsonb,
  created_at timestamptz not null default now()
);

-- append-only נאכף בטריגר, לא רק בהיעדר policy - כך שגם בעל הטבלה לא יכול לשנות בטעות.
create or replace function block_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_events is append-only: % not allowed', tg_op;
end;
$$;

create trigger audit_events_no_update
  before update on audit_events
  for each row execute function block_audit_mutation();

create trigger audit_events_no_delete
  before delete on audit_events
  for each row execute function block_audit_mutation();

-- פונקציית עזר פנימית בלבד לכתיבת שורת audit - לא נחשפת ישירות ללקוח (ר' revoke בסוף).
create or replace function insert_audit_event(p_action text, p_resource text, p_resource_id text, p_detail jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into audit_events (actor_id, action, resource, resource_id, detail)
  values (auth.uid(), p_action, p_resource, p_resource_id, p_detail);
end;
$$;

revoke execute on function insert_audit_event(text, text, text, jsonb) from public, anon, authenticated;

-- has_permission(): נקראת מ-RLS policies. security definer -> עוקפת RLS על הטבלאות שהיא
-- עצמה קוראת (profiles/role_permissions/user_permissions), כדי למנוע רקורסיה של policy שקוראת לעצמה.
-- deny-by-default: משתמש לא approved, או הרשאה שלא קיימת בשום מקום -> false.
create or replace function has_permission(p_resource text, p_action text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text;
  v_role_id uuid;
  v_override text;
  v_role_grant boolean;
begin
  select status, role_id into v_status, v_role_id from profiles where id = auth.uid();

  if v_status is distinct from 'approved' then
    return false;
  end if;

  select up.effect into v_override
  from user_permissions up
  join permissions p on p.id = up.permission_id
  where up.user_id = auth.uid() and p.resource = p_resource and p.action = p_action;

  if v_override = 'revoke' then
    return false;
  elsif v_override = 'grant' then
    return true;
  end if;

  select exists (
    select 1
    from role_permissions rp
    join permissions p on p.id = rp.permission_id
    where rp.role_id = v_role_id and p.resource = p_resource and p.action = p_action
  ) into v_role_grant;

  return coalesce(v_role_grant, false);
end;
$$;

grant execute on function has_permission(text, text) to authenticated;

-- my_permissions(): כל ההרשאות האפקטיביות של המשתמש המחובר, בקריאה אחת - כדי שהלקוח
-- יבדוק הרשאות מרשימה מטמון בזיכרון ולא יקרא ל-has_permission בנפרד על כל בדיקה.
create or replace function my_permissions()
returns table (resource text, action text)
language sql
stable
security definer
set search_path = public
as $$
  select p.resource, p.action
  from permissions p
  where has_permission(p.resource, p.action);
$$;

grant execute on function my_permissions() to authenticated;

-- admin_set_user_status(): הדרך היחידה לאשר/לדחות/להשבית משתמש ולשנות תפקיד/אזור ברירת מחדל.
-- אין UPDATE ישיר על profiles מהלקוח (ר' migration 004) - הכל עובר כאן, עם audit מובנה.
create or replace function admin_set_user_status(
  p_user_id uuid,
  p_status text,
  p_role_key text default null,
  p_default_area text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_id uuid;
begin
  if not has_permission('users', 'manage') then
    raise exception 'permission denied';
  end if;

  if p_status not in ('approved', 'disabled') then
    raise exception 'invalid status for this action: %', p_status;
  end if;

  if p_role_key is not null then
    select id into v_role_id from roles where key = p_role_key;
    if v_role_id is null then
      raise exception 'unknown role: %', p_role_key;
    end if;
  end if;

  update profiles
  set status = p_status,
      role_id = coalesce(v_role_id, role_id),
      default_area = coalesce(p_default_area, default_area)
  where id = p_user_id;

  -- דחייה = disabled על בקשה שעדיין לא הוכרעה. השבתה מאוחרת של משתמש שכבר אושר
  -- לא נוגעת בהחלטת ה-access_request המקורית (decision is null תופס רק בקשות פתוחות).
  update access_requests
  set decision = case when p_status = 'approved' then 'approved' else 'rejected' end,
      decided_by = auth.uid(),
      decided_at = now()
  where user_id = p_user_id and decision is null;

  perform insert_audit_event(
    'set_user_status', 'users', p_user_id::text,
    jsonb_build_object('status', p_status, 'role_key', p_role_key, 'default_area', p_default_area)
  );
end;
$$;

grant execute on function admin_set_user_status(uuid, text, text, text) to authenticated;

-- admin_set_user_permission(): הענקה/שלילה/איפוס של הרשאת חריגה בודדת למשתמש (p_effect null = איפוס לברירת התפקיד).
create or replace function admin_set_user_permission(
  p_user_id uuid,
  p_resource text,
  p_action text,
  p_effect text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_permission_id uuid;
begin
  if not has_permission('users', 'manage') then
    raise exception 'permission denied';
  end if;

  select id into v_permission_id from permissions where resource = p_resource and action = p_action;
  if v_permission_id is null then
    raise exception 'unknown permission: %/%', p_resource, p_action;
  end if;

  if p_effect is null then
    delete from user_permissions where user_id = p_user_id and permission_id = v_permission_id;
  else
    if p_effect not in ('grant', 'revoke') then
      raise exception 'invalid effect: %', p_effect;
    end if;
    insert into user_permissions (user_id, permission_id, effect)
    values (p_user_id, v_permission_id, p_effect)
    on conflict (user_id, permission_id) do update set effect = excluded.effect;
  end if;

  perform insert_audit_event(
    'set_user_permission', 'users', p_user_id::text,
    jsonb_build_object('resource', p_resource, 'action', p_action, 'effect', p_effect)
  );
end;
$$;

grant execute on function admin_set_user_permission(uuid, text, text, text) to authenticated;
