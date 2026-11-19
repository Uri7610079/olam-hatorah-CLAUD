-- תיקון: תנועות בנק שונות נקלטו כ"כפולות" (2026-11-19)
--
-- נמצא בשטח: במשיכה הראשונה שהצליחה (פאג"י, ברכת אלימלך) נמשכו 167 תנועות, נקלטו 27,
-- ו-140 סומנו "כבר היו" - למרות שהחשבון היה ריק. הסיבה: הסקרייפר שולח את מספר האסמכתא
-- של הבנק בשדה "מזהה תנועה", והמערכת מזהה תנועה לפי המזהה בלבד כשהוא קיים. בפאג"י
-- אסמכתא אחת (למשל של העברות מהעמותה) חוזרת על עשרות תנועות שונות.
--
-- התיקון, רק לתנועות שמגיעות מהסקרייפר (היבוא הידני לא משתנה):
-- 1. המזהה עובר לשדה האסמכתא, והטביעה מחושבת מכל פרטי התנועה.
-- 2. 27 התנועות שכבר נקלטו מקבלות טביעה לפי אותו כלל - כדי שהמשיכה הבאה תזהה אותן
--    ככפולות ותקלוט רק את ה-140 החסרות.

create or replace function scraper_reference(p_reference text, p_bank_id text)
returns text
language sql
immutable
as $$
  select case
    when nullif(p_bank_id, '') is null then nullif(p_reference, '')
    when nullif(p_reference, '') is null or p_reference = p_bank_id then p_bank_id
    else p_reference || ' · ' || p_bank_id
  end
$$;

create or replace function scraper_normalize_transactions(p_transactions jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(
    case
      when nullif(t ->> 'bank_transaction_id', '') is null then t
      else t || jsonb_build_object(
        'reference', scraper_reference(t ->> 'reference', t ->> 'bank_transaction_id'),
        'bank_transaction_id', null)
    end order by o), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_transactions, '[]'::jsonb)) with ordinality as x(t, o)
$$;

