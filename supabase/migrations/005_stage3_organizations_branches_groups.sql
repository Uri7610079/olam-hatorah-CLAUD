-- שלב 3: נתוני יסוד - עמותות, חשבונות עמותה, בעלי תפקידים, סניפים, ראשי קבוצות וקבוצות.
-- אלו טבלאות עסקיות אמיתיות (בשונה מטבלאות התשתית של שלב 2) - is_demo/demo_batch_id
-- על כל טבלה, לפי כללי הנתונים ב-ARCHITECTURE.md. אין balances, מס"ב או תנועות בשלב הזה.

create table organizations (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  org_number text,
  contact_phone text,
  contact_email text,
  contact_address text,
  status text not null default 'active' check (status in ('active', 'closed')),
  notes text,
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger organizations_set_updated_at
  before update on organizations
  for each row execute function set_updated_at();

-- יותר מחשבון אחד לאורך זמן לכל עמותה, כל אחד עם is_active נפרד. אין אכיפת "חשבון פעיל
-- יחיד" בשכבת ה-DB - זו החלטה עסקית פתוחה (ר' migrations/README או יומן ההחלטות),
-- מוצגת כאזהרה בממשק בלבד כשיש יותר מחשבון פעיל אחד לאותה עמותה.
create table organization_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  bank_name text,
  bank_branch_code text,
  account_number text,
  account_holder_name text,
  currency text not null default 'ILS',
  -- ייעודי ל-import_profiles שייבנה בשלב 5 - כרגע רק תווית טקסט חופשית, לא FK אמיתי.
  import_profile_label text,
  is_active boolean not null default true,
  opened_at date,
  closed_at date,
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger organization_bank_accounts_set_updated_at
  before update on organization_bank_accounts
  for each row execute function set_updated_at();

create table organization_officeholders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  full_name text not null,
  role_type text not null check (role_type in ('committee_member', 'signatory', 'audit_committee')),
  role_title text,
  id_number text,
  phone text,
  tenure_start date,
  tenure_end date,
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger organization_officeholders_set_updated_at
  before update on organization_officeholders
  for each row execute function set_updated_at();

create table branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  -- קוד תלמוד נשמר כמחרוזת כדי לשמר אפסים מובילים (למשל "00") - ר' כללי הנתונים ב-ARCHITECTURE.md.
  talmud_branch_code text not null,
  internal_name text not null,
  address text,
  responsible_person text,
  phone_system_id text,
  status text not null default 'active' check (status in ('active', 'closed')),
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  -- מניעת קוד כפול בתוך אותה עמותה בלבד - אין ייחודיות גלובלית (דרישה מפורשת באפיון).
  unique (organization_id, talmud_branch_code)
);

create trigger branches_set_updated_at
  before update on branches
  for each row execute function set_updated_at();

create table group_leaders (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger group_leaders_set_updated_at
  before update on group_leaders
  for each row execute function set_updated_at();

create table groups (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id) on delete restrict,
  group_leader_id uuid references group_leaders(id),
  name text not null,
  opened_at date,
  status text not null default 'active' check (status in ('active', 'closed')),
  -- ברירת מחדל להצגה בלבד - לא כלל חישוב עמלה סופי (זה מגיע בשלב 8).
  default_distribution_method text check (default_distribution_method in ('equal', 'fixed_amounts', 'percentages', 'manual')),
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger groups_set_updated_at
  before update on groups
  for each row execute function set_updated_at();

create index organization_bank_accounts_org_idx on organization_bank_accounts (organization_id);
create index organization_officeholders_org_idx on organization_officeholders (organization_id);
create index branches_org_idx on branches (organization_id);
create index groups_branch_idx on groups (branch_id);

-- מיסוך מספר חשבון בנק: פונקציה גנרית שתשמש שוב בשלבים הבאים (חשבונות תלמידים וכו').
create or replace function mask_account_number(raw text)
returns text
language sql
immutable
as $$
  select case
    when raw is null or length(raw) = 0 then null
    when length(raw) <= 4 then repeat('•', length(raw))
    else repeat('•', length(raw) - 4) || right(raw, 4)
  end;
$$;

-- view שמחזירה תמיד מספר חשבון ממוסך, ללא תלות בהרשאה - "ממוסך כברירת מחדל" באמת.
-- רצה כ-owner (לא security_invoker) בכוונה: ה-select policy על הטבלה הבסיסית מחייבת
-- עכשיו bank_accounts.view_sensitive (ר' 006, תוקן בשלב 16) - אילו ה-view עדיין רצתה
-- כ-invoker, מי שאין לו view_sensitive לא היה רואה אף שורה דרכה בכלל, גם לא ממוסכת.
-- לכן ה-view משכפלת כאן במפורש את כלל הראייה המקורי (area_ops/area_finance) בתוך
-- ה-WHERE שלה עצמה, במקום להסתמך על RLS של הטבלה - זו הסיבה שמותר לה לרוץ כ-owner בלי
-- לדלוף שורות: אין הבדל בין הרשאת השורה שה-RLS הייתה אוכפת לבין מה שכתוב כאן במפורש.
create view organization_bank_accounts_view
as
select
  id,
  organization_id,
  bank_name,
  bank_branch_code,
  mask_account_number(account_number) as account_number_masked,
  account_holder_name,
  currency,
  import_profile_label,
  is_active,
  opened_at,
  closed_at,
  is_demo,
  demo_batch_id,
  created_at,
  updated_at
from organization_bank_accounts
where has_permission('area_ops', 'access') or has_permission('area_finance', 'access');

grant select on organization_bank_accounts_view to authenticated;

-- endpoint ייעודי לחשיפת הערך המלא - הדרך היחידה לקבל את המספר האמיתי. נבדק בהרשאה
-- ונרשם ביומן פעילות בכל פעם (לא רק בשינוי - גם צפייה בנתון רגיש נחשבת אירוע לתיעוד).
create or replace function reveal_bank_account_number(p_account_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_value text;
begin
  if not has_permission('bank_accounts', 'view_sensitive') then
    raise exception 'permission denied';
  end if;

  select account_number into v_value from organization_bank_accounts where id = p_account_id;

  perform insert_audit_event('reveal_bank_account_number', 'organization_bank_accounts', p_account_id::text, null);

  return v_value;
end;
$$;

grant execute on function reveal_bank_account_number(uuid) to authenticated;

-- הרשאות חדשות לשלב 3, לפי ההערה שהושארה במיגרציית ההרשאות של שלב 2.
insert into permissions (resource, action, label_he) values
  ('organizations', 'manage', 'יצירה/עריכה/סגירה של עמותות'),
  ('branches', 'manage', 'יצירה/עריכה/סגירה של סניפים'),
  ('groups', 'manage', 'יצירה/עריכה/סגירה של קבוצות');

-- system_admin ו-operations_manager עורכים; שאר התפקידים נשארים בקריאה בלבד דרך גישת
-- area_ops/area_finance הקיימת (RLS SELECT), בלי הרשאת manage. הנחת עבודה סבירה לפי
-- הגדרות התפקידים משלב 2 - לא "כלל עסקי" מהרשימה האסורה לקיבוע.
insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.resource in ('organizations', 'branches', 'groups') and p.action = 'manage'
where r.key in ('system_admin', 'operations_manager');
