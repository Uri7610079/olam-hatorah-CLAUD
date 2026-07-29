-- שלב 23: משיכה אוטומטית של תנועות בנק (Open Banking), לפי בקשת Chani. בונה על תשתית
-- הבנק הקיימת משלבים 11-12 (bank_import_batches/rows, bank_transactions, recognition_rules,
-- bank_matches) בלי לשכפל אותה - הפונקציה החדשה כאן היא המקור השלישי (אחרי יבוא ידני)
-- שמזין את אותן טבלאות בדיוק, כך שכל מסכי הסיווג/ההתאמה/מרכז החריגות הקיימים ממשיכים
-- לעבוד בלי שינוי.
--
-- למה לא has_permission() כאן: ההרצה היא ע"י Vercel Cron (בלי משתמש מחובר, בדיוק כמו
-- pg_cron/generate_due_recurrences משלב 20) - הגנה היא secret משותף (bank_sync_config,
-- RLS בלי אף policy - deny-all, אותו דפוס בדיוק כמו whatsapp_webhook_config משלב 21).
--
-- אין אישור אוטומטי של סיווג/התאמה כאן: הפונקציה רק "מציעה" (suggested), בדיוק כמו
-- suggest_transaction_types()/suggest_masav_matches() הידניות - אישור סופי עדיין דורש
-- אדם במסכי הסיווג/ההתאמה הקיימים. "לא לבצע פעולה כספית רגישה אוטומטית" הוא עיקרון
-- שחוזר לאורך כל הפרויקט (ר' migration 065, סעיף דומה במודול המשימות).

create table bank_sync_config (
  id boolean primary key default true,
  secret text not null,
  check (id)
);
alter table bank_sync_config enable row level security;
-- בלי אף policy = deny-all מוחלט, גם ל-authenticated - הערך מוזן ידנית ע"י Chani דרך
-- SQL Editor, לא דרך שום מסך באפליקציה. אותו עיקרון בדיוק כמו whatsapp_webhook_config.

create table bank_auto_sync_settings (
  id uuid primary key default gen_random_uuid(),
  -- on delete cascade: מניעה חד-כיוונית - שלא יהיה FK violation שיעצור מחיקת נתוני דמו
  -- (delete_demo_batch, שלב 15) אם מישהו בכל זאת יגדיר משיכה אוטומטית על חשבון בנק
  -- של עמותת דמו (אותה בעיה קיימת כבר, בלי תיקון, על recognition_rules/bank_import_batches -
  -- לא בטווח התיקון כאן, אבל אין סיבה שהטבלאות החדשות יוסיפו עוד נקודת חסימה זהה).
  organization_bank_account_id uuid not null references organization_bank_accounts(id) on delete cascade,
  provider text not null default 'leumi_open_banking',
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly')),
  day_of_week smallint check (day_of_week between 0 and 6),
  day_of_month smallint check (day_of_month between 1 and 31),
  is_enabled boolean not null default true,
  -- "סימניה" - תאריך הביצוע של התנועה המאוחרת ביותר שנקלטה בהצלחה עד כה. ההרצה הבאה
  -- מבקשת מהבנק רק תנועות מאז התאריך הזה (לא הכל מחדש בכל פעם).
  last_synced_execution_date date,
  last_synced_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  check (
    (frequency = 'weekly' and day_of_week is not null)
    or (frequency = 'monthly' and day_of_month is not null)
    or (frequency = 'daily')
  ),
  unique (organization_bank_account_id)
);

create trigger bank_auto_sync_settings_set_updated_at
  before update on bank_auto_sync_settings
  for each row execute function set_updated_at();

create table bank_auto_sync_runs (
  id uuid primary key default gen_random_uuid(),
  setting_id uuid not null references bank_auto_sync_settings(id) on delete cascade,
  batch_id uuid references bank_import_batches(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'partial', 'failed')),
  transactions_fetched integer not null default 0,
  transactions_committed integer not null default 0,
  transactions_duplicate integer not null default 0,
  gap_detected boolean not null default false,
  gap_detail text,
  error_message text,
  is_resolved boolean not null default false,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz
);

create index bank_auto_sync_runs_setting_idx on bank_auto_sync_runs (setting_id, started_at desc);

alter table bank_auto_sync_settings enable row level security;
alter table bank_auto_sync_runs enable row level security;

