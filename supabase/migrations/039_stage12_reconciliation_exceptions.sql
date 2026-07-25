-- שלב 12 (חלק ב'): חריגות התאמה - view מחושב תמיד בזמן שאילתה (לא טבלה עם ספירות
-- שיכולות להתפוגג, אותו עיקרון שחוזר לאורך כל הפרויקט). security_invoker=true כדי
-- לכבד RLS על כל הטבלאות הבסיסיות.
--
-- חמשת סוגי החריגה מהאפיון: (1) מס"ב ששודר בלי תנועה תואמת - קריטי. (2) תנועה
-- שמסווגת כמס"ב בלי אצווה תואמת - קריטי. (3) תרומה מאושרת בלי תנועת בנק תואמת -
-- אזהרה. (4) תנועת זכות שמסווגת/מוצעת כתרומה בלי התאמה - אזהרה. (5) חיוב לא מזוהה -
-- אזהרה.

create view bank_reconciliation_exceptions
with (security_invoker = true)
as
select 'masav_transmitted_no_match'::text as exception_type, 'critical'::text as severity,
  oba.organization_id, 'masav_batches'::text as related_table, mb.id as related_id,
  mb.total_amount as amount, mb.period_month as related_date,
  'אצוות מס"ב ששודרה ללא תנועת בנק מותאמת ומאושרת' as description
from masav_batches mb
join organization_bank_accounts oba on oba.id = mb.organization_bank_account_id
where mb.status in ('transmitted', 'bank_completed')
  and not exists (
    select 1 from bank_matches bm
    where bm.target_table = 'masav_batches' and bm.target_id = mb.id and bm.status = 'approved'
  )

union all

select 'masav_transaction_no_batch', 'critical',
  oba.organization_id, 'bank_transactions', bt.id,
  bt.amount, bt.execution_date,
  'תנועת בנק מסווגת כמס"ב ללא אצוות מס"ב מותאמת ומאושרת'
from bank_transactions bt
join organization_bank_accounts oba on oba.id = bt.organization_bank_account_id
where bt.confirmed_type_id = (select id from bank_transaction_types where code = 'masav')
  and not exists (
    select 1 from bank_matches bm where bm.bank_transaction_id = bt.id and bm.status = 'approved'
  )

union all

select 'donation_no_bank_match', 'warning',
  d.organization_id, 'donations', d.id,
  d.amount, d.donation_date,
  'תרומה מאושרת ומשויכת לקבוצה ללא תנועת בנק מותאמת'
from donations d
where d.status = 'approved'
  and not exists (
    select 1 from bank_matches bm where bm.target_table = 'donations' and bm.target_id = d.id and bm.status = 'approved'
  )

union all

select 'credit_suspected_donation', 'warning',
  oba.organization_id, 'bank_transactions', bt.id,
  bt.amount, bt.execution_date,
  'תנועת זכות שסווגה/הוצעה כתרומה ללא התאמה מאושרת'
from bank_transactions bt
join organization_bank_accounts oba on oba.id = bt.organization_bank_account_id
where bt.direction = 'credit'
  and coalesce(bt.confirmed_type_id, bt.suggested_type_id) = (select id from bank_transaction_types where code = 'donation')
  and not exists (
    select 1 from bank_matches bm where bm.bank_transaction_id = bt.id and bm.status = 'approved'
  )

union all

select 'unidentified_debit', 'warning',
  oba.organization_id, 'bank_transactions', bt.id,
  bt.amount, bt.execution_date,
  'תנועת חיוב שטרם סווגה סופית'
from bank_transactions bt
join organization_bank_accounts oba on oba.id = bt.organization_bank_account_id
where bt.direction = 'debit' and bt.classification_status <> 'confirmed';

grant select on bank_reconciliation_exceptions to authenticated;
