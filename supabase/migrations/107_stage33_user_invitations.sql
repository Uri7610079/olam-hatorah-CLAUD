-- הוספת משתמש עם הרשאות ישירות ממסך הניהול
--
-- מה שאי אפשר לעשות, ולמה: יצירת משתמש ב-Supabase Auth מחייבת מפתח
-- service_role. מפתח כזה עוקף את כל ה-RLS במערכת, ואם הוא יגיע לדפדפן -
-- ולו לרגע - כל אדם שפותח את כלי הפיתוח מקבל גישה מלאה לכל הנתונים.
-- לכן אין ולא תהיה יצירת משתמש ישירות מהמסך, וגם לא הגדרת סיסמה עבור
-- אדם אחר: סיסמה שמנהל קובע היא סיסמה ששניים מכירים.
--
-- מה שכן, ופותר את אותו צורך: הזמנה מאושרת מראש. המנהל קובע כאן את
-- האימייל, התפקיד ואזור ברירת המחדל. כשאותו אדם נרשם בעצמו, הוא נכנס
-- כשהוא כבר מאושר ועם התפקיד שהוקצה לו - בלי לעבור במצב "ממתין" ובלי
-- שהמנהל יצטרך לחזור למסך ולאשר.
--
-- מבחינת המנהל זו בדיוק החוויה שהתבקשה: ממלאים פרטים במסך, והמשתמש
-- קיים עם ההרשאות שנקבעו. ההבדל היחיד הוא שהאדם עצמו בוחר את סיסמתו.

create table if not exists user_invitations (
  id uuid primary key default gen_random_uuid(),
  -- נשמר בנורמליזציה, כי אימייל אינו רגיש-רישיות והמנהל עלול להקליד
  -- אותו אחרת ממה שהנרשם יקליד. בלי זה ההזמנה פשוט לא תימצא.
  email text not null,
  role_id uuid not null references roles(id),
  default_area text check (default_area in ('ops', 'finance', 'admin')),
  note text,
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_user_id uuid references auth.users(id),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id)
);

-- הזמנה פתוחה אחת לכל אימייל. הזמנות שמומשו או בוטלו נשמרות להיסטוריה
-- ואינן חוסמות הזמנה חדשה.
create unique index if not exists user_invitations_open_email_idx
  on user_invitations (lower(email))
  where accepted_at is null and revoked_at is null;

alter table user_invitations enable row level security;

drop policy if exists user_invitations_select on user_invitations;
create policy user_invitations_select on user_invitations for select to authenticated
  using ((select has_permission('users', 'manage')));

-- כתיבה אך ורק דרך ה-RPC: הן בודקות הרשאה, מנרמלות את האימייל ומתעדות
-- ביומן. גישה ישירה הייתה עוקפת את שלושתם.
drop policy if exists user_invitations_write on user_invitations;
create policy user_invitations_write on user_invitations for all to authenticated
  using (false) with check (false);

-- ===== יצירת הזמנה =====

create or replace function admin_invite_user(
  p_email text,
  p_role_key text,
  p_default_area text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_role_id uuid;
  v_id uuid;
begin
  if not has_permission('users', 'manage') then
    raise exception 'permission denied';
  end if;

  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email = '' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'כתובת אימייל אינה תקינה';
  end if;

  select id into v_role_id from roles where key = p_role_key;
  if v_role_id is null then
    raise exception 'תפקיד לא מוכר: %', p_role_key;
  end if;

  -- אימייל שכבר יש לו משתמש במערכת: ההזמנה לא תעשה דבר, כי היא נצרכת
  -- רק בהרשמה. עדיף לומר זאת מאשר ליצור הזמנה שלא תמומש לעולם.
  if exists (select 1 from profiles where lower(email) = v_email) then
    raise exception 'קיים כבר משתמש עם האימייל הזה. יש לשנות לו תפקיד ברשימה במקום להזמין מחדש.';
  end if;

  if exists (
    select 1 from user_invitations
    where lower(email) = v_email and accepted_at is null and revoked_at is null
  ) then
    raise exception 'קיימת כבר הזמנה פתוחה לאימייל הזה';
  end if;

  insert into user_invitations (email, role_id, default_area, note, invited_by)
  values (v_email, v_role_id, p_default_area, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;

  perform insert_audit_event(
    'admin_invite_user', 'user_invitations', v_id::text,
    jsonb_build_object('email', v_email, 'role', p_role_key, 'default_area', p_default_area)
  );

  return v_id;
end;
$$;

revoke execute on function admin_invite_user(text, text, text, text) from public, anon;
grant execute on function admin_invite_user(text, text, text, text) to authenticated;

-- ===== ביטול הזמנה =====

create or replace function admin_revoke_invitation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('users', 'manage') then
    raise exception 'permission denied';
  end if;

  update user_invitations
  set revoked_at = now(), revoked_by = auth.uid()
  where id = p_id and accepted_at is null and revoked_at is null;

  if not found then
    raise exception 'ההזמנה אינה קיימת, כבר מומשה או כבר בוטלה';
  end if;

  perform insert_audit_event('admin_revoke_invitation', 'user_invitations', p_id::text, '{}'::jsonb);
end;
$$;

revoke execute on function admin_revoke_invitation(uuid) from public, anon;
grant execute on function admin_revoke_invitation(uuid) to authenticated;

-- ===== מימוש ההזמנה בהרשמה =====
--
-- זהה ל-002, למעט בדיקת ההזמנה. הטריגר רץ על auth.users ולכן אי אפשר
-- לעקוף אותו מצד הלקוח - מי שנרשם בלי הזמנה עדיין נכנס כ"ממתין", בדיוק
-- כמו קודם.

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv user_invitations;
begin
  select * into v_inv
  from user_invitations
  where lower(email) = lower(new.email)
    and accepted_at is null and revoked_at is null
  limit 1;

  if v_inv.id is not null then
    insert into profiles (id, full_name, email, status, role_id, default_area)
    values (new.id, new.raw_user_meta_data ->> 'full_name', new.email,
            'approved', v_inv.role_id, v_inv.default_area);

    update user_invitations
    set accepted_at = now(), accepted_user_id = new.id
    where id = v_inv.id;

    -- הבקשה נרשמת כמאושרת ולא מדולגת, כדי שההיסטוריה תישאר רציפה:
    -- לכל משתמש יש שורת בקשה, גם כשההכרעה נעשתה מראש.
    insert into access_requests (user_id, message, decision, decided_by, decided_at)
    values (new.id, new.raw_user_meta_data ->> 'request_message',
            'approved', v_inv.invited_by, now());
  else
    insert into profiles (id, full_name, email)
    values (new.id, new.raw_user_meta_data ->> 'full_name', new.email);

    insert into access_requests (user_id, message)
    values (new.id, new.raw_user_meta_data ->> 'request_message');
  end if;

  return new;
end;
$$;
