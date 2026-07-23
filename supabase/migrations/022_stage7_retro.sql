-- שלב 7: רטרו והפרשים. כל חישוב חדש הוא שורה חדשה - append-only, לעולם לא דורס גרסה
-- קודמת. "גרסה" = סדר יצירה (created_at) לאותו תלמיד/עמותה/חודש מקור, אין עמודת מספר
-- גרסה נפרדת. אין נוסחת ניקוד קבועה (למשל "95 × ניקוד") - ניקוד נשמר כנתון מקור בלבד
-- (score_or_payment_type כבר קיים ב-monthly_eligibility; כאן conceptual_note בלבד אם רלוונטי).

create table payment_calculation_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  branch_id uuid references branches(id),
  group_id uuid references groups(id),
  -- תלמיד ספציפי כשיש פירוט; ריק כשהרטרו הוא ברמת סניף/קבוצה מצרפית בלבד.
  student_id uuid references students(id),
  source_month date not null,
  received_month date not null,
  calculation_type text,
  calculation_date date not null default current_date,
  prior_eligible_count integer,
  current_eligible_count integer,
  prior_amount numeric(12, 2),
  current_amount numeric(12, 2),
  difference numeric(12, 2),
  current_period_offset numeric(12, 2),
  cumulative_offset numeric(12, 2),
  transferred_to_advances numeric(12, 2),
  notes text,
  source_batch_id uuid references import_batches(id),
  entered_by uuid references auth.users(id),
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index payment_calculation_versions_student_idx on payment_calculation_versions (student_id, source_month);
create index payment_calculation_versions_org_month_idx on payment_calculation_versions (organization_id, received_month);

-- append-only: אין UPDATE/DELETE בשום מצב, אותו דפוס כמו audit_events. תיקון = גרסה
-- (שורה) חדשה, לא עריכה של קודמת.
create or replace function block_retro_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'payment_calculation_versions is append-only: % not allowed', tg_op;
end;
$$;

create trigger payment_calculation_versions_no_update
  before update on payment_calculation_versions
  for each row execute function block_retro_mutation();

create trigger payment_calculation_versions_no_delete
  before delete on payment_calculation_versions
  for each row execute function block_retro_mutation();

create trigger payment_calculation_versions_audit
  after insert on payment_calculation_versions
  for each row execute function audit_table_change();

alter table payment_calculation_versions enable row level security;

insert into permissions (resource, action, label_he) values
  ('retro', 'manage', 'הזנת גרסאות רטרו והפרשים');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'retro' and p.action = 'manage'
where r.key in ('system_admin', 'operations_manager', 'finance_controller');

create policy payment_calculation_versions_select on payment_calculation_versions for select to authenticated
  using (has_permission('area_ops', 'access') or has_permission('area_finance', 'access'));

create policy payment_calculation_versions_insert on payment_calculation_versions for insert to authenticated
  with check (has_permission('retro', 'manage'));

-- אין UPDATE/DELETE policy בכלל - גם RLS וגם הטריגר חוסמים, בכוונה כפולה (append-only אמיתי).
