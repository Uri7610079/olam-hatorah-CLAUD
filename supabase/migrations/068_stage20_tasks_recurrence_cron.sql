-- שלב 20 (המשך): תזמון יומי ל-generate_due_recurrences() דרך pg_cron.
-- מיגרציה נפרדת מ-067 בכוונה: אם pg_cron חסום בתוכנית ה-Supabase הנוכחית, הרצה זו
-- תיכשל בלבד, בלי לגרור rollback על כל טבלאות/הרשאות/פונקציות התזכורות והחזרות (067).
-- אם ההרצה כאן נכשלת: יש להפעיל את ההרחבה ידנית דרך Database -> Extensions בלוח הבקרה
-- של Supabase, ואז להריץ את הקובץ הזה שוב (idempotent - cron.schedule עם אותו שם מחליף
-- job קיים, לא יוצר כפילות).

create extension if not exists pg_cron;

select cron.schedule('generate-due-task-recurrences', '0 6 * * *', $$select generate_due_recurrences();$$);
