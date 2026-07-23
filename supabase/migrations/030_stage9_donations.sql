-- שלב 9 (חלק א'): תרומות. תרומה יכולה להיות משויכת לעמותה בלבד (group_id null), לקבוצה
-- ספציפית, או ממתינה - group_id הוא nullable ומייצג את שני המקרים הראשונים; "ממתינה
-- לשיוך" היא פשוט group_id null שטרם הוכרע, אין דגל נפרד לזה (אין נתון עסקי חדש מעבר
-- לקיים/לא-קיים של group_id).
--
-- מיסוך: donor_reference (המקור הבנקאי/מזהה של התרומה - "מקור ממוסך" באפיון) ממוסך
-- באותה תבנית מדויקת כמו מספרי חשבון בנק (mask_account_number מ-005 + view + reveal
-- RPC מבוקר), ומוגן באותה הרשאה bank_accounts.view_sensitive - זו אותה משפחת נתון
-- רגיש-בנקאי, לא נתון חדש שדורש הרשאה נפרדת.
--
-- bank_transaction_id: placeholder בלבד, בלי FK - טבלת bank_transactions עוד לא קיימת
-- (תיבנה בשלב 11); ה-FK האמיתי יתווסף אז, לא מומצא כאן מראש.

create table donations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  group_id uuid references groups(id),
  donation_date date not null,
  amount numeric(12, 2) not null check (amount > 0),
  donor_reference text,
  reference text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  bank_transaction_id uuid,
  source_file_path text,
  notes text,
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references auth.users(id)
);

create trigger donations_set_updated_at
  before update on donations
  for each row execute function set_updated_at();

create index donations_org_idx on donations (organization_id, donation_date);
create index donations_group_idx on donations (group_id);
create index donations_unassigned_idx on donations (organization_id) where group_id is null;

alter table donations enable row level security;

insert into permissions (resource, action, label_he) values
  ('donations', 'manage', 'יצירה/עריכה/שיוך של תרומות'),
  ('donations', 'approve', 'אישור/דחיית תרומות');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'donations' and p.action in ('manage', 'approve')
where r.key in ('system_admin', 'operations_manager', 'finance_controller');

create policy donations_select on donations for select to authenticated
  using (has_permission('area_finance', 'access') or has_permission('area_ops', 'access'));

create policy donations_insert on donations for insert to authenticated
  with check (has_permission('donations', 'manage'));

create policy donations_update on donations for update to authenticated
  using (has_permission('donations', 'manage'))
  with check (has_permission('donations', 'manage'));

-- enforce_donation_mutation_guard(): RLS לבדה לא יכולה להגביל עמודות בודדות (donations_update
-- מתירה עדכון כל שדה כדי לאפשר עריכת פרטים רגילים כמו הערות/אסמכתה). האכיפה האמיתית:
-- status/group_id חסומים אלא אם כן דרך approve_donation()/reject_donation()/
-- set_donation_group() (אותו דפוס app.allow_X_change בדיוק כמו students בשלב 4); וסכום/
-- תאריך/עמותה ננעלים ברגע שהתרומה אושרה - כדי שלא ייווצר פער בין מה שנרשם בפועל
-- בספר התנועות (בזמן האישור) לבין שורת התרומה. תיקון לאחר אישור = תנועת תיקון
-- בספר הקבוצה (create_ledger_correction, שלב 8), לא עריכת התרומה עצמה.
create or replace function enforce_donation_mutation_guard()
returns trigger
language plpgsql
as $$
begin
  -- ללא הבדיקה הזו, INSERT ישיר (עם bypass של RLS.with_check שרק בודק הרשאה, לא ערך
  -- status) יכול היה ליצור תרומה שכבר "approved"/"rejected" מרגע הלידה - עוקף
  -- לגמרי את approve_donation()/reject_donation() ואת כל הבדיקות שבהן. תרומה חדשה
  -- תמיד נולדת pending; שינוי סטטוס קורה רק אחר כך, דרך אותן פונקציות.
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      raise exception 'תרומה חדשה תמיד נוצרת בסטטוס ממתין לאישור';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status
     and coalesce(current_setting('app.allow_donation_status_change', true), '') <> 'true' then
    raise exception 'שינוי סטטוס תרומה מותר רק דרך approve_donation()/reject_donation()';
  end if;

  if new.group_id is distinct from old.group_id
     and coalesce(current_setting('app.allow_donation_group_change', true), '') <> 'true' then
    raise exception 'שינוי שיוך תרומה מותר רק דרך set_donation_group()';
  end if;

  if old.status = 'approved'
     and (new.amount is distinct from old.amount
       or new.donation_date is distinct from old.donation_date
       or new.organization_id is distinct from old.organization_id) then
    raise exception 'לא ניתן לערוך סכום/תאריך/עמותה של תרומה שכבר אושרה - תיקון נעשה בתנועת תיקון בספר הקבוצה';
  end if;

  return new;
