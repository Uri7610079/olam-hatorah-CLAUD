-- עריכת סיווג שכבר אושר (2026-11-19)
--
-- בקשת צ'ני: לאפשר לשנות "סיווג מאושר" - חד-פעמית (רק התנועה הזו) או כללית (כלל
-- שחל גם על תנועות דומות, כולל כאלה שכבר אושרו).
--
-- הזהירות: אישור סיווג יכול להפעיל המשך אוטומטי (125):
--   * "תרומה" -> נוצרת תרומה ממתינה לשיוך. כשמשנים לסוג אחר, התרומה מבוטלת (סטטוס
--     "נדחתה") וההתאמה לתנועה מבוטלת. תרומה שכבר שויכה לקבוצה ואושרה - כבר נכנסה
--     ליתרת הקבוצה, ולכן השינוי נחסם עם הסבר (מבטלים אותה קודם במסך התרומות).
--   * "החזר תשלום" -> ייתכן שנרשמה החזרה לתשלום מס"ב. אם נרשמה - השינוי נחסם עם הסבר.

create or replace function auto_donation_from_bank(p_tx uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx bank_transactions;
  v_org uuid;
  v_group uuid;
  v_donation uuid;
  v_match uuid;
  v_month date;
  v_prev_status text;
  v_prev_group text;
begin
  select * into v_tx from bank_transactions where id = p_tx;
  if v_tx.id is null or v_tx.direction <> 'credit' then return; end if;
  -- (133) תרומה שבוטלה כי הסיווג שונה לא חוסמת יצירה מחדש אם הסיווג חזר ל"תרומה"
  if exists (select 1 from donations where bank_transaction_id = p_tx and status <> 'rejected') then return; end if;

  select organization_id into v_org from organization_bank_accounts where id = v_tx.organization_bank_account_id;
  select r.donation_group_id into v_group from recognition_rules r where r.id = v_tx.suggested_rule_id;
  v_month := date_trunc('month', v_tx.execution_date)::date;

  insert into donations (organization_id, group_id, donation_date, amount, reference, bank_transaction_id, notes)
  values (v_org, v_group, v_tx.execution_date, v_tx.amount, left(coalesce(v_tx.description, ''), 200), p_tx,
          'נוצרה אוטומטית מתנועת בנק')
  returning id into v_donation;

  insert into bank_matches (bank_transaction_id, match_type, target_table, target_id, matched_amount, suggested_reason)
  values (p_tx, 'donation', 'donations', v_donation, v_tx.amount, 'תרומה שנוצרה אוטומטית מהתנועה')
  returning id into v_match;
  perform approve_bank_match_core(v_match);

  if v_group is null then
    perform log_automation('auto_donations', v_org, v_month, 'done',
      'תרומה ' || to_char(v_tx.amount, 'FM999,999,990.00') || ' נוצרה וממתינה לשיוך לקבוצה');
    return;
  end if;

  if not ensure_open_period(v_org, v_month) then
    perform log_automation('auto_donations', v_org, v_month, 'skipped',
      'תרומה ' || to_char(v_tx.amount, 'FM999,999,990.00') || ' נוצרה, אך החודש הכספי אינו פתוח - ממתינה לאישור');
    return;
  end if;

  -- אותו אישור כמו approve_donation (030), בלי בדיקת ההרשאה. הדגל מוחזר לערכו הקודם.
  v_prev_status := coalesce(current_setting('app.allow_donation_status_change', true), '');
  perform set_config('app.allow_donation_status_change', 'true', true);
  update donations set status = 'approved' where id = v_donation;
  perform set_config('app.allow_donation_status_change', v_prev_status, true);

  insert into group_ledger_entries (organization_id, group_id, entry_type, amount, period_month, source_table, source_id, reference, created_by)
  values (v_org, v_group, 'donation', v_tx.amount, v_month, 'donations', v_donation, left(coalesce(v_tx.description, ''), 200), null);

  perform insert_audit_event('approve_donation', 'donations', v_donation::text, jsonb_build_object('group_id', v_group, 'automatic', true));
  perform log_automation('auto_donations', v_org, v_month, 'done',
    'תרומה ' || to_char(v_tx.amount, 'FM999,999,990.00') || ' נוצרה, שויכה לקבוצה ואושרה');
end;
$$;
revoke execute on function auto_donation_from_bank(uuid) from public, anon, authenticated;

-- מחזירה null אם השינוי בוצע, או הסבר למה נחסם
create or replace function change_transaction_type_core(p_tx uuid, p_type uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx bank_transactions;
  v_old_code text;
  v_don donations;
  v_prev text;
begin
  select * into v_tx from bank_transactions where id = p_tx;
  if v_tx.id is null then return 'התנועה לא נמצאה'; end if;
  if v_tx.confirmed_type_id is not distinct from p_type and v_tx.classification_status = 'confirmed' then return null; end if;

  select code into v_old_code from bank_transaction_types where id = v_tx.confirmed_type_id;

  if v_old_code = 'payment_return' and exists (
    select 1 from bank_matches where bank_transaction_id = p_tx and target_table = 'payment_returns' and status = 'approved'
  ) then
    return 'כבר נרשמה החזרה לתשלום מס"ב מהתנועה הזו - יש לבטל אותה קודם במסך ההחזרות';
  end if;

  if v_old_code = 'donation' then
    for v_don in select * from donations where bank_transaction_id = p_tx and status <> 'rejected' loop
      if v_don.status = 'approved' then
        return 'התרומה מהתנועה הזו כבר שויכה לקבוצה ואושרה - יש לבטל אותה קודם במסך התרומות';
      end if;
      update bank_matches set status = 'rejected', rejected_reason = 'סיווג התנועה שונה מ"תרומה"'
      where bank_transaction_id = p_tx and target_table = 'donations' and target_id = v_don.id and status <> 'rejected';
      v_prev := coalesce(current_setting('app.allow_donation_status_change', true), '');
      perform set_config('app.allow_donation_status_change', 'true', true);
      update donations set status = 'rejected', rejection_reason = 'סיווג תנועת הבנק שונה מ"תרומה"' where id = v_don.id;
      perform set_config('app.allow_donation_status_change', v_prev, true);
    end loop;
  end if;

  update bank_transactions set confirmed_type_id = p_type, classification_status = 'confirmed' where id = p_tx;
  perform insert_audit_event('change_transaction_type', 'bank_transactions', p_tx::text,
    jsonb_build_object('from_type_id', v_tx.confirmed_type_id, 'to_type_id', p_type));
  return null;
end;
$$;
revoke execute on function change_transaction_type_core(uuid, uuid) from public, anon, authenticated;

create or replace function change_transaction_type(p_transaction_id uuid, p_type_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_block text;
begin
  if not has_permission('transaction_classification', 'perform') then
    raise exception 'permission denied';
  end if;
  v_block := change_transaction_type_core(p_transaction_id, p_type_id);
  if v_block is not null then raise exception '%', v_block; end if;
end;
$$;
revoke execute on function change_transaction_type(uuid, uuid) from public, anon;
grant execute on function change_transaction_type(uuid, uuid) to authenticated;

-- כלל מסיווג ידני (132) + אפשרות לשנות גם תנועות דומות שכבר אושרו
drop function if exists create_rule_from_transaction(uuid, text, boolean);
create or replace function create_rule_from_transaction(
  p_transaction_id uuid,
  p_pattern text,
  p_this_account_only boolean default true,
  p_include_confirmed boolean default false
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
  v_applied integer := 0;
  v_changed integer := 0;
  v_blocked integer := 0;
  v_id uuid;
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

  -- כלל קודם עם אותו טקסט, כיוון וחשבון - מוחלף (מושבת), כדי שלא יתחרו שני כללים על אותן תנועות
  update recognition_rules set is_active = false
  where is_active and text_match_value = v_pattern and text_match_type = v_match_type
    and direction is not distinct from v_tx.direction
    and organization_bank_account_id is not distinct from (case when p_this_account_only then v_tx.organization_bank_account_id end);

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
    and ((v_match_type = 'starts_with' and bt.description ilike v_pattern || '%')
      or (v_match_type = 'contains' and bt.description ilike '%' || v_pattern || '%'));
  get diagnostics v_applied = row_count;

  if p_include_confirmed then
    for v_id in
      select bt.id from bank_transactions bt
      where bt.id <> v_tx.id
        and bt.classification_status = 'confirmed'
        and bt.confirmed_type_id is distinct from v_tx.confirmed_type_id
        and bt.direction = v_tx.direction
        and (not p_this_account_only or bt.organization_bank_account_id = v_tx.organization_bank_account_id)
        and ((v_match_type = 'starts_with' and bt.description ilike v_pattern || '%')
          or (v_match_type = 'contains' and bt.description ilike '%' || v_pattern || '%'))
    loop
      if change_transaction_type_core(v_id, v_tx.confirmed_type_id) is null then
        update bank_transactions set suggested_rule_id = v_rule_id, suggested_type_id = v_tx.confirmed_type_id,
          suggested_confidence = 'high', suggested_reason = 'כלל שנוצר מסיווג ידני' where id = v_id;
        v_changed := v_changed + 1;
      else
        v_blocked := v_blocked + 1;
      end if;
    end loop;
  end if;

  perform insert_audit_event('create_rule_from_transaction', 'recognition_rules', v_rule_id::text,
    jsonb_build_object('transaction_id', p_transaction_id, 'pattern', v_pattern, 'applied', v_applied,
      'changed', v_changed, 'blocked', v_blocked, 'this_account_only', p_this_account_only));

  return jsonb_build_object('rule_id', v_rule_id, 'applied', v_applied, 'changed', v_changed, 'blocked', v_blocked);
end;
$$;
revoke execute on function create_rule_from_transaction(uuid, text, boolean, boolean) from public, anon;
grant execute on function create_rule_from_transaction(uuid, text, boolean, boolean) to authenticated;
