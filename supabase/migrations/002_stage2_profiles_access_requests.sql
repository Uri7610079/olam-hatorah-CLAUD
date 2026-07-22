-- שלב 2: פרופילים, בקשות גישה, הרשאות חריגה למשתמש, וטריגר יצירה אוטומטית בהרשמה.

-- email מועתק פעם אחת מ-auth.users בהרשמה (ר' handle_new_user למטה) - אך ורק לתצוגה
-- במסך ניהול משתמשים. auth.users עצמה לא נגישה ללקוח דרך ה-Data API, ולכן אי אפשר
-- לשאוב ממנה email בזמן אמת בצד לקוח בלי לחשוף את הסכמה הפנימית של Auth.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'disabled')),
  role_id uuid references roles(id),
  default_area text check (default_area in ('ops', 'finance', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

create table access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message text,
  decision text check (decision in ('approved', 'rejected')),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger access_requests_set_updated_at
  before update on access_requests
  for each row execute function set_updated_at();

-- הרשאות חריגה פר-משתמש, מעבר לתפקיד: grant מוסיף הרשאה שאין בתפקיד, revoke שולל הרשאה שיש בתפקיד.
create table user_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  effect text not null check (effect in ('grant', 'revoke')),
  created_at timestamptz not null default now(),
  unique (user_id, permission_id)
);

-- יצירת profile + access_request אוטומטית עם כל הרשמה חדשה. לא ניתן לעקוף מצד הלקוח
-- (רץ כטריגר על auth.users, לא כקוד אפליקציה) - כך שאין דרך להירשם ולדלג על מצב "pending".
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, full_name, email)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.email);

  insert into access_requests (user_id, message)
  values (new.id, new.raw_user_meta_data ->> 'request_message');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
