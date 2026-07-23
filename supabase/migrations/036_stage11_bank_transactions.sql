-- שלב 11 (חלק ב'): יבוא תנועות בנק וכללי זיהוי. תשתית יבוא ייעודית לבנק (לא reuse של
-- import_batches/import_rows הגנרית משלב 5) - יש כאן צרכים ספציפיים (חשבון עמותה,
-- fingerprint דדופ, טבלת יעד קבועה) ששונים מספיק מהמנוע הגנרי. bank_import_profiles/
-- bank_transaction_types כבר קיימים מ-035.
--
-- קריטי: "סיווג אינו משנה יתרת קבוצה ללא התאמה עסקית מאושרת" (אפיון) - שום דבר כאן לא
-- נוגע ב-group_ledger_entries. הקישור לכסף בפועל (מס"ב, תרומה וכו') הוא שלב 12
-- (bank_matches), לא כאן. שלב הזה הוא זיהוי/סיווג בלבד.

-- recognition_rules לפני bank_transactions כי bank_transactions.suggested_rule_id מצביע אליה.
create table recognition_rules (
  id uuid primary key default gen_random_uuid(),
  -- כל שדה scope/קריטריון הוא null = "לא מגביל את הממד הזה" - אותו עיקרון בדיוק כמו
  -- commission_rules (שלב 8). קריטריונים מרובים הם AND (כולם שהוגדרו חייבים להתאים).
  organization_bank_account_id uuid references organization_bank_accounts(id),
  direction text check (direction in ('debit', 'credit')),
  text_match_type text check (text_match_type in ('contains', 'starts_with')),
  text_match_value text,
  counterparty_name text,
  amount_min numeric(12, 2),
  amount_max numeric(12, 2),
  reference_match text,
  effective_from date,
  effective_until date,
  suggested_type_id uuid not null references bank_transaction_types(id),
  confidence_level text not null check (confidence_level in ('high', 'medium', 'low')),
  -- עדיפות שוברת שוויון בין כמה כללים תואמים - אותו עיקרון כמו commission_rules, לא
  -- היררכיה מקובעת מראש (למשל "חשבון ספציפי תמיד מנצח") שלא אושרה.
  priority integer not null default 0,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references auth.users(id),
  -- שני השדות תמיד ביחד או תמיד ריקים ביחד - סוג התאמה בלי ערך (או להפך) הוא כלל חסר-משמעות.
  check ((text_match_type is null) = (text_match_value is null)),
  check (effective_until is null or effective_from is null or effective_until >= effective_from)
);

create trigger recognition_rules_set_updated_at
  before update on recognition_rules
  for each row execute function set_updated_at();

create index recognition_rules_account_idx on recognition_rules (organization_bank_account_id);

alter table recognition_rules enable row level security;

create policy recognition_rules_select on recognition_rules for select to authenticated
  using (has_permission('area_finance', 'access') or has_permission('area_ops', 'access'));

create policy recognition_rules_insert on recognition_rules for insert to authenticated
  with check (has_permission('transaction_classification', 'perform'));

create policy recognition_rules_update on recognition_rules for update to authenticated
  using (has_permission('transaction_classification', 'perform'))
  with check (has_permission('transaction_classification', 'perform'));

create trigger recognition_rules_audit
  after insert or update on recognition_rules
  for each row execute function audit_table_change();

-- match_recognition_rule(): מקום יחיד לבחירת הכלל התואם - נקראת רק מ-suggest_transaction_types
-- כדי שלא ייווצר פער לוגיקה בין הצעה לבין כל שימוש עתידי אחר בכללים (אותו עיקרון כמו
-- match_commission_rule בשלב 8). security invoker, ללא הרשאות מוגברות משלה.
create or replace function match_recognition_rule(
  p_organization_bank_account_id uuid,
  p_direction text,
  p_amount numeric,
  p_description text,
  p_reference text,
  p_date date
)
returns recognition_rules
language sql
stable
as $$
  select *
  from recognition_rules
  where is_active = true
    and (organization_bank_account_id is null or organization_bank_account_id = p_organization_bank_account_id)
    and (direction is null or direction = p_direction)
    and (effective_from is null or effective_from <= p_date)
    and (effective_until is null or effective_until >= p_date)
    and (amount_min is null or p_amount >= amount_min)
    and (amount_max is null or p_amount <= amount_max)
    and (reference_match is null or p_reference ilike '%' || reference_match || '%')
    and (
      text_match_value is null
      or (text_match_type = 'starts_with' and p_description ilike text_match_value || '%')
      or (text_match_type = 'contains' and p_description ilike '%' || text_match_value || '%')
    )
    and (counterparty_name is null or p_description ilike '%' || counterparty_name || '%')
  order by priority desc, created_at desc
  limit 1;
$$;

revoke execute on function match_recognition_rule(uuid, text, numeric, text, text, date) from public, anon, authenticated;

create table bank_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_bank_account_id uuid not null references organization_bank_accounts(id),
  profile_id uuid not null references bank_import_profiles(id),
  file_path text not null,
  file_name text not null,
  file_hash text not null,
  statement_period_start date,
  statement_period_end date,
  row_count integer not null default 0,
  valid_count integer not null default 0,
  duplicate_count integer not null default 0,
  invalid_count integer not null default 0,
  status text not null default 'uploaded' check (status in ('uploaded', 'analyzed', 'previewed', 'committed', 'rejected')),
  uploaded_by uuid references auth.users(id),
  rejected_reason text,
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  committed_at timestamptz,
  unique (file_hash)
);

