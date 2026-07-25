-- Patch לפרויקט החי: get_finance_dashboard_counts() (048) נכשלה בבדיקה חיה הראשונה
-- שלה עם "column reference 'gross_amount' is ambiguous". הסיבה: לפונקציית PL/pgSQL יש
-- RETURNS TABLE עם עמודת פלט בשם gross_amount/commission_amount/net_amount - בתוך גוף
-- הפונקציה, Postgres חושף את עמודות ה-RETURNS TABLE כמשתנים, ואלה מתנגשים עם העמודות
-- הממשיות באותו שם בטבלה eligibility_financial_results. תוקן ע"י alias מפורש לטבלה
-- (efr.gross_amount וכו') בכל שלוש הסכימות. 048 עודכן בדיסק; זהו ה-patch לפרויקט הקיים.
create or replace function get_finance_dashboard_counts(p_organization_id uuid, p_month date)
returns table (
  period_status text,
  gross_amount numeric,
  commission_amount numeric,
  net_amount numeric,
  masav_in_process_count integer,
  masav_transmitted_not_completed_count integer,
  group_commitment_total numeric,
  open_bank_exceptions integer,
  open_returns integer,
  unclassified_transactions integer,
  unassigned_donations integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('area_finance', 'access') then
    raise exception 'permission denied';
  end if;

  return query
  select
    (select status from financial_periods where organization_id = p_organization_id and month = p_month),
    (select coalesce(sum(efr.gross_amount), 0) from eligibility_financial_results efr where efr.organization_id = p_organization_id and efr.month = p_month and efr.status = 'active'),
    (select coalesce(sum(efr.commission_amount), 0) from eligibility_financial_results efr where efr.organization_id = p_organization_id and efr.month = p_month and efr.status = 'active'),
    (select coalesce(sum(efr.net_amount), 0) from eligibility_financial_results efr where efr.organization_id = p_organization_id and efr.month = p_month and efr.status = 'active'),
    (select count(*)::integer from masav_batches where organization_id = p_organization_id and period_month = p_month and status in ('draft', 'pending_review', 'pending_approval', 'approved', 'file_generated')),
    (select count(*)::integer from masav_batches where organization_id = p_organization_id and period_month = p_month and status = 'transmitted'),
    (select coalesce(sum(gb.balance), 0) from group_balances gb where gb.organization_id = p_organization_id),
    (select count(*)::integer from bank_reconciliation_exceptions where organization_id = p_organization_id),
    (
      select count(*)::integer from payment_returns pr
      join masav_lines ml on ml.id = pr.masav_line_id
      join masav_batches mb on mb.id = ml.batch_id
      where mb.organization_id = p_organization_id and pr.status = 'open'
    ),
    (
      select count(*)::integer from bank_transactions bt
      join organization_bank_accounts oba on oba.id = bt.organization_bank_account_id
      where oba.organization_id = p_organization_id and bt.classification_status <> 'confirmed'
    ),
    (select count(*)::integer from donations where organization_id = p_organization_id and (group_id is null or status = 'pending'));
end;
$$;
