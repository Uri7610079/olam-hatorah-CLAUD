-- שלב 30: דיווח ברמת "הקבוצה כפי שהיא באמת" - לפי ראש הקבוצה, ולא לפי רשומת ה-groups.
--
-- הרקע, כלשון הלקוח: "בהתנהלות היומיומית זו קבוצה אחת עם מנהל אחד. רק מבחינת הרישום
-- הכספי והמשפטי בעמותה, אלו שתי קבוצות." ובעקבות זאת: "הדוחות יופיעו ברצף לכל הקבוצות
-- ביחד לקבוצה (מכל הסניפים). אם קבוצה אחת מתנהלת בשתי עמותות, אז שיופיע בכל דוח של
-- הקבוצה בחלוקה לפי שתי העמותות."
--
-- מכאן שני כללים מדויקים, וכל מה שכאן נגזר מהם:
--   סניפים  -> מאחדים. הסניף אינו גבול דיווחי; הוא חלוקה פנימית של אותה עמותה.
--   עמותות  -> מפצלים. זה גבול משפטי אמיתי: הלקוח אישר במפורש חשבון נפרד ותשלום
--              נפרד מכל עמותה, ולכן איחוד סכומים בין עמותות היה מציג מספר שאי אפשר
--              לשלם ואי אפשר להתאים לבנק.
--
-- לכן היחידה הדיווחית כאן היא (ראש קבוצה × עמותה), ולא ראש קבוצה לבדו.
--
-- מפתח הזיהוי הוא group_leader_id ולא שם הקבוצה. שם הקבוצה תואר כ"דומה" בין הסניפים,
-- לא זהה, ולכן הוא מפתח לא אמין; ראש הקבוצה כבר מוגדר כטבלה עצמאית בלי שיוך לעמותה
-- (מיגרציה 005), וזה בדיוק הצומת שמחזיק את הזהות האמיתית.
--
-- אין כאן שום שינוי במבנה הנתונים: לא נוספה טבלה, לא שונתה עמודה, ולא הוזז כסף.
-- הכל תצוגה מחושבת מעל הרישום הקיים, שנשאר מופרד כנדרש.

-- יתרות מאוחדות לראש קבוצה, בתוך כל עמותה בנפרד.
--
-- security_invoker=true כדי לכבד RLS על group_ledger_entries, בדיוק כמו group_balances.
-- ראשי קבוצה בלי שיוך (group_leader_id is null) לא מופיעים כאן - אין להם "קבוצה
-- מאוחדת", והם ממשיכים להיראות כרגיל במסך היתרות לפי קבוצה.
create view group_leader_balances
with (security_invoker = true)
as
select
  g.group_leader_id,
  gl.full_name as group_leader_name,
  b.organization_id,
  o.legal_name as organization_name,
  count(distinct g.id) as group_count,
  count(distinct g.branch_id) as branch_count,
  -- sum על ה-join עם שורות הספר תקין: כל שורת ספר מופיעה פעם אחת בדיוק, כי החיבור
  -- הוא group_id -> groups.id (יחיד). ה-count משתמש ב-distinct דווקא כן, כי שם
  -- הריבוי כן היה מנפח.
  coalesce(sum(gle.amount), 0)::numeric(12, 2) as balance
from groups g
join branches b on b.id = g.branch_id
join organizations o on o.id = b.organization_id
join group_leaders gl on gl.id = g.group_leader_id
left join group_ledger_entries gle on gle.group_id = g.id
where g.group_leader_id is not null
group by g.group_leader_id, gl.full_name, b.organization_id, o.legal_name;

grant select on group_leader_balances to authenticated;