create trigger bank_import_batches_set_updated_at
  before update on bank_import_batches
  for each row execute function set_updated_at();

create index bank_import_batches_account_idx on bank_import_batches (organization_bank_account_id);

-- fingerprint מחושב פעם אחת בצד לקוח בזמן ניתוח הקובץ (מזהה בנק אם קיים, אחרת hash של
-- תאריך ביצוע/ערך/צד/סכום/אסמכתה/תיאור) ונשמר כנתון פשוט - כך שאין סיכון לפער לוגיקה
-- בין חישוב הצעת-הכפילות בצד לקוח לבין הבדיקה בפועל בשרת (השרת רק בודק אם ה-fingerprint
-- כבר קיים ב-bank_transactions, לא מחשב אותו מחדש).
create table bank_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references bank_import_batches(id) on delete cascade,
  row_number integer not null,
  raw jsonb not null,
  normalized jsonb,
  fingerprint text,
  status text not null default 'valid' check (status in ('valid', 'duplicate', 'invalid', 'committed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger bank_import_rows_set_updated_at
  before update on bank_import_rows
  for each row execute function set_updated_at();

create index bank_import_rows_batch_idx on bank_import_rows (batch_id);

create table bank_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_bank_account_id uuid not null references organization_bank_accounts(id),
  batch_id uuid references bank_import_batches(id),
  execution_date date not null,
  value_date date,
  direction text not null check (direction in ('debit', 'credit')),
  amount numeric(12, 2) not null check (amount > 0),
  description text,
  reference text,
  operation_type text,
  bank_balance_after numeric(12, 2),
  bank_transaction_id text,
  raw jsonb not null,
  normalized jsonb,
  fingerprint text not null,
  suggested_type_id uuid references bank_transaction_types(id),
  suggested_confidence text check (suggested_confidence in ('high', 'medium', 'low')),
  suggested_reason text,
  suggested_rule_id uuid references recognition_rules(id),
  confirmed_type_id uuid references bank_transaction_types(id),
  classification_status text not null default 'unclassified' check (classification_status in ('unclassified', 'suggested', 'confirmed')),
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  -- מניעת כפילות: אותו fingerprint לאותו חשבון לא ייובא פעמיים - הגנת-עומק בשכבת ה-DB
  -- בנוסף לבדיקה בזמן ניתוח/commit.
  unique (organization_bank_account_id, fingerprint)
);

create trigger bank_transactions_set_updated_at
  before update on bank_transactions
  for each row execute function set_updated_at();

create index bank_transactions_account_idx on bank_transactions (organization_bank_account_id, execution_date);
create index bank_transactions_classification_idx on bank_transactions (organization_bank_account_id, classification_status);

alter table bank_import_batches enable row level security;
alter table bank_import_rows enable row level security;
alter table bank_transactions enable row level security;

-- bank_import_batches/rows: כתיבה ישירה מהלקוח מותרת (הפרסור קורה בצד לקוח, אותו עיקרון
-- כמו import_batches/import_rows הגנרית משלב 5) - חוץ מהמעבר ל-status='committed', שחסום
-- בטריגר (בודק גם INSERT, לא רק UPDATE - לקח מהביקורת שנעשתה אחרי שלב 10).
create policy bank_import_batches_select on bank_import_batches for select to authenticated
  using (has_permission('area_finance', 'access') or has_permission('area_ops', 'access'));

create policy bank_import_batches_insert on bank_import_batches for insert to authenticated
  with check (has_permission('bank_import', 'perform'));

create policy bank_import_batches_update on bank_import_batches for update to authenticated
  using (has_permission('bank_import', 'perform'))
  with check (has_permission('bank_import', 'perform'));

create policy bank_import_rows_select on bank_import_rows for select to authenticated
  using (has_permission('area_finance', 'access') or has_permission('area_ops', 'access'));

create policy bank_import_rows_insert on bank_import_rows for insert to authenticated
  with check (has_permission('bank_import', 'perform'));

create policy bank_import_rows_update on bank_import_rows for update to authenticated
  using (has_permission('bank_import', 'perform'))
  with check (has_permission('bank_import', 'perform'));

-- bank_transactions: אין שום INSERT/UPDATE policy ללקוח - זו טבלת המקור הכספי הסופית,
-- כל כתיבה רק דרך commit_bank_import_batch()/suggest_transaction_types()/
-- confirm_transaction_type() (SECURITY DEFINER). אותו עיקרון כמו group_ledger_entries/
-- masav_batches - לא policy גנרי + guard trigger.
create policy bank_transactions_select on bank_transactions for select to authenticated
  using (has_permission('area_finance', 'access') or has_permission('area_ops', 'access'));

create trigger bank_import_batches_audit
  after insert or update on bank_import_batches
  for each row execute function audit_table_change();

create trigger bank_import_rows_audit
  after insert or update on bank_import_rows
  for each row execute function audit_table_change();

create trigger bank_transactions_audit
  after insert or update on bank_transactions
  for each row execute function audit_table_change();

-- enforce_bank_import_batch_commit(): בודקת גם INSERT מהכתיבה הראשונה (לא כמו הבאג
-- שנמצא בביקורת אחרי שלב 10 ב-import_batches/students/groups) - אצווה חדשה תמיד
-- נוצרת "הועלה"; מעבר ל-"committed" רק דרך commit_bank_import_batch().
create or replace function enforce_bank_import_batch_commit()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'uploaded' then
      raise exception 'אצוות יבוא בנק חדשה תמיד נוצרת בסטטוס "הועלה"';
    end if;
    return new;
  end if;

  if new.status = 'committed' and old.status is distinct from 'committed'
     and coalesce(current_setting('app.allow_bank_batch_commit', true), '') <> 'true' then
    raise exception 'סגירת אצוות יבוא בנק מותרת רק דרך commit_bank_import_batch()';
  end if;
  return new;
end;
$$;

create trigger bank_import_batches_enforce_commit
  before insert or update on bank_import_batches
  for each row execute function enforce_bank_import_batch_commit();

-- אותו עיקרון בדיוק על bank_import_rows: שורה חדשה לעולם לא נוצרת כבר "נקלטה", ומעבר
-- ל-"נקלטה" מותר רק מתוך commit_bank_import_batch() (אותו דגל app.allow_bank_batch_commit).
create or replace function enforce_bank_import_row_commit()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'committed' then
      raise exception 'שורת יבוא בנק חדשה לא יכולה להיווצר כבר "נקלטה"';
    end if;
    return new;
  end if;

  if new.status = 'committed' and old.status is distinct from 'committed'
     and coalesce(current_setting('app.allow_bank_batch_commit', true), '') <> 'true' then
    raise exception 'סימון שורה כ-"נקלטה" מותר רק דרך commit_bank_import_batch()';
  end if;
  return new;
end;
$$;

create trigger bank_import_rows_enforce_commit
  before insert or update on bank_import_rows
  for each row execute function enforce_bank_import_row_commit();

-- commit_bank_import_batch(): שורות valid בלבד נכתבות בפועל ל-bank_transactions.
-- duplicate/invalid לא חוסמות סגירה - פשוט לא נכתבות (אותו עיקרון כמו commit_import_batch
-- ו-commit_eligibility_batch). בדיקת כפילות אחרונה נעשית כאן שוב מול bank_transactions
-- בפועל (לא רק מול הסטטוס שכבר סומן בזמן הניתוח) - הגנת-עומק מפני מרוץ בין שתי אצוות.
create or replace function commit_bank_import_batch(p_batch_id uuid)
returns table (committed_count integer, duplicate_count integer, invalid_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch bank_import_batches;
  v_committed integer := 0;
  v_duplicates integer := 0;
  v_invalid integer := 0;
begin
  if not has_permission('bank_import', 'perform') then
    raise exception 'permission denied';
  end if;

  select * into v_batch from bank_import_batches where id = p_batch_id;
  if v_batch.id is null then
    raise exception 'אצוות יבוא בנק לא נמצאה';
  end if;
  if v_batch.status not in ('uploaded', 'analyzed', 'previewed') then
    raise exception 'לא ניתן לקלוט אצווה בסטטוס %', v_batch.status;
  end if;

  -- מופעל כאן, לפני עדכון השורות ל-"נקלטה" למטה - הדגל תקף לכל השאר של הטרנזקציה,
  -- ומכסה גם את bank_import_rows וגם את bank_import_batches בהמשך הפונקציה.
  perform set_config('app.allow_bank_batch_commit', 'true', true);

  -- שורות שכבר קיימות בפועל (fingerprint תפוס) מסומנות duplicate בלי לחסום - הגנת-עומק
  -- מעבר לסימון שכבר נעשה בזמן הניתוח.
  update bank_import_rows br
  set status = 'duplicate'
  where br.batch_id = p_batch_id
    and br.status = 'valid'
    and exists (
      select 1 from bank_transactions bt
      where bt.organization_bank_account_id = v_batch.organization_bank_account_id
        and bt.fingerprint = br.fingerprint
    );

  insert into bank_transactions (
    organization_bank_account_id, batch_id, execution_date, value_date, direction, amount,
    description, reference, operation_type, bank_balance_after, bank_transaction_id,
    raw, normalized, fingerprint
  )
  select
    v_batch.organization_bank_account_id, p_batch_id,
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
  where br.batch_id = p_batch_id and br.status = 'valid';

  get diagnostics v_committed = row_count;

  update bank_import_rows set status = 'committed' where batch_id = p_batch_id and status = 'valid';

  select count(*) into v_duplicates from bank_import_rows where batch_id = p_batch_id and status = 'duplicate';
  select count(*) into v_invalid from bank_import_rows where batch_id = p_batch_id and status = 'invalid';

  update bank_import_batches
  set valid_count = v_committed, duplicate_count = v_duplicates, invalid_count = v_invalid
  where id = p_batch_id;

  update bank_import_batches set status = 'committed', committed_at = now() where id = p_batch_id;

  perform insert_audit_event(
    'commit_bank_import_batch', 'bank_import_batches', p_batch_id::text,
    jsonb_build_object('committed', v_committed, 'duplicates', v_duplicates, 'invalid', v_invalid)
  );

  return query select v_committed, v_duplicates, v_invalid;
end;
$$;

grant execute on function commit_bank_import_batch(uuid) to authenticated;

-- suggest_transaction_types(): set-based (לא לולאה - נמנע מהבאג שתוקן כבר כמה פעמים
-- השנה כשמשתנה נשאר "תקוע" מאיטרציה קודמת) - מציעה סיווג לכל תנועה unclassified שיש
-- לה כלל תואם. תמיד רק מציעה (classification_status='suggested'), לעולם לא מאשרת לבד -
-- automation_policies.is_enabled לא נקראת כאן בכלל: "התאמה אוטומטית כבויה כברירת מחדל"
-- היא התנהגות קבועה של הפונקציה הזו בשלב הזה, לא תלוית-קונפיג. הפעלה אוטומטית בפועל
-- (אם תאושר אי-פעם) היא הרחבה עתידית מפורשת, לא משהו שנכנס "בשקט" עכשיו.
create or replace function suggest_transaction_types(p_organization_bank_account_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not has_permission('transaction_classification', 'perform') then
    raise exception 'permission denied';
  end if;

  update bank_transactions bt
  set suggested_type_id = r.suggested_type_id,
      suggested_confidence = r.confidence_level,
      suggested_reason = 'התאמה לכלל זיהוי (עדיפות ' || r.priority || ')',
      suggested_rule_id = r.id,
      classification_status = 'suggested'
  from lateral match_recognition_rule(bt.organization_bank_account_id, bt.direction, bt.amount, bt.description, bt.reference, bt.execution_date) r
  where bt.organization_bank_account_id = p_organization_bank_account_id
    and bt.classification_status = 'unclassified'
    and r.id is not null;

  get diagnostics v_count = row_count;

  perform insert_audit_event(
    'suggest_transaction_types', 'bank_transactions', p_organization_bank_account_id::text,
    jsonb_build_object('suggested_count', v_count)
  );

  return v_count;
end;
$$;

grant execute on function suggest_transaction_types(uuid) to authenticated;

-- confirm_transaction_type(): הדרך היחידה לקבוע confirmed_type_id - בין אם מאשרים הצעה
-- כמות שהיא ובין אם בוחרים סוג אחר ידנית. לא נוגעת בשום יתרת קבוצה (ר' הערת הפתיחה).
create or replace function confirm_transaction_type(p_transaction_id uuid, p_type_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('transaction_classification', 'perform') then
    raise exception 'permission denied';
  end if;

  update bank_transactions
  set confirmed_type_id = p_type_id, classification_status = 'confirmed'
  where id = p_transaction_id;

  perform insert_audit_event('confirm_transaction_type', 'bank_transactions', p_transaction_id::text, jsonb_build_object('type_id', p_type_id));
end;
$$;

grant execute on function confirm_transaction_type(uuid, uuid) to authenticated;

insert into storage.buckets (id, name, public)
values ('bank-import-files', 'bank-import-files', false)
on conflict (id) do nothing;

create policy bank_import_files_select on storage.objects for select to authenticated
  using (bucket_id = 'bank-import-files' and has_permission('bank_import', 'perform'));

create policy bank_import_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'bank-import-files' and has_permission('bank_import', 'perform'));
