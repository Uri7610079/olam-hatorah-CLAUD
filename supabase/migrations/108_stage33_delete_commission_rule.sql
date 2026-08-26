-- מחיקת כלל עמלה
--
-- עד כה לא הייתה מדיניות delete על commission_rules כלל, כלומר מחיקה
-- הייתה חסומה בשקט. הוספת מדיניות פתוחה הייתה פתרון גרוע: כלל ששימש
-- כבר לחישוב כספי אינו נתון שאפשר למחוק, אלא היסטוריה.
-- eligibility_financial_results.rule_id מפנה אליו, ומחיקתו הייתה משאירה
-- תוצאות כספיות שאי אפשר להסביר איך חושבו.
--
-- לכן ההבחנה הזו, והיא נאכפת כאן ולא במסך:
--
--   כלל שמעולם לא שימש לחישוב  →  נמחק באמת
--   כלל ששימש לחישוב            →  נחסם, עם הסבר שיש לכבות אותו
--
-- כיבוי (is_active=false) כבר קיים במסך ועושה בדיוק את מה שצריך: הכלל
-- מפסיק להשפיע על חישובים חדשים, וההיסטוריה נשארת מוסברת.
--
-- rule_snapshot בטבלת התוצאות שומר ממילא העתק מלא של הכלל בזמן החישוב,
-- ולכן ההיסטוריה קריאה גם בלי הכלל עצמו - אבל rule_id שמצביע לשומקום
-- הוא עדיין שקר, והבדיקה כאן מונעת אותו.

create or replace function delete_commission_rule(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
  v_org uuid;
begin
  if not has_permission('commission_rules', 'manage') then
    raise exception 'permission denied';
  end if;

  select organization_id into v_org from commission_rules where id = p_id;
  if v_org is null then
    raise exception 'הכלל אינו קיים';
  end if;

  select count(*) into v_used
  from eligibility_financial_results
  where rule_id = p_id;

  if v_used > 0 then
    raise exception
      'לא ניתן למחוק: הכלל כבר שימש לחישוב של % שורות זכאות. אפשר לכבות אותו כדי שיפסיק להשפיע על חישובים חדשים, וההיסטוריה תישאר מוסברת.',
      v_used;
  end if;

  delete from commission_rules where id = p_id;

  perform insert_audit_event(
    'delete_commission_rule', 'commission_rules', p_id::text,
    jsonb_build_object('organization_id', v_org)
  );
end;
$$;

comment on function delete_commission_rule(uuid) is
  'מוחק כלל עמלה שמעולם לא שימש לחישוב. כלל שכן שימש נחסם. ראה מיגרציה 108.';

revoke execute on function delete_commission_rule(uuid) from public, anon;
grant execute on function delete_commission_rule(uuid) to authenticated;

-- מדיניות delete נשארת סגורה בכוונה: המחיקה עוברת אך ורק דרך הפונקציה,
-- שהיא זו שבודקת את הקשר להיסטוריה הכספית. גישה ישירה הייתה עוקפת אותה.
