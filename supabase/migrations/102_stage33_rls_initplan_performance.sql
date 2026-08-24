-- ביצועים: has_permission() רץ פעם לכל שורה בכל בדיקת RLS
--
-- has_permission() מוגדרת stable, אבל Postgres מעריך פונקציה stable
-- בתוך qual של RLS *לכל שורה* - הוא אינו מרים אותה החוצה מעצמו. כל
-- הפעלה מריצה שלוש שאילתות (profiles, user_permissions, role_permissions),
-- וכך שאילתה שסורקת 9,045 שורות יבוא מריצה כ-27,000 שאילתות פנימיות.
--
-- מדדתי על המסד החי: מעבר על 9,000 שורות ב-import_rows עולה כ-600ms רק
-- על בדיקת ההרשאה. עם צירופים לרוחב - שיוך פעיל, זכאות פעילה, סניף -
-- זה הצטבר ל-8 שניות ומרכז החריגות נפל ב-timeout.
--
-- התיקון: לעטוף את הקריאה ב-(select ...). ל-Postgres זו תת-שאילתה בלי
-- תלות בשורה, והוא מחשב אותה כ-InitPlan - פעם אחת לכל השאילתה. אותה
-- סמנטיקה בדיוק, ללא שינוי בהרשאות.
--
-- import_rows_select הוא המקרה הקיצוני: הוא גם מריץ exists על
-- import_batches לכל שורה, ותת-השאילתה הזו מפעילה בעצמה את
-- import_batches_select - כלומר עוד has_permission לכל שורה. ה-exists
-- נשאר במקומו (הוא מבטא "רואים שורה רק של אצווה שמותר לראות", וזה
-- נכון גם אם מדיניות האצוות תהיה מצומצמת יותר בעתיד), אבל שתי
-- בדיקות ההרשאה שסביבו יורדות לחישוב יחיד.
--
-- הרשימה כאן היא בדיוק הטבלאות ש-unified_exceptions סורק. שאר המערכת
-- נהנית מזה ממילא בכל מסך שקורא מהן.

-- ===== יבוא =====

drop policy if exists import_profiles_select on import_profiles;
create policy import_profiles_select on import_profiles for select to authenticated
  using ((select has_permission('area_ops', 'access')) or (select has_permission('area_finance', 'access')));

drop policy if exists import_batches_select on import_batches;
create policy import_batches_select on import_batches for select to authenticated
  using ((select has_permission('import', 'perform')));

drop policy if exists import_rows_select on import_rows;
create policy import_rows_select on import_rows for select to authenticated
  using (
    (select has_permission('import', 'perform'))
    and exists (select 1 from import_batches b where b.id = batch_id)
  );

-- ===== מרשם =====

drop policy if exists students_select on students;
create policy students_select on students for select to authenticated
  using ((select has_permission('area_ops', 'access')) or (select has_permission('area_finance', 'access')));

drop policy if exists student_assignments_select on student_assignments;
create policy student_assignments_select on student_assignments for select to authenticated
  using ((select has_permission('area_ops', 'access')) or (select has_permission('area_finance', 'access')));

drop policy if exists organizations_select on organizations;
create policy organizations_select on organizations for select to authenticated
  using ((select has_permission('area_ops', 'access')) or (select has_permission('area_finance', 'access')));

drop policy if exists branches_select on branches;
create policy branches_select on branches for select to authenticated
  using ((select has_permission('area_ops', 'access')) or (select has_permission('area_finance', 'access')));

drop policy if exists groups_select on groups;
create policy groups_select on groups for select to authenticated
  using ((select has_permission('area_ops', 'access')) or (select has_permission('area_finance', 'access')));

-- ===== זכאות =====

drop policy if exists monthly_eligibility_select on monthly_eligibility;
create policy monthly_eligibility_select on monthly_eligibility for select to authenticated
  using ((select has_permission('area_ops', 'access')) or (select has_permission('area_finance', 'access')));
