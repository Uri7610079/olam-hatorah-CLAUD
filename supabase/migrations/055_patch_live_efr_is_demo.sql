-- Patch לפרויקט החי: eligibility_financial_results (026, שלב 8) נבנתה בלי is_demo/
-- demo_batch_id - השמטה ישנה, לא קשורה לשלב הנוכחי, שנתפסה רק עכשיו כי create_demo_batch()
-- (052) הוא הדבר הראשון שאי-פעם ניסה לתייג שורה בטבלה הזו כדמו. נכשל בבדיקה חיה הראשונה
-- עם "column is_demo of relation eligibility_financial_results does not exist" - כל
-- הפעולה חזרה לאחור בטרנזקציה אחת (create_demo_batch כולה פונקציה אחת), כך שלא נוצרה
-- אף שורה חלקית. 026 עודכן בדיסק עם אותן שתי עמודות; זהו ה-patch לפרויקט הקיים.
alter table eligibility_financial_results add column is_demo boolean not null default false;
alter table eligibility_financial_results add column demo_batch_id uuid;
