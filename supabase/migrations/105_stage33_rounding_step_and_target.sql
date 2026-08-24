-- עיגול לכפולות, ועיגול הסכום לתלמיד
--
-- שני חוסרים שהתגלו כשניגשו להזין כללי עמלה אמיתיים:
--
-- 1. העיגול ידע רק שקל שלם. הבקשה בפועל היא לעגל לכפולות של 10:
--    תלמיד שיוצא לו 99 ש"ח מקבל 90.
--
-- 2. העיגול פעל על *העמלה*, ואילו הבקשה מדברת על *הסכום שהתלמיד מקבל*.
--    אלה לא אותו דבר: עיגול העמלה כלפי מטה מגדיל את הסכום לתלמיד, וזה
--    ההפך ממה שהתבקש.
--
-- לכן שני שדות חדשים, ולא אחד:
--
--   rounding_step     לאיזו כפולה מעגלים. 1 = התנהגות קודמת בדיוק.
--   rounding_target   על מה חל העיגול: העמלה או הסכום לתלמיד.
--
-- rounding_rule נשאר כשהיה ומשמעותו מעתה *כיוון* בלבד (לקרוב / מעלה /
-- מטה). ערכיו לא שונו כדי שכללים קיימים ימשיכו לעבוד, ושתי ברירות
-- המחדל - צעד 1 ועיגול על העמלה - הן בדיוק ההתנהגות שהייתה עד כה.
--
-- מה קורה להפרש: הברוטו נקבע בדוח של תלמוד ואינו משתנה, ולכן
-- ברוטו = עמלה + נטו תמיד. כשמעגלים את הסכום לתלמיד מ-99 ל-90, תשעת
-- השקלים עוברים לעמלה - אין להם מקום אחר. זו החלטה כספית אמיתית,
-- ולכן היא נאמרת במפורש במסך ולא נעשית בשקט.

alter table commission_rules
  add column if not exists rounding_step numeric(12, 2) not null default 1,
  add column if not exists rounding_target text not null default 'commission';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'commission_rules_rounding_step_positive') then
    alter table commission_rules
      add constraint commission_rules_rounding_step_positive check (rounding_step > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'commission_rules_rounding_target_valid') then
    alter table commission_rules
      add constraint commission_rules_rounding_target_valid check (rounding_target in ('commission', 'net'));
  end if;
end $$;

comment on column commission_rules.rounding_step is
  'לאיזו כפולה מעגלים. 1 = שקל שלם, 10 = כפולות של עשרה. ראה מיגרציה 105.';
comment on column commission_rules.rounding_target is
  'על מה חל העיגול: commission = על העמלה, net = על הסכום שהתלמיד מקבל.';

-- ===== העיגול עצמו =====
-- בפונקציה נפרדת כדי שהכיוון והצעד יחושבו במקום אחד בלבד, ולא ישוכפלו
-- בין ענף העמלה לענף הנטו.

create or replace function apply_rounding(p_value numeric, p_rule text, p_step numeric)
returns numeric
language sql
immutable
as $$
  select case
    when p_value is null then null
    when p_rule = 'none' or coalesce(p_step, 0) <= 0 then p_value
    when p_rule = 'round_int' then round(p_value / p_step) * p_step
    when p_rule = 'ceil_int'  then ceil(p_value / p_step) * p_step
    when p_rule = 'floor_int' then floor(p_value / p_step) * p_step
    else p_value
  end
$$;

comment on function apply_rounding(numeric, text, numeric) is
  'עיגול לכפולה של p_step בכיוון p_rule. ראה מיגרציה 105.';

-- ===== החישוב =====
-- זהה ל-025, למעט קטע העיגול.

create or replace function compute_commission(p_rule commission_rules, p_gross numeric)
returns table (commission_amount numeric, net_amount numeric)
language plpgsql
immutable
as $$
declare
  v_commission numeric;
  v_net numeric;
  v_step numeric;
begin
  if p_rule.id is null then
    return query select 0::numeric(12, 2), round(p_gross, 2)::numeric(12, 2);
    return;
  end if;

  v_commission := case p_rule.calculation_type
    when 'percentage' then p_gross * coalesce(p_rule.percentage, 0) / 100
    when 'fixed' then coalesce(p_rule.fixed_amount, 0)
    when 'combined' then (p_gross * coalesce(p_rule.percentage, 0) / 100) + coalesce(p_rule.fixed_amount, 0)
    else 0
  end;

  v_step := coalesce(p_rule.rounding_step, 1);

  if coalesce(p_rule.rounding_target, 'commission') = 'net' then
    -- מעגלים את מה שהתלמיד מקבל, וההפרש נופל לעמלה. הברוטו קבוע ומגיע
    -- מתלמוד, ולכן ברוטו = עמלה + נטו נשמר בהכרח.
    v_net := apply_rounding(p_gross - v_commission, p_rule.rounding_rule, v_step);
    v_net := greatest(0, least(v_net, p_gross));
    v_commission := p_gross - v_net;
  else
    v_commission := apply_rounding(v_commission, p_rule.rounding_rule, v_step);
  end if;

  -- הגנת סנאטי (לא כלל עסקי): עמלה לעולם לא שלילית ולא גדולה מהברוטו.
  v_commission := greatest(0, least(v_commission, p_gross));

  return query select v_commission::numeric(12, 2), (p_gross - v_commission)::numeric(12, 2);
end;
$$;

revoke execute on function compute_commission(commission_rules, numeric) from public, anon, authenticated;
