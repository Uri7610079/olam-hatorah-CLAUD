-- שלב 10 (חלק ב'): החזרות תשלום. הזנה ידנית בלבד בשלב הזה - התאמה אוטומטית מול דוח
-- בנק תגיע רק אחרי מודול הבנק (שלב 11). "החזרה אינה מוחקת את שורת המקור" - שורת
-- ה-masav_line המקורית נשארת (רק מסומנת status='returned'), וה"זיכוי" חזרה לקבוצה
-- הוא תנועת refund נגדית חדשה בספר התנועות (append-only, שלב 8) - לא מחיקה/עריכה
-- של תנועת ה-payment המקורית.

create table payment_returns (
  id uuid primary key default gen_random_uuid(),
  masav_line_id uuid not null references masav_lines(id),
  return_date date not null,
  amount numeric(12, 2) not null check (amount > 0),
  reason text not null,
  new_bank_account_id uuid references student_bank_accounts(id),
  -- קישור לתשלום חוזר בפועל: שדה ייחוס בלבד. יצירת מחזור תשלום/מס"ב חדש להחזר אינה
  -- אוטומטית בשלב הזה - "בשלב זה ניתן להזין החזרה ידנית" באפיון. אם/כשנוצר בפועל
  -- masav_line חדש עבור ההחזר, הקישור מתעדכן כאן ידנית (עדכון רגיל, לא RPC ייעודי -
  -- זה שדה מעקב, לא פעולה כספית).
  retry_masav_line_id uuid references masav_lines(id),
  status text not null default 'open' check (status in ('open', 'retried', 'resolved')),
  notes text,
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references auth.users(id)
);

create trigger payment_returns_set_updated_at
  before update on payment_returns
  for each row execute function set_updated_at();

create index payment_returns_masav_line_idx on payment_returns (masav_line_id);

alter table payment_returns enable row level security;

insert into permissions (resource, action, label_he) values
  ('payment_returns', 'manage', 'רישום ומעקב החזרות תשלום');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'payment_returns' and p.action = 'manage'
where r.key in ('system_admin', 'operations_manager', 'finance_controller');

create policy payment_returns_select on payment_returns for select to authenticated
  using (has_permission('area_finance', 'access') or has_permission('area_ops', 'access'));

create policy payment_returns_update on payment_returns for update to authenticated
  using (has_permission('payment_returns', 'manage'))
  with check (has_permission('payment_returns', 'manage'));

-- אין INSERT policy - יצירה רק דרך record_payment_return() (חייבת גם לפרסם תנועת
-- refund בטרנזקציה אחת). UPDATE ישיר מותר, אך רק לשדות מעקב לא-כספיים (סטטוס/הערות/
-- קישור לתשלום חוזר/חשבון חדש) - הטריגר חוסם עריכה של פרטי ההחזרה הכספיים עצמם.
create or replace function enforce_payment_return_mutation()
returns trigger
language plpgsql
as $$
begin
  if new.masav_line_id is distinct from old.masav_line_id
     or new.return_date is distinct from old.return_date
     or new.amount is distinct from old.amount
     or new.reason is distinct from old.reason then
    raise exception 'לא ניתן לערוך את פרטי ההחזרה הכספיים (תשלום/תאריך/סכום/סיבה) - ניתן לעדכן רק סטטוס/הערות/חשבון חדש/קישור לתשלום חוזר';
  end if;
  return new;
end;
$$;

create trigger payment_returns_enforce_mutation
  before update on payment_returns
  for each row execute function enforce_payment_return_mutation();

create trigger payment_returns_audit
  after insert or update on payment_returns
  for each row execute function audit_table_change();

-- record_payment_return(): הדרך היחידה ליצור החזרה. מותרת רק על שורת מס"ב ששולמה
-- בפועל (valid, באצווה ששודרה/הושלמה) - לא ניתן "להחזיר" תשלום שמעולם לא יצא.
create or replace function record_payment_return(
  p_masav_line_id uuid,
  p_return_date date,
  p_amount numeric,
  p_reason text,
  p_new_bank_account_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line masav_lines;
  v_batch masav_batches;
  v_return_id uuid;
  v_period_month date;
begin
  if not has_permission('payment_returns', 'manage') then
    raise exception 'permission denied';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'נדרשת סיבה להחזרה';
  end if;

  select * into v_line from masav_lines where id = p_masav_line_id;
  if v_line.id is null then
    raise exception 'שורת מס"ב לא נמצאה';
  end if;
  if v_line.status <> 'valid' then
    raise exception 'ניתן לרשום החזרה רק לשורה תקינה ששולמה (סטטוס נוכחי: %)', v_line.status;
  end if;

  select * into v_batch from masav_batches where id = v_line.batch_id;
  if v_batch.status not in ('transmitted', 'bank_completed') then
    raise exception 'ניתן לרשום החזרה רק על תשלום שכבר שודר בפועל (סטטוס אצווה נוכחי: %)', v_batch.status;
  end if;

  v_period_month := date_trunc('month', p_return_date)::date;
  perform assert_financial_period_open(v_batch.organization_id, v_period_month);

  insert into payment_returns (masav_line_id, return_date, amount, reason, new_bank_account_id, created_by)
  values (p_masav_line_id, p_return_date, p_amount, p_reason, p_new_bank_account_id, auth.uid())
  returning id into v_return_id;

  update masav_lines set status = 'returned' where id = p_masav_line_id;

  insert into group_ledger_entries (organization_id, group_id, entry_type, amount, period_month, source_table, source_id, reason, created_by)
  values (v_batch.organization_id, v_line.group_id, 'refund', p_amount, v_period_month, 'payment_returns', v_return_id, p_reason, auth.uid());

  perform insert_audit_event('record_payment_return', 'payment_returns', v_return_id::text, jsonb_build_object('masav_line_id', p_masav_line_id, 'amount', p_amount));

  return v_return_id;
end;
$$;

grant execute on function record_payment_return(uuid, date, numeric, text, uuid) to authenticated;
