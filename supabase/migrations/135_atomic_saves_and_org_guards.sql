-- 135: ממצאי ביקורת עומק (20.11.2026) - שמירות אטומיות ובדיקות "אותה עמותה" בשרת.
--
-- 1. replace_distribution_lines: שמירת שורות חלוקה. עד היום המסך מחק את כל השורות
--    ורק אחר כך הוסיף את החדשות - שתי קריאות נפרדות. כשל בהוספה השאיר אצווה בלי
--    שורות. כאן שתיהן בפונקציה אחת = טרנזקציה אחת: או הכול או כלום.
--    security invoker: רץ בהרשאות המשתמש, כך שמדיניות ה-RLS והטריגר שמגבילים עריכה
--    לאצווה בטיוטה (031) חלים בדיוק כמו קודם.
--
-- 2. create_import_batch_with_rows: יצירת אצוות יבוא עם השורות שלה. עד היום נוצרה
--    האצווה ואז נשמרו השורות בקריאה נפרדת. כשל בשורות השאיר אצווה ריקה - ובגלל
--    unique(file_hash) אי אפשר היה לנסות שוב את אותו קובץ, ותיבת הקבצים סימנה אותו
--    "כבר נקלט". כאן הכול בטרנזקציה אחת. גם כן security invoker (RLS כמו קודם).
--
-- 3. create_bank_match: היעד (אצוות מס"ב / תרומה / החזרה / תנועה בחשבון אחר) חייב
--    להיות של אותה עמותה כמו תנועת הבנק. עד היום לא נבדק, ובמסך שבו העמותה והחשבון
--    נשמרים בנפרד אפשר היה להציע התאמה בין עמותות.
--
-- 4. create_masav_batch: חשבון הבנק המשלם חייב להיות של העמותה. עד היום לא נבדק -
--    ו"החשבון האחרון שנבחר" במסך יכול היה להיות של עמותה אחרת.
--
-- שום נתון קיים לא משתנה. סעיפים 3-4: אותה פונקציה בדיוק, עם בדיקה נוספת אחת בתחילתה.

-- ===== 1 =====
create or replace function replace_distribution_lines(p_batch_id uuid, p_lines jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from distribution_lines where batch_id = p_batch_id;
  insert into distribution_lines (batch_id, student_id, amount)
  select p_batch_id, (l->>'student_id')::uuid, (l->>'amount')::numeric
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function replace_distribution_lines(uuid, jsonb) to authenticated;

-- ===== 2 =====
create or replace function create_import_batch_with_rows(p_batch jsonb, p_rows jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into import_batches (
    profile_id, organization_id, period_month, file_path, file_name, file_hash,
    row_count, valid_count, needs_decision_count, invalid_count, status
  ) values (
    (p_batch->>'profile_id')::uuid,
    nullif(p_batch->>'organization_id', '')::uuid,
    nullif(p_batch->>'period_month', '')::date,
    p_batch->>'file_path',
    p_batch->>'file_name',
    p_batch->>'file_hash',
    coalesce((p_batch->>'row_count')::integer, 0),
    coalesce((p_batch->>'valid_count')::integer, 0),
    coalesce((p_batch->>'needs_decision_count')::integer, 0),
    coalesce((p_batch->>'invalid_count')::integer, 0),
    'previewed'
  )
  returning id into v_id;

  insert into import_rows (batch_id, row_number, raw, status, error_message)
  select v_id, (r->>'row_number')::integer, r->'raw', r->>'status', r->>'error_message'
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r;

  return v_id;
end;
$$;

grant execute on function create_import_batch_with_rows(jsonb, jsonb) to authenticated;

-- ===== 3 =====
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
  v_tx_org uuid;
  v_target_org uuid;
begin
  if not has_permission('bank_matching', 'perform') then
    raise exception 'permission denied';
  end if;

  select bt.amount, oba.organization_id into v_transaction_amount, v_tx_org
  from bank_transactions bt
  left join organization_bank_accounts oba on oba.id = bt.organization_bank_account_id
  where bt.id = p_bank_transaction_id;
  if v_transaction_amount is null then
    raise exception 'תנועת בנק לא נמצאה';
  end if;
  if p_matched_amount > v_transaction_amount then
    raise exception 'סכום ההתאמה (%) גדול מסכום התנועה עצמה (%)', p_matched_amount, v_transaction_amount;
  end if;

  -- 135: היעד חייב להיות של אותה עמותה כמו התנועה
  if p_target_id is not null then
    if p_target_table = 'masav_batches' then
      select organization_id into v_target_org from masav_batches where id = p_target_id;
    elsif p_target_table = 'donations' then
      select organization_id into v_target_org from donations where id = p_target_id;
    elsif p_target_table = 'payment_returns' then
      select mb.organization_id into v_target_org
      from payment_returns pr
      join masav_lines ml on ml.id = pr.masav_line_id
      join masav_batches mb on mb.id = ml.batch_id
      where pr.id = p_target_id;
    elsif p_target_table = 'bank_transactions' then
      select oba.organization_id into v_target_org
      from bank_transactions bt
      join organization_bank_accounts oba on oba.id = bt.organization_bank_account_id
      where bt.id = p_target_id;
    end if;
    if v_target_org is not null and v_tx_org is not null and v_target_org <> v_tx_org then
      raise exception 'לא ניתן להתאים: היעד שייך לעמותה אחרת מתנועת הבנק';
    end if;
  end if;

  insert into bank_matches (bank_transaction_id, match_type, target_table, target_id, matched_amount, notes, created_by)
  values (p_bank_transaction_id, p_match_type, p_target_table, p_target_id, p_matched_amount, p_notes, auth.uid())
  returning id into v_id;

  perform insert_audit_event('create_bank_match', 'bank_matches', v_id::text, jsonb_build_object('bank_transaction_id', p_bank_transaction_id, 'match_type', p_match_type));

  return v_id;
end;
$$;

grant execute on function create_bank_match(uuid, text, text, uuid, numeric, text) to authenticated;

-- ===== 4 =====
create or replace function create_masav_batch(p_organization_id uuid, p_organization_bank_account_id uuid, p_period_month date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_count integer;
begin
  if not has_permission('masav', 'manage') then
    raise exception 'permission denied';
  end if;

  -- 135: החשבון המשלם חייב להיות של העמותה
  if not exists (
    select 1 from organization_bank_accounts
    where id = p_organization_bank_account_id and organization_id = p_organization_id
  ) then
    raise exception 'חשבון הבנק שנבחר אינו שייך לעמותה הזו';
  end if;

  insert into masav_batches (organization_id, organization_bank_account_id, period_month, prepared_at, prepared_by, created_by)
  values (p_organization_id, p_organization_bank_account_id, p_period_month, now(), auth.uid(), auth.uid())
  returning id into v_batch_id;

  insert into masav_lines (batch_id, student_id, group_id, student_bank_account_id, amount, source_distribution_batch_id)
  select
    v_batch_id,
    dl.student_id,
    db.group_id,
    (select sba.id from student_bank_accounts sba
     where sba.student_id = dl.student_id and sba.is_active = true and sba.verification_status = 'verified'
     limit 1),
    dl.amount,
    db.id
  from distribution_batches db
  join distribution_lines dl on dl.batch_id = db.id
  where db.organization_id = p_organization_id
    and db.period_month = p_period_month
    and db.status = 'locked_for_masav'
    and not exists (
      select 1 from masav_lines ml
      join masav_batches mb on mb.id = ml.batch_id
      where ml.source_distribution_batch_id = db.id and mb.status <> 'cancelled'
    );

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'אין הוראות חלוקה נעולות וזמינות להכנת מס"ב עבור עמותה/חודש אלה';
  end if;

  update masav_batches
  set total_amount = (select coalesce(sum(amount), 0) from masav_lines where batch_id = v_batch_id),
      payment_count = (select count(*) from masav_lines where batch_id = v_batch_id)
  where id = v_batch_id;

  perform insert_audit_event('create_masav_batch', 'masav_batches', v_batch_id::text, jsonb_build_object('organization_id', p_organization_id, 'month', p_period_month));

  return v_batch_id;
end;
$$;

grant execute on function create_masav_batch(uuid, uuid, date) to authenticated;
