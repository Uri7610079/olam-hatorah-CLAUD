-- שלב 11 (חלק א'): טבלאות בסיס למודול הבנק - סוגי תנועה (13 בדיוק לפי נספח האפיון, בלי
-- השמטה - אותו עיקרון כמו study_codes בשלב 5), פרופילי יבוא בנקאיים (configurable לפי
-- בנק, לא ממציא פורמט - פרופיל גנרי יחיד עד קבלת דוגמת קובץ אמיתית מכל בנק), ומדיניות
-- אוטומציה (כבויה כברירת מחדל - ר' הערה ב-036 למה היא לא נקראת בפועל בשלב הזה).

create table bank_transaction_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label_he text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger bank_transaction_types_set_updated_at
  before update on bank_transaction_types
  for each row execute function set_updated_at();

insert into bank_transaction_types (code, label_he) values
  ('government_support', 'תמיכה ממשלתית'),
  ('masav', 'מס"ב'),
  ('donation', 'תרומה'),
  ('bank_fee', 'עמלת בנק'),
  ('masav_fee', 'עמלת מס"ב'),
  ('payment_return', 'החזר תשלום'),
  ('inter_account_transfer', 'העברה בין חשבונות'),
  ('supplier', 'ספק'),
  ('loan_interest', 'הלוואה/ריבית'),
  ('forex', 'מט"ח'),
  ('withdrawal', 'משיכה'),
  ('other_income_expense', 'הכנסה/הוצאה אחרת'),
  ('not_identified', 'לא מזוהה');

alter table bank_transaction_types enable row level security;

create policy bank_transaction_types_select on bank_transaction_types for select to authenticated
  using (has_permission('area_finance', 'access') or has_permission('area_ops', 'access'));

create policy bank_transaction_types_insert on bank_transaction_types for insert to authenticated
  with check (has_permission('transaction_classification', 'perform'));

create policy bank_transaction_types_update on bank_transaction_types for update to authenticated
  using (has_permission('transaction_classification', 'perform'))
  with check (has_permission('transaction_classification', 'perform'));

create trigger bank_transaction_types_audit
  after insert or update on bank_transaction_types
  for each row execute function audit_table_change();

-- bank_import_profiles: פרופיל לפי בנק/פורמט - configurable, לא טבלה קבועה. פרופיל אחד
-- גנרי בלבד כרגע - כל בנק ספציפי יתווסף כשורה חדשה (לא שינוי סכמה) ברגע שתתקבל דוגמת
-- קובץ אמיתית ממנו, אותו עיקרון בדיוק כמו "פורמט שידור סופי טרם אושר" בשלב 10.
create table bank_import_profiles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  bank_name text,
  label_he text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger bank_import_profiles_set_updated_at
  before update on bank_import_profiles
  for each row execute function set_updated_at();

insert into bank_import_profiles (key, label_he, description) values
  ('bank_generic', 'בנק - פורמט כללי (טרם אושר לבנק ספציפי)', 'זיהוי אוטומטי מכותרות, כמו הפרופיל הגנרי משלב 5. פרופילים ייעודיים לבנקים ספציפיים יתווספו כשורות נוספות ברגע שתתקבל דוגמת קובץ אמיתית מכל בנק - לא מומצא כאן פורמט שלא אושר.');

alter table bank_import_profiles enable row level security;

create policy bank_import_profiles_select on bank_import_profiles for select to authenticated
  using (has_permission('area_finance', 'access') or has_permission('area_ops', 'access'));

create policy bank_import_profiles_insert on bank_import_profiles for insert to authenticated
  with check (has_permission('bank_import', 'perform'));

create policy bank_import_profiles_update on bank_import_profiles for update to authenticated
  using (has_permission('bank_import', 'perform'))
  with check (has_permission('bank_import', 'perform'));

create trigger bank_import_profiles_audit
  after insert or update on bank_import_profiles
  for each row execute function audit_table_change();

-- automation_policies: התאמה אוטומטית כבויה כברירת מחדל - קיימת כתשתית configurable
-- לעתיד, אבל שום RPC בשלב הזה לא קורא את הערך שלה בפועל (ר' הערה מפורטת ב-036,
-- suggest_transaction_types) - מנוע ההצעות תמיד רק מציע, לעולם לא מאשר לבד, בלי תלות
-- במדיניות הזו. זה מכוון: "אין להתאים אוטומטית" הוא ברירת המחדל הבטוחה, לא רק ערך שדה.
create table automation_policies (
  id uuid primary key default gen_random_uuid(),
  organization_bank_account_id uuid references organization_bank_accounts(id),
  policy_key text not null default 'auto_classify_transactions',
  is_enabled boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (organization_bank_account_id, policy_key)
);

create trigger automation_policies_set_updated_at
  before update on automation_policies
  for each row execute function set_updated_at();

alter table automation_policies enable row level security;

create policy automation_policies_select on automation_policies for select to authenticated
  using (has_permission('area_finance', 'access') or has_permission('area_ops', 'access'));

create policy automation_policies_insert on automation_policies for insert to authenticated
  with check (has_permission('transaction_classification', 'perform'));

create policy automation_policies_update on automation_policies for update to authenticated
  using (has_permission('transaction_classification', 'perform'))
  with check (has_permission('transaction_classification', 'perform'));

create trigger automation_policies_audit
  after insert or update on automation_policies
  for each row execute function audit_table_change();
