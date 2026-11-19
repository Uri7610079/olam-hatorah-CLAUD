-- כלל סיווג מסיווג ידני (2026-11-19)
--
-- החלטת צ'ני: כשהפקיד מסווג תנועה ידנית, המערכת שואלת "לסווג ככה מעכשיו את כל
-- התנועות עם התיאור הזה?". אישור יוצר כלל קבוע, ואותו כלל מסווג מיד גם את התנועות
-- הדומות שכבר נמצאות במערכת וטרם אושרו.
--
-- הכלל נוצר בוודאות גבוהה (אדם בחר את הסוג), ולכן תנועות עתידיות עם אותו תיאור
-- מאושרות אוטומטית בקליטה (124). עדיפות 100 - כלל שאדם קבע גובר על הכללים הכלליים
-- של 131. ברירת המחדל: הכלל חל רק על החשבון של התנועה, כי אותו תיאור יכול להיות דבר
-- אחר בעמותה אחרת (למשל "קרן עולם התורה").

create or replace function create_rule_from_transaction(
  p_transaction_id uuid,
  p_pattern text,
  p_this_account_only boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx bank_transactions;
  v_pattern text := btrim(coalesce(p_pattern, ''));
  v_match_type text;
  v_rule_id uuid;
  v_applied integer;
begin
  if not has_permission('transaction_classification', 'perform') then
    raise exception 'permission denied';
  end if;

  select * into v_tx from bank_transactions where id = p_transaction_id;
  if v_tx.id is null then raise exception 'התנועה לא נמצאה'; end if;
  if v_tx.confirmed_type_id is null then raise exception 'יש לסווג את התנועה לפני יצירת כלל'; end if;
  if char_length(v_pattern) < 3 then raise exception 'הטקסט לזיהוי קצר מדי - לפחות 3 תווים'; end if;
  if coalesce(v_tx.description, '') not ilike '%' || v_pattern || '%' then
    raise exception 'הטקסט "%" לא מופיע בתיאור התנועה', v_pattern;
  end if;

  v_match_type := case when v_tx.description ilike v_pattern || '%' then 'starts_with' else 'contains' end;

  insert into recognition_rules (
    organization_bank_account_id, direction, text_match_type, text_match_value,
    suggested_type_id, confidence_level, priority, is_active, notes, created_by
  ) values (
    case when p_this_account_only then v_tx.organization_bank_account_id end,
    v_tx.direction, v_match_type, v_pattern,
    v_tx.confirmed_type_id, 'high', 100, true,
    'נוצר מסיווג ידני של תנועה', auth.uid()
  )
  returning id into v_rule_id;

  -- תנועות דומות שעוד לא אושרו - מקבלות את אותו סוג ומאושרות (אדם כבר החליט)
  update bank_transactions bt
  set suggested_type_id = v_tx.confirmed_type_id,
      suggested_confidence = 'high',
      suggested_rule_id = v_rule_id,
      suggested_reason = 'כלל שנוצר מסיווג ידני',
      confirmed_type_id = v_tx.confirmed_type_id,
      classification_status = 'confirmed'
  where bt.id <> v_tx.id
    and bt.classification_status in ('unclassified', 'suggested')
    and bt.direction = v_tx.direction
    and (not p_this_account_only or bt.organization_bank_account_id = v_tx.organization_bank_account_id)
    and (
      (v_match_type = 'starts_with' and bt.description ilike v_pattern || '%')
      or (v_match_type = 'contains' and bt.description ilike '%' || v_pattern || '%')
    );
  get diagnostics v_applied = row_count;

  perform insert_audit_event('create_rule_from_transaction', 'recognition_rules', v_rule_id::text,
    jsonb_build_object('transaction_id', p_transaction_id, 'pattern', v_pattern, 'applied', v_applied, 'this_account_only', p_this_account_only));

  return jsonb_build_object('rule_id', v_rule_id, 'applied', v_applied);
end;
$$;
revoke execute on function create_rule_from_transaction(uuid, text, boolean) from public, anon;
grant execute on function create_rule_from_transaction(uuid, text, boolean) to authenticated;
