-- שלב 7: מכסות. המכסה המאושרת היא הנתון היחיד שנשמר כאן (מגיע ממקור מאושר, לא נגזר).
-- "רשומים" ו"זכאים" נגזרים בזמן שאילתה מהטבלאות האמיתיות (student_assignments,
-- monthly_eligibility) - לא נשמרים כאן, כדי לא ליצור עוד מקור-כפול-לאמת שדורש סנכרון
-- (בדיוק הבעיה שתוקנה כמה פעמים בשלב 6 עם ספירות import_batches). משמעות המכסה
-- המדויקת (והאם ניתן להעביר בין סניפים) היא שאלה פתוחה - המסך מציג את המספרים בלי
-- להמציא כלל תקציבי.

create table monthly_quotas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  branch_id uuid references branches(id),
  month date not null,
  approved_quota integer not null,
  source_file_path text,
  notes text,
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (organization_id, branch_id, month)
);

create trigger monthly_quotas_set_updated_at
  before update on monthly_quotas
  for each row execute function set_updated_at();

create index monthly_quotas_org_month_idx on monthly_quotas (organization_id, month);

alter table monthly_quotas enable row level security;

insert into permissions (resource, action, label_he) values
  ('quotas', 'manage', 'הגדרת מכסות מאושרות');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'quotas' and p.action = 'manage'
where r.key in ('system_admin', 'operations_manager');

create policy monthly_quotas_select on monthly_quotas for select to authenticated
  using (has_permission('area_ops', 'access'));

create policy monthly_quotas_insert on monthly_quotas for insert to authenticated
  with check (has_permission('quotas', 'manage'));

create policy monthly_quotas_update on monthly_quotas for update to authenticated
  using (has_permission('quotas', 'manage'))
  with check (has_permission('quotas', 'manage'));

create trigger monthly_quotas_audit
  after insert or update on monthly_quotas
  for each row execute function audit_table_change();