create policy bank_auto_sync_settings_select on bank_auto_sync_settings for select to authenticated
  using (has_permission('area_finance', 'access') or has_permission('area_ops', 'access'));
create policy bank_auto_sync_settings_manage on bank_auto_sync_settings for all to authenticated
  using (has_permission('bank_import', 'perform'))
  with check (has_permission('bank_import', 'perform'));

create policy bank_auto_sync_runs_select on bank_auto_sync_runs for select to authenticated
  using (has_permission('area_finance', 'access') or has_permission('area_ops', 'access'));
-- אין insert/update policy - נכתב רק ע"י ingest_bank_transactions_batch() (SECURITY DEFINER).
-- החריגה היחידה: acknowledge_bank_sync_run() (למטה) לסימון "טופל", דרך RPC ולא ישירות.

create trigger bank_auto_sync_settings_audit after insert or update on bank_auto_sync_settings for each row execute function audit_table_change();

-- מקור התנועה (יבוא ידני מול משיכה אוטומטית) - לא היה קיים עד עכשיו על bank_import_batches.
alter table bank_import_batches add column source text not null default 'manual' check (source in ('manual', 'automated'));

-- פרופיל יבוא ייעודי למשיכה האוטומטית - "בנק חדש = שורה חדשה, לא שינוי סכימה" (אותו
-- עיקרון שכבר נוהג ב-bank_import_profiles מאז שלב 11).
insert into bank_import_profiles (key, bank_name, label_he, description)
values ('leumi_open_banking', 'לאומי', 'לאומי - בנקאות פתוחה (משיכה אוטומטית)', 'תנועות שנמשכו אוטומטית דרך ה-API הרשמי של לאומי, לא קובץ שהועלה ידנית.')
on conflict (key) do nothing;

-- חישוב fingerprint זהה בדיוק לאלגוריתם בצד לקוח (computeFingerprint ב-BankTransactionsScreen.tsx)
-- - קריטי שיהיה זהה מילה-במילה, אחרת תנועה שנמשכה אוטומטית ותועלה ידנית בעתיד (או להפך)
-- לא תזוהה ככפולה.
create or replace function compute_bank_fingerprint(
  p_account_id uuid,
  p_bank_transaction_id text,
  p_execution_date date,
  p_value_date date,
  p_direction text,
  p_amount numeric,
  p_reference text,
  p_description text
)
returns text
language sql
immutable
as $$
  select case
    when p_bank_transaction_id is not null and p_bank_transaction_id <> '' then 'bankid:' || p_bank_transaction_id
    else encode(
      digest(
        p_account_id::text || '|' || p_execution_date::text || '|' || coalesce(p_value_date::text, '') || '|' ||
        p_direction || '|' || to_char(p_amount, 'FM999999999990.00') || '|' || coalesce(p_reference, '') || '|' || coalesce(p_description, ''),
        'sha256'
      ),
      'hex'
    )
  end;
$$;

-- האם הכלל הזה "אמור לרוץ היום" - נבדק כל יום ע"י ה-Cron (יום = הטריגר הקבוע היחיד
-- שVercel Cron בתוכנית החינמית תומך בו; יומי/שבועי/חודשי לפי המשתמש נבדק כאן, בתוך
-- הפונקציה, לא ברמת תזמון ה-Cron עצמו).
create or replace function is_bank_sync_due(p_setting bank_auto_sync_settings)
returns boolean
language sql
stable
as $$
  select
    p_setting.is_enabled
    and (
      p_setting.frequency = 'daily'
      or (p_setting.frequency = 'weekly' and extract(dow from current_date) = p_setting.day_of_week)
      or (
        p_setting.frequency = 'monthly'
        and (
          extract(day from current_date) = p_setting.day_of_month
          -- קיזוז לחודשים קצרים (פברואר, אפריל, ...): מי שבחר יום 29-31 ירוץ ביום
          -- האחרון של החודש באותם חודשים שבהם היום שנבחר לא קיים בכלל, במקום לדלג
          -- על החודש כולו בשקט (נתפס בביקורת - "תבדוק שאין באגים").
          or (
            p_setting.day_of_month > extract(day from (date_trunc('month', current_date) + interval '1 month - 1 day'))
            and current_date = (date_trunc('month', current_date) + interval '1 month - 1 day')::date
          )
        )
      )
    )
    -- הגנה נוספת: לא להריץ פעמיים באותו יום גם אם ה-Cron הופעל שוב (למשל ידנית לבדיקה).
    and (p_setting.last_synced_at is null or p_setting.last_synced_at::date < current_date);
