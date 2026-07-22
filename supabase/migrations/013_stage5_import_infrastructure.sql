-- שלב 5: תשתית יבוא גנרית - profile → batch → staging rows → preview → commit.
-- זו תשתית בלבד: אין כאן עדיין טבלת יעד עסקית (זכאות/בנק/וכו') כי אלה עוד לא קיימות.
-- ה-commit בשלב הזה רק סוגר את האצווה עצמה; שלבים עתידיים (6, 11...) יוסיפו לוגיקת
-- commit ספציפית-דומיין שקוראת מ-import_rows וכותבת לטבלת היעד שלהם.

create table import_profiles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label_he text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger import_profiles_set_updated_at
  before update on import_profiles
  for each row execute function set_updated_at();

insert into import_profiles (key, label_he, description) values
  ('generic_csv_xlsx', 'זיהוי אוטומטי מכותרות (CSV/XLSX)', 'פרופיל כללי: כל עמודה בקובץ הופכת לשדה גולמי לפי שם הכותרת שלה. פרופילים ייעודיים לדוחות ספציפיים (זכאות, שגויים, תנועות בנק) יתווספו יחד עם השלבים שצורכים אותם.');

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references import_profiles(id),
  organization_id uuid references organizations(id),
  period_month date,
  file_path text not null,
  file_name text not null,
  file_hash text not null,
  row_count integer not null default 0,
  valid_count integer not null default 0,
  needs_decision_count integer not null default 0,
  invalid_count integer not null default 0,
  status text not null default 'uploaded' check (status in ('uploaded', 'analyzed', 'previewed', 'committed', 'rejected')),
  uploaded_by uuid references auth.users(id),
  rejected_reason text,
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  committed_at timestamptz,
  -- מונע יבוא כפול: אותו קובץ בדיוק (לפי תוכן, לא שם) לא יתקבל פעמיים.
  unique (file_hash)
);

create trigger import_batches_set_updated_at
  before update on import_batches
  for each row execute function set_updated_at();

create index import_batches_profile_idx on import_batches (profile_id);
create index import_batches_org_idx on import_batches (organization_id);

create table import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references import_batches(id) on delete cascade,
  row_number integer not null,
  -- raw: הערכים בדיוק כפי שהופיעו בקובץ (מפתח = כותרת עמודה). normalized: אחרי נרמול
  -- (trim, נרמול טלפון/תאריך וכו') - נשמרים שניהם, לעולם לא דורסים את המקור.
  raw jsonb not null,
  normalized jsonb,
  status text not null default 'valid' check (status in ('valid', 'needs_decision', 'invalid', 'committed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger import_rows_set_updated_at
  before update on import_rows
  for each row execute function set_updated_at();

create index import_rows_batch_idx on import_rows (batch_id);
create index import_rows_status_idx on import_rows (batch_id, status);

-- הרשאות: import.perform לכל מי שמייבא קבצים בפועל; import_profiles.manage למנהל בלבד.
insert into permissions (resource, action, label_he) values
  ('import', 'perform', 'יבוא קבצים (יצירה, Preview ואישור אצווה)'),
  ('import_profiles', 'manage', 'ניהול פרופילי יבוא');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'import' and p.action = 'perform'
where r.key in ('system_admin', 'operations_manager', 'finance_controller');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'import_profiles' and p.action = 'manage'
where r.key = 'system_admin';

-- guard: כמו students.status ו-groups.group_leader_id - RLS לא יכולה להגביל עמודה בודדת,
-- אז import_batches_update (014) מתירה עדכון כל שדה (row_count וכו' תוך כדי ניתוח בצד
-- לקוח), אבל מעבר ל-status='committed' חייב לעבור דרך commit_import_batch() כדי לוודא
-- שאין שורות needs_decision/invalid שלא טופלו לפני הסגירה.
create or replace function enforce_import_batch_commit()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'committed' and old.status is distinct from 'committed'
     and coalesce(current_setting('app.allow_batch_commit', true), '') <> 'true' then
    raise exception 'סגירת אצווה מותרת רק דרך commit_import_batch()';
  end if;
  return new;
end;
$$;

create trigger import_batches_enforce_commit
  before update on import_batches
  for each row execute function enforce_import_batch_commit();

-- commit_import_batch(): בודקת שאין שורות needs_decision פתוחות (טרם הוכרעו), מסמנת את
-- כל השורות התקינות כ-committed ואת האצווה כ-committed. אינה כותבת לשום טבלת יעד עסקית -
-- זה עדיין לא קיים בשלב הזה (ר' הערת הפתיחה של הקובץ). שימו לב: invalid לא חוסם סגירה -
-- שורה שגויה (למשל ריקה) פשוט נשארת מחוץ לאצווה הסגורה; חסימה גם עליה הייתה תוקעת
-- אצווה לצמיתות בלי אפשרות לסיים איתה.
create or replace function commit_import_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open_rows integer;
begin
  if not has_permission('import', 'perform') then
    raise exception 'permission denied';
  end if;

  select count(*) into v_open_rows
  from import_rows
  where batch_id = p_batch_id and status = 'needs_decision';

  if v_open_rows > 0 then
    raise exception 'לא ניתן לסגור אצווה עם % שורות שטרם הוכרעו ("דורש החלטה")', v_open_rows;
  end if;

  update import_rows set status = 'committed' where batch_id = p_batch_id and status = 'valid';

  perform set_config('app.allow_batch_commit', 'true', true);
  update import_batches set status = 'committed', committed_at = now() where id = p_batch_id;

  perform insert_audit_event('commit_import_batch', 'import_batches', p_batch_id::text, null);
end;
$$;

grant execute on function commit_import_batch(uuid) to authenticated;

-- reject_import_batch(): ביטול אצווה לפני commit (למשל התגלה שהיא שגויה) - לא מוחקת,
-- רק מסמנת. מותר גם ישירות (לא רק ל-committed יש guard), אבל RPC נותן audit אחיד.
create or replace function reject_import_batch(p_batch_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('import', 'perform') then
    raise exception 'permission denied';
  end if;

  update import_batches set status = 'rejected', rejected_reason = p_reason where id = p_batch_id and status <> 'committed';

  perform insert_audit_event('reject_import_batch', 'import_batches', p_batch_id::text, jsonb_build_object('reason', p_reason));
end;
$$;

grant execute on function reject_import_batch(uuid, text) to authenticated;

create trigger import_batches_audit
  after insert or update on import_batches
  for each row execute function audit_table_change();
