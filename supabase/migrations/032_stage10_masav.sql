-- שלב 10 (חלק א'): מס"ב עד נקודת השידור - בלי להמציא פורמט טכני שלא התקבל. אצוות מס"ב
-- מרכזות את כל הוראות החלוקה שכבר "נעולות להכנת מס"ב" (שלב 9) לאותה עמותה/חודש לכדי
-- קובץ תשלום אחד. אין כאן שידור אמיתי לבנק - generate/transmit הם סימונים ידניים
-- בלבד (ר' הערות ב-mark_masav_transmitted למטה), ויצוא הקובץ עצמו הוא CSV/XLSX מתויג
-- בבירור כטיוטה, לא פורמט מס"ב רשמי (ר' export_profiles וה-UI).
--
-- masav_lines/masav_batches: אין להן שום INSERT/UPDATE policy ללקוח - זו מכונת מצבים
-- מלאה שרק ה-RPCs הייעודיים למטה מפעילים אותה, בלי אפשרות עקיפה ישירה (אותו עיקרון
-- כמו group_ledger_entries/eligibility_financial_results בשלב 8, רק מוחל כאן על שתי
-- הטבלאות כי כל המהלך רגיש יותר - זו נקודת השידור בפועל).
--
-- החלטה פתוחה מתועדת (לא מומצאת): בדיקת "סכום חריג" מהאפיון (אחד מ-4 החסימות)
-- אינה מיושמת - אין סף כספי מאושר להגדרת "חריג", ואסור להמציא אחד. שלוש הבדיקות
-- האחרות (כפילות, חשבון חסר/לא מאומת, יתרה לא מספיקה) כן נאכפות ב-run_masav_validation.

create table export_profiles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label_he text not null,
  description text,
  created_at timestamptz not null default now()
);

insert into export_profiles (key, label_he, description) values
  ('masav_demo_csv', 'ייצוא דמו/בדיקה למס"ב', 'פורמט זמני לבדיקה/דמו בלבד - טרם אושר מול הבנק/מס"ב בפועל. אין להשתמש בקובץ הזה לשידור אמיתי.');

alter table export_profiles enable row level security;

create policy export_profiles_select on export_profiles for select to authenticated
  using (has_permission('area_finance', 'access') or has_permission('area_ops', 'access'));

create table masav_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  organization_bank_account_id uuid not null references organization_bank_accounts(id),
  period_month date not null,
  -- מכונת מצבים מלאה לפי האפיון: טיוטה -> ממתין לבדיקה -> ממתין לאישור -> מאושר ->
  -- קובץ הופק -> שודר -> בוצע בבנק. דורש תיקון/בוטל נגישים מרוב השלבים המוקדמים.
  status text not null default 'draft' check (status in (
    'draft', 'pending_review', 'pending_approval', 'approved',
    'file_generated', 'transmitted', 'bank_completed', 'needs_correction', 'cancelled'
  )),
  -- נגזר משורות (masav_lines בסטטוס valid) בכל שלב רלוונטי - לא ערך שרירותי. "חייב
  -- להתאים" באפיון = בדיוק בגלל זה מחושב מחדש בכל run_masav_validation/create.
  total_amount numeric(12, 2) not null default 0,
  payment_count integer not null default 0,
  reference text,
  prepared_at timestamptz,
  prepared_by uuid references auth.users(id),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  transmitted_at timestamptz,
  transmitted_by uuid references auth.users(id),
  status_reason text,
  notes text,
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references auth.users(id)
);

create trigger masav_batches_set_updated_at
  before update on masav_batches
  for each row execute function set_updated_at();

create index masav_batches_org_month_idx on masav_batches (organization_id, period_month);

