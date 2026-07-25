-- ניקוי סופי לפני מסירה ללקוח - לבקשת Chani, אחרי סיום שלב 17 (Audit סופי).
--
-- TRUNCATE ולא DELETE: TRUNCATE לא מפעיל טריגרים ברמת-שורה (before delete וכו') - עוקף
-- באופן טבעי את כל טריגרי ה-append-only/guard שנבנו לאורך הפרויקט (block_ledger_mutation,
-- block_audit_mutation, block_retro_mutation, enforce_*_mutation ודומיהם) בלי לגעת באף
-- אחד מהם, ובלי צורך לחשב סדר מחיקה ידני - כל הטבלאות המפורטות מרוקנות יחד באותה פקודה,
-- כך שאין בעיית סדר תלות (CASCADE הוא רשת ביטחון נוספת לכל טבלה שהושמטה בטעות).
-- TRUNCATE דורש הרשאת בעלים על הטבלה - מורץ ע"י Chani דרך עורך ה-SQL של Supabase (לא
-- דרך ה-API של האפליקציה, ששם אין לתפקיד authenticated הרשאת TRUNCATE בכלל).
--
-- נשארות בכוונה (הגדרות מערכת + משתמשים אמיתיים, לא נתוני עסק): roles, permissions,
-- role_permissions, profiles, user_permissions (מערכת ההרשאות והצוות עצמו) +
-- import_profiles, export_profiles, bank_import_profiles, bank_transaction_types,
-- study_codes, letter_templates (טבלאות הגדרה/לוקאפ כלליות של המערכת - לא ספציפיות
-- לעמותה/תלמיד/תנועה, ולכן לא "נתוני בדיקה" במובן העסקי).
--
-- נמחקות: כל 44 הטבלאות הנותרות (כל מבנה הארגון, כל תלמיד/שיוך/חשבון, כל זכאות/עמלה/
-- ספר תנועות, כל תרומה/חלוקה/מס"ב/בנק/החזרה, כל ביקורת/רשימה טלפונית/מסמך/מכתב, כל
-- חבילת דמו, יומן פעולות ומסנני חיפוש אישיים).

truncate table
  access_requests,
  audit_attendance,
  audit_events,
  audits,
  automation_policies,
  bank_import_batches,
  bank_import_rows,
  bank_matches,
  bank_transactions,
  branches,
  commission_rules,
  demo_batches,
  distribution_batches,
  distribution_lines,
  documents,
  donations,
  eligibility_financial_results,
  export_batch_students,
  export_batches,
  financial_periods,
  group_leader_assignments,
  group_leaders,
  group_ledger_entries,
  groups,
  import_batches,
  import_rows,
  letters,
  masav_batches,
  masav_lines,
  monthly_eligibility,
  monthly_quotas,
  organization_bank_accounts,
  organization_officeholders,
  organizations,
  payment_calculation_versions,
  payment_returns,
  phone_list_entries,
  phone_list_imports,
  recognition_rules,
  saved_filters,
  student_assignments,
  student_bank_accounts,
  students,
  talmud_errors
cascade;

-- ניקוי קבצים שהועלו במהלך הבדיקה: Supabase חוסם DELETE ישיר על storage.objects
-- (storage.protect_delete() - "Use the Storage API instead", נתפס בהרצה חיה) - חובה
-- לנקות ידנית דרך לוח הבקרה (Storage) ולא דרך SQL: לכל אחד מהדליים student-documents,
-- import-files, talmud-exports, donation-documents, organization-documents,
-- bank-import-files, phone-list-files - לבחור את כל הקבצים ולמחוק דרך הממשק.
