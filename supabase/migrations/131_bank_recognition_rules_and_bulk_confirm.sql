-- כללי סיווג לתנועות הבנק + אישור הרבה הצעות בבת אחת (2026-11-19)
--
-- עד עכשיו לא היה במערכת אף כלל זיהוי, ולכן עמודת "הצעת סיווג" הייתה ריקה בכל 319
-- התנועות הראשונות מהסקרייפר. הכללים כאן נבנו מהתיאורים האמיתיים שהבנקים שולחים.
--
-- ודאות גבוהה = הטקסט של הבנק אומר במפורש מה זה (עמלה, משרד החינוך, הלוואה, משיכת
--   שיק). תנועה כזו מאושרת אוטומטית (הגדרת האוטומציה auto_confirm_classification).
-- ודאות בינונית = סביר מאוד אבל לא ודאי (למשל זיכוי מאדם פרטי = תרומה). נשאר כהצעה,
--   והפקיד מאשר את כולן בלחיצה אחת ("אישור כל ההצעות").
--
-- לא נבנו כללים לשלושה סוגי תנועות שצריך בהם החלטה של צ'ני (נשארים "לא מזוהה"):
--   * פאג"י (ברכת אלימלך): חיובים בשם "ברכת אלימלך (ע"ר)", אסמכתא 80380
--   * מרכנתיל (אור דוד): "חיוב תשלומים מוסד 00076390"
--   * פאג"י: זיכויים מ"קרן עולם התורה"
--
-- כלל שנוסף עכשיו יחול גם על התנועות שכבר נקלטו (סעיף 3), וכל משיכה חדשה מסווגת
-- לבד (כך זה כבר עובד מאז 124).

-- ===== 1. הכללים =====
-- כל כלל מזוהה לפי notes כדי שהרצה חוזרת של הקובץ לא תכפיל אותו.
with r(code, direction, match_type, match_value, confidence, priority, notes) as (
  values
    ('masav',                  'debit',  'contains',    'העברת קובץ זיכויים', 'high',   90, 'כלל-131: קובץ זיכויים מס"ב'),
    ('payment_return',         'credit', 'contains',    'החזר זיכוי',         'medium', 80, 'כלל-131: החזר זיכוי (חזרה ממס"ב)'),
    ('government_support',     'credit', 'contains',    'משרד החינו',         'high',   70, 'כלל-131: משרד החינוך'),
    ('loan_interest',          'debit',  'contains',    'הלוואה',             'high',   70, 'כלל-131: הלוואה - קרן/ריבית'),
    ('forex',                  null,     'contains',    'המרת מט"ח',          'high',   70, 'כלל-131: המרת מט"ח'),
    ('withdrawal',             'debit',  'starts_with', 'משיכת שיק',          'high',   60, 'כלל-131: משיכת שיק'),
    ('donation',               'credit', 'contains',    'תרומ',               'high',   60, 'כלל-131: הבנק כתב "תרומה"'),
    ('bank_fee',               'debit',  'contains',    'עמלת',               'high',   50, 'כלל-131: עמלות בנק'),
    ('inter_account_transfer', 'credit', 'contains',    'העברה מישיבת אור דוד', 'medium', 45, 'כלל-131: העברה מישיבת אור דוד'),
    ('donation',               'credit', 'contains',    'קלירשיפט',           'medium', 40, 'כלל-131: סליקת אשראי (קלירשיפט)'),
    ('donation',               'credit', 'contains',    'זה"ב',               'medium', 40, 'כלל-131: העברה מחו"ל'),
    ('donation',               'credit', 'contains',    'זיכוי מ',            'medium', 30, 'כלל-131: זיכוי מחשבון של אדם/גוף'),
    ('donation',               'credit', 'contains',    'הפקדת שיק',          'medium', 30, 'כלל-131: הפקדת שיק')
)
insert into recognition_rules (direction, text_match_type, text_match_value, suggested_type_id, confidence_level, priority, is_active, notes)
select r.direction, r.match_type, r.match_value, t.id, r.confidence, r.priority, true, r.notes
from r
join bank_transaction_types t on t.code = r.code
where not exists (select 1 from recognition_rules x where x.notes = r.notes);

-- ===== 2. אישור הרבה הצעות בבת אחת =====
-- מאשרת את כל ההצעות של חשבון אחד (או רק את הרשימה שהועברה). כל אישור עובר באותו
-- מסלול כמו אישור בודד, כולל ההמשך האוטומטי (תרומה ממתינה לשיוך, החזר תשלום - 125).
create or replace function confirm_suggested_transactions(
  p_organization_bank_account_id uuid,
  p_transaction_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not has_permission('transaction_classification', 'perform') then
    raise exception 'permission denied';
  end if;

  update bank_transactions bt
  set confirmed_type_id = bt.suggested_type_id,
      classification_status = 'confirmed'
  where bt.organization_bank_account_id = p_organization_bank_account_id
    and bt.classification_status = 'suggested'
    and bt.suggested_type_id is not null
    and (p_transaction_ids is null or bt.id = any(p_transaction_ids));
  get diagnostics v_count = row_count;

  perform insert_audit_event('confirm_suggested_transactions', 'bank_transactions', p_organization_bank_account_id::text,
    jsonb_build_object('confirmed_count', v_count, 'selected', p_transaction_ids is not null));
  return v_count;
end;
$$;
revoke execute on function confirm_suggested_transactions(uuid, uuid[]) from public, anon;
grant execute on function confirm_suggested_transactions(uuid, uuid[]) to authenticated;

-- ===== 3. הפעלת הכללים על התנועות שכבר נקלטו =====
-- אותה לוגיקה כמו suggest_transaction_types (037), לכל החשבונות. (הפונקציה עצמה דורשת
-- הרשאת משתמש, ולכן כאן היא כתובה ישירות.)
update bank_transactions bt
set suggested_type_id = r.suggested_type_id,
    suggested_confidence = r.confidence_level,
    suggested_reason = 'התאמה לכלל זיהוי (עדיפות ' || r.priority || ')',
    suggested_rule_id = r.id,
    classification_status = 'suggested'
from bank_transactions bt2
cross join lateral match_recognition_rule(bt2.organization_bank_account_id, bt2.direction, bt2.amount, bt2.description, bt2.reference, bt2.execution_date) r
where bt.id = bt2.id
  and bt2.classification_status = 'unclassified'
  and r.id is not null;

-- ודאות גבוהה מאושרת אוטומטית, בדיוק כמו בקליטה (124)
update bank_transactions bt
set confirmed_type_id = bt.suggested_type_id,
    classification_status = 'confirmed',
    suggested_reason = coalesce(bt.suggested_reason, '') || ' · אושר אוטומטית (ודאות גבוהה)'
where automation_enabled('auto_confirm_classification')
  and bt.classification_status = 'suggested'
  and bt.suggested_confidence = 'high'
  and bt.suggested_type_id is not null;
