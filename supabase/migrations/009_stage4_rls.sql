-- שלב 4: RLS על טבלאות התלמידים + מדיניות Storage לבאקט אישורי חשבון.
-- SELECT לכל מאושר עם גישת area_ops או area_finance (הרחבה מפורשת של צ'ני ב-2026-07-23:
-- כספים צריך לראות תלמידים/שיוכים/חשבונות בנק - גם כדי לבחור "חריג לתלמיד" בכלל עמלה
-- (שלב 8), וגם לקראת תרומות/חלוקות/מס"ב (שלבים 9-10) שישלמו ישירות לחשבון תלמיד).
-- כתיבה על students: עדכון שדות רגילים מותר עם
-- students.manage (העריכה בפועל דרך StudentDetailsTab), אבל שינוי status חסום בטריגר
-- (008) גם אם יש הרשאת students.manage - הדרך היחידה היא advance_student_status()/exit_student().
-- ל-student_assignments ול-student_bank_accounts אין בכלל INSERT/UPDATE policy ללקוח:
-- reassign_student(), add_student_bank_account() ו-set_student_bank_account_verification()
-- הן security definer ולא זקוקות ל-policy כדי לכתוב - מדיניות INSERT/UPDATE כאן הייתה
-- רק פותחת מסלול עקיפה סביב הבדיקות העסקיות שבפונקציות האלה, בלי לתרום שום דבר.

alter table students enable row level security;
alter table student_assignments enable row level security;
alter table student_bank_accounts enable row level security;

create policy students_select on students for select to authenticated
  using (has_permission('area_ops', 'access') or has_permission('area_finance', 'access'));

create policy students_insert on students for insert to authenticated
  with check (has_permission('students', 'manage'));

create policy students_update on students for update to authenticated
  using (has_permission('students', 'manage'))
  with check (has_permission('students', 'manage'));

create policy student_assignments_select on student_assignments for select to authenticated
  using (has_permission('area_ops', 'access') or has_permission('area_finance', 'access'));

create policy student_bank_accounts_select on student_bank_accounts for select to authenticated
  using (has_permission('area_ops', 'access') or has_permission('area_finance', 'access'));

-- Storage: רק בעלי students.manage יכולים לקרוא/להעלות מסמכי אסמכתה. אין UPDATE/DELETE
-- policy - מסמך שהועלה לא נמחק ולא מוחלף (soft/append-only, כמו שאר המערכת).
create policy student_documents_select on storage.objects for select to authenticated
  using (bucket_id = 'student-documents' and has_permission('students', 'manage'));

create policy student_documents_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'student-documents' and has_permission('students', 'manage'));
