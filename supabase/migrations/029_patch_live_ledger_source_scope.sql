-- Patch לפרויקט החי: group_ledger_entries_source_unique (026, שלב 8) כבר רץ נגד הפרויקט
-- הקיים כ-unique גורף על (source_table, source_id) לכל שורה עם שני הערכים. זה נכון
-- עבור eligibility_financial_results (1:1 אמיתי - כל תוצאה נוצרת פעם אחת), אבל שגוי
-- עבור מקורות עתידיים כמו תרומות (שלב 9): תרומה יחידה יכולה לגיטימית לקבל כמה תנועות
-- באותו source_id לאורך חייה (פרסום ראשוני, ביטול עקב שינוי שיוך, פרסום מחדש לקבוצה
-- חדשה) - ה-unique הגורף היה חוסם את זה. מצמצם את ה-unique להיות ספציפי ל-
-- eligibility_financial_results בלבד; מקורות אחרים מגינים על עצמם דרך מכונת מצבים
-- ב-RPC הייעודי שלהם, לא דרך unique index גורף. idempotent (drop if exists + create).

drop index if exists group_ledger_entries_source_unique;
create unique index group_ledger_entries_source_unique on group_ledger_entries (source_table, source_id)
  where source_table = 'eligibility_financial_results' and source_id is not null;
