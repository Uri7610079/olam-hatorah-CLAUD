-- Patch לפרויקט החי (052 כבר רץ בפועל): Chani נתקלה בפועל במסך "ניהול נתוני דמו" בשגיאה
-- "update or delete on table organizations violates foreign key constraint
-- financial_periods_organization_id_fkey" בזמן מחיקת אצוות דמו.
--
-- הסיבה השורשית: delete_demo_batch() (052) מוחקת מכל טבלה רק שורות עם demo_batch_id
-- תואם בדיוק. זה עבד כל עוד הנתונים היחידים שנוגעים בעמותת הדמו נוצרו ע"י create_demo_batch()
-- עצמה. אבל לאורך כל הפרויקט (בדיקות חיות, שלב 16, סקירות UX וכו') עמותת הדמו שימשה
-- גם לבדיקת מסכים אמיתיים (פתיחת חודש, יבוא בנק, יצירת התאמות ועוד) - וזרימות אלה
-- הן RPCs/הכנסות רגילות שלא יודעות בכלל שהעמותה היא "דמו" ולא מסמנות demo_batch_id
-- על השורות שהן יוצרות. התוצאה: שורות "יתומות" מבחינת התיוג (שייכות בפועל לעמותת
-- הדמו, אבל demo_batch_id שלהן ריק/לא תואם) ששורדות את המחיקה הממוקדת ותוקעות אותה
-- ב-foreign key ברגע שמגיעים למחיקת organizations עצמה.
--
-- התיקון: כל תנאי DELETE מורחב מ"demo_batch_id = p_batch_id בלבד" ל-"demo_batch_id
-- תואם, **או** שהשורה שייכת בפועל (לפי ה-FK האמיתי שלה) לעמותה/תלמיד ששייכים לאצווה" -
-- כך שגם שורות שנוצרו דרך זרימה אמיתית (לא רק ע"י create_demo_batch) נתפסות ונמחקות.
-- הרחבה זהה לכל 14 הטבלאות שנבדקו כאן, לא רק ל-financial_periods שבו זה נתפס בפועל -
-- אותה בעיה שורשית הייתה חוזרת על הטבלה הבאה בתור בהרצה הבאה אחרת.
--
-- preview_demo_batch_deletion() (052) עודכנה באותו האופן בהמשך הקובץ - היא ספרה עד כה
-- לפי demo_batch_id בלבד (לולאת SQL דינמי גנרית), כך שהתצוגה המקדימה הייתה מציגה פחות
-- שורות משבאמת יימחקו - חוסר סנכרון בין שתי הפונקציות בדיוק כמו שההערה המקורית (052)
-- התכוונה למנוע.
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
  delete from group_ledger_entries
  where demo_batch_id = p_batch_id
     or organization_id in (select id from organizations where demo_batch_id = p_batch_id);
  get diagnostics v_deleted = row_count; table_name := 'group_ledger_entries'; row_count := v_deleted; return next;

  delete from bank_matches
  where demo_batch_id = p_batch_id
     or bank_transaction_id in (
          select id from bank_transactions
          where organization_bank_account_id in (
            select id from organization_bank_accounts where organization_id in (select id from organizations where demo_batch_id = p_batch_id)
          )
        );
  get diagnostics v_deleted = row_count; table_name := 'bank_matches'; row_count := v_deleted; return next;

  delete from payment_returns
  where demo_batch_id = p_batch_id
     or masav_line_id in (
          select id from masav_lines
          where batch_id in (select id from masav_batches where organization_id in (select id from organizations where demo_batch_id = p_batch_id))
        );
  get diagnostics v_deleted = row_count; table_name := 'payment_returns'; row_count := v_deleted; return next;

  delete from bank_transactions
  where demo_batch_id = p_batch_id
     or organization_bank_account_id in (
          select id from organization_bank_accounts where organization_id in (select id from organizations where demo_batch_id = p_batch_id)
        );
  get diagnostics v_deleted = row_count; table_name := 'bank_transactions'; row_count := v_deleted; return next;

  delete from masav_lines
  where demo_batch_id = p_batch_id
     or batch_id in (select id from masav_batches where organization_id in (select id from organizations where demo_batch_id = p_batch_id));
  get diagnostics v_deleted = row_count; table_name := 'masav_lines'; row_count := v_deleted; return next;

  delete from masav_batches
  where demo_batch_id = p_batch_id
     or organization_id in (select id from organizations where demo_batch_id = p_batch_id);
  get diagnostics v_deleted = row_count; table_name := 'masav_batches'; row_count := v_deleted; return next;

  perform set_config('app.allow_distribution_status_change', 'true', true);
  update distribution_batches
  set status = 'draft'
  where demo_batch_id = p_batch_id
     or organization_id in (select id from organizations where demo_batch_id = p_batch_id);

  delete from distribution_lines
  where demo_batch_id = p_batch_id
     or batch_id in (select id from distribution_batches where organization_id in (select id from organizations where demo_batch_id = p_batch_id));
  get diagnostics v_deleted = row_count; table_name := 'distribution_lines'; row_count := v_deleted; return next;

  delete from distribution_batches
  where demo_batch_id = p_batch_id
     or organization_id in (select id from organizations where demo_batch_id = p_batch_id);
  get diagnostics v_deleted = row_count; table_name := 'distribution_batches'; row_count := v_deleted; return next;

  delete from donations
  where demo_batch_id = p_batch_id
     or organization_id in (select id from organizations where demo_batch_id = p_batch_id);
  get diagnostics v_deleted = row_count; table_name := 'donations'; row_count := v_deleted; return next;

  delete from eligibility_financial_results
  where demo_batch_id = p_batch_id
     or organization_id in (select id from organizations where demo_batch_id = p_batch_id);
  get diagnostics v_deleted = row_count; table_name := 'eligibility_financial_results'; row_count := v_deleted; return next;

  delete from monthly_eligibility
  where demo_batch_id = p_batch_id
     or organization_id in (select id from organizations where demo_batch_id = p_batch_id);
  get diagnostics v_deleted = row_count; table_name := 'monthly_eligibility'; row_count := v_deleted; return next;

  -- הטבלה שבה הבעיה נתפסה בפועל אצל Chani.
  delete from financial_periods
  where demo_batch_id = p_batch_id
     or organization_id in (select id from organizations where demo_batch_id = p_batch_id);
  get diagnostics v_deleted = row_count; table_name := 'financial_periods'; row_count := v_deleted; return next;

  -- student_bank_accounts/student_assignments: תלמיד עצמו כן מתויג באמינות ע"י
  -- create_demo_batch (הוא היחיד שיוצר תלמידי דמו) - ההרחבה כאן לפי student_id, לא
  -- organization_id, כי חשבון בנק/שיוך של תלמיד לא בהכרח נושא organization_id ישירות.
  delete from student_bank_accounts
  where demo_batch_id = p_batch_id
     or student_id in (select id from students where demo_batch_id = p_batch_id);
  get diagnostics v_deleted = row_count; table_name := 'student_bank_accounts'; row_count := v_deleted; return next;

  delete from student_assignments
  where demo_batch_id = p_batch_id
     or student_id in (select id from students where demo_batch_id = p_batch_id)
     or organization_id in (select id from organizations where demo_batch_id = p_batch_id);
  get diagnostics v_deleted = row_count; table_name := 'student_assignments'; row_count := v_deleted; return next;

  delete from students where demo_batch_id = p_batch_id;
  get diagnostics v_deleted = row_count; table_name := 'students'; row_count := v_deleted; return next;

  delete from groups
  where demo_batch_id = p_batch_id
     or branch_id in (select id from branches where organization_id in (select id from organizations where demo_batch_id = p_batch_id));
  get diagnostics v_deleted = row_count; table_name := 'groups'; row_count := v_deleted; return next;

  delete from branches
  where demo_batch_id = p_batch_id
     or organization_id in (select id from organizations where demo_batch_id = p_batch_id);
  get diagnostics v_deleted = row_count; table_name := 'branches'; row_count := v_deleted; return next;

  delete from organization_bank_accounts
  where demo_batch_id = p_batch_id
     or organization_id in (select id from organizations where demo_batch_id = p_batch_id);
  get diagnostics v_deleted = row_count; table_name := 'organization_bank_accounts'; row_count := v_deleted; return next;

  delete from organizations where demo_batch_id = p_batch_id;
  get diagnostics v_deleted = row_count; table_name := 'organizations'; row_count := v_deleted; return next;

  delete from demo_batches where id = p_batch_id;

  perform insert_audit_event('delete_demo_batch', 'demo_batches', p_batch_id::text, jsonb_build_object('deleted_at', now()));
end;
$$;

-- ר' הערה למעלה - מעודכנת לספור באותה לוגיקה בדיוק כמו delete_demo_batch(), כדי שהתצוגה
-- המקדימה לעולם לא תציג פחות שורות ממה שבאמת יימחק.
create or replace function preview_demo_batch_deletion(p_batch_id uuid)
returns table (table_name text, row_count integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('demo_data', 'manage') then
    raise exception 'permission denied';
  end if;
  if not exists (select 1 from demo_batches where id = p_batch_id) then
    raise exception 'אצוות דמו לא נמצאה';
  end if;

  table_name := 'group_ledger_entries';
  select count(*) into row_count from group_ledger_entries
  where demo_batch_id = p_batch_id
     or organization_id in (select id from organizations where demo_batch_id = p_batch_id);
  return next;

  table_name := 'bank_matches';
  select count(*) into row_count from bank_matches
  where demo_batch_id = p_batch_id
     or bank_transaction_id in (
          select id from bank_transactions
          where organization_bank_account_id in (
            select id from organization_bank_accounts where organization_id in (select id from organizations where demo_batch_id = p_batch_id)
          )
        );
  return next;

  table_name := 'payment_returns';
  select count(*) into row_count from payment_returns
  where demo_batch_id = p_batch_id
     or masav_line_id in (
          select id from masav_lines
          where batch_id in (select id from masav_batches where organization_id in (select id from organizations where demo_batch_id = p_batch_id))
        );
  return next;

  table_name := 'bank_transactions';
  select count(*) into row_count from bank_transactions
  where demo_batch_id = p_batch_id
     or organization_bank_account_id in (
          select id from organization_bank_accounts where organization_id in (select id from organizations where demo_batch_id = p_batch_id)
        );
  return next;

  table_name := 'masav_lines';
  select count(*) into row_count from masav_lines
  where demo_batch_id = p_batch_id
     or batch_id in (select id from masav_batches where organization_id in (select id from organizations where demo_batch_id = p_batch_id));
  return next;

  table_name := 'masav_batches';
  select count(*) into row_count from masav_batches
  where demo_batch_id = p_batch_id
     or organization_id in (select id from organizations where demo_batch_id = p_batch_id);
  return next;

  table_name := 'distribution_lines';
  select count(*) into row_count from distribution_lines
  where demo_batch_id = p_batch_id
     or batch_id in (select id from distribution_batches where organization_id in (select id from organizations where demo_batch_id = p_batch_id));
  return next;

  table_name := 'distribution_batches';
  select count(*) into row_count from distribution_batches
  where demo_batch_id = p_batch_id
     or organization_id in (select id from organizations where demo_batch_id = p_batch_id);
  return next;

  table_name := 'donations';
  select count(*) into row_count from donations
  where demo_batch_id = p_batch_id
     or organization_id in (select id from organizations where demo_batch_id = p_batch_id);
  return next;

  table_name := 'eligibility_financial_results';
  select count(*) into row_count from eligibility_financial_results
  where demo_batch_id = p_batch_id
     or organization_id in (select id from organizations where demo_batch_id = p_batch_id);
  return next;

  table_name := 'monthly_eligibility';
  select count(*) into row_count from monthly_eligibility
  where demo_batch_id = p_batch_id
     or organization_id in (select id from organizations where demo_batch_id = p_batch_id);
  return next;

  table_name := 'financial_periods';
  select count(*) into row_count from financial_periods
  where demo_batch_id = p_batch_id
     or organization_id in (select id from organizations where demo_batch_id = p_batch_id);
  return next;

  table_name := 'student_bank_accounts';
  select count(*) into row_count from student_bank_accounts
  where demo_batch_id = p_batch_id
     or student_id in (select id from students where demo_batch_id = p_batch_id);
  return next;

  table_name := 'student_assignments';
  select count(*) into row_count from student_assignments
  where demo_batch_id = p_batch_id
     or student_id in (select id from students where demo_batch_id = p_batch_id)
     or organization_id in (select id from organizations where demo_batch_id = p_batch_id);
  return next;

  table_name := 'students';
  select count(*) into row_count from students where demo_batch_id = p_batch_id;
  return next;

  table_name := 'groups';
  select count(*) into row_count from groups
  where demo_batch_id = p_batch_id
     or branch_id in (select id from branches where organization_id in (select id from organizations where demo_batch_id = p_batch_id));
  return next;

  table_name := 'branches';
  select count(*) into row_count from branches
  where demo_batch_id = p_batch_id
     or organization_id in (select id from organizations where demo_batch_id = p_batch_id);
  return next;

  table_name := 'organization_bank_accounts';
  select count(*) into row_count from organization_bank_accounts
  where demo_batch_id = p_batch_id
     or organization_id in (select id from organizations where demo_batch_id = p_batch_id);
  return next;

  table_name := 'organizations';
  select count(*) into row_count from organizations where demo_batch_id = p_batch_id;
  return next;
end;
$$;
