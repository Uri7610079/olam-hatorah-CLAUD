-- שלב 43 (שלב ב' של האוטומציה)
--
-- החלטות צ'ני (2026-11-18):
--   * תרומה: תנועת זכות שאושרה כ"תרומה" יוצרת רשומת תרומה לבד, מקושרת לתנועה. אם כלל
--     הזיהוי קובע קבוצה - התרומה מאושרת ונרשמת ביומן הקבוצה. לא ידוע לאיזו קבוצה -
--     התרומה נשארת ממתינה לשיוך (החלטה מפורשת: לא לקבוצה "כללית").
--   * החזרה: תנועת זכות שאושרה כ"החזר תשלום" נרשמת לבד כהחזרה - רק כשיש לה שורת מס"ב
--     אחת בלבד שמתאימה (אותה עמותה, אותו סכום, שודרה ב-60 הימים שלפני). אחרת - חריגה.
--   * חלוקה: אחרי חישוב העמלות נבנית לכל קבוצה *טיוטת* חלוקה מהסכומים שחושבו. האישור
--     נשאר אצל מנהל הכספים (החלטה מפורשת: טיוטה, לא אישור אוטומטי).
--   * מס"ב: "הכנה ואישור" בלחיצה אחת. השידור לבנק נשאר ידני (החלטה מפורשת).
--   * רטרו: "הסבר תשלומים" מתלמוד נרשם לבד כגרסאות חישוב (רטרו), במקום הקלדה.
--
-- כל אחד ניתן לכיבוי ב-automation_settings (124), וכל הפעלה נרשמת ב-automation_runs.

insert into automation_settings (key, label_he) values
  ('auto_donations', 'יצירת תרומה מתנועת בנק שסווגה כתרומה'),
  ('auto_returns', 'רישום החזרה מתנועת בנק שסווגה כהחזר תשלום'),
  ('auto_distribution_draft', 'טיוטת חלוקה לכל קבוצה אחרי חישוב העמלות'),
  ('auto_retro', 'רישום רטרו מ"הסבר תשלומים" של תלמוד')
on conflict (key) do nothing;

-- חודש כספי פתוח לפעולה אוטומטית: נפתח אם לא קיים; בבדיקה/סגור - לא.
create or replace function ensure_open_period(p_org uuid, p_month date)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  insert into financial_periods (organization_id, month, status)
  values (p_org, p_month, 'open')
  on conflict (organization_id, month) do nothing;
  select status into v_status from financial_periods where organization_id = p_org and month = p_month;
  return v_status = 'open';
end;
$$;
revoke execute on function ensure_open_period(uuid, date) from public, anon, authenticated;

-- ===== 1. תרומה מתנועת בנק =====

-- כלל זיהוי יכול לקבוע לאיזו קבוצה התרומה הולכת (למשל "הוראת קבע של פלוני" -> קבוצה X)
alter table recognition_rules add column if not exists donation_group_id uuid references groups(id);

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
  if exists (select 1 from donations where bank_transaction_id = p_tx) then return; end if;

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

-- ===== 2. החזרה מתנועת בנק =====

create or replace function auto_return_from_bank(p_tx uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx bank_transactions;
  v_org uuid;
  v_lines uuid[];
  v_line masav_lines;
  v_return uuid;
  v_match uuid;
  v_month date;
begin
  select * into v_tx from bank_transactions where id = p_tx;
  if v_tx.id is null or v_tx.direction <> 'credit' then return; end if;
  if exists (select 1 from bank_matches where bank_transaction_id = p_tx and target_table = 'payment_returns' and status <> 'rejected') then return; end if;

  select organization_id into v_org from organization_bank_accounts where id = v_tx.organization_bank_account_id;
  v_month := date_trunc('month', v_tx.execution_date)::date;

  select array_agg(ml.id) into v_lines
  from masav_lines ml
  join masav_batches mb on mb.id = ml.batch_id
  where mb.organization_id = v_org
    and mb.status in ('transmitted', 'bank_completed')
    and ml.status = 'valid'
    and abs(ml.amount - v_tx.amount) < 0.01
    and mb.transmitted_at is not null
    and mb.transmitted_at::date between v_tx.execution_date - 60 and v_tx.execution_date;

  if coalesce(array_length(v_lines, 1), 0) <> 1 then
    perform log_automation('auto_returns', v_org, v_month, 'skipped',
      'החזר ' || to_char(v_tx.amount, 'FM999,999,990.00') || ' מהבנק: ' ||
      case when coalesce(array_length(v_lines, 1), 0) = 0 then 'לא נמצא תשלום מס"ב באותו סכום' else 'נמצאו ' || array_length(v_lines, 1) || ' תשלומים באותו סכום' end ||
      ' - יש לרשום ידנית במסך ההחזרות');
    return;
  end if;

  if not ensure_open_period(v_org, v_month) then
    perform log_automation('auto_returns', v_org, v_month, 'skipped', 'החודש הכספי אינו פתוח - ההחזרה לא נרשמה');
    return;
  end if;

  select * into v_line from masav_lines where id = v_lines[1];

  -- אותו רישום כמו record_payment_return (033), בלי בדיקת ההרשאה
  insert into payment_returns (masav_line_id, return_date, amount, reason, notes)
  values (v_line.id, v_tx.execution_date, v_tx.amount,
          'החזרה מהבנק: ' || coalesce(nullif(v_tx.description, ''), 'ללא תיאור'), 'נרשמה אוטומטית מתנועת בנק')
  returning id into v_return;

  update masav_lines set status = 'returned' where id = v_line.id;

  insert into group_ledger_entries (organization_id, group_id, entry_type, amount, period_month, source_table, source_id, reason, created_by)
  values (v_org, v_line.group_id, 'refund', v_tx.amount, v_month, 'payment_returns', v_return, 'החזרה מהבנק', null);

  insert into bank_matches (bank_transaction_id, match_type, target_table, target_id, matched_amount, suggested_reason)
  values (p_tx, 'return', 'payment_returns', v_return, v_tx.amount, 'החזרה שנרשמה אוטומטית מהתנועה')
  returning id into v_match;
  perform approve_bank_match_core(v_match);

  perform insert_audit_event('record_payment_return', 'payment_returns', v_return::text, jsonb_build_object('masav_line_id', v_line.id, 'amount', v_tx.amount, 'automatic', true));
  perform log_automation('auto_returns', v_org, v_month, 'done',
    'החזר ' || to_char(v_tx.amount, 'FM999,999,990.00') || ' נרשם לתשלום המס"ב המתאים, ונפתח לתשלום חוזר');
end;
$$;
revoke execute on function auto_return_from_bank(uuid) from public, anon, authenticated;

-- כשתנועה מאושרת - אוטומטית (124) או בידי הפקיד - בודקים אם היא תרומה או החזר.
create or replace function trg_bank_tx_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  select code into v_code from bank_transaction_types where id = new.confirmed_type_id;
  if v_code = 'donation' and automation_enabled('auto_donations') then
    perform auto_donation_from_bank(new.id);
  elsif v_code = 'payment_return' and automation_enabled('auto_returns') then
    perform auto_return_from_bank(new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists bank_transactions_confirmed_followup on bank_transactions;
create trigger bank_transactions_confirmed_followup
  after update of classification_status, confirmed_type_id on bank_transactions
  for each row when (new.classification_status = 'confirmed' and new.direction = 'credit'
                     and (old.classification_status is distinct from 'confirmed' or old.confirmed_type_id is distinct from new.confirmed_type_id))
  execute function trg_bank_tx_confirmed();

-- ===== 3. טיוטת חלוקה מחישוב העמלות =====
--
-- לכל קבוצה שיש לה סכומי נטו בחודש: טיוטת חלוקה "מלגות נטו", סכום קבוע לכל תלמיד =
-- הנטו שחושב לו. כבר יש לקבוצה חלוקת מלגות לחודש (שאינה מוחלפת) - אם היא טיוטה,
-- השורות מתעדכנות לחישוב האחרון; אם כבר הוגשה/אושרה - לא נוגעים בה.

create or replace function build_distribution_drafts(p_org uuid, p_month date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v_batch uuid;
  v_status text;
  v_built integer := 0;
begin
  if not automation_enabled('auto_distribution_draft') then return 0; end if;

  for v_group in
    select distinct r.group_id from eligibility_financial_results r
    where r.organization_id = p_org and r.month = p_month and r.status = 'active' and r.group_id is not null and r.net_amount > 0
  loop
    select b.id, b.status into v_batch, v_status from distribution_batches b
    where b.organization_id = p_org and b.group_id = v_group and b.period_month = p_month
      and b.source_type = 'net_scholarships' and b.status <> 'superseded'
    order by b.created_at desc limit 1;

    if v_batch is not null and v_status <> 'draft' then
      continue;
    end if;

    if v_batch is null then
      insert into distribution_batches (organization_id, group_id, period_month, source_type, method, notes)
      values (p_org, v_group, p_month, 'net_scholarships', 'fixed_amounts', 'טיוטה שנבנתה אוטומטית מחישוב העמלות - לבדיקה ואישור')
      returning id into v_batch;
    else
      delete from distribution_lines where batch_id = v_batch;
    end if;

    insert into distribution_lines (batch_id, student_id, amount)
    select v_batch, r.student_id, sum(r.net_amount)
    from eligibility_financial_results r
    where r.organization_id = p_org and r.month = p_month and r.status = 'active' and r.group_id = v_group
    group by r.student_id
    having sum(r.net_amount) > 0;

    v_built := v_built + 1;
  end loop;

  if v_built > 0 then
    perform log_automation('auto_distribution_draft', p_org, p_month, 'done',
      'נבנו/עודכנו ' || v_built || ' טיוטות חלוקה - ממתינות לבדיקה ואישור מנהל הכספים');
  end if;
  return v_built;
end;
$$;
revoke execute on function build_distribution_drafts(uuid, date) from public, anon, authenticated;

-- החישוב האוטומטי (124) - זהה, ונוספה בניית הטיוטות אחרי חישוב מוצלח
create or replace function auto_commission_for(p_organization_id uuid, p_month date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_res record;
begin
  if p_organization_id is null or p_month is null then return; end if;
  if not automation_enabled('auto_commission') then
    perform log_automation('auto_commission', p_organization_id, p_month, 'skipped', 'החישוב האוטומטי כבוי בהגדרות');
    return;
  end if;

  insert into financial_periods (organization_id, month, status)
  values (p_organization_id, p_month, 'open')
  on conflict (organization_id, month) do nothing;

  select status into v_status from financial_periods where organization_id = p_organization_id and month = p_month;
  if v_status <> 'open' then
    perform log_automation('auto_commission', p_organization_id, p_month, 'skipped',
      'החודש הכספי בסטטוס "' || v_status || '" - החישוב לא רץ. אם צריך לחשב, יש לפתוח את החודש מחדש.');
    return;
  end if;

  begin
    select * into v_res from commission_calculate_core(p_organization_id, p_month);
    perform log_automation('auto_commission', p_organization_id, p_month, 'done',
      'חושבו ' || v_res.processed_count || ' זכאויות · עמלה ' || to_char(v_res.total_commission, 'FM999,999,990.00') ||
      ' · נטו ' || to_char(v_res.total_net, 'FM999,999,990.00'));
    perform build_distribution_drafts(p_organization_id, p_month);
  exception when others then
    perform log_automation('auto_commission', p_organization_id, p_month, 'failed', sqlerrm);
  end;
end;
$$;

-- גם חישוב ידני (הכפתור במסך החודשים) בונה טיוטות
create or replace function commit_commission_calculation(p_organization_id uuid, p_month date)
returns table (processed_count integer, total_commission numeric, total_net numeric)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_res record;
begin
  if not has_permission('commission', 'calculate') then
    raise exception 'permission denied';
  end if;
  select * into v_res from commission_calculate_core(p_organization_id, p_month);
  perform build_distribution_drafts(p_organization_id, p_month);
  return query select v_res.processed_count, v_res.total_commission, v_res.total_net;
end;
$$;

-- ===== 4. מס"ב: הכנה ואישור בלחיצה אחת =====
--
-- אותן חמש פעולות שהיו חמש לחיצות (יצירה, הגשה לבדיקה, בדיקה, הגשה לאישור, אישור),
-- דרך אותן פונקציות - כך שכל בדיקה והרשאה שלהן נשמרות. נעצר לפני האישור אם יש ולו
-- שורה אחת שנפסלה בבדיקה: תלמיד שלא יקבל כסף הוא החלטה של אדם. הפקת הקובץ והשידור
-- לבנק - ידניים, כמו קודם.

create or replace function prepare_masav_batch(p_organization_id uuid, p_organization_bank_account_id uuid, p_period_month date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch uuid;
  v_valid integer;
  v_rejected integer;
  v_reasons text;
begin
  v_batch := create_masav_batch(p_organization_id, p_organization_bank_account_id, p_period_month);
  perform submit_masav_for_review(v_batch);
  perform run_masav_validation(v_batch);

  select count(*) filter (where status = 'valid'), count(*) filter (where status = 'rejected'),
         string_agg(distinct rejection_code, ' · ') filter (where status = 'rejected')
  into v_valid, v_rejected, v_reasons
  from masav_lines where batch_id = v_batch;

  if v_rejected > 0 or v_valid = 0 then
    return jsonb_build_object('batch_id', v_batch, 'status', 'pending_review', 'valid', v_valid, 'rejected', v_rejected,
      'message', v_rejected || ' שורות נפסלו בבדיקה (' || coalesce(v_reasons, '') || ') - האצווה נעצרה לפני האישור, לבדיקה.');
  end if;

  perform submit_masav_for_approval(v_batch);
  perform approve_masav_batch(v_batch);
  return jsonb_build_object('batch_id', v_batch, 'status', 'approved', 'valid', v_valid, 'rejected', 0,
    'message', 'האצווה הוכנה ואושרה: ' || v_valid || ' תשלומים. הצעד הבא - הפקת הקובץ ושידור לבנק, ידנית.');
end;
$$;
revoke execute on function prepare_masav_batch(uuid, uuid, date) from public, anon;
grant execute on function prepare_masav_batch(uuid, uuid, date) to authenticated;

-- ===== 5. רטרו מ"הסבר תשלומים" של תלמוד =====

alter table payment_calculation_versions add column if not exists talmud_key text;
create unique index if not exists payment_calculation_versions_talmud_key on payment_calculation_versions (talmud_key) where talmud_key is not null;

-- "09/2026" / "9/2026" / "2026-09" -> 2026-09-01
create or replace function talmud_text_month(p text)
returns date
language plpgsql
immutable
as $$
declare
  m text[];
begin
  if p is null then return null; end if;
  m := regexp_match(p, '(\d{1,2})/(\d{4})');
  if m is not null then return make_date(m[2]::int, m[1]::int, 1); end if;
  m := regexp_match(p, '(\d{4})-(\d{1,2})');
  if m is not null then return make_date(m[1]::int, m[2]::int, 1); end if;
  return null;
exception when others then
  return null;
end;
$$;

create or replace function sync_retro_from_talmud(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_added integer;
begin
  if not automation_enabled('auto_retro') then return 0; end if;

  insert into payment_calculation_versions (
    organization_id, branch_id, source_month, received_month, calculation_type, calculation_date,
    prior_eligible_count, current_eligible_count, prior_amount, current_amount, difference,
    current_period_offset, cumulative_offset, transferred_to_advances, notes, talmud_key
  )
  select r.organization_id, b.id,
         talmud_text_month(r.data ->> 'report_month'), r.month,
         nullif(r.data ->> 'payment_type', ''),
         coalesce(talmud_text_date(r.data ->> 'calc_date'), r.month),
         (r.data ->> 'prev_eligible')::numeric::integer, (r.data ->> 'eligible')::numeric::integer,
         (r.data ->> 'prev_amount')::numeric, (r.data ->> 'amount')::numeric, (r.data ->> 'diff')::numeric,
         (r.data ->> 'offset_this')::numeric, (r.data ->> 'offset_total')::numeric, (r.data ->> 'to_advances')::numeric,
         'נרשם אוטומטית מ"הסבר תשלומים" בתלמוד',
         concat_ws('|', r.organization_id, coalesce(r.branch_code, ''), r.data ->> 'report_month', r.data ->> 'payment_type', r.data ->> 'calc_date')
  from talmud_report_rows r
  left join branches b on b.organization_id = r.organization_id and b.talmud_branch_code = r.branch_code
  where r.report_key = 'payment_explanation'
    and r.organization_id = p_org
    and talmud_text_month(r.data ->> 'report_month') is not null
    and coalesce((r.data ->> 'diff')::numeric, 0) <> 0
  on conflict (talmud_key) where talmud_key is not null do nothing;

  get diagnostics v_added = row_count;
  if v_added > 0 then
    perform log_automation('auto_retro', p_org, null, 'done', 'נרשמו ' || v_added || ' שורות רטרו מתלמוד');
  end if;
  return v_added;
end;
$$;
revoke execute on function sync_retro_from_talmud(uuid) from public, anon, authenticated;

-- הטריגר של 124 על talmud_report_rows - זהה, ונוסף הרטרו
create or replace function trg_match_talmud_payments_after_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  for v_org in select distinct n.organization_id from new_rows n where n.report_key = 'institute_payments' loop
    perform match_talmud_institute_payments(v_org);
  end loop;
  for v_org in select distinct n.organization_id from new_rows n where n.report_key = 'payment_explanation' loop
    perform sync_retro_from_talmud(v_org);
  end loop;
  return null;
end;
$$;

-- ===== 6. מרכז החריגות: זהה ל-124, ונוסף ענף להחזר שלא נרשם =====

create or replace view unified_exceptions
with (security_invoker = true)
as
-- materialized במפורש: בלעדיו Postgres משכפל את ה-CTE לתוך כל אחד
-- מחמשת הענפים, וזו בדיוק הבעיה שהמיגרציה הזו מתקנת.
with talmud_gap as materialized (
  select
    ir.id as row_id,
    ir.status as row_status,
    ir.raw as raw,
    b.organization_id,
    b.period_month,
    nullif(btrim(ir.raw ->> 'סניף'), '') as branch_code,
    coalesce(nullif(regexp_replace(coalesce(ir.raw ->> 'סכום ברוטו', ''), '[^0-9.\-]', '', 'g'), '')::numeric, 0) as amount,
    s.id as student_id,
    (asg.student_id is not null) as has_assignment,
    (el.student_id is not null) as has_eligibility,
    (br.id is not null) as branch_exists
  from import_rows ir
  join import_batches b on b.id = ir.batch_id and b.status = 'committed'
  join import_profiles p on p.id = b.profile_id and p.key = 'talmud_eligibility'
  left join students s
    on normalize_identity(s.external_id) = normalize_identity(ir.raw ->> 'מזהה תלמיד')
  left join lateral (
    select sa.student_id from student_assignments sa
    where sa.student_id = s.id and sa.is_active = true limit 1
  ) asg on true
  left join lateral (
    select me.student_id from monthly_eligibility me
    where me.student_id = s.id and me.month = b.period_month and me.status = 'active' limit 1
  ) el on true
  left join branches br
    on br.organization_id = b.organization_id
   and br.talmud_branch_code = btrim(ir.raw ->> 'סניף')
  -- שורה שהמפעיל דחה בכוונה אינה פער לתיקון (110)
  where ir.error_message is distinct from 'נדחתה ידנית בבדיקה'
)
select ue.* from (
  select exception_type, (case when severity = 'warning' then 'medium' else severity end) as severity,
    organization_id, related_table, related_id, amount, related_date, description
  from bank_reconciliation_exceptions

  union all

  select 'talmud_error', case when te.is_recurring then 'high' else 'medium' end,
    te.organization_id, 'talmud_errors', te.id, null, te.month,
    te.error_code || coalesce(': ' || te.error_description, '')
  from talmud_errors te
  where te.status in ('open', 'in_progress', 'pending_info')

  union all

  select 'audit_attendance', case when aa.is_recurring then 'high' else 'medium' end,
    a.organization_id, 'audit_attendance', aa.id, null, a.audit_date,
    'חוסר בביקורת: ' || coalesce(aa.external_student_ref, '(תלמיד מותאם)')
  from audit_attendance aa
  join audits a on a.id = aa.audit_id
  where aa.status in ('open', 'in_progress', 'pending_info')

  union all

  select 'document_expiry',
    case
      when d.expiry_date < current_date then 'critical'
      when d.expiry_date - current_date <= 7 then 'critical'
      when d.expiry_date - current_date <= 14 then 'high'
      else 'medium'
    end,
    d.organization_id, 'documents', d.id, null, d.expiry_date,
    'תוקף מסמך: ' || d.title
  from documents d
  where d.status = 'active' and d.expiry_date is not null and d.expiry_date - current_date <= 30

  union all

  select 'payment_return_open', 'medium',
    mb.organization_id, 'payment_returns', pr.id, pr.amount, pr.return_date,
    'החזרה פתוחה: ' || pr.reason
  from payment_returns pr
  join masav_lines ml on ml.id = pr.masav_line_id
  join masav_batches mb on mb.id = ml.batch_id
  where pr.status = 'open'

  union all

  select 'masav_needs_correction', 'high',
    mb.organization_id, 'masav_batches', mb.id, mb.total_amount, mb.period_month,
    'אצוות מס"ב דורשת תיקון' || coalesce(': ' || mb.status_reason, '')
  from masav_batches mb
  where mb.status = 'needs_correction'

  union all

  select 'bank_auto_sync_issue', case when r.status = 'failed' then 'critical' else 'high' end,
    oba.organization_id, 'bank_auto_sync_runs', r.id, null, r.started_at::date,
    coalesce(r.gap_detail, 'משיכת תנועות בנק אוטומטית נכשלה: ' || coalesce(r.error_message, 'שגיאה לא ידועה'))
  from bank_auto_sync_runs r
  join bank_auto_sync_settings s on s.id = r.setting_id
  join organization_bank_accounts oba on oba.id = s.organization_bank_account_id
  where r.is_resolved = false and (r.status = 'failed' or r.gap_detected = true)

  union all

  -- ===== מה שחסר כדי שדוח "תלמוד" ייקלט במלואו =====
  --
  -- כל חמשת הענפים מנקים את עצמם: הם קוראים את המצב הנוכחי מתוך
  -- talmud_gap, לא את מה שהיה בזמן הקליטה. ברגע שהתלמיד נוסף, שויך,
  -- או שהסניף נפתח - החריגה נעלמת מעצמה. חריגה שנשארת אחרי שתוקנה
  -- מאמנת להתעלם מהמסך, וזה גרוע מלא להציג אותו בכלל.

  -- 1. תלמיד עם זכאות בפועל שאינו קיים במערכת. זה כסף שלא נכנס.
  select 'talmud_student_missing', 'high',
    g.organization_id, 'import_rows', g.row_id, g.amount, g.period_month,
    'תלמיד שאינו במערכת: ' || coalesce(nullif(g.raw ->> 'שם', ''), '(ללא שם)') ||
      ' · ת.ז ' || coalesce(g.raw ->> 'מזהה תלמיד', '—') ||
      ' · סניף ' || coalesce(g.branch_code, '—') ||
      ' · יש לייבא אותו במסך תלמידים'
  from talmud_gap g
  where g.row_status = 'invalid' and g.student_id is null and g.amount > 0

  union all

  -- 2. תלמיד קיים אך בלי שיוך פעיל. הקליטה קוראת את הסניף והקבוצה
  --    מהשיוך, ולכן הוא נדחה למרות שהוא במערכת - וזה הכי מבלבל.
  select 'talmud_student_unassigned', 'high',
    g.organization_id, 'import_rows', g.row_id, g.amount, g.period_month,
    'תלמיד ללא שיוך פעיל לסניף/קבוצה: ' || coalesce(nullif(g.raw ->> 'שם', ''), '(ללא שם)') ||
      ' · ת.ז ' || coalesce(g.raw ->> 'מזהה תלמיד', '—') ||
      ' · הוא קיים במערכת, רק חסר לו שיוך'
  from talmud_gap g
  where g.row_status = 'invalid' and g.student_id is not null and not g.has_assignment

  union all

  -- 3. סניף שמופיע בדוח ואינו קיים. שורה אחת לכל קוד סניף, לא לכל תלמיד.
  select 'talmud_branch_missing', 'medium',
    g.organization_id, 'import_rows', (array_agg(g.row_id order by g.row_id))[1], null, g.period_month,
    'סניף ' || g.branch_code || ' מופיע בדוח תלמוד ואינו קיים במערכת' ||
      ' · הזכאות תיזקף לפי השיוך שבמערכת, לא לפי הקובץ'
  from talmud_gap g
  where g.branch_code is not null and not g.branch_exists
  group by g.organization_id, g.period_month, g.branch_code

  union all

  -- 4. חסרים ללא זכאות החודש, מסוכמים לשורה אחת לכל דוח בכוונה: בקבצים
  --    אמיתיים אלה מאות שורות של 0.00, והצגתן אחת-אחת הייתה מטביעה את
  --    החריגות שבאמת עולות כסף.
  select 'talmud_students_missing_no_amount', 'low',
    g.organization_id, 'import_rows', (array_agg(g.row_id order by g.row_id))[1], null, g.period_month,
    count(*) || ' תלמידים בדוח אינם קיימים במערכת, אך ללא זכאות החודש (0.00 ש"ח)' ||
      ' · אין השפעה כספית, אבל כדאי להוסיף אותם'
  from talmud_gap g
  where g.row_status = 'invalid' and g.student_id is null and g.amount = 0
  group by g.organization_id, g.period_month

  union all

  -- 5. שורה שנדחתה, והנתונים שחסרו לה הוזנו מאז. ארבעת הענפים שמעל
  --    שותקים כאן - התלמיד כבר לא חסר ולא חסר שיוך - אבל הכסף שלו לא
  --    נזקף, כי הקליטה כבר רצה. בלי הענף הזה הפער בלתי נראה.
  select 'talmud_row_recoverable', 'high',
    g.organization_id, 'import_rows', g.row_id, g.amount, g.period_month,
    'זכאות שנדחתה וניתן להשלים: ' || coalesce(nullif(g.raw ->> 'שם', ''), '(ללא שם)') ||
      ' · ת.ז ' || coalesce(g.raw ->> 'מזהה תלמיד', '—') ||
      ' · התלמיד קיים ומשויך כעת · יש להריץ "השלמת שורות שנדחו" במסך זכאות'
  from talmud_gap g
  where g.row_status = 'invalid' and g.student_id is not null
    and g.has_assignment and not g.has_eligibility and g.amount > 0

  union all

  -- ===== תלמוד = מערכת האמת (122) =====
  -- שלושת הענפים מנקים את עצמם, כמו הענפים שמעל: ברגע שהנתון הוזן, או
  -- שהתלמיד הועבר סניף - השורה נעלמת.

  -- 6. "חסר נתון": מה שתלמוד לא יודע ונחוץ לעבודה. שורה אחת לכל תלמיד.
  --    בינוני כשחסר מה שמעכב תשלום (בנק, ראש קבוצה); אחרת - לידיעה.
  select 'student_missing_data',
    case when md.missing && array['חשבון בנק', 'ראש קבוצה'] then 'medium' else 'low' end,
    md.organization_id, 'students', md.student_id, null, null,
    'חסר נתון: ' || array_to_string(md.missing, ', ') || ' · ' || md.full_name || ' · ' || md.external_id
  from student_missing_data md

  union all

  -- 7. יצא אצלנו, ותלמוד עדיין רושם אותו בדוח האחרון (אחרי תאריך היציאה).
  --    לא מחזירים ל"פעיל" לבד: כנראה פשוט לא דווחה היציאה לתלמוד.
  (select distinct on (s.id) 'talmud_exited_but_listed', 'high',
    l.organization_id, 'students', s.id, null, l.month,
    'יצא במערכת' || coalesce(' (' || to_char(s.exit_date, 'DD/MM/YYYY') || ')', '') ||
      ' ועדיין רשום בתלמוד בחודש ' || to_char(l.month, 'MM/YYYY') ||
      ' (' || case when x.eligible then 'זכאי' else 'אינו זכאי' end || ')' ||
      ' · ' || s.full_name || ' · ' || s.external_id ||
      ' · יש לדווח את היציאה לתלמוד, או להחזיר אותו לפעיל'
  from talmud_latest_lists l
  join talmud_eligibility_list_rows x on x.list_id = l.id
  join students s on s.id = x.student_id
  where s.status = 'inactive'
    and coalesce(s.exit_date, date '1900-01-01') < l.month
  order by s.id, x.eligible desc)

  union all

  -- 8. תלמוד רושם אותו בסניף אחר מהשיוך שלנו. לא מעבירים לבד: מעבר סניף
  --    הוא גם מעבר ראש קבוצה, ואת זה תלמוד לא יודע.
  (select distinct on (s.id) 'talmud_branch_differs', 'medium',
    l.organization_id, 'students', s.id, null, l.month,
    'בתלמוד: ' || o.legal_name || ' סניף ' || coalesce(x.branch_code, '—') ||
      ' · במערכת: ' || coalesce(ao.legal_name, '—') || ' סניף ' || coalesce(ab.talmud_branch_code, '—') ||
      ' · ' || s.full_name || ' · ' || s.external_id ||
      ' · יש להעביר לסניף שבתלמוד ולבחור ראש קבוצה'
  from talmud_latest_lists l
  join organizations o on o.id = l.organization_id
  join talmud_eligibility_list_rows x on x.list_id = l.id
  join students s on s.id = x.student_id and s.status <> 'inactive'
  join student_assignments sa on sa.student_id = s.id and sa.is_active = true
  join organizations ao on ao.id = sa.organization_id
  join branches ab on ab.id = sa.branch_id
  where not exists (
    -- אחת השורות שלו בדוח תואמת שיוך פעיל כלשהו שלו
    select 1 from talmud_eligibility_list_rows x2
    join student_assignments sa2 on sa2.student_id = x2.student_id and sa2.is_active = true
    join branches b2 on b2.id = sa2.branch_id
    where x2.list_id = l.id and x2.student_id = s.id
      and sa2.organization_id = l.organization_id and b2.talmud_branch_code = x2.branch_code
  )
  order by s.id, x.eligible desc)

  union all

  -- ===== הסקרייפר במשרד (123) =====
  -- 9. חשבון שהבנק החזיר ואין לו בעלים במערכת (או שיש לו שניים). התנועות שלו לא
  --    נקלטו. נעלם מעצמו ברגע שהחשבון נרשם תחת העמותה והמשיכה הבאה קולטת אותו.
  select 'bank_account_unmatched', 'high',
    null::uuid, 'bank_scraper_unmatched_accounts', u.id, u.bank_balance, u.last_seen_at::date,
    case when u.reason = 'not_found'
      then 'חשבון בנק ' || u.bank_code || ' / ' || u.account_number || ' נמשך מהבנק ואינו רשום תחת אף עמותה · ' ||
           u.transactions_count || ' תנועות לא נקלטו · יש להוסיף את החשבון בכרטיס העמותה'
      else 'חשבון בנק ' || u.bank_code || ' / ' || u.account_number || ' תואם לכמה חשבונות במערכת · ' ||
           u.transactions_count || ' תנועות לא נקלטו · יש להשאיר רק חשבון פעיל אחד עם המספר הזה'
    end
  from bank_scraper_unmatched_accounts u
  where u.resolved_at is null

  union all

  -- ===== תשלומי משרד החינוך (124) =====
  -- 10. תלמוד אומר ששולם, ובבנק לא נמצאה תנועת זכות באותו סכום - 14 ימים אחרי תאריך
  --     החישוב. נעלם מעצמו כשהתנועה נקלטת והתאמה נמצאת.
  select 'talmud_payment_not_in_bank', 'high',
    r.organization_id, 'talmud_report_rows', r.id, (r.data ->> 'amount')::numeric, coalesce(talmud_text_date(r.data ->> 'calc_date'), r.month),
    'משרד החינוך: ' || coalesce(r.data ->> 'payment_type', 'תשלום') ||
      coalesce(' לחודש ' || (r.data ->> 'report_month'), '') ||
      ' · סניף ' || coalesce(r.branch_code, '—') ||
      ' · ' || to_char((r.data ->> 'amount')::numeric, 'FM999,999,990.00') || ' ש"ח' ||
      ' · לא נמצאה תנועה באותו סכום בבנק העמותה · כדאי לבדוק מול דף החשבון'
  from talmud_report_rows r
  where r.report_key = 'institute_payments'
    and coalesce((r.data ->> 'amount')::numeric, 0) > 0
    and coalesce(talmud_text_date(r.data ->> 'calc_date'), r.month) < current_date - 14
    and not exists (select 1 from talmud_payment_bank_links l where l.report_row_id = r.id)

  union all

  -- ===== החזרים מהבנק (125) =====
  -- 11. תנועת זכות שסווגה "החזר תשלום" ואין לה החזרה רשומה - לא נמצאה לה שורת מס"ב
  --     אחת ויחידה באותו סכום. נעלם מעצמו כשההחזרה נרשמת (ידנית או אוטומטית).
  select 'bank_return_unrecorded', 'high',
    a.organization_id, 'bank_transactions', bt.id, bt.amount, bt.execution_date,
    'החזר תשלום בבנק שלא נרשם: ' || to_char(bt.amount, 'FM999,999,990.00') || ' ש"ח' ||
      coalesce(' · ' || left(bt.description, 80), '') ||
      ' · לא נמצא תשלום מס"ב אחד באותו סכום · יש לרשום את ההחזרה במסך ההחזרות'
  from bank_transactions bt
  join organization_bank_accounts a on a.id = bt.organization_bank_account_id
  join bank_transaction_types tt on tt.id = bt.confirmed_type_id and tt.code = 'payment_return'
  where bt.classification_status = 'confirmed' and bt.direction = 'credit'
    and not exists (
      select 1 from bank_matches bm
      where bm.bank_transaction_id = bt.id and bm.target_table = 'payment_returns' and bm.status <> 'rejected'
    )
    -- החזרה שנרשמה ידנית במסך ההחזרות (בלי קישור לתנועה): אותה עמותה, סכום ותאריך סמוך
    and not exists (
      select 1 from payment_returns pr
      join masav_lines ml on ml.id = pr.masav_line_id
      join masav_batches mb on mb.id = ml.batch_id
      where mb.organization_id = a.organization_id
        and abs(pr.amount - bt.amount) < 0.01
        and pr.return_date between bt.execution_date - 10 and bt.execution_date + 10
    )
) ue
left join organizations o on o.id = ue.organization_id
where coalesce(o.is_demo, false) = false;