create table masav_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references masav_batches(id),
  student_id uuid not null references students(id),
  group_id uuid not null references groups(id),
  student_bank_account_id uuid references student_bank_accounts(id),
  amount numeric(12, 2) not null check (amount > 0),
  source_distribution_batch_id uuid references distribution_batches(id),
  status text not null default 'pending' check (status in ('pending', 'valid', 'rejected', 'returned')),
  rejection_code text,
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger masav_lines_set_updated_at
  before update on masav_lines
  for each row execute function set_updated_at();

create index masav_lines_batch_idx on masav_lines (batch_id);
create index masav_lines_student_idx on masav_lines (student_id);

alter table masav_batches enable row level security;
alter table masav_lines enable row level security;

-- masav.approve כבר קיים משלב 2 (001) - finance_controller בלבד + system_admin, אותה
-- הכרעה מכוונת כמו distributions.approve. מוסיף כאן רק masav.manage (הכנה/בדיקה/הגשה,
-- לא אישור סופי) ברמה שכבר ניתנה לתפקידים המקבילים בשלבים 7-9.
insert into permissions (resource, action, label_he) values
  ('masav', 'manage', 'הכנה, בדיקה והגשה לאישור של אצוות מס"ב');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'masav' and p.action = 'manage'
where r.key in ('system_admin', 'operations_manager', 'finance_controller');

create policy masav_batches_select on masav_batches for select to authenticated
  using (has_permission('area_finance', 'access') or has_permission('area_ops', 'access'));

create policy masav_lines_select on masav_lines for select to authenticated
  using (has_permission('area_finance', 'access') or has_permission('area_ops', 'access'));

-- בכוונה: אין אף policy ל-INSERT/UPDATE על masav_batches/masav_lines. זו נקודת השידור
-- בפועל - כל כתיבה, כולל עדכון שדה בודד, עוברת רק דרך RPC ייעודי שבודק הרשאה+מצב.

create trigger masav_batches_audit
  after insert or update on masav_batches
  for each row execute function audit_table_change();

create trigger masav_lines_audit
  after insert or update on masav_lines
  for each row execute function audit_table_change();

