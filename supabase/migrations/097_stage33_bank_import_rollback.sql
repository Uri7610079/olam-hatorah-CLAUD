-- שלב 33: ביטול יבוא תנועות בנק.
--
-- הפער שנתפס בשטח: קובץ של בנק הפועלים נקלט בטעות לחשבון של פאג"י, כי בורר
-- החשבון במסך הוא זה שקובע ולא תוכן הקובץ. 25 תנועות אמיתיות של בנק אחד יושבות
-- עכשיו על חשבון של בנק אחר - ולא הייתה שום דרך להסיר אותן.
--
-- ליבוא תלמידים כבר קיים ביטול (087), וליבוא תנועות בנק - הטבלה מכירה סטטוס
-- 'rejected' אבל אף פונקציה לא ידעה להגיע אליו. זה החוסר שנסגר כאן.
--
-- העיקרון זהה לביטול יבוא התלמידים: מוחקים רק מה שאיש עוד לא נשען עליו, מדווחים
-- במפורש על מה שנשמר ולמה, ולא מוחקים בשקט משהו שכבר משתתף בהתאמה עסקית.

-- הסיבה שבגללה תנועה אינה ניתנת למחיקה, או null אם היא כן.
create or replace function bank_transaction_rollback_block_reason(p_transaction_id uuid)
returns text
language sql
stable
as $$
  select case
    when exists (select 1 from bank_matches where bank_transaction_id = p_transaction_id)
      then 'התנועה משתתפת בהתאמה בנקאית'
    else null
  end;
$$;

grant execute on function bank_transaction_rollback_block_reason(uuid) to authenticated;

-- תצוגה מקדימה: מה יימחק ומה יישאר, לפני שנוגעים בכלום.
create or replace function preview_bank_import_rollback(p_batch_id uuid)
returns table (
  transaction_id uuid,
  execution_date date,
  direction text,
  amount numeric,
  description text,
  will_delete boolean,
  block_reason text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    bt.id,
    bt.execution_date,
    bt.direction,
    bt.amount,
    bt.description,
    bank_transaction_rollback_block_reason(bt.id) is null,
    bank_transaction_rollback_block_reason(bt.id)
  from bank_transactions bt
  where bt.batch_id = p_batch_id
    and has_permission('area_finance', 'access')
  order by bt.execution_date, bt.id;
$$;

grant execute on function preview_bank_import_rollback(uuid) to authenticated;

create or replace function rollback_bank_import_batch(p_batch_id uuid)
returns table (deleted_count integer, kept_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
  v_kept integer := 0;
begin
  -- ההרשאה שקיימת בפועל בקטלוג היא bank_import/perform. הראשונה שכתבתי,
  -- bank_transactions/import, אינה קיימת - ו-has_permission על הרשאה שאינה
  -- קיימת מחזירה false, כלומר הפונקציה הייתה דוחה כל קריאה בשקט.
  if not has_permission('bank_import', 'perform') then
    raise exception 'permission denied';
  end if;

  if not exists (select 1 from bank_import_batches where id = p_batch_id) then
    raise exception 'אצווה לא נמצאה';
  end if;

  select count(*) into v_kept
  from bank_transactions bt
  where bt.batch_id = p_batch_id
    and bank_transaction_rollback_block_reason(bt.id) is not null;

  with removable as (
    select bt.id from bank_transactions bt
    where bt.batch_id = p_batch_id
      and bank_transaction_rollback_block_reason(bt.id) is null
  )
  delete from bank_transactions where id in (select id from removable);
  get diagnostics v_deleted = row_count;

  -- שורות האצווה חוזרות ל'valid' והאצווה ל'rejected'. לא מוחקים את האצווה עצמה:
  -- ה-file_hash שלה הוא מה שמונע קליטה כפולה של אותו קובץ, וגם התיעוד של מה
  -- שקרה שווה יותר משורה נקייה.
  update bank_import_rows set status = 'valid' where batch_id = p_batch_id and status = 'committed';
  update bank_import_batches
  set status = 'rejected', rejected_reason = 'בוטל ידנית - ' || v_deleted || ' תנועות נמחקו'
  where id = p_batch_id;

  perform insert_audit_event(
    'rollback_bank_import_batch', 'bank_transactions', p_batch_id::text,
    jsonb_build_object('deleted', v_deleted, 'kept', v_kept)
  );

  deleted_count := v_deleted;
  kept_count := v_kept;
  return next;
end;
$$;

grant execute on function rollback_bank_import_batch(uuid) to authenticated;
