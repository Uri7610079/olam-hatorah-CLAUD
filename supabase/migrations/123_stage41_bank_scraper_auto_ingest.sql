-- שלב 41: קליטה אוטומטית של תנועות בנק מהסקרייפר שבמחשב המשרד
--
-- החלטת צ'ני (2026-11-18): כל מה שנמשך מהבנק נקלט מיד, בלי יבוא ידני. השיוך לעמותה
-- נעשה רק לפי מספר החשבון והבנק, ואת ההסבר לתנועה (סיווג, התאמה) הפקיד משלים רק
-- כשמשהו לא מסתדר.
--
-- איך זה מחובר: הסקרייפר (bank-scraper-portable.ps1) מושך מהבנק, ומיד אחר כך שולח
-- כל חשבון בנפרד ל-ingest_scraped_bank_account(). זו עוטפת את אותה ליבת קליטה
-- שנבנתה בשלב 23 למשיכה דרך API (ingest_bank_transactions_batch) - staging, דדופ לפי
-- fingerprint, הצעת סיווג, הצעת התאמה למס"ב, זיהוי פער - בלי לשכפל אותה.
--
-- ארבע הגנות שסוכמו עם צ'ני:
--   1. שיוך רק לפי חשבון רשום. חשבון שלא נמצא (או שנמצאו לו שני חשבונות במערכת) -
--      לא נקלט, ונרשם ב-bank_scraper_unmatched_accounts, שמופיעה במרכז החריגות.
--   2. כפילויות - כמו קודם: מזהה הבנק קודם, גיבוב רק בהיעדרו.
--   3. בדיקת יתרה: היתרה הקודמת שהבנק דיווח + התנועות החדשות צריכה לתת את היתרה
--      הנוכחית. פער = חסרות תנועות, והריצה מסומנת "פער" (נכנסת למרכז החריגות).
--   4. מפתח מוגבל: הסקרייפר מחזיק מפתח שמאפשר רק את הקליטה הזו. במסד נשמרת רק
--      טביעה (sha256) - כמו talmud_worker_config (120). המפתח נוצר מהאתר, במסך
--      "משיכה אוטומטית מהבנק", ונכתב משם ישר לתיקייה שבמחשב המשרד.
--
-- מה שלא משתנה: סיווג ההתאמות נשאר הצעה (suggested). שום התאמה לא מאושרת לבד.

-- ===== 1. המפתח =====

create table if not exists bank_scraper_config (
  id boolean primary key default true,
  secret_hash text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (id)
);
alter table bank_scraper_config enable row level security;
-- בלי אף policy: deny-all. הקריאה והכתיבה רק דרך הפונקציות למטה.

-- יצירת מפתח (או החלפתו). מחזירה את המפתח עצמו פעם אחת בלבד - האתר כותב אותו
-- לתיקייה במחשב ולא מציג אותו. מפתח חדש מבטל את הקודם מיד.
create or replace function create_bank_scraper_key()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text := encode(gen_random_bytes(32), 'hex');
begin
  if not has_permission('bank_import', 'perform') then
    raise exception 'permission denied';
  end if;
  insert into bank_scraper_config (id, secret_hash, created_by, created_at)
  values (true, encode(digest(v_secret, 'sha256'), 'hex'), auth.uid(), now())
  on conflict (id) do update set secret_hash = excluded.secret_hash, created_by = excluded.created_by, created_at = excluded.created_at;
  perform insert_audit_event('create_bank_scraper_key', 'bank_scraper_config', 'true', null);
  return v_secret;
end;
$$;

revoke execute on function create_bank_scraper_key() from public, anon;
grant execute on function create_bank_scraper_key() to authenticated;

-- האם יש מפתח, ומתי נוצר - למסך. לא מחזיר את הטביעה.
create or replace function bank_scraper_key_status()
returns table (has_key boolean, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from bank_scraper_config), (select c.created_at from bank_scraper_config c where c.id);
$$;

revoke execute on function bank_scraper_key_status() from public, anon;
grant execute on function bank_scraper_key_status() to authenticated;

create or replace function bank_scraper_check(p_secret text)
returns void
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  select secret_hash into v_hash from bank_scraper_config where id;
  if v_hash is null or coalesce(p_secret, '') = '' or encode(digest(p_secret, 'sha256'), 'hex') <> v_hash then
    raise exception 'unauthorized';
  end if;
end;
$$;

revoke execute on function bank_scraper_check(text) from public, anon, authenticated;

-- ===== 2. ספק חדש: הסקרייפר במחשב המשרד =====

insert into bank_import_profiles (key, bank_name, label_he, description)
values ('office_scraper', 'כל הבנקים', 'משיכה מהמחשב במשרד (סקרייפר)', 'תנועות שהסקרייפר במחשב המשרד משך מאתר הבנק ושלח ישר למערכת.')
on conflict (key) do nothing;

alter table bank_auto_sync_settings drop constraint if exists bank_auto_sync_settings_provider_check;
alter table bank_auto_sync_settings
  add constraint bank_auto_sync_settings_provider_check
  check (provider in ('leumi_open_banking', 'mercantile_open_banking', 'pagi_open_banking', 'office_scraper'));

