-- תיקון: קליטת הבנק נכשלה ב-"function digest(text, unknown) does not exist"
--
-- נמצא בשטח (2026-11-19): כל ארבע הקליטות הראשונות מהסקרייפר נכשלו. compute_bank_fingerprint
-- (074) מחשבת גיבוב sha256 לתנועה שאין לה מזהה מהבנק, דרך digest() של pgcrypto. ב-Supabase
-- pgcrypto יושבת בסכמה extensions, והפונקציה נקראת מתוך ingest_bank_transactions_core,
-- שמגדירה search_path = public בלבד - ולכן digest לא נמצאת. עד עכשיו זה לא התגלה כי
-- המשיכה דרך ה-API מעולם לא רצה בפועל, והקליטה הידנית מחשבת את הטביעה בדפדפן.
-- (פאג"י החזירה תנועה אחת בלי מזהה - וזה הספיק כדי להפיל את כל הקליטה של החשבון.)
--
-- התיקון: search_path מפורש על הפונקציה עצמה, כך שהיא עובדת מכל מקום שקורא לה. בדיוק
-- כמו שכבר נעשה בפונקציות של תלמוד (118/120).
--
-- הקליטות שנכשלו לא השאירו תנועות חלקיות: הכישלון קרה בתוך בלוק שבוטל כולו. המשיכה
-- הבאה (שמושכת 45 ימים אחורה) תקלוט את כל התנועות, והחריגות על הכישלון אפשר לסמן כטופלו.

alter function compute_bank_fingerprint(uuid, text, date, date, text, numeric, text, text)
  set search_path = public, extensions;

-- ארבע הקליטות שנכשלו בגלל התקלה הזו - לא בגלל הבנק. הסיבה תוקנה, והמשיכה הבאה
-- תקלוט את התנועות שלהן; אין סיבה שיישארו פתוחות במרכז החריגות.
update bank_auto_sync_runs
set is_resolved = true, resolved_at = now()
where status = 'failed' and is_resolved = false and error_message like '%function digest(%does not exist%';