create or replace function ingest_scraped_bank_account(
  p_secret text,
  p_connection_key text,
  p_bank_code text,
  p_account_number text,
  p_bank_balance numeric,
  p_pending_count integer,
  p_transactions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_bank text := lpad(regexp_replace(coalesce(p_bank_code, ''), '[^0-9]', '', 'g'), 2, '0');
  v_all text := scraper_account_digits(p_account_number);
  v_parts text[] := array_remove(regexp_split_to_array(coalesce(p_account_number, ''), '[^0-9]+'), '');
  v_last text;
  v_first text;
  v_matches uuid[];
  v_account uuid;
  v_org uuid;
  v_org_name text;
  v_setting uuid;
  v_run uuid;
  v_prev_balance numeric;
  v_prev_pending integer;
  v_net numeric;
  v_committed integer;
  v_duplicates integer;
  v_status text;
  v_reason text;
begin
  perform bank_scraper_check(p_secret);

  v_last := scraper_account_digits(v_parts[array_length(v_parts, 1)]);
  v_first := case when array_length(v_parts, 1) > 1 then scraper_account_digits(v_parts[1]) end;

  select array_agg(a.id) into v_matches
  from organization_bank_accounts a
  where a.is_active
    and lpad(coalesce(nullif(a.bank_code, ''), resolve_bank_code(a.bank_name), ''), 2, '0') = v_bank
    and scraper_account_digits(a.account_number) is not null
    and (
      scraper_account_digits(a.account_number) = v_all
      or (scraper_account_digits(a.account_number) = v_last
          and (v_first is null or v_first = scraper_account_digits(a.bank_branch_code)))
      or scraper_account_digits(coalesce(a.bank_branch_code, '') || a.account_number) = v_all
    );

  if coalesce(array_length(v_matches, 1), 0) <> 1 then

  -- (127) לא נמצא חשבון רשום, והחשבון סומן "להתעלם": לא נרשם שוב כחריגה. חשבון שנרשם
  -- בהמשך תחת עמותה כן נקלט - הבדיקה כאן רק כשאין התאמה.
  if exists (
    select 1 from bank_scraper_unmatched_accounts u
    where u.bank_code = lpad(regexp_replace(coalesce(p_bank_code, ''), '[^0-9]', '', 'g'), 2, '0')
      and u.account_number = coalesce(p_account_number, '')
      and u.ignored_at is not null
  ) then
    return jsonb_build_object('status', 'unmatched', 'reason', 'ignored',
      'message', 'החשבון ' || coalesce(p_account_number, '?') || ' מסומן במערכת "להתעלם" - לא נקלט.');
  end if;
    v_reason := case when coalesce(array_length(v_matches, 1), 0) = 0 then 'not_found' else 'ambiguous' end;
    insert into bank_scraper_unmatched_accounts (bank_code, account_number, connection_key, reason, transactions_count, bank_balance)
    values (v_bank, coalesce(p_account_number, ''), p_connection_key, v_reason,
            coalesce(jsonb_array_length(p_transactions), 0), p_bank_balance)
    on conflict (bank_code, account_number) do update
      set connection_key = excluded.connection_key, reason = excluded.reason,
          transactions_count = excluded.transactions_count, bank_balance = excluded.bank_balance,
          last_seen_at = now(), resolved_at = null;
    return jsonb_build_object(
      'status', 'unmatched',
      'reason', v_reason,
      'message', case when v_reason = 'not_found'
        then 'החשבון ' || coalesce(p_account_number, '?') || ' (בנק ' || v_bank || ') לא רשום במערכת תחת אף עמותה - לא נקלט.'
        else 'לחשבון ' || coalesce(p_account_number, '?') || ' (בנק ' || v_bank || ') נמצאו כמה חשבונות במערכת - לא נקלט עד שיתוקן.' end);
  end if;

  v_account := v_matches[1];
  select a.organization_id, o.legal_name into v_org, v_org_name
  from organization_bank_accounts a join organizations o on o.id = a.organization_id
  where a.id = v_account;

  update bank_scraper_unmatched_accounts set resolved_at = now()
  where bank_code = v_bank and account_number = coalesce(p_account_number, '') and resolved_at is null;

  insert into bank_auto_sync_settings (organization_bank_account_id, provider, frequency, is_enabled, created_by)
  values (v_account, 'office_scraper', 'daily', true, null)
  on conflict (organization_bank_account_id) do update set provider = 'office_scraper', is_enabled = true
  returning id into v_setting;

  -- היתרה הקודמת שהבנק דיווח, מהריצה הקודמת של אותו חשבון שהצליחה
  select r.bank_reported_balance, r.bank_pending_count into v_prev_balance, v_prev_pending
  from bank_auto_sync_runs r
  where r.setting_id = v_setting and r.bank_reported_balance is not null and r.status in ('success', 'partial')
  order by r.started_at desc limit 1;

  -- (129) המזהה שהסקרייפר מקבל מהבנק הוא מספר אסמכתא, ואינו ייחודי: בפאג"י 89 תנועות
  -- שונות הגיעו עם אותו מספר. לכן הוא לא משמש לבד כטביעת התנועה - הוא נשמר כאסמכתא,
  -- והטביעה מחושבת מכל פרטי התנועה (תאריך, כיוון, סכום, אסמכתא, תיאור).
  v_run := ingest_bank_transactions_core(v_setting, scraper_normalize_transactions(p_transactions));

  select r.status, r.transactions_committed, r.transactions_duplicate into v_status, v_committed, v_duplicates
  from bank_auto_sync_runs r where r.id = v_run;

  update bank_auto_sync_runs set bank_reported_balance = p_bank_balance, bank_pending_count = coalesce(p_pending_count, 0) where id = v_run;

  -- בדיקת היתרה. רק כשאין תנועות ממתינות: הבנק כבר מוריד אותן מהיתרה, והסקרייפר
  -- בכוונה לא קולט אותן עד שייסגרו - ולכן איתן היתרה לעולם לא "תסתדר".
  if v_status in ('success', 'partial') and v_prev_balance is not null and p_bank_balance is not null
     and coalesce(p_pending_count, 0) = 0 and coalesce(v_prev_pending, 0) = 0 then
    select coalesce(sum(case when bt.direction = 'credit' then bt.amount else -bt.amount end), 0) into v_net
    from bank_transactions bt
    join bank_auto_sync_runs r on r.batch_id = bt.batch_id
    where r.id = v_run;
    if abs(v_prev_balance + v_net - p_bank_balance) >= 0.01 then
      update bank_auto_sync_runs set
        status = 'partial', gap_detected = true,
        gap_detail = 'בדיקת יתרה: היתרה הקודמת ' || to_char(v_prev_balance, 'FM999,999,990.00') ||
          ' ועוד התנועות שנקלטו (' || to_char(v_net, 'FM999,999,990.00') || ') = ' ||
          to_char(v_prev_balance + v_net, 'FM999,999,990.00') || ', אבל הבנק מדווח ' ||
          to_char(p_bank_balance, 'FM999,999,990.00') || '. ייתכן שחסרות תנועות - כדאי להשוות לדף החשבון.'
      where id = v_run;
      v_status := 'partial';
    end if;
  end if;

  return jsonb_build_object(
    'status', v_status,
    'run_id', v_run,
    'organization', v_org_name,
    'committed', coalesce(v_committed, 0),
    'duplicates', coalesce(v_duplicates, 0),
    'message', (select coalesce(r.error_message, r.gap_detail) from bank_auto_sync_runs r where r.id = v_run));
end;
$$;


revoke execute on function ingest_scraped_bank_account(text, text, text, text, numeric, integer, jsonb) from public;
grant execute on function ingest_scraped_bank_account(text, text, text, text, numeric, integer, jsonb) to anon, authenticated;

-- 2. תנועות שכבר נקלטו מהסקרייפר - אותו כלל
update bank_transactions bt
set reference = scraper_reference(bt.reference, bt.bank_transaction_id),
    bank_transaction_id = null,
    fingerprint = compute_bank_fingerprint(
      bt.organization_bank_account_id, null, bt.execution_date, bt.value_date, bt.direction, bt.amount,
      scraper_reference(bt.reference, bt.bank_transaction_id), nullif(bt.description, ''))
from bank_import_batches b
where b.id = bt.batch_id
  and b.source = 'automated'
  and exists (select 1 from bank_auto_sync_settings s where s.organization_bank_account_id = bt.organization_bank_account_id and s.provider = 'office_scraper')
  and nullif(bt.bank_transaction_id, '') is not null;