-- הרשומות המרכיבות: מה מסתתר מאחורי כל שורה מאוחדת. נדרש כדי שהאיחוד לא יהיה "קופסה
-- שחורה" - תמיד אפשר לפתוח ולראות אילו קבוצות ואילו סניפים הרכיבו את הסכום, וזה גם
-- מה שעונה על תרחיש הביקורת (סניף אחד עבר ביקורת והשני לא).
create view group_leader_group_rows
with (security_invoker = true)
as
select
  g.group_leader_id,
  b.organization_id,
  o.legal_name as organization_name,
  g.id as group_id,
  g.name as group_name,
  g.status as group_status,
  b.id as branch_id,
  b.internal_name as branch_name,
  b.talmud_branch_code,
  coalesce(sum(gle.amount), 0)::numeric(12, 2) as balance
from groups g
join branches b on b.id = g.branch_id
join organizations o on o.id = b.organization_id
left join group_ledger_entries gle on gle.group_id = g.id
where g.group_leader_id is not null
group by g.group_leader_id, b.organization_id, o.legal_name, g.id, g.name, g.status, b.id, b.internal_name, b.talmud_branch_code;

grant select on group_leader_group_rows to authenticated;

-- אינדקס על המפתח שלפיו מאחדים. בלי זה כל מסך שמסנן לפי ראש קבוצה היה סורק את כל
-- טבלת הקבוצות.
create index if not exists groups_leader_idx on groups (group_leader_id);

-- אי-התאמה בכללי עמלה בין הרשומות של אותו ראש קבוצה.
--
-- למה זה נחוץ דווקא עכשיו: ברגע שהמשתמשת תופסת את הקבוצה כיחידה אחת, קל להניח ששינוי
-- כלל עמלה חל על כולה. בפועל commission_rules נקבע לפי group_id, ולכן עדכון של רשומה
-- אחת משאיר את האחרת על התנאים הישנים - בשקט, ובלי שאף מסך יראה זאת. הפונקציה מחזירה
-- רק ראשי קבוצה שבהם קיים פער בפועל.
--
-- ההשוואה היא בתוך אותה עמותה בלבד. בין עמותות שוני בתנאים הוא לגיטימי לחלוטין (הסכם
-- נפרד מול כל עמותה), ודיווח עליו כחריגה היה מייצר רעש במקום מידע.
create or replace function group_leader_commission_mismatches()
returns table (
  group_leader_id uuid,
  group_leader_name text,
  organization_id uuid,
  organization_name text,
  distinct_rule_shapes integer,
  group_count integer
)
language sql
stable
as $$
  with active_rules as (
    select
      g.group_leader_id,
      b.organization_id,
      g.id as group_id,
      -- "צורת הכלל": מה שקובע כמה כסף יוצא. שדות תיאור (הערות, מי יצר) לא נכללים
      -- בכוונה - הבדל בהם אינו אי-התאמה עסקית.
      string_agg(
        coalesce(cr.calculation_type, '-') || ':' ||
        coalesce(cr.percentage::text, '-') || ':' ||
        coalesce(cr.fixed_amount::text, '-') || ':' ||
        coalesce(cr.rounding_rule, '-'),
        '|' order by cr.calculation_type, cr.percentage, cr.fixed_amount, cr.rounding_rule
      ) as rule_shape
    from groups g
    join branches b on b.id = g.branch_id
    left join commission_rules cr
      on cr.group_id = g.id
     and cr.effective_from <= current_date
     and (cr.effective_until is null or cr.effective_until >= current_date)
    where g.group_leader_id is not null
      and g.status = 'active'
    group by g.group_leader_id, b.organization_id, g.id
  )
  select
    ar.group_leader_id,
    gl.full_name,
    ar.organization_id,
    o.legal_name,
    count(distinct coalesce(ar.rule_shape, ''))::integer,
    count(*)::integer
  from active_rules ar
  join group_leaders gl on gl.id = ar.group_leader_id
  join organizations o on o.id = ar.organization_id
  group by ar.group_leader_id, gl.full_name, ar.organization_id, o.legal_name
  having count(*) > 1
     and count(distinct coalesce(ar.rule_shape, '')) > 1;
$$;

grant execute on function group_leader_commission_mismatches() to authenticated;
