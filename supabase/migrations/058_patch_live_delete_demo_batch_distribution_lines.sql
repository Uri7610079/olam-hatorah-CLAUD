-- Patch לפרויקט החי: delete_demo_batch() (052/057) נכשלה שוב, הפעם ב-DELETE, עם אותה
-- הודעה מוכרת מ-create_demo_batch: "ניתן לערוך שורות חלוקה רק כאשר האצווה בטיוטה (סטטוס
-- נוכחי: locked_for_masav)". enforce_distribution_lines_mutation() (031) חוסמת גם DELETE
-- על distribution_lines כשהאצווה שלהן אינה 'draft', לא רק INSERT/UPDATE. הפונקציה מחזירה
-- את distribution_batches ל-'draft' (עם הדגל הקיים app.allow_distribution_status_change)
-- ממש לפני מחיקת השורות; האצווה עצמה נמחקת מיד אחרי, כך שאין מצב ביניים שנשאר בסטטוס
-- שגוי. 052 עודכן בדיסק; זהו ה-patch לפרויקט הקיים - re-create מלא של הפונקציה.
create or replace function delete_demo_batch(p_batch_id uuid)
returns table (table_name text, row_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if not has_permission('demo_data', 'manage') then
    raise exception 'permission denied';
  end if;
  if not exists (select 1 from demo_batches where id = p_batch_id) then
    raise exception 'אצוות דמו לא נמצאה';
  end if;

  perform set_config('app.allow_demo_ledger_delete', 'true', true);
  delete from group_ledger_entries where demo_batch_id = p_batch_id;
  get diagnostics v_deleted = row_count; table_name := 'group_ledger_entries'; row_count := v_deleted; return next;

  delete from bank_matches where demo_batch_id = p_batch_id;
  get diagnostics v_deleted = row_count; table_name := 'bank_matches'; row_count := v_deleted; return next;

  delete from payment_returns where demo_batch_id = p_batch_id;
  get diagnostics v_deleted = row_count; table_name := 'payment_returns'; row_count := v_deleted; return next;

  delete from bank_transactions where demo_batch_id = p_batch_id;
  get diagnostics v_deleted = row_count; table_name := 'bank_transactions'; row_count := v_deleted; return next;

  delete from masav_lines where demo_batch_id = p_batch_id;
  get diagnostics v_deleted = row_count; table_name := 'masav_lines'; row_count := v_deleted; return next;

  delete from masav_batches where demo_batch_id = p_batch_id;
  get diagnostics v_deleted = row_count; table_name := 'masav_batches'; row_count := v_deleted; return next;

  perform set_config('app.allow_distribution_status_change', 'true', true);
  update distribution_batches set status = 'draft' where demo_batch_id = p_batch_id;

  delete from distribution_lines where demo_batch_id = p_batch_id;
  get diagnostics v_deleted = row_count; table_name := 'distribution_lines'; row_count := v_deleted; return next;

  delete from distribution_batches where demo_batch_id = p_batch_id;
  get diagnostics v_deleted = row_count; table_name := 'distribution_batches'; row_count := v_deleted; return next;

  delete from donations where demo_batch_id = p_batch_id;
  get diagnostics v_deleted = row_count; table_name := 'donations'; row_count := v_deleted; return next;

  delete from eligibility_financial_results where demo_batch_id = p_batch_id;
  get diagnostics v_deleted = row_count; table_name := 'eligibility_financial_results'; row_count := v_deleted; return next;

  delete from monthly_eligibility where demo_batch_id = p_batch_id;
  get diagnostics v_deleted = row_count; table_name := 'monthly_eligibility'; row_count := v_deleted; return next;

  delete from financial_periods where demo_batch_id = p_batch_id;
  get diagnostics v_deleted = row_count; table_name := 'financial_periods'; row_count := v_deleted; return next;

  delete from student_bank_accounts where demo_batch_id = p_batch_id;
  get diagnostics v_deleted = row_count; table_name := 'student_bank_accounts'; row_count := v_deleted; return next;

  delete from student_assignments where demo_batch_id = p_batch_id;
  get diagnostics v_deleted = row_count; table_name := 'student_assignments'; row_count := v_deleted; return next;

  delete from students where demo_batch_id = p_batch_id;
  get diagnostics v_deleted = row_count; table_name := 'students'; row_count := v_deleted; return next;

  delete from groups where demo_batch_id = p_batch_id;
  get diagnostics v_deleted = row_count; table_name := 'groups'; row_count := v_deleted; return next;

  delete from branches where demo_batch_id = p_batch_id;
  get diagnostics v_deleted = row_count; table_name := 'branches'; row_count := v_deleted; return next;

  delete from organization_bank_accounts where demo_batch_id = p_batch_id;
  get diagnostics v_deleted = row_count; table_name := 'organization_bank_accounts'; row_count := v_deleted; return next;

  delete from organizations where demo_batch_id = p_batch_id;
  get diagnostics v_deleted = row_count; table_name := 'organizations'; row_count := v_deleted; return next;

  delete from demo_batches where id = p_batch_id;

  perform insert_audit_event('delete_demo_batch', 'demo_batches', p_batch_id::text, jsonb_build_object('deleted_at', now()));
end;
$$;