-- הגדרה שהסקרייפר יוצר אין מאחוריה משתמש מחובר.
alter table bank_auto_sync_settings alter column created_by drop not null;

-- היתרה שהבנק דיווח בכל ריצה - הבסיס לבדיקת היתרה של הריצה הבאה.
alter table bank_auto_sync_runs add column if not exists bank_reported_balance numeric(14, 2);
-- כמה תנועות ממתינות היו בבנק באותה ריצה. בדיקת היתרה תקפה רק כשאין כאלה - לא
-- עכשיו ולא בריצה הקודמת (תנועה שהמתינה אז ונסגרה עכשיו כבר ירדה מהיתרה הקודמת).
alter table bank_auto_sync_runs add column if not exists bank_pending_count integer;

-- המשיכה דרך API (Vercel Cron) לא נוגעת בחשבונות של הסקרייפר. זהה ל-083, ונוסף התנאי.
create or replace function list_due_bank_sync_accounts(p_secret text)
returns table (
  setting_id uuid,
  organization_bank_account_id uuid,
  provider text,
  bank_name text,
  bank_branch_code text,
  account_number text,
  since_execution_date date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stored_secret text;
begin
  select secret into v_stored_secret from bank_sync_config where id = true;
  if v_stored_secret is null or p_secret is distinct from v_stored_secret then
    raise exception 'invalid sync secret';
  end if;

  return query
  select s.id, s.organization_bank_account_id, s.provider, a.bank_name, a.bank_branch_code, a.account_number, s.last_synced_execution_date
  from bank_auto_sync_settings s
  join organization_bank_accounts a on a.id = s.organization_bank_account_id
  where is_bank_sync_due(s) and s.provider <> 'office_scraper';
end;
$$;

-- ===== 3. ליבת הקליטה, בלי בדיקת הסוד =====
--
-- הגוף זהה מילה במילה ל-ingest_bank_transactions_batch של 083 - רק בדיקת הסוד הוצאה
-- החוצה, כדי ששני הנכנסים (API עם bank_sync_config, סקרייפר עם bank_scraper_config)
-- יעברו באותה ליבה ולא בשני עותקים שיתפצלו עם הזמן.

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

-- הכניסה של ה-API (שלב 23): בדיקת הסוד שלה, ואז הליבה. התנהגות זהה ל-083.
create or replace function ingest_bank_transactions_batch(
  p_secret text,
  p_setting_id uuid,
  p_transactions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stored_secret text;
begin
  select secret into v_stored_secret from bank_sync_config where id = true;
  if v_stored_secret is null or p_secret is distinct from v_stored_secret then
    raise exception 'invalid sync secret';
  end if;
  return ingest_bank_transactions_core(p_setting_id, p_transactions);
end;
$$;

grant execute on function ingest_bank_transactions_batch(text, uuid, jsonb) to anon, authenticated;

-- ===== 4. חשבונות שהסקרייפר הביא ואין להם בעלים במערכת =====

create table if not exists bank_scraper_unmatched_accounts (
  id uuid primary key default gen_random_uuid(),
  bank_code text not null,
  account_number text not null,
  connection_key text,
  reason text not null check (reason in ('not_found', 'ambiguous')),
  transactions_count integer not null default 0,
  bank_balance numeric(14, 2),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (bank_code, account_number)
);
alter table bank_scraper_unmatched_accounts enable row level security;
drop policy if exists bank_scraper_unmatched_accounts_select on bank_scraper_unmatched_accounts;
create policy bank_scraper_unmatched_accounts_select on bank_scraper_unmatched_accounts for select to authenticated
  using (has_permission('area_finance', 'access') or has_permission('area_ops', 'access'));

-- ===== 5. הכניסה של הסקרייפר =====
--
-- חשבון אחד בכל קריאה. הסקרייפר מפצל לפי account_number, כי כניסה אחת לבנק יכולה
-- להחזיר כמה חשבונות.
--
-- התאמת חשבון: ספרות בלבד, בלי אפסים מובילים, ורק בתוך אותו בנק. מתקבל אחד מאלה:
--   * מספר החשבון זהה ("123456" מול "123456")
--   * הסקרייפר מצרף סניף ("12-123456"): החלק האחרון הוא החשבון, והראשון הסניף
--   * סניף+חשבון מחוברים בלי מפריד ("12123456")
-- שום התאמה "חלקית" אחרת. עדיף חשבון שנעצר ומחכה לבדיקה, מאשר תנועות שנרשמו
-- לעמותה הלא נכונה.

create or replace function scraper_account_digits(p text)
returns text
language sql
immutable
as $$
  select nullif(ltrim(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '0'), '');
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

  v_run := ingest_bank_transactions_core(v_setting, coalesce(p_transactions, '[]'::jsonb));

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

-- ===== 6. מרכז החריגות: זהה ל-122, ונוסף ענף לחשבון שלא נמצא =====

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
) ue
left join organizations o on o.id = ue.organization_id
where coalesce(o.is_demo, false) = false;
