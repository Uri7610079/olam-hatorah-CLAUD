-- תיקון: שתי תנועות זהות באותו יום נקלטו כאחת (2026-11-19)
--
-- נמצא בשטח: בפאג"י של ברכת אלימלך היו ב-20.10 שני זיכויים של 6,750 ₪, "קלירשיפט",
-- עם אותה אסמכתא. כל הפרטים זהים, ולכן הטביעה זהה והשני סומן "כפול" ולא נקלט.
--
-- הכלל החדש: בתוך משיכה אחת הבנק לא מציג את אותה תנועה פעמיים. לכן אם מופיעות כמה
-- תנועות זהות לגמרי, כל אחת היא תנועה נפרדת. השנייה מקבלת לאסמכתא תוספת "(2)", השלישית
-- "(3)" וכן הלאה. במשיכה הבאה אותו זוג יקבל שוב (1) ו-(2), ולכן לא ייקלט פעמיים.
-- התנועה הראשונה לא משתנה, ולכן מה שכבר נקלט נשאר כפי שהוא. הזיכוי השני ייקלט
-- במשיכה הבאה.

create or replace function scraper_normalize_transactions(p_transactions jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  with base as (
    select o,
      case
        when nullif(t ->> 'bank_transaction_id', '') is null then t
        else t || jsonb_build_object(
          'reference', scraper_reference(t ->> 'reference', t ->> 'bank_transaction_id'),
          'bank_transaction_id', null)
      end as t
    from jsonb_array_elements(coalesce(p_transactions, '[]'::jsonb)) with ordinality as x(t, o)
  ),
  numbered as (
    select o, t,
      row_number() over (
        partition by t ->> 'execution_date', coalesce(t ->> 'value_date', ''), t ->> 'direction',
                     (t ->> 'amount')::numeric, coalesce(t ->> 'reference', ''), coalesce(t ->> 'description', '')
        order by o) as n
    from base
  )
  select coalesce(jsonb_agg(
    case when n = 1 then t
         else t || jsonb_build_object('reference', btrim(coalesce(t ->> 'reference', '') || ' (' || n || ')'))
    end order by o), '[]'::jsonb)
  from numbered
$$;

-- בדיקת היתרה משווה ליתרה שנרשמה במשיכה הקודמת. היתרות שנרשמו עד עכשיו נרשמו כשחלק
-- מהתנועות עוד לא נקלטו בגלל התקלות שתוקנו ב-128 עד 130. לכן ההשוואה אליהן יוצאת שגויה,
-- כמו בהתראה של פאג"י, שבה התנועות שהשלימו את החסר נספרו פעמיים. מוחקים את היתרות
-- הישנות: המשיכה הבאה רושמת יתרה חדשה, ומהמשיכה שאחריה הבדיקה שוב אמיתית.
update bank_auto_sync_runs r
set bank_reported_balance = null
from bank_auto_sync_settings s
where s.id = r.setting_id and s.provider = 'office_scraper' and r.bank_reported_balance is not null;

update bank_auto_sync_runs r
set is_resolved = true, resolved_at = now()
from bank_auto_sync_settings s
where s.id = r.setting_id and s.provider = 'office_scraper'
  and r.status = 'partial' and r.is_resolved = false and r.gap_detail like 'בדיקת יתרה:%';
