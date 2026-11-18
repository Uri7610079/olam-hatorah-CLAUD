-- שלב 42 (שלב א' של האוטומציה): פחות אישורים, יותר מידע אמין שזורם לבד
--
-- החלטת צ'ני (2026-11-18): מה שמגיע ממקור מוסמך - תלמוד או הבנק - ושעומד בכל
-- הבדיקות, נקלט ומעובד בלי אישור. אדם מטפל רק במה שלא מסתדר. כאן:
--   1. חישוב העמלות רץ לבד מיד אחרי קליטת דרישת התשלום מתלמוד (לפי הכללים
--      שהוגדרו - לא ממציא כללים). החודש הכספי נפתח לבד אם לא היה פתוח.
--   2. סיווג תנועת בנק שתואם כלל זיהוי בוודאות גבוהה (confidence = high) מאושר לבד.
--   3. התאמת תנועת בנק לאצוות מס"ב מאושרת לבד כשהיא חד-משמעית: מועמד אחד לתנועה,
--      ותנועה אחת לאצווה, באותו סכום בדיוק. האצווה עוברת ל"בוצע בבנק".
--   4. "תשלומים למוסד" מתלמוד מותאמים לתנועת הזכות בבנק. תשלום שלא הגיע - חריגה.
--
-- כל אחד מהם ניתן לכיבוי בטבלת automation_settings, וכל הפעלה נרשמת ב-automation_runs
-- (מה רץ, על מה, ומה יצא) - כדי שאוטומציה לא תהיה קופסה שחורה.
--
-- מה שלא משתנה: השידור של מס"ב לבנק, הגדרת כללי העמלה, ומקרים לא חד-משמעיים.

-- ===== 1. הגדרות ויומן =====

create table if not exists automation_settings (
  key text primary key,
  label_he text not null,
  is_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
alter table automation_settings enable row level security;
drop policy if exists automation_settings_select on automation_settings;
create policy automation_settings_select on automation_settings for select to authenticated
  using (has_permission('area_ops', 'access') or has_permission('area_finance', 'access') or has_permission('area_admin', 'access'));

insert into automation_settings (key, label_he) values
  ('talmud_auto_import', 'קליטה אוטומטית של הדוחות מתלמוד בסיום המשיכה'),
  ('auto_commission', 'חישוב עמלות אוטומטי אחרי קליטת דרישת התשלום'),
  ('auto_confirm_classification', 'אישור אוטומטי של סיווג תנועת בנק בוודאות גבוהה'),
  ('auto_approve_masav_match', 'אישור אוטומטי של התאמת מס"ב חד-משמעית'),
  ('talmud_bank_match', 'התאמת תשלומי משרד החינוך (מתלמוד) לתנועות הבנק')
on conflict (key) do nothing;

create or replace function automation_enabled(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_enabled from automation_settings where key = p_key), false);
$$;

create or replace function set_automation_setting(p_key text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (has_permission('financial_periods', 'manage') or has_permission('users', 'manage')) then
    raise exception 'permission denied';
  end if;
  update automation_settings set is_enabled = p_enabled, updated_at = now(), updated_by = auth.uid() where key = p_key;
  if not found then raise exception 'הגדרה לא מוכרת: %', p_key; end if;
  perform insert_audit_event('set_automation_setting', 'automation_settings', p_key, jsonb_build_object('enabled', p_enabled));
end;
$$;

revoke execute on function set_automation_setting(text, boolean) from public, anon;
grant execute on function set_automation_setting(text, boolean) to authenticated;

create table if not exists automation_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  organization_id uuid references organizations(id),
  month date,
  status text not null check (status in ('done', 'skipped', 'failed')),
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists automation_runs_created_idx on automation_runs (created_at desc);
alter table automation_runs enable row level security;
drop policy if exists automation_runs_select on automation_runs;
create policy automation_runs_select on automation_runs for select to authenticated
  using (has_permission('area_ops', 'access') or has_permission('area_finance', 'access') or has_permission('area_admin', 'access'));

create or replace function log_automation(p_kind text, p_org uuid, p_month date, p_status text, p_detail text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into automation_runs (kind, organization_id, month, status, detail) values (p_kind, p_org, p_month, p_status, p_detail);
$$;
revoke execute on function log_automation(text, uuid, date, text, text) from public, anon, authenticated;

-- ===== 2. חישוב עמלות - ליבה בלי בדיקת הרשאה =====
--
-- הגוף זהה ל-commit_commission_calculation של 026, רק בלי בדיקת ההרשאה - כדי
-- שאותה ליבה תשמש גם את הלחיצה הידנית וגם את החישוב האוטומטי.

create or replace function commission_calculate_core(p_organization_id uuid, p_month date)
returns table (processed_count integer, total_commission numeric, total_net numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_id uuid;
  v_row record;
  v_processed integer := 0;
  v_total_commission numeric := 0;
  v_total_net numeric := 0;
begin
  select id into v_period_id from financial_periods where organization_id = p_organization_id and month = p_month;
  perform assert_financial_period_open(p_organization_id, p_month);

  for v_row in
    select me.id as eligibility_id, me.group_id, me.branch_id, me.student_id, me.gross_amount, s.study_code
    from monthly_eligibility me
    join students s on s.id = me.student_id
    where me.organization_id = p_organization_id and me.month = p_month and me.status = 'active'
  loop
    declare
      v_rule commission_rules;
      v_commission numeric;
      v_net numeric;
      v_result_id uuid;
      v_prior_net numeric;
      v_delta numeric;
    begin
      select * into v_rule from match_commission_rule(p_organization_id, v_row.group_id, v_row.study_code, v_row.student_id, p_month);
      select c.commission_amount, c.net_amount into v_commission, v_net from compute_commission(v_rule, v_row.gross_amount) c;

      select net_amount into v_prior_net from eligibility_financial_results where eligibility_id = v_row.eligibility_id and status = 'active';

      if v_prior_net is not distinct from v_net then
        continue;
      end if;

      update eligibility_financial_results set status = 'superseded' where eligibility_id = v_row.eligibility_id and status = 'active';

      insert into eligibility_financial_results (
        eligibility_id, organization_id, branch_id, group_id, student_id, month,
        gross_amount, rule_id, rule_snapshot, commission_amount, net_amount, calculation_detail, financial_period_id
      )
      values (
        v_row.eligibility_id, p_organization_id, v_row.branch_id, v_row.group_id, v_row.student_id, p_month,
        v_row.gross_amount, v_rule.id, to_jsonb(v_rule), v_commission, v_net,
        jsonb_build_object('gross', v_row.gross_amount, 'commission', v_commission, 'net', v_net),
        v_period_id
      )
      returning id into v_result_id;

      v_delta := v_net - coalesce(v_prior_net, 0);

      if v_row.group_id is not null and v_delta <> 0 then
        insert into group_ledger_entries (organization_id, group_id, entry_type, amount, period_month, source_table, source_id, reference, created_by)
        values (p_organization_id, v_row.group_id, 'net_scholarship', v_delta, p_month, 'eligibility_financial_results', v_result_id, 'חישוב עמלה חודשי', auth.uid());
      end if;

      v_processed := v_processed + 1;
      v_total_commission := v_total_commission + v_commission;
      v_total_net := v_total_net + v_net;
    end;
  end loop;

  perform insert_audit_event(
    'commit_commission_calculation', 'financial_periods', v_period_id::text,
    jsonb_build_object('organization_id', p_organization_id, 'month', p_month, 'processed', v_processed)
  );

  return query select v_processed, v_total_commission, v_total_net;
end;
$$;

revoke execute on function commission_calculate_core(uuid, date) from public, anon, authenticated;

create or replace function commit_commission_calculation(p_organization_id uuid, p_month date)
returns table (processed_count integer, total_commission numeric, total_net numeric)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('commission', 'calculate') then
    raise exception 'permission denied';
  end if;
  return query select * from commission_calculate_core(p_organization_id, p_month);
end;
$$;

-- החישוב האוטומטי: אחרי שאצוות "זכאות חודשית" (דרישת תשלום) נקלטת. חודש כספי
-- שלא נפתח - נפתח לבד. חודש שבבדיקה או סגור - לא נוגעים בו, ונרשם ביומן למה.
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
  exception when others then
    perform log_automation('auto_commission', p_organization_id, p_month, 'failed', sqlerrm);
  end;
end;
$$;

revoke execute on function auto_commission_for(uuid, date) from public, anon, authenticated;

create or replace function trg_auto_commission_after_eligibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from import_profiles p where p.id = new.profile_id and p.key = 'talmud_eligibility') then
    perform auto_commission_for(new.organization_id, date_trunc('month', new.period_month)::date);
  end if;
  return null;
end;
$$;

drop trigger if exists import_batches_auto_commission on import_batches;
create trigger import_batches_auto_commission
  after update of status on import_batches
  for each row when (new.status = 'committed' and old.status is distinct from 'committed')
  execute function trg_auto_commission_after_eligibility();

-- ===== 3. אישור התאמת בנק - ליבה בלי בדיקת הרשאה =====
-- זהה ל-approve_bank_match של 038, רק בלי בדיקת ההרשאה.

create or replace function approve_bank_match_core(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match bank_matches;
  v_target_total numeric;
  v_already_approved numeric;
  v_org_id uuid;
  v_transaction_amount numeric;
  v_transaction_already_approved numeric;
begin
  select * into v_match from bank_matches where id = p_match_id;
  if v_match.id is null then
    raise exception 'התאמה לא נמצאה';
  end if;
  if v_match.status <> 'suggested' then
    raise exception 'ניתן לאשר רק התאמה בסטטוס הצעה (סטטוס נוכחי: %)', v_match.status;
  end if;

  select amount into v_transaction_amount from bank_transactions where id = v_match.bank_transaction_id;
  select coalesce(sum(matched_amount), 0) into v_transaction_already_approved
  from bank_matches where bank_transaction_id = v_match.bank_transaction_id and status = 'approved';

  if v_transaction_already_approved + v_match.matched_amount > v_transaction_amount + 0.01 then
    raise exception 'לא ניתן לאשר: סכום ההתאמות המאושרות על תנועה זו (%) יעלה על סכום התנועה עצמה (%)',
      v_transaction_already_approved + v_match.matched_amount, v_transaction_amount;
  end if;

  if v_match.target_table = 'masav_batches' then
    select total_amount, organization_id into v_target_total, v_org_id from masav_batches where id = v_match.target_id;
  elsif v_match.target_table = 'donations' then
    select amount, organization_id into v_target_total, v_org_id from donations where id = v_match.target_id;
  end if;

  if v_target_total is not null then
    select coalesce(sum(matched_amount), 0) into v_already_approved
    from bank_matches
    where target_table = v_match.target_table and target_id = v_match.target_id and status = 'approved';

    if v_already_approved + v_match.matched_amount > v_target_total + 0.01 then
      raise exception 'לא ניתן לאשר: סכום ההתאמות המאושרות (%) יעלה על סכום היעד (%)',
        v_already_approved + v_match.matched_amount, v_target_total;
    end if;
  end if;

  update bank_matches set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_match_id;

  if v_match.target_table = 'masav_batches' then
    if v_already_approved + v_match.matched_amount >= v_target_total - 0.01 then
      update masav_batches set status = 'bank_completed' where id = v_match.target_id and status = 'transmitted';
    end if;
  end if;

  perform insert_audit_event('approve_bank_match', 'bank_matches', p_match_id::text, jsonb_build_object('target_table', v_match.target_table, 'target_id', v_match.target_id));
end;
$$;

revoke execute on function approve_bank_match_core(uuid) from public, anon, authenticated;

create or replace function approve_bank_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('bank_matching', 'perform') then
    raise exception 'permission denied';
  end if;
  perform approve_bank_match_core(p_match_id);
end;
$$;

-- ===== 4. תשלומי משרד החינוך (מתלמוד) מול הבנק =====
--
-- "תשלומים למוסד" (121) הוא מה שהמשרד אומר ששילם לכל סניף וסוג תשלום. כל שורה עם
-- סכום מחפשת תנועת זכות בחשבונות העמותה: אותו סכום בדיוק, בטווח של 5 ימים לפני
-- תאריך החישוב עד 30 ימים אחריו. כל תנועה משמשת שורה אחת בלבד, והקרובה בתאריך
-- נבחרת. אין התאמה = לא מנחשים; אחרי 14 ימים זה מופיע כחריגה.

create table if not exists talmud_payment_bank_links (
  report_row_id uuid primary key references talmud_report_rows(id) on delete cascade,
  bank_transaction_id uuid not null unique references bank_transactions(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  linked_at timestamptz not null default now()
);
alter table talmud_payment_bank_links enable row level security;
drop policy if exists talmud_payment_bank_links_select on talmud_payment_bank_links;
create policy talmud_payment_bank_links_select on talmud_payment_bank_links for select to authenticated
  using (has_permission('area_ops', 'access') or has_permission('area_finance', 'access'));

-- "15/09/2026" / "15/09/2026 10:30" / "2026-09-15" -> date
create or replace function talmud_text_date(p text)
returns date
language plpgsql
immutable
as $$
declare
  m text[];
begin
  if p is null then return null; end if;
  m := regexp_match(p, '(\d{1,2})/(\d{1,2})/(\d{4})');
  if m is not null then return make_date(m[3]::int, m[2]::int, m[1]::int); end if;
  m := regexp_match(p, '(\d{4})-(\d{2})-(\d{2})');
  if m is not null then return make_date(m[1]::int, m[2]::int, m[3]::int); end if;
  return null;
exception when others then
  return null;
end;
$$;

create or replace function match_talmud_institute_payments(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_tx uuid;
  v_linked integer := 0;
begin
  if not automation_enabled('talmud_bank_match') then return 0; end if;

  for v_row in
    select r.id, r.organization_id, (r.data ->> 'amount')::numeric as amount,
           coalesce(talmud_text_date(r.data ->> 'calc_date'), r.month) as ref_date
    from talmud_report_rows r
    where r.report_key = 'institute_payments'
      and r.organization_id = p_organization_id
      and coalesce((r.data ->> 'amount')::numeric, 0) > 0
      and not exists (select 1 from talmud_payment_bank_links l where l.report_row_id = r.id)
    order by r.month, r.id
  loop
    select bt.id into v_tx
    from bank_transactions bt
    join organization_bank_accounts a on a.id = bt.organization_bank_account_id
    where a.organization_id = v_row.organization_id
      and bt.direction = 'credit'
      and abs(bt.amount - v_row.amount) < 0.01
      and bt.execution_date between v_row.ref_date - 5 and v_row.ref_date + 30
      and not exists (select 1 from talmud_payment_bank_links l where l.bank_transaction_id = bt.id)
    order by abs(bt.execution_date - v_row.ref_date), bt.id
    limit 1;

    if v_tx is not null then
      insert into talmud_payment_bank_links (report_row_id, bank_transaction_id, organization_id)
      values (v_row.id, v_tx, v_row.organization_id)
      on conflict do nothing;
      v_linked := v_linked + 1;
    end if;
  end loop;

  if v_linked > 0 then
    perform log_automation('talmud_bank_match', p_organization_id, null, 'done', 'הותאמו ' || v_linked || ' תשלומים של משרד החינוך לתנועות בבנק');
  end if;
  return v_linked;
end;
$$;

revoke execute on function match_talmud_institute_payments(uuid) from public, anon, authenticated;

-- אחרי קליטת "תשלומים למוסד": התאמה מיד, לכל עמותה שבקליטה
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
  return null;
end;
$$;

drop trigger if exists talmud_report_rows_match_payments on talmud_report_rows;
create trigger talmud_report_rows_match_payments
  after insert on talmud_report_rows
  referencing new table as new_rows
  for each statement execute function trg_match_talmud_payments_after_report();

-- ===== 5. ליבת קליטת הבנק - זהה ל-123, ונוספו האישורים האוטומטיים =====

create or replace function ingest_bank_transactions_core(
  p_setting_id uuid,
  p_transactions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_setting bank_auto_sync_settings;
  v_batch_id uuid;
  v_run_id uuid;
  v_fetched integer := 0;
  v_committed integer := 0;
  v_duplicates integer := 0;
  v_max_execution_date date;
  v_min_new_execution_date date;
  v_profile_id uuid;
  v_gap_detected boolean := false;
  v_gap_detail text := null;
  v_auto_confirmed integer := 0;
  v_auto_matched integer := 0;
  v_org uuid;
  v_m record;
begin
  select * into v_setting from bank_auto_sync_settings where id = p_setting_id;
  if v_setting.id is null then
    raise exception 'sync setting not found';
  end if;

  insert into bank_auto_sync_runs (setting_id, status) values (p_setting_id, 'running') returning id into v_run_id;

  select id into v_profile_id from bank_import_profiles where key = v_setting.provider;
  if v_profile_id is null then
    update bank_auto_sync_runs set finished_at = now(), status = 'failed', error_message = 'לא נמצא פרופיל יבוא עבור ספק: ' || coalesce(v_setting.provider, '(ריק)') where id = v_run_id;
    return v_run_id;
  end if;

  begin
    v_fetched := coalesce(jsonb_array_length(p_transactions), 0);

    insert into bank_import_batches (
      organization_bank_account_id, profile_id, file_path, file_name, file_hash,
      source, status, uploaded_by
    )
    values (
      v_setting.organization_bank_account_id, v_profile_id,
      'api-pull/' || v_run_id::text, 'api-pull-' || to_char(now(), 'YYYY-MM-DD-HH24MISS') || '.json',
      'auto-' || v_run_id::text,
      'automated', 'uploaded', v_setting.created_by
    )
    returning id into v_batch_id;

    update bank_auto_sync_runs set batch_id = v_batch_id where id = v_run_id;

    insert into bank_import_rows (batch_id, row_number, raw, normalized, fingerprint, status)
    select
      v_batch_id,
      row_number() over (),
      t.value,
      t.value,
      compute_bank_fingerprint(
        v_setting.organization_bank_account_id,
        nullif(t.value ->> 'bank_transaction_id', ''),
        (t.value ->> 'execution_date')::date,
        nullif(t.value ->> 'value_date', '')::date,
        t.value ->> 'direction',
        (t.value ->> 'amount')::numeric,
        nullif(t.value ->> 'reference', ''),
        nullif(t.value ->> 'description', '')
      ),
      'valid'
    from jsonb_array_elements(p_transactions) as t(value);

    update bank_import_rows br
    set status = 'duplicate'
    where br.batch_id = v_batch_id
      and br.status = 'valid'
      and exists (
        select 1 from bank_transactions bt
        where bt.organization_bank_account_id = v_setting.organization_bank_account_id
          and bt.fingerprint = br.fingerprint
      );

    update bank_import_rows br
    set status = 'duplicate'
    where br.batch_id = v_batch_id
      and br.status = 'valid'
      and br.id <> (
        select min(br2.id) from bank_import_rows br2
        where br2.batch_id = v_batch_id and br2.fingerprint = br.fingerprint
      );

    perform set_config('app.allow_bank_batch_commit', 'true', true);

    insert into bank_transactions (
      organization_bank_account_id, batch_id, execution_date, value_date, direction, amount,
      description, reference, operation_type, bank_balance_after, bank_transaction_id,
      raw, normalized, fingerprint
    )
    select
      v_setting.organization_bank_account_id, v_batch_id,
      (br.normalized ->> 'execution_date')::date,
      nullif(br.normalized ->> 'value_date', '')::date,
      br.normalized ->> 'direction',
      (br.normalized ->> 'amount')::numeric,
      br.normalized ->> 'description',
      nullif(br.normalized ->> 'reference', ''),
      nullif(br.normalized ->> 'operation_type', ''),
      nullif(br.normalized ->> 'bank_balance_after', '')::numeric,
      nullif(br.normalized ->> 'bank_transaction_id', ''),
      br.raw, br.normalized, br.fingerprint
    from bank_import_rows br
    where br.batch_id = v_batch_id and br.status = 'valid';

    get diagnostics v_committed = row_count;

    update bank_import_rows set status = 'committed' where batch_id = v_batch_id and status = 'valid';
    select count(*) into v_duplicates from bank_import_rows where batch_id = v_batch_id and status = 'duplicate';

    update bank_import_batches
    set valid_count = v_committed, duplicate_count = v_duplicates, status = 'committed', committed_at = now()
    where id = v_batch_id;

    update bank_transactions bt
    set suggested_type_id = r.suggested_type_id,
        suggested_confidence = r.confidence_level,
        suggested_reason = 'התאמה לכלל זיהוי (עדיפות ' || r.priority || ') - נקלט אוטומטית',
        suggested_rule_id = r.id,
        classification_status = 'suggested'
    from bank_transactions bt2
    cross join lateral match_recognition_rule(bt2.organization_bank_account_id, bt2.direction, bt2.amount, bt2.description, bt2.reference, bt2.execution_date) r
    where bt.id = bt2.id
      and bt2.batch_id = v_batch_id
      and bt2.classification_status = 'unclassified'
      and r.id is not null;

    -- (124) אישור אוטומטי של סיווג בוודאות גבוהה. בינוני/נמוך נשאר הצעה לפקיד.
    if automation_enabled('auto_confirm_classification') then
      update bank_transactions bt
      set confirmed_type_id = bt.suggested_type_id,
          classification_status = 'confirmed',
          suggested_reason = coalesce(bt.suggested_reason, '') || ' · אושר אוטומטית (ודאות גבוהה)'
      where bt.batch_id = v_batch_id
        and bt.classification_status = 'suggested'
        and bt.suggested_confidence = 'high'
        and bt.suggested_type_id is not null;
      get diagnostics v_auto_confirmed = row_count;
    end if;

    insert into bank_matches (bank_transaction_id, match_type, target_table, target_id, matched_amount, suggested_reason, created_by)
    select
      bt.id, 'masav_batch', 'masav_batches', mb.id,
      least(bt.amount, mb.total_amount),
      'התאמה אוטומטית: אותו חשבון, סכום תואם, תאריך סמוך לשידור (משיכה אוטומטית)',
      v_setting.created_by
    from bank_transactions bt
    join masav_batches mb on mb.organization_bank_account_id = bt.organization_bank_account_id
    where bt.batch_id = v_batch_id
      and bt.direction = 'debit'
      and mb.status in ('transmitted', 'bank_completed')
      and abs(bt.amount - mb.total_amount) < 0.01
      and mb.transmitted_at is not null
      and abs(bt.execution_date - mb.transmitted_at::date) <= 5
      and not exists (select 1 from bank_matches bm where bm.bank_transaction_id = bt.id and bm.status in ('suggested', 'approved'))
      and not exists (select 1 from bank_matches bm2 where bm2.target_table = 'masav_batches' and bm2.target_id = mb.id and bm2.status = 'approved');

    -- (124) אישור אוטומטי של התאמת מס"ב חד-משמעית: לתנועה יש הצעה אחת בלבד, לאצווה
    -- יש הצעה אחת בלבד, והסכום זהה. כל מצב אחר נשאר הצעה לפקיד.
    if automation_enabled('auto_approve_masav_match') then
      for v_m in
        select bm.id
        from bank_matches bm
        join bank_transactions bt on bt.id = bm.bank_transaction_id
        join masav_batches mb on mb.id = bm.target_id
        where bt.batch_id = v_batch_id
          and bm.status = 'suggested' and bm.target_table = 'masav_batches'
          and abs(bt.amount - mb.total_amount) < 0.01
          and (select count(*) from bank_matches x where x.bank_transaction_id = bm.bank_transaction_id and x.status = 'suggested') = 1
          and (select count(*) from bank_matches y where y.target_table = 'masav_batches' and y.target_id = bm.target_id and y.status = 'suggested') = 1
      loop
        begin
          perform approve_bank_match_core(v_m.id);
          v_auto_matched := v_auto_matched + 1;
        exception when others then
          null; -- נשאר הצעה; הפקיד יראה אותה כרגיל
        end;
      end loop;
    end if;

    select min((t.value ->> 'execution_date')::date), max((t.value ->> 'execution_date')::date)
    into v_min_new_execution_date, v_max_execution_date
    from jsonb_array_elements(p_transactions) as t(value);

    if v_setting.last_synced_execution_date is not null and v_min_new_execution_date is not null
       and v_min_new_execution_date > v_setting.last_synced_execution_date + 1 then
      v_gap_detected := true;
      v_gap_detail := 'אין תנועות בין ' || (v_setting.last_synced_execution_date + 1)::text || ' ל-' || (v_min_new_execution_date - 1)::text || ' - ייתכן שנוצר פער, מומלץ לבדוק ידנית מול דף חשבון הבנק.';
    elsif v_fetched = 0 and v_setting.last_synced_at is not null and v_setting.last_synced_at < now() - interval '3 days' then
      v_gap_detected := true;
      v_gap_detail := 'לא התקבלו תנועות חדשות כבר יותר מ-3 ימים - ייתכן תקלה בחיבור לבנק, לא בהכרח פער אמיתי בתנועות.';
    end if;

    update bank_auto_sync_settings
    set last_synced_execution_date = greatest(coalesce(last_synced_execution_date, v_max_execution_date), coalesce(v_max_execution_date, last_synced_execution_date)),
        last_synced_at = now()
    where id = p_setting_id;

    update bank_auto_sync_runs
    set finished_at = now(),
        status = case when v_gap_detected then 'partial' else 'success' end,
        transactions_fetched = v_fetched,
        transactions_committed = v_committed,
        transactions_duplicate = v_duplicates,
        gap_detected = v_gap_detected,
        gap_detail = v_gap_detail
    where id = v_run_id;


    -- (124) תשלומי משרד החינוך שמחכים לתנועה בבנק - אולי היא הגיעה עכשיו
    select organization_id into v_org from organization_bank_accounts where id = v_setting.organization_bank_account_id;
    perform match_talmud_institute_payments(v_org);
    if v_auto_confirmed > 0 or v_auto_matched > 0 then
      perform log_automation('bank_auto_approve', v_org, null, 'done',
        'סיווגים שאושרו אוטומטית: ' || v_auto_confirmed || ' · התאמות מס"ב שאושרו: ' || v_auto_matched);
    end if;

    perform insert_audit_event(
      'ingest_bank_transactions_batch', 'bank_auto_sync_runs', v_run_id::text,
      jsonb_build_object('fetched', v_fetched, 'committed', v_committed, 'duplicates', v_duplicates, 'gap_detected', v_gap_detected, 'provider', v_setting.provider)
    );
  exception when others then
    update bank_auto_sync_runs
    set finished_at = now(), status = 'failed', error_message = sqlerrm, transactions_fetched = v_fetched
    where id = v_run_id;
  end;

  return v_run_id;
end;
$$;

revoke execute on function ingest_bank_transactions_core(uuid, jsonb) from public, anon, authenticated;

-- ===== 6. מרכז החריגות: זהה ל-123, ונוסף ענף לתשלום שלא הגיע לבנק =====

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
) ue
left join organizations o on o.id = ue.organization_id
where coalesce(o.is_demo, false) = false;
