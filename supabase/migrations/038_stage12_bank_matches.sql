-- שלב 12 (חלק א'): התאמות בנק. bank_matches מקשר תנועת בנק (או חלק ממנה) ליעד עסקי -
-- (target_table, target_id) גנרי, לא עמודת FK נפרדת לכל סוג יעד, כדי לתמוך בכל סוגי
-- היעד (אצוות מס"ב, תרומות, החזרות, הצד השני של העברה בין חשבונות) בלי טבלה דלילה.
-- "עמלה"/"הוצאה אחרת"/"הכנסה אחרת" הם סוגי התאמה בלי יעד ספציפי (target_table/id ריקים) -
-- הם רק מסמנים שהתנועה טופלה/הותאמה, הסיווג עצמו כבר קיים משלב 11.
--
-- הערת התאמה מכוונת (לא סטייה מהאפיון): "אצוות מס"ב" (יעד ה-matching) הוא ברמת
-- masav_batches, לא masav_lines - תנועת הבנק בפועל (חיוב אחד) משדרת החוצה את כל
-- האצווה בבת אחת, לא שורה-שורה. "הצעות מס״ב לפי עמותה, חשבון, סכום, תאריך ואסמכתה"
-- באפיון מתאימה בדיוק לרמת הבאצ' (חשבון+סכום כולל+תאריך שידור), לא לתשלום בודד.

create table bank_matches (
  id uuid primary key default gen_random_uuid(),
  bank_transaction_id uuid not null references bank_transactions(id),
  match_type text not null check (match_type in (
    'masav_batch', 'donation', 'commission', 'return', 'inter_account_transfer', 'other_expense', 'other_income'
  )),
  -- target_table: 'masav_batches' | 'donations' | 'payment_returns' | 'bank_transactions'
  -- (לצד השני של העברה בין חשבונות) | null (commission/other_expense/other_income - אין יעד ספציפי).
  target_table text,
  target_id uuid,
  matched_amount numeric(12, 2) not null check (matched_amount > 0),
  status text not null default 'suggested' check (status in ('suggested', 'approved', 'rejected')),
  suggested_reason text,
  notes text,
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  rejected_reason text,
  check ((target_table is null) = (target_id is null)),
  check (
    (match_type = 'masav_batch' and target_table = 'masav_batches')
    or (match_type = 'donation' and target_table = 'donations')
    or (match_type = 'return' and target_table = 'payment_returns')
    or (match_type = 'inter_account_transfer' and target_table = 'bank_transactions')
    or (match_type in ('commission', 'other_expense', 'other_income') and target_table is null)
  ),
  -- מניעת הצעה/אישור כפול מיותר של אותה תנועה לאותו יעד בדיוק - לא חוסם many-to-one/
  -- one-to-many אמיתיים (יעדים/תנועות שונים), רק כפילות מדויקת מקרית.
  unique (bank_transaction_id, target_table, target_id)
);

create trigger bank_matches_set_updated_at
  before update on bank_matches
  for each row execute function set_updated_at();

create index bank_matches_transaction_idx on bank_matches (bank_transaction_id);
create index bank_matches_target_idx on bank_matches (target_table, target_id);

alter table bank_matches enable row level security;

create policy bank_matches_select on bank_matches for select to authenticated
  using (has_permission('area_finance', 'access') or has_permission('area_ops', 'access'));

-- אין INSERT/UPDATE policy ללקוח בכלל - כל כתיבה דרך ה-RPCs הייעודיים למטה (ר' הערה
-- דומה ב-masav_batches/bank_transactions - זו עוד נקודת התאמה כספית, לא רק סיווג).

create trigger bank_matches_audit
  after insert or update on bank_matches
  for each row execute function audit_table_change();

-- suggest_masav_matches(): מציעה התאמה בין תנועות חובה (כסף יצא) לאצוות מס"ב ששודרו
-- ועדיין לא הותאמו במלואן, לפי חשבון+סכום קרוב+תאריך סמוך. set-based, לא לולאה.
-- לא יוצרת הצעה אם כבר קיימת הצעה/אישור לאותו זוג בדיוק (ה-unique constraint למעלה
-- מגן על זה גם ברמת ה-DB).
create or replace function suggest_masav_matches(p_organization_bank_account_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not has_permission('bank_matching', 'perform') then
    raise exception 'permission denied';
  end if;

  insert into bank_matches (bank_transaction_id, match_type, target_table, target_id, matched_amount, suggested_reason, created_by)
  select
    bt.id, 'masav_batch', 'masav_batches', mb.id,
    least(bt.amount, mb.total_amount),
    'התאמה אוטומטית: אותו חשבון, סכום תואם, תאריך סמוך לשידור',
    auth.uid()
  from bank_transactions bt
  join organization_bank_accounts oba on oba.id = bt.organization_bank_account_id
  join masav_batches mb on mb.organization_bank_account_id = bt.organization_bank_account_id
  where bt.organization_bank_account_id = p_organization_bank_account_id
    and bt.direction = 'debit'
    and mb.status in ('transmitted', 'bank_completed')
    and abs(bt.amount - mb.total_amount) < 0.01
    and mb.transmitted_at is not null
    and abs(bt.execution_date - mb.transmitted_at::date) <= 5
    and not exists (
      select 1 from bank_matches bm where bm.bank_transaction_id = bt.id and bm.status in ('suggested', 'approved')
    )
    and not exists (
      select 1 from bank_matches bm2
      where bm2.target_table = 'masav_batches' and bm2.target_id = mb.id and bm2.status = 'approved'
    );

  get diagnostics v_count = row_count;

  perform insert_audit_event('suggest_masav_matches', 'bank_matches', p_organization_bank_account_id::text, jsonb_build_object('suggested_count', v_count));

  return v_count;
end;
$$;

grant execute on function suggest_masav_matches(uuid) to authenticated;

-- create_bank_match(): יצירה ידנית של התאמה (לכל סוג יעד) - הבסיס ל-MatchSplitView
-- (one-to-one/one-to-many/many-to-one/פיצול). לא בודקת כאן "יתרה לא מותאמת" באופן קשיח
-- (המשתמש רואה זאת ב-UI ובוחר בעצמו) - האימות המחייב האמיתי הוא ב-approve_bank_match().
create or replace function create_bank_match(
  p_bank_transaction_id uuid,
  p_match_type text,
  p_target_table text,
  p_target_id uuid,
  p_matched_amount numeric,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_transaction_amount numeric;
begin
  if not has_permission('bank_matching', 'perform') then
    raise exception 'permission denied';
  end if;

  select amount into v_transaction_amount from bank_transactions where id = p_bank_transaction_id;
  if v_transaction_amount is null then
    raise exception 'תנועת בנק לא נמצאה';
  end if;
  if p_matched_amount > v_transaction_amount then
    raise exception 'סכום ההתאמה (%) גדול מסכום התנועה עצמה (%)', p_matched_amount, v_transaction_amount;
  end if;

  insert into bank_matches (bank_transaction_id, match_type, target_table, target_id, matched_amount, notes, created_by)
  values (p_bank_transaction_id, p_match_type, p_target_table, p_target_id, p_matched_amount, p_notes, auth.uid())
  returning id into v_id;

  perform insert_audit_event('create_bank_match', 'bank_matches', v_id::text, jsonb_build_object('bank_transaction_id', p_bank_transaction_id, 'match_type', p_match_type));

  return v_id;
end;
$$;

grant execute on function create_bank_match(uuid, text, text, uuid, numeric, text) to authenticated;

-- approve_bank_match(): הדרך היחידה לאשר. בודקת "מניעת התאמה כפולה" בפועל - סכום כל
-- ההתאמות המאושרות ליעד (כולל זו) לא יעלה על סכום היעד עצמו (masav_batches.total_amount/
-- donations.amount). כשמדובר במס"ב וההתאמה המאושרת מכסה את מלוא סכום האצווה - מעדכנת
-- את האצווה ל-"בוצע בבנק" (זו הדרך ה"אמיתית", מבוססת-ראיה; mark_masav_bank_completed
-- הידני משלב 10 עדיין קיים כחלופה ידנית כשאין עדיין נתוני בנק).
create or replace function approve_bank_match(p_match_id uuid)
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
  if not has_permission('bank_matching', 'perform') then
    raise exception 'permission denied';
  end if;

  select * into v_match from bank_matches where id = p_match_id;
  if v_match.id is null then
    raise exception 'התאמה לא נמצאה';
  end if;
  if v_match.status <> 'suggested' then
    raise exception 'ניתן לאשר רק התאמה בסטטוס הצעה (סטטוס נוכחי: %)', v_match.status;
  end if;

  -- מניעת הכפלת כסף: סכום ההתאמות המאושרות על אותה תנועת בנק (מול כל היעדים ביחד,
  -- לא רק מול היעד הנוכחי) לא יעלה על סכום התנועה עצמה - בלי הבדיקה הזו, אותה תנועה
  -- הייתה יכולה "לכסות" גם אצוות מס"ב וגם תרומה בו-זמנית ולהכפיל את הסכום בפועל.
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

grant execute on function approve_bank_match(uuid) to authenticated;

create or replace function reject_bank_match(p_match_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not has_permission('bank_matching', 'perform') then
    raise exception 'permission denied';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'נדרשת סיבה לדחיית התאמה';
  end if;

  select status into v_status from bank_matches where id = p_match_id;
  if v_status is null then
    raise exception 'התאמה לא נמצאה';
  end if;
  if v_status <> 'suggested' then
    raise exception 'ניתן לדחות רק התאמה בסטטוס הצעה (סטטוס נוכחי: %)', v_status;
  end if;

  update bank_matches set status = 'rejected', rejected_reason = p_reason where id = p_match_id;

  perform insert_audit_event('reject_bank_match', 'bank_matches', p_match_id::text, jsonb_build_object('reason', p_reason));
end;
$$;

grant execute on function reject_bank_match(uuid, text) to authenticated;
