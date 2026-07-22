-- שלב 3: RLS על טבלאות היסוד. תבנית קבועה: SELECT לכל מאושר עם גישת אזור תפעול,
-- כתיבה (INSERT/UPDATE) רק עם הרשאת manage הספציפית. אין DELETE policy בשום מקום -
-- סגירה נעשית ב-UPDATE (status='closed'), לא במחיקה (soft close, לפי דרישת האפיון).

alter table organizations enable row level security;
alter table organization_bank_accounts enable row level security;
alter table organization_officeholders enable row level security;
alter table branches enable row level security;
alter table group_leaders enable row level security;
alter table groups enable row level security;

create policy organizations_select on organizations for select to authenticated
  using (has_permission('area_ops', 'access'));

create policy organizations_insert on organizations for insert to authenticated
  with check (has_permission('organizations', 'manage'));

create policy organizations_update on organizations for update to authenticated
  using (has_permission('organizations', 'manage'))
  with check (has_permission('organizations', 'manage'));

-- קיום השורה נראה למי שיש לו גישת תפעול או כספים (כדי לדעת שיש חשבון ולעבוד מולו) -
-- המיסוך של מספר החשבון עצמו נאכף ב-view (organization_bank_accounts_view), לא כאן.
create policy organization_bank_accounts_select on organization_bank_accounts for select to authenticated
  using (has_permission('area_ops', 'access') or has_permission('area_finance', 'access'));

create policy organization_bank_accounts_insert on organization_bank_accounts for insert to authenticated
  with check (has_permission('organizations', 'manage'));

create policy organization_bank_accounts_update on organization_bank_accounts for update to authenticated
  using (has_permission('organizations', 'manage'))
  with check (has_permission('organizations', 'manage'));

create policy organization_officeholders_select on organization_officeholders for select to authenticated
  using (has_permission('area_ops', 'access'));

create policy organization_officeholders_insert on organization_officeholders for insert to authenticated
  with check (has_permission('organizations', 'manage'));

create policy organization_officeholders_update on organization_officeholders for update to authenticated
  using (has_permission('organizations', 'manage'))
  with check (has_permission('organizations', 'manage'));

create policy branches_select on branches for select to authenticated
  using (has_permission('area_ops', 'access'));

create policy branches_insert on branches for insert to authenticated
  with check (has_permission('branches', 'manage'));

create policy branches_update on branches for update to authenticated
  using (has_permission('branches', 'manage'))
  with check (has_permission('branches', 'manage'));

create policy group_leaders_select on group_leaders for select to authenticated
  using (has_permission('area_ops', 'access'));

create policy group_leaders_insert on group_leaders for insert to authenticated
  with check (has_permission('groups', 'manage'));

create policy group_leaders_update on group_leaders for update to authenticated
  using (has_permission('groups', 'manage'))
  with check (has_permission('groups', 'manage'));

create policy groups_select on groups for select to authenticated
  using (has_permission('area_ops', 'access'));

create policy groups_insert on groups for insert to authenticated
  with check (has_permission('groups', 'manage'));

create policy groups_update on groups for update to authenticated
  using (has_permission('groups', 'manage'))
  with check (has_permission('groups', 'manage'));