$$;

grant execute on function is_bank_sync_due(bank_auto_sync_settings) to authenticated;

-- הפונקציה ב-Vercel (ללא session) לא יכולה לקרוא ישירות את organization_bank_accounts
-- (מוגן RLS, דורש has_permission() של משתמש מחובר) - כדי לדעת אילו חשבונות "אמורים
-- לרוץ היום" ומה מספר החשבון/סניף שלהם (נדרש בפועל לקריאה מה-API של הבנק), היא
-- קוראת לפונקציה הזו במקום, תחת אותה הגנת-secret. מחזירה רק את השדות הדרושים לקריאת
-- API, לא שדות רגישים נוספים שלא רלוונטיים כאן (למשל account_holder_name).
create or replace function list_due_bank_sync_accounts(p_secret text)
returns table (
  setting_id uuid,
  organization_bank_account_id uuid,
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
  select s.id, s.organization_bank_account_id, a.bank_name, a.bank_branch_code, a.account_number, s.last_synced_execution_date
  from bank_auto_sync_settings s
  join organization_bank_accounts a on a.id = s.organization_bank_account_id
  where is_bank_sync_due(s);
end;
$$;

grant execute on function list_due_bank_sync_accounts(text) to anon, authenticated;

-- ליבת המשיכה האוטומטית: מקבלת תנועות כבר מנורמלות (מהפונקציה ב-Vercel, אחרי שקראה
-- בפועל מה-API של הבנק) ומזינה אותן לתוך אותה תשתית בדיוק כמו יבוא קובץ ידני - כולל
-- staging, דדופ, סיווג אוטומטי, הצעת התאמות מס"ב, וזיהוי פערים. לא קוראת ל-
-- commit_bank_import_batch/suggest_transaction_types/suggest_masav_matches הקיימות
-- (כולן דורשות has_permission() של משתמש מחובר, שלא קיים בהרצת Cron) - במקום זה משכפלת
-- את הלוגיקה הדרושה ישירות, תחת אותו הגנת-secret כמו כל שאר ההרצה.
create or replace function ingest_bank_transactions_batch(
  p_secret text,
  p_setting_id uuid,
  p_transactions jsonb -- מערך אובייקטים: execution_date, value_date, direction, amount,
                       -- description, reference, operation_type, bank_balance_after, bank_transaction_id
)
returns uuid -- run id
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

  select id into v_profile_id from bank_import_profiles where key = 'leumi_open_banking';

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

    -- staging: כל תנועה הופכת לשורת bank_import_row עם fingerprint מחושב, כולל בדיקת
    -- כפילות מול bank_transactions הקיימות (אותו עיקרון כמו analyzeBankFile בצד לקוח).
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

    -- כפילות מול תנועות שכבר קיימות בפועל בחשבון הזה.
    update bank_import_rows br
    set status = 'duplicate'
    where br.batch_id = v_batch_id
      and br.status = 'valid'
      and exists (
        select 1 from bank_transactions bt
        where bt.organization_bank_account_id = v_setting.organization_bank_account_id
          and bt.fingerprint = br.fingerprint
      );

    -- כפילות פנימיות בתוך אותה אצווה עצמה (אם ה-API החזיר את אותה תנועה פעמיים).
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

    -- סיווג אוטומטי - הצעה בלבד (classification_status='suggested'), אותה שאילתה בדיוק
    -- כמו suggest_transaction_types(), בלי בדיקת ההרשאה שלא רלוונטית כאן.
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

    -- הצעת התאמות מס"ב - אותה שאילתה בדיוק כמו suggest_masav_matches(), בלי בדיקת הרשאה.
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

    -- זיהוי פער: אין דרך מוכחת להבטיח "לא פספסנו כלום" - זה היוריסטי במפורש (טווח ימים
    -- בלי אף תנועה בין הריצה הקודמת לחדשה). מציג התראה לבדיקה אנושית, לא קובע ודאות.
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
      jsonb_build_object('fetched', v_fetched, 'committed', v_committed, 'duplicates', v_duplicates, 'gap_detected', v_gap_detected)
    );
  exception when others then
    -- בכוונה בלי raise כאן: PostgREST מריץ את כל הקריאה כטרנזקציה אחת - חריגה שיוצאת
    -- מהפונקציה בלי תפיסה הייתה מבטלת (rollback) את כל הטרנזקציה, כולל את ה-INSERT
    -- הראשוני של שורת ה-run וגם את ה-UPDATE הזה עצמו לסטטוס 'failed' - בדיוק ההפך
    -- ממטרת התיעוד. נתפס בביקורת ("תבדוק שאין באגים") - בלי התיקון, כישלון בתוך
    -- הפונקציה (לא בשלב fetchTransactionsFromBank שב-api/bank-sync.js) לא היה משאיר
    -- שום עקבות במסך/במרכז החריגות.
    update bank_auto_sync_runs
    set finished_at = now(), status = 'failed', error_message = sqlerrm, transactions_fetched = v_fetched
    where id = v_run_id;
  end;

  return v_run_id;