-- create_masav_batch(): מרכזת את כל distribution_batches הנעולות (locked_for_masav)
-- לאותה עמותה/חודש שעוד לא נכללו באצוות מס"ב פעילה (לא מבוטלת) אחרת - כדי שאותה
-- הוראת חלוקה לא תיכלל פעמיים בטעות בשתי הרצות מס"ב שונות.
create or replace function create_masav_batch(p_organization_id uuid, p_organization_bank_account_id uuid, p_period_month date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_count integer;
begin
  if not has_permission('masav', 'manage') then
    raise exception 'permission denied';
  end if;

  insert into masav_batches (organization_id, organization_bank_account_id, period_month, prepared_at, prepared_by, created_by)
  values (p_organization_id, p_organization_bank_account_id, p_period_month, now(), auth.uid(), auth.uid())
  returning id into v_batch_id;

  insert into masav_lines (batch_id, student_id, group_id, student_bank_account_id, amount, source_distribution_batch_id)
  select
    v_batch_id,
    dl.student_id,
    db.group_id,
    (select sba.id from student_bank_accounts sba
     where sba.student_id = dl.student_id and sba.is_active = true and sba.verification_status = 'verified'
     limit 1),
    dl.amount,
    db.id
  from distribution_batches db
  join distribution_lines dl on dl.batch_id = db.id
  where db.organization_id = p_organization_id
    and db.period_month = p_period_month
    and db.status = 'locked_for_masav'
    and not exists (
      select 1 from masav_lines ml
      join masav_batches mb on mb.id = ml.batch_id
      where ml.source_distribution_batch_id = db.id and mb.status <> 'cancelled'
    );

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'אין הוראות חלוקה נעולות וזמינות להכנת מס"ב עבור עמותה/חודש אלה';
  end if;

  update masav_batches
  set total_amount = (select coalesce(sum(amount), 0) from masav_lines where batch_id = v_batch_id),
      payment_count = (select count(*) from masav_lines where batch_id = v_batch_id)
  where id = v_batch_id;

  perform insert_audit_event('create_masav_batch', 'masav_batches', v_batch_id::text, jsonb_build_object('organization_id', p_organization_id, 'month', p_period_month));

  return v_batch_id;
end;
$$;

grant execute on function create_masav_batch(uuid, uuid, date) to authenticated;

create or replace function submit_masav_for_review(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not has_permission('masav', 'manage') then
    raise exception 'permission denied';
  end if;

  select status into v_status from masav_batches where id = p_batch_id;
  if v_status is null then
    raise exception 'אצוות מס"ב לא נמצאה';
  end if;
  if v_status <> 'draft' then
    raise exception 'ניתן להגיש לבדיקה רק אצווה בטיוטה (סטטוס נוכחי: %)', v_status;
  end if;

  update masav_batches set status = 'pending_review' where id = p_batch_id;

  perform insert_audit_event('submit_masav_for_review', 'masav_batches', p_batch_id::text, null);
end;
$$;

grant execute on function submit_masav_for_review(uuid) to authenticated;

-- run_masav_validation(): כל הרצה מתחילה מ"הכול תקין" ובודקת מחדש (לא מצטברת) - כדי
-- שהרצה חוזרת אחרי תיקון (למשל אימות חשבון בנק) תשקף נכון את המצב העדכני. שלוש
-- בדיקות set-based (לא לולאה - נמנע מהבאג של משתנה שנשאר "תקוע" מאיטרציה קודמת,
-- כמו שתוקן בשלב 8/9): חשבון חסר/לא מאומת, כפילות תלמיד באותה אצווה, יתרת קבוצה
-- לא מספיקה (נבדקת מחדש נגד group_balances בפועל - ייתכן שהשתנתה מאז נעילת החלוקה).
create or replace function run_masav_validation(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not has_permission('masav', 'manage') then
    raise exception 'permission denied';
  end if;

  select status into v_status from masav_batches where id = p_batch_id;
  if v_status is null then
    raise exception 'אצוות מס"ב לא נמצאה';
  end if;
  if v_status <> 'pending_review' then
    raise exception 'ניתן להריץ בדיקה רק על אצווה הממתינה לבדיקה (סטטוס נוכחי: %)', v_status;
  end if;

  update masav_lines set status = 'valid', rejection_code = null where batch_id = p_batch_id;

  update masav_lines
  set status = 'rejected', rejection_code = 'חשבון חסר או לא מאומת'
  where batch_id = p_batch_id
    and (student_bank_account_id is null or not exists (
      select 1 from student_bank_accounts sba
      where sba.id = masav_lines.student_bank_account_id and sba.is_active = true and sba.verification_status = 'verified'
    ));

  update masav_lines
  set status = 'rejected', rejection_code = coalesce(rejection_code || '; ', '') || 'כפילות - אותו תלמיד מופיע כמה פעמים באצווה'
  where batch_id = p_batch_id
    and student_id in (
      select student_id from masav_lines where batch_id = p_batch_id group by student_id having count(*) > 1
    );

  update masav_lines ml
  set status = 'rejected', rejection_code = coalesce(ml.rejection_code || '; ', '') || 'יתרת קבוצה לא מספיקה'
  from (
    select ml2.group_id
    from masav_lines ml2
    join group_balances gb on gb.group_id = ml2.group_id
    where ml2.batch_id = p_batch_id and ml2.status = 'valid'
    group by ml2.group_id, gb.balance
    having sum(ml2.amount) > gb.balance
  ) bad_groups
  where ml.batch_id = p_batch_id and ml.group_id = bad_groups.group_id and ml.status = 'valid';

  update masav_batches
  set reviewed_at = now(), reviewed_by = auth.uid(),
      total_amount = (select coalesce(sum(amount), 0) from masav_lines where batch_id = p_batch_id and status = 'valid'),
      payment_count = (select count(*) from masav_lines where batch_id = p_batch_id and status = 'valid')
  where id = p_batch_id;

  perform insert_audit_event('run_masav_validation', 'masav_batches', p_batch_id::text, null);
end;
$$;

grant execute on function run_masav_validation(uuid) to authenticated;

create or replace function submit_masav_for_approval(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch masav_batches;
  v_valid_count integer;
begin
  if not has_permission('masav', 'manage') then
    raise exception 'permission denied';
  end if;

  select * into v_batch from masav_batches where id = p_batch_id;
  if v_batch.id is null then
    raise exception 'אצוות מס"ב לא נמצאה';
  end if;
  if v_batch.status <> 'pending_review' then
    raise exception 'ניתן להגיש לאישור רק אצווה בבדיקה (סטטוס נוכחי: %)', v_batch.status;
  end if;
  if v_batch.reviewed_at is null then
    raise exception 'יש להריץ בדיקה לפני הגשה לאישור';
  end if;

  select count(*) into v_valid_count from masav_lines where batch_id = p_batch_id and status = 'valid';
  if v_valid_count = 0 then
    raise exception 'אין שורות תקינות להגשה לאישור';
  end if;

  update masav_batches set status = 'pending_approval' where id = p_batch_id;

  perform insert_audit_event('submit_masav_for_approval', 'masav_batches', p_batch_id::text, null);
end;
$$;

grant execute on function submit_masav_for_approval(uuid) to authenticated;

create or replace function approve_masav_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not has_permission('masav', 'approve') then
    raise exception 'permission denied';
  end if;

  select status into v_status from masav_batches where id = p_batch_id;
  if v_status is null then
    raise exception 'אצוות מס"ב לא נמצאה';
  end if;
  if v_status <> 'pending_approval' then
    raise exception 'ניתן לאשר רק אצווה הממתינה לאישור (סטטוס נוכחי: %)', v_status;
  end if;

  update masav_batches set status = 'approved', approved_at = now(), approved_by = auth.uid() where id = p_batch_id;

  perform insert_audit_event('approve_masav_batch', 'masav_batches', p_batch_id::text, null);
end;
$$;

grant execute on function approve_masav_batch(uuid) to authenticated;

-- mark_masav_file_generated(): מסמנת שהקובץ (CSV/XLSX דמו, ר' ExportProfile) הופק
-- והורד בפועל בצד הלקוח - הפונקציה עצמה לא מייצרת/שולחת שום קובץ.
create or replace function mark_masav_file_generated(p_batch_id uuid, p_reference text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not has_permission('masav', 'approve') then
    raise exception 'permission denied';
  end if;

  select status into v_status from masav_batches where id = p_batch_id;
  if v_status is null then
    raise exception 'אצוות מס"ב לא נמצאה';
  end if;
  if v_status <> 'approved' then
    raise exception 'ניתן לסמן הפקת קובץ רק לאצווה מאושרת (סטטוס נוכחי: %)', v_status;
  end if;

  update masav_batches set status = 'file_generated', reference = coalesce(p_reference, reference) where id = p_batch_id;

  perform insert_audit_event('mark_masav_file_generated', 'masav_batches', p_batch_id::text, null);
end;
$$;

grant execute on function mark_masav_file_generated(uuid, text) to authenticated;

-- mark_masav_transmitted(): סימון ידני בלבד ("אל תיצור שליחה אוטומטית") - המשתמש
-- מעביר את הקובץ לבנק מחוץ למערכת, ואז מסמן כאן. זו הנקודה שבה הכסף "יוצא בפועל"
-- מבחינת ספר התנועות - עד עכשיו (שלבים 8-9) שום 'payment' לא פורסם, בדיוק לפי הכוונה
-- המתועדת שם. כל שורה valid מקבלת תנועת payment שלילית בקבוצה שלה.
create or replace function mark_masav_transmitted(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch masav_batches;
begin
  if not has_permission('masav', 'approve') then
    raise exception 'permission denied';
  end if;

  select * into v_batch from masav_batches where id = p_batch_id;
  if v_batch.id is null then
    raise exception 'אצוות מס"ב לא נמצאה';
  end if;
  if v_batch.status <> 'file_generated' then
    raise exception 'ניתן לסמן כמשודר רק אצווה שהופק לה קובץ (סטטוס נוכחי: %)', v_batch.status;
  end if;

  perform assert_financial_period_open(v_batch.organization_id, v_batch.period_month);

  insert into group_ledger_entries (organization_id, group_id, entry_type, amount, period_month, source_table, source_id, reference, created_by)
  select v_batch.organization_id, ml.group_id, 'payment', -ml.amount, v_batch.period_month, 'masav_lines', ml.id, v_batch.reference, auth.uid()
  from masav_lines ml
  where ml.batch_id = p_batch_id and ml.status = 'valid';

  update masav_batches set status = 'transmitted', transmitted_at = now(), transmitted_by = auth.uid() where id = p_batch_id;

  perform insert_audit_event('mark_masav_transmitted', 'masav_batches', p_batch_id::text, null);
end;
$$;

grant execute on function mark_masav_transmitted(uuid) to authenticated;

-- mark_masav_bank_completed(): אישור ידני שהבנק אכן ביצע - עד שיהיה feed בנקאי אמיתי
-- (שלב 11) זהו סימון בלבד, לא התאמה אוטומטית מול דוח בנק.
create or replace function mark_masav_bank_completed(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not has_permission('masav', 'approve') then
    raise exception 'permission denied';
  end if;

  select status into v_status from masav_batches where id = p_batch_id;
  if v_status is null then
    raise exception 'אצוות מס"ב לא נמצאה';
  end if;
  if v_status <> 'transmitted' then
    raise exception 'ניתן לסמן ביצוע בבנק רק לאצווה ששודרה (סטטוס נוכחי: %)', v_status;
  end if;

  update masav_batches set status = 'bank_completed' where id = p_batch_id;

  perform insert_audit_event('mark_masav_bank_completed', 'masav_batches', p_batch_id::text, null);
end;
$$;

grant execute on function mark_masav_bank_completed(uuid) to authenticated;

create or replace function cancel_masav_batch(p_batch_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not has_permission('masav', 'manage') then
    raise exception 'permission denied';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'נדרשת סיבה לביטול אצוות מס"ב';
  end if;

  select status into v_status from masav_batches where id = p_batch_id;
  if v_status is null then
    raise exception 'אצוות מס"ב לא נמצאה';
  end if;
  if v_status in ('transmitted', 'bank_completed', 'cancelled') then
    raise exception 'לא ניתן לבטל אצווה שכבר שודרה/הושלמה/בוטלה (סטטוס נוכחי: %)', v_status;
  end if;

  update masav_batches set status = 'cancelled', status_reason = p_reason where id = p_batch_id;

  perform insert_audit_event('cancel_masav_batch', 'masav_batches', p_batch_id::text, jsonb_build_object('reason', p_reason));
end;
$$;

grant execute on function cancel_masav_batch(uuid, text) to authenticated;

create or replace function request_masav_correction(p_batch_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not has_permission('masav', 'manage') then
    raise exception 'permission denied';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'נדרשת סיבה לדרישת תיקון';
  end if;

  select status into v_status from masav_batches where id = p_batch_id;
  if v_status is null then
    raise exception 'אצוות מס"ב לא נמצאה';
  end if;
  if v_status not in ('draft', 'pending_review', 'pending_approval') then
    raise exception 'ניתן לדרוש תיקון רק לפני אישור סופי (סטטוס נוכחי: %)', v_status;
  end if;

  update masav_batches set status = 'needs_correction', status_reason = p_reason where id = p_batch_id;

  perform insert_audit_event('request_masav_correction', 'masav_batches', p_batch_id::text, jsonb_build_object('reason', p_reason));
end;
$$;

grant execute on function request_masav_correction(uuid, text) to authenticated;
