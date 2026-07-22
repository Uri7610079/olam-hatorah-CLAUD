-- שלב 2: תשתית תפקידים והרשאות (roles, permissions, role_permissions).
-- אלו טבלאות תשתית/lookup קבועות, לא טבלאות עסקיות - אין להן is_demo/demo_batch_id
-- (ר' כללי הנתונים ב-ARCHITECTURE.md; is_demo חל על נתונים עסקיים שיובאו/יימחקו כדמו).

create extension if not exists pgcrypto;

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label_he text not null,
  created_at timestamptz not null default now()
);

create table permissions (
  id uuid primary key default gen_random_uuid(),
  resource text not null,
  action text not null,
  label_he text not null,
  created_at timestamptz not null default now(),
  unique (resource, action)
);

create table role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references roles(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (role_id, permission_id)
);

-- ששת התפקידים ההתחלתיים מהתוכנית (שלב 2).
insert into roles (key, label_he) values
  ('system_admin', 'מנהל מערכת'),
  ('operations_manager', 'מנהל תפעול'),
  ('finance_controller', 'כספים ובקרה'),
  ('office_staff', 'עובד משרד'),
  ('accountant_readonly', 'מנהלת חשבונות'),
  ('viewer', 'צופה');

-- קטלוג הרשאות: גישה ברמת אזור + פעולות רגישות ספציפיות שהאפיון מזכיר במפורש
-- (פרטי בנק, יבוא בנק, סיווג, התאמה, חלוקה, מס"ב, פתיחת חודש, יצוא, ניהול משתמשים, audit).
-- הרשאות CRUD פר-טבלה עסקית (תלמידים, עמותות וכו') יתווספו איתן משלב 3 ואילך - אין להמציא אותן עכשיו.
insert into permissions (resource, action, label_he) values
  ('area_ops', 'access', 'גישה לאזור תפעול שוטף'),
  ('area_finance', 'access', 'גישה לאזור כספים ובקרה'),
  ('area_admin', 'access', 'גישה לאזור ניהול'),
  ('bank_accounts', 'view_sensitive', 'צפייה בפרטי בנק רגישים'),
  ('bank_import', 'perform', 'יבוא תנועות בנק'),
  ('transaction_classification', 'perform', 'סיווג תנועות בנק'),
  ('bank_matching', 'perform', 'ביצוע התאמות בנק'),
  ('distributions', 'approve', 'אישור הוראות חלוקה'),
  ('masav', 'approve', 'אישור מס"ב'),
  ('financial_months', 'open_close', 'פתיחה/סגירה של חודש כספי'),
  ('exports', 'perform', 'ביצוע יצוא נתונים'),
  ('users', 'manage', 'ניהול משתמשים והרשאות'),
  ('audit', 'view', 'צפייה ביומן פעילות');

-- הרשאות ברירת מחדל לכל תפקיד. system_admin = הכל. שאר התפקידים לפי חלוקת האזורים באפיון
-- (משה/תפעול לא רואה כספים; אורי/כספים נכנס ישירות לאזור כספים ובקרה).
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p where r.key = 'system_admin';

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'area_ops' and p.action = 'access'
where r.key in ('operations_manager', 'office_staff', 'viewer');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'area_finance' and p.action = 'access'
where r.key in ('finance_controller', 'accountant_readonly', 'viewer');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p
  on p.resource in (
    'bank_accounts', 'bank_import', 'transaction_classification', 'bank_matching',
    'distributions', 'masav', 'financial_months', 'exports'
  )
where r.key = 'finance_controller';