end;
$$;

create trigger donations_enforce_mutation_guard
  before insert or update on donations
  for each row execute function enforce_donation_mutation_guard();

create trigger donations_audit
  after insert or update on donations
  for each row execute function audit_table_change();

create view donations_view
with (security_invoker = true)
as
select
  id, organization_id, group_id, donation_date, amount,
  mask_account_number(donor_reference) as donor_reference_masked,
  reference, status, rejection_reason, bank_transaction_id, source_file_path, notes,
  is_demo, demo_batch_id, created_at, updated_at, created_by
from donations;

grant select on donations_view to authenticated;

create or replace function reveal_donation_source(p_donation_id uuid)
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

  select donor_reference into v_value from donations where id = p_donation_id;

  perform insert_audit_event('reveal_donation_source', 'donations', p_donation_id::text, null);

  return v_value;
end;
$$;

grant execute on function reveal_donation_source(uuid) to authenticated;

-- approve_donation(): הדרך היחידה מ-pending ל-approved. פרסום לספר התנועות קורה כאן
-- ורק כאן, ורק אם כבר יש שיוך לקבוצה - תרומה מאושרת בלי קבוצה לא יוצרת שום תנועה
-- (בדיוק לפי האפיון: "רק תרומה מאושרת ומשויכת לקבוצה יוצרת זכות ב-group_ledger").
create or replace function approve_donation(p_donation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_donation donations;
  v_period_month date;
begin
  if not has_permission('donations', 'approve') then
    raise exception 'permission denied';
  end if;

  select * into v_donation from donations where id = p_donation_id;
  if v_donation.id is null then
    raise exception 'תרומה לא נמצאה';
  end if;
  if v_donation.status <> 'pending' then
    raise exception 'ניתן לאשר רק תרומה הממתינה לאישור (סטטוס נוכחי: %)', v_donation.status;
  end if;

  if v_donation.group_id is not null then
    v_period_month := date_trunc('month', v_donation.donation_date)::date;
    perform assert_financial_period_open(v_donation.organization_id, v_period_month);
  end if;

  perform set_config('app.allow_donation_status_change', 'true', true);
  update donations set status = 'approved' where id = p_donation_id;

  if v_donation.group_id is not null then
    insert into group_ledger_entries (organization_id, group_id, entry_type, amount, period_month, source_table, source_id, reference, created_by)
    values (v_donation.organization_id, v_donation.group_id, 'donation', v_donation.amount, v_period_month, 'donations', p_donation_id, v_donation.reference, auth.uid());
  end if;

  perform insert_audit_event('approve_donation', 'donations', p_donation_id::text, jsonb_build_object('group_id', v_donation.group_id));
end;
$$;

grant execute on function approve_donation(uuid) to authenticated;

-- reject_donation(): רק מ-pending, דורש סיבה. אין "ביטול אישור" - אם תרומה כבר אושרה
-- ופורסמה בטעות, התיקון הוא תנועת תיקון בספר הקבוצה (שלב 8), לא היפוך סטטוס.
create or replace function reject_donation(p_donation_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not has_permission('donations', 'approve') then
    raise exception 'permission denied';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'נדרשת סיבה לדחיית תרומה';
  end if;

  select status into v_status from donations where id = p_donation_id;
  if v_status is null then
    raise exception 'תרומה לא נמצאה';
  end if;
  if v_status <> 'pending' then
    raise exception 'ניתן לדחות רק תרומה הממתינה לאישור (סטטוס נוכחי: %)', v_status;
  end if;

  perform set_config('app.allow_donation_status_change', 'true', true);
  update donations set status = 'rejected', rejection_reason = p_reason where id = p_donation_id;

  perform insert_audit_event('reject_donation', 'donations', p_donation_id::text, jsonb_build_object('reason', p_reason));
end;
$$;

grant execute on function reject_donation(uuid, text) to authenticated;

-- set_donation_group(): הדרך היחידה לשייך/לשנות שיוך קבוצה. שיוך ראשוני (מ-ריק) לא
-- דורש סיבה; שינוי שיוך אמיתי (הייתה קבוצה קודמת) דורש סיבה - "שינוי שיוך דורש הרשאה,
-- סיבה, ביטול תנועת ledger קודמת ויצירת חדשה" באפיון. הביטול הוא תנועה נגדית
-- (group_ledger הוא append-only, שלב 8) - לא מחיקה של התנועה הקודמת.
create or replace function set_donation_group(p_donation_id uuid, p_group_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_donation donations;
  v_period_month date;
begin
  if not has_permission('donations', 'manage') then
    raise exception 'permission denied';
  end if;

  select * into v_donation from donations where id = p_donation_id;
  if v_donation.id is null then
    raise exception 'תרומה לא נמצאה';
  end if;

  if v_donation.group_id is not distinct from p_group_id then
    raise exception 'הקבוצה שנבחרה זהה לשיוך הנוכחי';
  end if;

  if v_donation.group_id is not null and (p_reason is null or length(trim(p_reason)) = 0) then
    raise exception 'נדרשת סיבה לשינוי שיוך של תרומה שכבר משויכת';
  end if;

  if v_donation.status = 'approved' and v_donation.group_id is not null then
    v_period_month := date_trunc('month', v_donation.donation_date)::date;
    perform assert_financial_period_open(v_donation.organization_id, v_period_month);
    insert into group_ledger_entries (organization_id, group_id, entry_type, amount, period_month, source_table, source_id, reference, reason, created_by)
    values (v_donation.organization_id, v_donation.group_id, 'donation', -v_donation.amount, v_period_month, 'donations', p_donation_id, v_donation.reference, coalesce(p_reason, 'ביטול עקב שינוי שיוך'), auth.uid());
  end if;

  perform set_config('app.allow_donation_group_change', 'true', true);
  update donations set group_id = p_group_id where id = p_donation_id;

  if v_donation.status = 'approved' and p_group_id is not null then
    v_period_month := date_trunc('month', v_donation.donation_date)::date;
    perform assert_financial_period_open(v_donation.organization_id, v_period_month);
    insert into group_ledger_entries (organization_id, group_id, entry_type, amount, period_month, source_table, source_id, reference, reason, created_by)
    values (v_donation.organization_id, p_group_id, 'donation', v_donation.amount, v_period_month, 'donations', p_donation_id, v_donation.reference, p_reason, auth.uid());
  end if;

  perform insert_audit_event(
    'set_donation_group', 'donations', p_donation_id::text,
    jsonb_build_object('old_group_id', v_donation.group_id, 'new_group_id', p_group_id, 'reason', p_reason)
  );
end;
$$;

grant execute on function set_donation_group(uuid, uuid, text) to authenticated;

-- bucket פרטי לקבצי מקור של תרומות (למשל דף מתוך דוח בנק) - אותה תבנית כמו
-- student-documents בשלב 4.
insert into storage.buckets (id, name, public)
values ('donation-documents', 'donation-documents', false)
on conflict (id) do nothing;

create policy donation_documents_select on storage.objects for select to authenticated
  using (bucket_id = 'donation-documents' and (has_permission('donations', 'manage') or has_permission('donations', 'approve')));

create policy donation_documents_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'donation-documents' and has_permission('donations', 'manage'));
