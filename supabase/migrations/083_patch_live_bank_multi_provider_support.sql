-- Patch לפרויקט החי (074/075 כבר רצו בפועל - ר' README, "חריגה מתועדת: 008/009"): הלקוח
-- של Chani עדכן שיש לעמותות שלו חשבונות גם בבנק מרכנתיל (17) ובבנק פאג"י (52), לא רק
-- לאומי. תשתית המשיכה האוטומטית (שלב 23) נבנתה כללית מלכתחילה - עמודת provider כבר
-- קיימת בלי ערך קשיח בקוד ה-SQL עצמו - אבל שני באגים אמיתיים נמצאו כשבדקתי להוסיף בנק
-- שני בפועל: (1) אין בכלל בורר ספק במסך ההגדרות - כל הגדרה חדשה נוצרה תמיד עם ברירת
-- המחדל 'leumi_open_banking' של העמודה, בלי דרך לבחור אחרת. (2) ingest_bank_transactions_batch
-- חיפשה תמיד `bank_import_profiles where key = 'leumi_open_banking'` בקוד קשיח - גם
-- אם ההגדרה בפועל הייתה עבור בנק אחר.
--
-- מחקר (ר' דוח ל-Chani): בנק מרכנתיל - אישור חזק, יש פורטל מפתחים ייעודי עם קטלוג API
-- אמיתי (mercantile.co.il/openbanking), תואם PSD2, כולל Sandbox. בנק פאג"י - פחות ודאי:
-- הוא מותג/חטיבה של הבנק הבינלאומי הראשון (לא רישיון בנקאי נפרד), ולבנק הבינלאומי יש
-- API עסקי אמיתי משלו - אבל לא אומת בוודאות שהוא חל גם על חשבונות פאג"י ספציפית. Chani
-- צריכה לוודא זאת ישירות מול הבנק/הבינלאומי, בדיוק כמו שנדרש לגבי לאומי.

-- קטלוג ה-profiles מתרחב - "בנק חדש = שורה חדשה, לא שינוי סכימה" (עיקרון קבוע מאז
-- שלב 11/035). לכל בנק שתי שורות: יבוא ידני (עדיין באמצעות הפרסינג הגנרי לפי כותרות
-- עבריות - ר' הערה בהמשך) ומשיכה אוטומטית.
insert into bank_import_profiles (key, bank_name, label_he, description) values
  ('bank_mercantile', 'מרכנתיל', 'מרכנתיל - יבוא ידני', 'יבוא קובץ ידני מבנק מרכנתיל - עדיין לפי זיהוי כותרות עמודות עברי גנרי (כמו bank_generic), עד לקבלת קובץ דוגמה אמיתי מהבנק שיאשר אם הפורמט שלו שונה.'),
  ('bank_pagi', 'פאג"י', 'פאג"י - יבוא ידני', 'יבוא קובץ ידני מבנק פאג"י - עדיין לפי זיהוי כותרות עמודות עברי גנרי (כמו bank_generic), עד לקבלת קובץ דוגמה אמיתי מהבנק שיאשר אם הפורמט שלו שונה.'),
  ('mercantile_open_banking', 'מרכנתיל', 'מרכנתיל - בנקאות פתוחה (משיכה אוטומטית)', 'תנועות שנמשכות אוטומטית דרך ה-API הרשמי של מרכנתיל (יש פורטל מפתחים מאושר), לא קובץ שהועלה ידנית.'),
  ('pagi_open_banking', 'פאג"י', 'פאג"י - בנקאות פתוחה (משיכה אוטומטית)', 'תנועות שנמשכות אוטומטית דרך ה-API של פאג"י/הבנק הבינלאומי - טרם אומת מול הבנק אם ה-API הרגיל של הבינלאומי חל גם על חשבונות פאג"י ספציפית.')
on conflict (key) do nothing;

-- הגנה על ערך provider: לפני התיקון הזה לא היה שום check - טעות הקלדה בעמודה הייתה
-- עוברת בשקט ונכשלת רק בזמן ריצה בפועל (list_due_bank_sync_accounts לא הייתה מוצאת
-- profile מתאים). מגביל לרשימה סגורה של ספקים שאושרו/נבדקו בפועל - הוספת ספק נוסף
-- בעתיד דורשת מיגרציה נוספת שתרחיב את הרשימה הזו, לא רק שורת seed חדשה.
alter table bank_auto_sync_settings
  add constraint bank_auto_sync_settings_provider_check
  check (provider in ('leumi_open_banking', 'mercantile_open_banking', 'pagi_open_banking'));

-- list_due_bank_sync_accounts: הוספת עמודת provider לפלט - חובה כדי ש-api/bank-sync.js
-- ידע לאיזה בנק לפנות בפועל לכל חשבון (בלי זה, אין דרך להבחין בין הגדרה של לאומי
-- להגדרה של מרכנתיל/פאג"י בצד ה-Vercel). שינוי טיפוס החזרה של פונקציה מחייב DROP לפני
-- CREATE (לא מספיק create or replace) - הפונקציה כבר רצה חי במיגרציה 074.
drop function if exists list_due_bank_sync_accounts(text);

create function list_due_bank_sync_accounts(p_secret text)
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
  where is_bank_sync_due(s);
end;
$$;

grant execute on function list_due_bank_sync_accounts(text) to anon, authenticated;

-- ingest_bank_transactions_batch: תיקון הבאג - חיפוש ה-profile היה קשיח ל-'leumi_open_banking'
-- תמיד, בלי קשר לספק בפועל של ההגדרה. עכשיו נגזר מ-v_setting.provider - זהה ל-key
-- שכבר קיים בטבלת bank_import_profiles לכל אחד משלושת הספקים. create or replace מספיק
-- כאן (לא DROP) כי טיפוס הקלט/הפלט לא השתנו, רק הגוף הפנימי.
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
  select secret into v_stored_secret from bank_sync_config where id = true;
  if v_stored_secret is null or p_secret is distinct from v_stored_secret then
    raise exception 'invalid sync secret';
  end if;

  select * into v_setting from bank_auto_sync_settings where id = p_setting_id;
  if v_setting.id is null then
    raise exception 'sync setting not found';
  end if;

  insert into bank_auto_sync_runs (setting_id, status) values (p_setting_id, 'running') returning id into v_run_id;

  select id into v_profile_id from bank_import_profiles where key = v_setting.provider;
  if v_profile_id is null then
    -- לא אמור לקרות (provider מוגן ע"י check constraint שתמיד תואם profile קיים) - אבל
    -- אם בכל זאת קרה, נכשל בבירור ובתיעוד מלא, לא בשקט עם profile_id ריק בהזמנה.
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

grant execute on function ingest_bank_transactions_batch(text, uuid, jsonb) to anon, authenticated;
