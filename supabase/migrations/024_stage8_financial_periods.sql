-- שלב 8 (חלק א'): חודשים כספיים. כל כתיבה כספית (חישוב עמלה, בהמשך: תרומות/חלוקות/מס"ב)
-- חייבת לבדוק שהחודש הכספי הרלוונטי פתוח - ר' assert_financial_period_open בהמשך הקובץ,
-- ותיעשה עבורו קריאה בכל migration עתידי שכותב נתון כספי.

create table financial_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  month date not null,
  status text not null default 'open' check (status in ('open', 'in_review', 'closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  notes text,
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (organization_id, month)
);

create trigger financial_periods_set_updated_at
  before update on financial_periods
  for each row execute function set_updated_at();

create index financial_periods_org_idx on financial_periods (organization_id, month);

alter table financial_periods enable row level security;

insert into permissions (resource, action, label_he) values
  ('financial_periods', 'manage', 'פתיחה/סגירה של חודשים כספיים');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'financial_periods' and p.action = 'manage'
where r.key in ('system_admin', 'operations_manager', 'finance_controller');

create policy financial_periods_select on financial_periods for select to authenticated
  using (has_permission('area_finance', 'access') or has_permission('area_ops', 'access'));

-- אין INSERT/UPDATE policy ללקוח - רק דרך open_financial_period()/set_financial_period_status() למטה.

create trigger financial_periods_audit
  after insert or update on financial_periods
  for each row execute function audit_table_change();

-- open_financial_period(): פותחת חודש כספי לעמותה. אידמפוטנטית - קריאה חוזרת על חודש
-- שכבר קיים לא יוצרת שורה כפולה (unique constraint) ופשוט מחזירה את ה-id הקיים.
create or replace function open_financial_period(p_organization_id uuid, p_month date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not has_permission('financial_periods', 'manage') then
    raise exception 'permission denied';
  end if;

  insert into financial_periods (organization_id, month, status)
  values (p_organization_id, p_month, 'open')
  on conflict (organization_id, month) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from financial_periods where organization_id = p_organization_id and month = p_month;
  else
    perform insert_audit_event('open_financial_period', 'financial_periods', v_id::text, jsonb_build_object('organization_id', p_organization_id, 'month', p_month));
  end if;

  return v_id;
end;
$$;

grant execute on function open_financial_period(uuid, date) to authenticated;

-- set_financial_period_status(): המעבר היחיד בין open/in_review/closed. סגירה חוזרת
-- ("פתיחה מחדש" של חודש סגור) מותרת דרך אותה פונקציה - אין איסור טכני, זו החלטה
-- עסקית פתוחה (מי מורשה לפתוח מחדש חודש סגור) שמוצגת כרגע רק דרך אותה הרשאת ניהול.
create or replace function set_financial_period_status(p_period_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('financial_periods', 'manage') then
    raise exception 'permission denied';
  end if;

  if p_status not in ('open', 'in_review', 'closed') then
    raise exception 'invalid status: %', p_status;
  end if;

  update financial_periods
  set status = p_status, closed_at = case when p_status = 'closed' then now() else null end
  where id = p_period_id;

  perform insert_audit_event('set_financial_period_status', 'financial_periods', p_period_id::text, jsonb_build_object('status', p_status));
end;
$$;

grant execute on function set_financial_period_status(uuid, text) to authenticated;

-- assert_financial_period_open(): נקראת מכל RPC כספי (ר' commit_commission_calculation
-- וכל מה שיתווסף בשלבים 9-10). לא security definer - היא לא כותבת כלום וכל קורא כבר
-- עומד לעבור בדיקת has_permission משלו ב-RPC הקורא.
create or replace function assert_financial_period_open(p_organization_id uuid, p_month date)
returns void
language plpgsql
stable
as $$
declare
  v_status text;
begin
  select status into v_status from financial_periods where organization_id = p_organization_id and month = p_month;

  if v_status is null then
    raise exception 'לא נפתח חודש כספי % לעמותה זו', p_month;
  end if;

  if v_status <> 'open' then
    raise exception 'החודש הכספי % אינו פתוח (סטטוס נוכחי: %)', p_month, v_status;
  end if;
end;
$$;
