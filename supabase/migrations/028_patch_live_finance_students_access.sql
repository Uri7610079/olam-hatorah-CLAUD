-- Patch לפרויקט החי: הרחבה מפורשת של צ'ני (2026-07-23) - students_select/
-- student_assignments_select/student_bank_accounts_select (009, שלב 4) כבר רצו נגד
-- הפרויקט הקיים ומתירות SELECT רק ל-area_ops. עכשיו גם area_finance - כספים צריך
-- לראות תלמידים/שיוכים/חשבונות בנק (חריג לתלמיד בכלל עמלה משלב 8, וקראת תרומות/
-- חלוקות/מס"ב בשלבים 9-10 שישלמו ישירות לחשבון תלמיד). מספר חשבון עצמו נשאר ממוסך
-- כרגיל (view + reveal RPC, מוגן בהרשאת bank_accounts.view_sensitive בנפרד) - זו לא
-- הרחבה של הגישה לנתון הרגיש עצמו, רק של הגישה לשורה (קיום התלמיד/השיוך/החשבון).
-- idempotent (drop if exists + create).

drop policy if exists students_select on students;
create policy students_select on students for select to authenticated
  using (has_permission('area_ops', 'access') or has_permission('area_finance', 'access'));

drop policy if exists student_assignments_select on student_assignments;
create policy student_assignments_select on student_assignments for select to authenticated
  using (has_permission('area_ops', 'access') or has_permission('area_finance', 'access'));

drop policy if exists student_bank_accounts_select on student_bank_accounts;
create policy student_bank_accounts_select on student_bank_accounts for select to authenticated
  using (has_permission('area_ops', 'access') or has_permission('area_finance', 'access'));
