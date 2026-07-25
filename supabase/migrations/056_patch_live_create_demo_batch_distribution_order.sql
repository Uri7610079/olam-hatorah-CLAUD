-- Patch לפרויקט החי: create_demo_batch() (052) נכשלה בבדיקה חיה השנייה שלה (אחרי תיקון
-- 055) עם "ניתן לערוך שורות חלוקה רק כאשר האצווה בטיוטה (סטטוס נוכחי: locked_for_masav)".
-- הפונקציה נעלה את distribution_batches ל-locked_for_masav *לפני* יצירת distribution_lines
-- - enforce_distribution_lines_mutation() (031) חוסמת כל insert/update/delete על
-- distribution_lines כשהאצווה שלהן אינה 'draft', בלי שום דגל עוקף (בניגוד לשאר הבאגים
-- מאותה מחלקה, זו בדיקה על טבלת האב, לא על הטבלה עצמה). כל הפעולה חזרה לאחור בטרנזקציה
-- אחת - לא נוצרה אף שורה חלקית. 052 עודכן בדיסק (שורות החלוקה נוצרות לפני הנעילה, לא
-- אחריה); זהו ה-patch לפרויקט הקיים - re-create מלא של הפונקציה עם הסדר המתוקן.
create or replace function create_demo_batch(p_label text, p_description text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_org_id uuid;
  v_bank_account_id uuid;
  v_branch_id uuid;
  v_group_a_id uuid;
  v_group_b_id uuid;
  v_student1_id uuid;
  v_student2_id uuid;
  v_student3_id uuid;
  v_sba1_id uuid;
  v_sba2_id uuid;
  v_sba3_id uuid;
  v_month date := '2026-06-01';
  v_masav_type_id uuid;
  v_masav_batch_id uuid;
  v_line1_id uuid;
  v_line2_id uuid;
  v_dist_batch_id uuid;
  v_donation_id uuid;
  v_bt_id uuid;
  v_return_id uuid;
begin
  if not has_permission('demo_data', 'manage') then
    raise exception 'permission denied';
  end if;
  if p_label is null or length(trim(p_label)) = 0 then
    raise exception 'נדרשת תווית לחבילת הדמו';
  end if;

  insert into demo_batches (label, description, created_by) values (p_label, p_description, auth.uid()) returning id into v_batch_id;

  insert into organizations (legal_name, org_number, contact_phone, contact_email, contact_address, is_demo, demo_batch_id)
  values ('DEMO - עמותת הדגמה', 'DEMO-0001', '000-0000000', 'demo@example.invalid', 'DEMO - כתובת לדוגמה', true, v_batch_id)
  returning id into v_org_id;

  insert into organization_bank_accounts (organization_id, bank_name, bank_branch_code, account_number, account_holder_name, is_demo, demo_batch_id)
  values (v_org_id, 'DEMO - בנק לדוגמה', '000', '0000000', 'DEMO - עמותת הדגמה', true, v_batch_id)
  returning id into v_bank_account_id;

  insert into branches (organization_id, talmud_branch_code, internal_name, is_demo, demo_batch_id)
  values (v_org_id, 'DEMO-01', 'DEMO - סניף הדגמה', true, v_batch_id)
  returning id into v_branch_id;

  insert into groups (branch_id, name, is_demo, demo_batch_id) values (v_branch_id, 'DEMO - קבוצה א', true, v_batch_id) returning id into v_group_a_id;
  insert into groups (branch_id, name, is_demo, demo_batch_id) values (v_branch_id, 'DEMO - קבוצה ב', true, v_batch_id) returning id into v_group_b_id;

  insert into students (id_type, external_id, full_name, phone_raw, phone_normalized, address, status, is_demo, demo_batch_id)
  values ('israeli_id', 'DEMO0000001', 'DEMO - תלמיד הדגמה 1', '050-0000001', '0500000001', 'DEMO - רחוב 1', 'draft', true, v_batch_id)
  returning id into v_student1_id;
  insert into students (id_type, external_id, full_name, phone_raw, phone_normalized, address, status, is_demo, demo_batch_id)
  values ('israeli_id', 'DEMO0000002', 'DEMO - תלמיד הדגמה 2', '050-0000002', '0500000002', 'DEMO - רחוב 2', 'draft', true, v_batch_id)
  returning id into v_student2_id;
  insert into students (id_type, external_id, full_name, phone_raw, phone_normalized, address, status, is_demo, demo_batch_id)
  values ('israeli_id', 'DEMO0000003', 'DEMO - תלמיד הדגמה 3', '050-0000003', '0500000003', 'DEMO - רחוב 3', 'draft', true, v_batch_id)
  returning id into v_student3_id;

  perform set_config('app.allow_student_status_change', 'true', true);
  update students set status = 'active' where id in (v_student1_id, v_student2_id, v_student3_id);

  insert into student_assignments (student_id, organization_id, branch_id, group_id, start_date, is_active, is_demo, demo_batch_id)
  values
    (v_student1_id, v_org_id, v_branch_id, v_group_a_id, v_month, true, true, v_batch_id),
    (v_student2_id, v_org_id, v_branch_id, v_group_a_id, v_month, true, true, v_batch_id),
    (v_student3_id, v_org_id, v_branch_id, v_group_b_id, v_month, true, true, v_batch_id);

  insert into student_bank_accounts (student_id, bank_name, bank_branch_code, account_number, account_holder_name, student_relationship, verification_status, verified_at, is_active, is_demo, demo_batch_id)
  values (v_student1_id, 'DEMO - בנק לדוגמה', '000', '0000001', 'DEMO - תלמיד הדגמה 1', 'self', 'verified', now(), true, true, v_batch_id)
  returning id into v_sba1_id;
  insert into student_bank_accounts (student_id, bank_name, bank_branch_code, account_number, account_holder_name, student_relationship, verification_status, verified_at, is_active, is_demo, demo_batch_id)
  values (v_student2_id, 'DEMO - בנק לדוגמה', '000', '0000002', 'DEMO - תלמיד הדגמה 2', 'self', 'verified', now(), true, true, v_batch_id)
  returning id into v_sba2_id;
  insert into student_bank_accounts (student_id, bank_name, bank_branch_code, account_number, account_holder_name, student_relationship, verification_status, verified_at, is_active, is_demo, demo_batch_id)
  values (v_student3_id, 'DEMO - בנק לדוגמה', '000', '0000003', 'DEMO - תלמיד הדגמה 3', 'self', 'verified', now(), true, true, v_batch_id)
  returning id into v_sba3_id;

  insert into financial_periods (organization_id, month, status, closed_at, is_demo, demo_batch_id)
  values (v_org_id, v_month, 'closed', now(), true, v_batch_id);

  insert into monthly_eligibility (student_id, organization_id, branch_id, group_id, month, gross_amount, score_or_payment_type, status, is_demo, demo_batch_id)
  values
    (v_student1_id, v_org_id, v_branch_id, v_group_a_id, v_month, 500, 'DEMO', 'active', true, v_batch_id),
    (v_student2_id, v_org_id, v_branch_id, v_group_a_id, v_month, 400, 'DEMO', 'active', true, v_batch_id),
    (v_student3_id, v_org_id, v_branch_id, v_group_b_id, v_month, 500, 'DEMO', 'active', true, v_batch_id);

  insert into eligibility_financial_results (eligibility_id, organization_id, branch_id, group_id, student_id, month, gross_amount, rule_snapshot, commission_amount, net_amount, status, is_demo, demo_batch_id)
  select me.id, v_org_id, v_branch_id, me.group_id, me.student_id, v_month, me.gross_amount,
    jsonb_build_object('calculation_type', 'DEMO - 10% אחוז'), round(me.gross_amount * 0.1, 2), round(me.gross_amount * 0.9, 2), 'active', true, v_batch_id
  from monthly_eligibility me where me.demo_batch_id = v_batch_id;

  insert into group_ledger_entries (organization_id, group_id, entry_type, amount, period_month, source_table, reason, is_demo, demo_batch_id)
  select v_org_id, v_group_a_id, 'net_scholarship', sum(efr.net_amount), v_month, 'eligibility_financial_results', 'DEMO - זיכוי עמלה חודשית', true, v_batch_id
  from eligibility_financial_results efr where efr.demo_batch_id = v_batch_id and efr.group_id = v_group_a_id;

  insert into group_ledger_entries (organization_id, group_id, entry_type, amount, period_month, source_table, reason, is_demo, demo_batch_id)
  values (v_org_id, v_group_b_id, 'net_scholarship', 450, v_month, 'eligibility_financial_results', 'DEMO - זיכוי עמלה חודשית', true, v_batch_id);

  insert into donations (organization_id, group_id, donation_date, amount, donor_reference, reference, status, is_demo, demo_batch_id)
  values (v_org_id, v_group_a_id, v_month, 1000, 'DEMO-DONOR-001', 'DEMO - קבלה 1', 'pending', true, v_batch_id)
  returning id into v_donation_id;

  perform set_config('app.allow_donation_status_change', 'true', true);
  update donations set status = 'approved' where id = v_donation_id;

  insert into group_ledger_entries (organization_id, group_id, entry_type, amount, period_month, source_table, reason, is_demo, demo_batch_id)
  values (v_org_id, v_group_a_id, 'donation', 1000, v_month, 'donations', 'DEMO - תרומה', true, v_batch_id);

  -- שורות החלוקה נוצרות *לפני* הנעילה - ר' הערת הפתיחה של הקובץ.
  insert into distribution_batches (organization_id, group_id, period_month, source_type, method, status, is_demo, demo_batch_id)
  values (v_org_id, v_group_a_id, v_month, 'combined', 'fixed_amounts', 'draft', true, v_batch_id)
  returning id into v_dist_batch_id;

  insert into distribution_lines (batch_id, student_id, amount, is_demo, demo_batch_id)
  values (v_dist_batch_id, v_student1_id, 500, true, v_batch_id);
  insert into distribution_lines (batch_id, student_id, amount, is_demo, demo_batch_id)
  values (v_dist_batch_id, v_student2_id, 400, true, v_batch_id);

  perform set_config('app.allow_distribution_status_change', 'true', true);
  update distribution_batches set status = 'locked_for_masav' where id = v_dist_batch_id;

  insert into masav_batches (organization_id, organization_bank_account_id, period_month, status, total_amount, payment_count, transmitted_at, is_demo, demo_batch_id)
  values (v_org_id, v_bank_account_id, v_month, 'bank_completed', 900, 2, now(), true, v_batch_id)
  returning id into v_masav_batch_id;

  insert into masav_lines (batch_id, student_id, group_id, student_bank_account_id, amount, source_distribution_batch_id, status, is_demo, demo_batch_id)
  values (v_masav_batch_id, v_student1_id, v_group_a_id, v_sba1_id, 500, v_dist_batch_id, 'valid', true, v_batch_id)
  returning id into v_line1_id;
  insert into masav_lines (batch_id, student_id, group_id, student_bank_account_id, amount, source_distribution_batch_id, status, is_demo, demo_batch_id)
  values (v_masav_batch_id, v_student2_id, v_group_a_id, v_sba2_id, 400, v_dist_batch_id, 'returned', true, v_batch_id)
  returning id into v_line2_id;

  insert into group_ledger_entries (organization_id, group_id, entry_type, amount, period_month, source_table, source_id, reason, is_demo, demo_batch_id)
  values (v_org_id, v_group_a_id, 'payment', -900, v_month, 'masav_batches', v_masav_batch_id, 'DEMO - שידור מס"ב', true, v_batch_id);

  select id into v_masav_type_id from bank_transaction_types where code = 'masav';
  insert into bank_transactions (organization_bank_account_id, execution_date, direction, amount, description, reference, raw, fingerprint, confirmed_type_id, classification_status, is_demo, demo_batch_id)
  values (v_bank_account_id, v_month, 'debit', 900, 'DEMO - שידור מס"ב', 'DEMO-REF-001', jsonb_build_object('demo', true), 'DEMO-FP-' || v_batch_id::text, v_masav_type_id, 'confirmed', true, v_batch_id)
  returning id into v_bt_id;

  insert into bank_matches (bank_transaction_id, match_type, target_table, target_id, matched_amount, status, suggested_reason, approved_by, approved_at, is_demo, demo_batch_id)
  values (v_bt_id, 'masav_batch', 'masav_batches', v_masav_batch_id, 900, 'approved', 'DEMO - התאמה אוטומטית', auth.uid(), now(), true, v_batch_id);

  insert into payment_returns (masav_line_id, return_date, amount, reason, status, is_demo, demo_batch_id)
  values (v_line2_id, v_month, 400, 'DEMO - חשבון סגור, חזר מהבנק', 'open', true, v_batch_id)
  returning id into v_return_id;

  insert into group_ledger_entries (organization_id, group_id, entry_type, amount, period_month, source_table, source_id, reason, is_demo, demo_batch_id)
  values (v_org_id, v_group_a_id, 'refund', 400, v_month, 'payment_returns', v_return_id, 'DEMO - החזר תשלום', true, v_batch_id);

  perform insert_audit_event('create_demo_batch', 'demo_batches', v_batch_id::text, jsonb_build_object('label', p_label));

  return v_batch_id;
end;
$$;
