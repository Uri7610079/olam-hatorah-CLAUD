-- דשבורד כספי: זכאות מתלמוד שטרם חושבה
--
-- הדשבורד קורא מ-eligibility_financial_results - התוצאה שאחרי ההפחתות -
-- ולא מ-monthly_eligibility, שהיא מה שתלמוד מצהיר. זו הפרדה נכונה, אבל
-- היא יוצרת מצב מטעה: אחרי קליטת דוחות אוגוסט 2026 יש במערכת 982,320
-- ש"ח זכאות, והדשבורד הראה ברוטו 0, עמלה 0, נטו 0. בלי שום רמז לכך
-- שהנתונים קיימים ופשוט טרם עברו חישוב.
--
-- אפס בלי הסבר גרוע מאפס עם הסבר: הוא נקרא ככשל קליטה, ושולח לחפש
-- תקלה במקום שאין בה תקלה.
--
-- שתי העמודות החדשות עונות בדיוק על השאלה "כמה כסף כבר נקלט אך עדיין
-- אינו בתמונה הכספית", והדשבורד מציג אותן ככרטיס נפרד.
--
-- ההשוואה היא לפי eligibility_id ולא לפי תלמיד: זה הקישור הישיר בין
-- שתי הטבלאות, והוא נכון גם אם לתלמיד יש כמה שורות זכאות באותו חודש.

drop function if exists get_finance_dashboard_counts(uuid, date);

create or replace function get_finance_dashboard_counts(p_organization_id uuid, p_month date)
returns table (
  period_status text,
  gross_amount numeric,
  commission_amount numeric,
  net_amount numeric,
  uncalculated_eligibility_amount numeric,
  uncalculated_eligibility_count integer,
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
    -- alias מפורש בשלוש הסכימות האלה: עמודות ה-RETURNS TABLE נחשפות כמשתנים
    -- בגוף הפונקציה ומתנגשות בשמות הממשיים בטבלה. ראה 051.
    (select coalesce(sum(efr.gross_amount), 0) from eligibility_financial_results efr where efr.organization_id = p_organization_id and efr.month = p_month and efr.status = 'active'),
    (select coalesce(sum(efr.commission_amount), 0) from eligibility_financial_results efr where efr.organization_id = p_organization_id and efr.month = p_month and efr.status = 'active'),
    (select coalesce(sum(efr.net_amount), 0) from eligibility_financial_results efr where efr.organization_id = p_organization_id and efr.month = p_month and efr.status = 'active'),
    (
      select coalesce(sum(me.gross_amount), 0)
      from monthly_eligibility me
      where me.organization_id = p_organization_id and me.month = p_month and me.status = 'active'
        and not exists (
          select 1 from eligibility_financial_results efr
          where efr.eligibility_id = me.id and efr.status = 'active'
        )
    ),
    (
      select count(*)::integer
      from monthly_eligibility me
      where me.organization_id = p_organization_id and me.month = p_month and me.status = 'active'
        and not exists (
          select 1 from eligibility_financial_results efr
          where efr.eligibility_id = me.id and efr.status = 'active'
        )
    ),
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

-- drop מוחק גם את ההרשאות, ולכן הן ניתנות כאן מחדש
revoke execute on function get_finance_dashboard_counts(uuid, date) from public, anon;
grant execute on function get_finance_dashboard_counts(uuid, date) to authenticated;

-- אינדקס לבדיקת ה-not exists: בלעדיו כל שורת זכאות סורקת את טבלת
-- התוצאות, ובחודש עמוס אלה אלפי שורות.
create index if not exists efr_eligibility_active_idx
  on eligibility_financial_results (eligibility_id) where status = 'active';