end;
$$;

-- anon בכוונה - הקריאה מגיעה מפונקציית Vercel (ללא session), ההגנה היא ה-secret בפנים.
grant execute on function ingest_bank_transactions_batch(text, uuid, jsonb) to anon, authenticated;

-- כשהמשיכה בפועל מהבנק נכשלת עוד לפני שיש תנועות להעביר ל-ingest_bank_transactions_batch
-- (כרגע המצב הקבוע - fetchTransactionsFromBank() ב-api/bank-sync.js הוא placeholder עד
-- שיתקבלו פרטי חיבור מהבנק) - עדיין רוצים שהכישלון יופיע בהיסטוריית ההרצות ובמרכז
-- החריגות, לא ייעלם בשקט. בלי הפונקציה הזו, כשלון לפני קריאת ingest לא משאיר שום
-- רישום ב-bank_auto_sync_runs בכלל.
create or replace function log_failed_bank_sync_run(p_secret text, p_setting_id uuid, p_error_message text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stored_secret text;
  v_run_id uuid;
begin
  select secret into v_stored_secret from bank_sync_config where id = true;
  if v_stored_secret is null or p_secret is distinct from v_stored_secret then
    raise exception 'invalid sync secret';
  end if;

  insert into bank_auto_sync_runs (setting_id, status, finished_at, error_message)
  values (p_setting_id, 'failed', now(), p_error_message)
  returning id into v_run_id;

  return v_run_id;
end;
$$;

grant execute on function log_failed_bank_sync_run(text, uuid, text) to anon, authenticated;

-- סימון ידני "טופל" על הרצה שסומנה gap_detected/failed - כדי שההתראה לא תישאר לצמיתות
-- במרכז החריגות אחרי שמישהו בדק ידנית מול דף חשבון הבנק וראה שהכל תקין.
create or replace function acknowledge_bank_sync_run(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('bank_import', 'perform') then
    raise exception 'permission denied';
  end if;
  update bank_auto_sync_runs set is_resolved = true, resolved_by = auth.uid(), resolved_at = now() where id = p_run_id;
end;
$$;

-- revoke מ-public: EXECUTE ניתן ל-PUBLIC כברירת מחדל בכל פונקציה חדשה - לא מנוצל בפועל
-- כאן (has_permission() מחזירה false בבטחה ל-anon/לא-מאושר), אבל תואם את התיקון שכבר
-- בוצע לאותה בעיה בדיוק ב-generate_due_recurrences() (071) - עקביות הגנתית.
revoke execute on function acknowledge_bank_sync_run(uuid) from public, anon;
grant execute on function acknowledge_bank_sync_run(uuid) to authenticated;

-- הרחבת מרכז החריגות הקיים (048/053) עם ענף נוסף - לא בונה מסך נפרד: הרצה שנכשלה או
-- שזוהה בה פער מוצגת יחד עם כל שאר החריגות הכספיות/תפעוליות, לא כתיבה נפרדת.
create or replace view unified_exceptions
with (security_invoker = true)
as
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
) ue
left join organizations o on o.id = ue.organization_id
where coalesce(o.is_demo, false) = false;

grant select on unified_exceptions to authenticated;
