-- שלב 22 (המשך) - תיקוני תקינות מביקורת ייעודית שנייה (הפעם לוגיקה, לא אבטחה) על
-- מודול המשימות. patch על מיגרציה שכבר רצה נגד הפרויקט החי (create or replace בלבד).
--
-- resolve_relative_reminder() (067) חישבה timestamptz מ-date בלי לציין אזור זמן - אין
-- "set timezone" בשום מיגרציה מ-1 עד עכשיו (נבדק), אז ברירת המחדל של Postgres/Supabase
-- (UTC) חלה. משמעות בפועל: תזכורת "יחסית ליעד, 0 ימים" הייתה מתפרשת כחצות UTC = השעה
-- 2-3 לפנות בוקר בישראל, לא חצות מקומי - התזכורת הייתה "מגיעה" מאוחר משציפו. נבדקו
-- שאר תיקוני התאריכים (לוח שנה, מסך בית, תבניות) - כולם היו בקוד הצד-לקוח, תוקנו שם
-- (dateUtils.ts חדש, לא כאן).
create or replace function resolve_relative_reminder(p_task_id uuid, p_days_before_due integer)
returns timestamptz
language sql
stable
as $$
  select ((t.due_date - (p_days_before_due || ' days')::interval)::timestamp at time zone 'Asia/Jerusalem')
  from tasks t where t.id = p_task_id and t.due_date is not null;
$$;
