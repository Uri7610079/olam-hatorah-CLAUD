-- שלב 16 (ביצועים): אינדקסים שחסרו לגמרי על עמודות שכבר מסוננות בפועל בכל המערכת -
-- נתפס בביקורת ביצועים (subagent), לא נתפס קודם כי בהיקף הנתונים הנוכחי (~4 עמותות,
-- ~18 סניפים, כמה עשרות תלמידי בדיקה) שום שאילתה לא מרגישה איטית - אבל בהיקף אמיתי
-- (אלפי תלמידים, לפי דרישת האפיון המפורשת) כל אחד מהם הופך לסריקה מלאה של הטבלה.
--
-- students: מסונן לפי status/is_demo בדשבורד התפעולי (048/053) ובמסך התלמידים (שלב 14)
-- בכל טעינה - אינדקס חלקי (is_demo=false) כי כמעט כל שאילתה אמיתית מסננת גם ככה.
create index students_status_idx on students (status) where is_demo = false;

-- student_assignments: יומן היסטורי append-only (משתנה, גדל ולעולם לא נמחק) שסונן
-- לפי organization_id/branch_id ב-5+ מסכים (דוחות, רטרו, זכאות, מכסות, יצוא לתלמוד) -
-- ולא לפי student_id/group_id (שכבר מאונדקסים) בשום אחד מהם.
create index student_assignments_org_active_idx on student_assignments (organization_id, is_active);
create index student_assignments_branch_active_idx on student_assignments (branch_id, is_active);

-- audit_events: append-only ובלתי מוגבל בגודל מטבעו (כל שינוי בכל טבלה מבוקרת יוצר שורה) -
-- "יומן פעילות" (AdminAuditLog) שולף תמיד לפי created_at desc limit 200 בלי שום סינון.
create index audit_events_created_at_idx on audit_events (created_at desc);
create index audit_events_resource_idx on audit_events (resource, resource_id, created_at desc);

-- חיפוש שם/מזהה: StudentsListScreen ו-GlobalSearch (שלב 14) משתמשים ב-ilike עם % מוביל,
-- שלא יכול להשתמש באינדקס btree רגיל בכלל - נדרש pg_trgm + GIN.
create extension if not exists pg_trgm;
create index students_full_name_trgm_idx on students using gin (full_name gin_trgm_ops);
create index students_external_id_trgm_idx on students using gin (external_id gin_trgm_ops);

-- חומרה נמוכה יותר אך זול וללא סיכון להוסיף עכשיו: document_expiry ו-masav_needs_correction
-- ב-unified_exceptions (048/053) מסננים לפי expiry_date/status בלי אינדקס תומך.
create index documents_expiry_status_idx on documents (expiry_date, status) where expiry_date is not null;
create index masav_batches_status_idx on masav_batches (status);
