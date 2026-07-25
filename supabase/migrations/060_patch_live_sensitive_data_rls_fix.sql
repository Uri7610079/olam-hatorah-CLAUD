-- Patch לפרויקט החי - שלב 16 (ביקורת אבטחה): באג קריטי אמיתי, לא תיאורטי. מספר חשבון
-- בנק (עמותה/תלמיד) ואסמכתת תרומה היו קריאים בטקסט גלוי לכל מי שיש לו area_ops/
-- area_finance דרך SELECT ישיר על הטבלה הבסיסית - המיסוך (mask_account_number + view +
-- reveal_*/bank_accounts.view_sensitive) הוגן רק ברמת ה-view וה-RPC, מעולם לא ברמת ה-RLS
-- על הטבלה עצמה. אומת שזה לא רק תיאורטי: ReportsScreen.tsx (דוח "תרומות") ו-
-- BankMatchingScreen.tsx (בורר תרומה להתאמה) שניהם קראו donor_reference הגולמי ישירות
-- מהטבלה בפועל - תוקנו בקוד הלקוח (עברו ל-donations_view/donor_reference_masked) יחד
-- עם ה-patch הזה.
--
-- תיקון: SELECT ישיר על organization_bank_accounts/student_bank_accounts/donations דורש
-- עכשיו bank_accounts.view_sensitive (בדיוק כמו reveal_bank_account_number()/
-- reveal_student_bank_account_number()/reveal_donation_source()). מי שאין לו view_sensitive
-- ממשיך לראות הכול (כולל השורה עצמה, ממוסכת) אך ורק דרך ה-view המתאים, שעכשיו רץ כ-owner
-- (לא security_invoker) ומשכפל במפורש בתוך ה-WHERE שלו את כלל הראייה המקורי
-- (area_ops/area_finance) - כדי שלא ידלוף כלום מעבר למה שה-RLS המקורי כבר איפשר.
-- 005/006/008/009/030 עודכנו בדיסק; זהו ה-patch לפרויקט הקיים.

drop policy organization_bank_accounts_select on organization_bank_accounts;
create policy organization_bank_accounts_select on organization_bank_accounts for select to authenticated
  using (has_permission('bank_accounts', 'view_sensitive'));

drop policy student_bank_accounts_select on student_bank_accounts;
create policy student_bank_accounts_select on student_bank_accounts for select to authenticated
  using (has_permission('bank_accounts', 'view_sensitive'));

drop policy donations_select on donations;
create policy donations_select on donations for select to authenticated
  using (has_permission('bank_accounts', 'view_sensitive'));

create or replace view organization_bank_accounts_view
as
select
  id,
  organization_id,
  bank_name,
  bank_branch_code,
  mask_account_number(account_number) as account_number_masked,
  account_holder_name,
  currency,
  import_profile_label,
  is_active,
  opened_at,
  closed_at,
  is_demo,
  demo_batch_id,
  created_at,
  updated_at
from organization_bank_accounts
where has_permission('area_ops', 'access') or has_permission('area_finance', 'access');

-- CREATE OR REPLACE VIEW משנה את השאילתה, אבל אינו מבטיח איפוס reloption קיים (security_invoker
-- שהוגדר ב-005 המקורי) - ALTER מפורש כדי לוודא שה-view באמת רצה כ-owner עכשיו, לא נשארת
-- בטעות עם security_invoker=true (מה שהיה מחזיר בדיוק את הבאג: אף שורה למי שאין לו view_sensitive).
alter view organization_bank_accounts_view reset (security_invoker);

create or replace view student_bank_accounts_view
as
select
  id,
  student_id,
  bank_name,
  bank_branch_code,
  mask_account_number(account_number) as account_number_masked,
  account_holder_name,
  student_relationship,
  supporting_document_path,
  verification_status,
  verified_at,
  verified_by,
  is_active,
  opened_at,
  closed_at,
  is_demo,
  demo_batch_id,
  created_at,
  updated_at
from student_bank_accounts
where has_permission('area_ops', 'access') or has_permission('area_finance', 'access');

alter view student_bank_accounts_view reset (security_invoker);

create or replace view donations_view
as
select
  id, organization_id, group_id, donation_date, amount,
  mask_account_number(donor_reference) as donor_reference_masked,
  reference, status, rejection_reason, bank_transaction_id, source_file_path, notes,
  is_demo, demo_batch_id, created_at, updated_at, created_by
from donations
where has_permission('area_ops', 'access') or has_permission('area_finance', 'access');

alter view donations_view reset (security_invoker);
