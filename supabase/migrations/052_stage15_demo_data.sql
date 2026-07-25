-- שלב 15 (חלק א'): ניהול נתוני דמו. demo_batches עוקבת אחרי כל "חבילת דמו" שנוצרה,
-- כדי לאפשר מחיקה מבוקרת (Preview + מחיקה בסדר תלות + אישור כפול + יומן) בלי לגעת
-- בנתוני אמת. demo_batch_id כבר קיים כעמודה רגילה (לא FK) בכל טבלה מאז השלב שבו נוצרה -
-- לא מוסיפים FK אמיתי (יידרש ALTER על ~20 טבלאות בלי תועלת אמיתית: המחיקה עצמה מבוצעת
-- בסדר מפורש בקוד, לא מסתמכת על CASCADE).
--
-- create_demo_batch(): יוצרת שרשרת סינתטית עקבית אחת: עמותה -> סניף -> 2 קבוצות ->
-- 3 תלמידים -> זכאות -> עמלה -> תרומה/חלוקה -> מס"ב -> בנק -> התאמה/החזרה. כל שורה
-- is_demo=true + demo_batch_id, מזהים לוגיים מתחילים ב-DEMO, פרטי קשר/חשבון סינתטיים
-- לגמרי. נכתבת כ-INSERT-ים ישירים (לא קריאה לרצף ה-RPCs האמיתי) - הפונקציה היא
-- SECURITY DEFINER סגור למנהל מערכת בלבד, לא נתיב עקיפה ללקוח רגיל (ר' טבלת אין-INSERT-
-- policy שכל טבלה מוגנת-RPC כבר אוכפת); המטרה היא הדגמה ויזואלית של השרשרת המלאה, לא
-- שחזור היסטוריית האישורים צעד-אחר-צעד (זו כבר הוכחה נכונה לאורך כל הפרויקט).

create table demo_batches (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  description text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

insert into permissions (resource, action, label_he) values
  ('demo_data', 'manage', 'ניהול נתוני דמו (יצירה ומחיקה)');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'demo_data' and p.action = 'manage'
where r.key = 'system_admin';

alter table demo_batches enable row level security;

create policy demo_batches_select on demo_batches for select to authenticated
  using (has_permission('demo_data', 'manage'));

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

  -- עמותה + חשבון בנק + סניף
  insert into organizations (legal_name, org_number, contact_phone, contact_email, contact_address, is_demo, demo_batch_id)
  values ('DEMO - עמותת הדגמה', 'DEMO-0001', '000-0000000', 'demo@example.invalid', 'DEMO - כתובת לדוגמה', true, v_batch_id)
  returning id into v_org_id;

  insert into organization_bank_accounts (organization_id, bank_name, bank_branch_code, account_number, account_holder_name, is_demo, demo_batch_id)
  values (v_org_id, 'DEMO - בנק לדוגמה', '000', '0000000', 'DEMO - עמותת הדגמה', true, v_batch_id)
  returning id into v_bank_account_id;

  insert into branches (organization_id, talmud_branch_code, internal_name, is_demo, demo_batch_id)
  values (v_org_id, 'DEMO-01', 'DEMO - סניף הדגמה', true, v_batch_id)
  returning id into v_branch_id;

  -- שתי קבוצות: קבוצה א' עוברת את כל השרשרת עד בנק; קבוצה ב' נשארת באמצע (זכאות+עמלה בלבד)
  insert into groups (branch_id, name, is_demo, demo_batch_id) values (v_branch_id, 'DEMO - קבוצה א', true, v_batch_id) returning id into v_group_a_id;
  insert into groups (branch_id, name, is_demo, demo_batch_id) values (v_branch_id, 'DEMO - קבוצה ב', true, v_batch_id) returning id into v_group_b_id;

  -- שלושה תלמידים. enforce_student_status_transition() חוסמת INSERT עם status<>'draft'
  -- ללא תנאי (הדגל app.allow_student_status_change משפיע רק על UPDATE, לא על INSERT
  -- - נתפס בביקורת עצמית) - לכן יוצרים כטיוטה קודם, ואז מעדכנים ל-"active" בנפרד.
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

  -- חודש כספי סגור (רשומה היסטורית שלמה, לא נפתחת/נסגרת דרך הזרימה האמיתית)
  insert into financial_periods (organization_id, month, status, closed_at, is_demo, demo_batch_id)
  values (v_org_id, v_month, 'closed', now(), true, v_batch_id);

  -- זכאות ועמלה: 500 ברוטו לתלמידים 1+3, 400 לתלמיד 2, עמלה 10% בכל השורות
  insert into monthly_eligibility (student_id, organization_id, branch_id, group_id, month, gross_amount, score_or_payment_type, status, is_demo, demo_batch_id)
  values
    (v_student1_id, v_org_id, v_branch_id, v_group_a_id, v_month, 500, 'DEMO', 'active', true, v_batch_id),
    (v_student2_id, v_org_id, v_branch_id, v_group_a_id, v_month, 400, 'DEMO', 'active', true, v_batch_id),
    (v_student3_id, v_org_id, v_branch_id, v_group_b_id, v_month, 500, 'DEMO', 'active', true, v_batch_id);

  insert into eligibility_financial_results (eligibility_id, organization_id, branch_id, group_id, student_id, month, gross_amount, rule_snapshot, commission_amount, net_amount, status, is_demo, demo_batch_id)
  select me.id, v_org_id, v_branch_id, me.group_id, me.student_id, v_month, me.gross_amount,
    jsonb_build_object('calculation_type', 'DEMO - 10% אחוז'), round(me.gross_amount * 0.1, 2), round(me.gross_amount * 0.9, 2), 'active', true, v_batch_id
  from monthly_eligibility me where me.demo_batch_id = v_batch_id;

  -- ספר תנועות: קבוצה א' (450+360=810 נטו) + תרומה 1000 + תשלום מס"ב יוצא 810 + החזר 360
  insert into group_ledger_entries (organization_id, group_id, entry_type, amount, period_month, source_table, reason, is_demo, demo_batch_id)
  select v_org_id, v_group_a_id, 'net_scholarship', sum(efr.net_amount), v_month, 'eligibility_financial_results', 'DEMO - זיכוי עמלה חודשית', true, v_batch_id
  from eligibility_financial_results efr where efr.demo_batch_id = v_batch_id and efr.group_id = v_group_a_id;

  insert into group_ledger_entries (organization_id, group_id, entry_type, amount, period_month, source_table, reason, is_demo, demo_batch_id)
  values (v_org_id, v_group_b_id, 'net_scholarship', 450, v_month, 'eligibility_financial_results', 'DEMO - זיכוי עמלה חודשית', true, v_batch_id);

  -- enforce_donation_mutation_guard() חוסמת INSERT עם status<>'pending' ללא תנאי (אותה
  -- מחלקת באג בדיוק כמו students למעלה) - יוצרים pending ואז מעדכנים ל-approved עם הדגל.
  insert into donations (organization_id, group_id, donation_date, amount, donor_reference, reference, status, is_demo, demo_batch_id)
  values (v_org_id, v_group_a_id, v_month, 1000, 'DEMO-DONOR-001', 'DEMO - קבלה 1', 'pending', true, v_batch_id)
  returning id into v_donation_id;

  perform set_config('app.allow_donation_status_change', 'true', true);
  update donations set status = 'approved' where id = v_donation_id;

  insert into group_ledger_entries (organization_id, group_id, entry_type, amount, period_month, source_table, reason, is_demo, demo_batch_id)
  values (v_org_id, v_group_a_id, 'donation', 1000, v_month, 'donations', 'DEMO - תרומה', true, v_batch_id);

  -- חלוקה: 500 לתלמיד 1, 400 לתלמיד 2 (סה"כ 900 מתוך יתרה זמינה 810+1000).
  -- enforce_distribution_batch_mutation() חוסמת INSERT עם status<>'draft' ללא תנאי -
  -- יוצרים טיוטה ואז מעדכנים ל-locked_for_masav עם הדגל. שורות החלוקה עצמן חייבות
  -- להיווצר *לפני* הנעילה - enforce_distribution_lines_mutation() (031) חוסמת כל
  -- insert/update/delete על distribution_lines כשהאצווה שלהן אינה 'draft', בלי שום דגל
  -- עוקף (לא רק בדיקת סטטוס על הטבלה עצמה, כמו שאר הבאגים מהמחלקה הזו, אלא על טבלת האב) -
  -- נתפס בבדיקה חיה, לא בביקורת עצמית.
  insert into distribution_batches (organization_id, group_id, period_month, source_type, method, status, is_demo, demo_batch_id)
  values (v_org_id, v_group_a_id, v_month, 'combined', 'fixed_amounts', 'draft', true, v_batch_id)
  returning id into v_dist_batch_id;

  insert into distribution_lines (batch_id, student_id, amount, is_demo, demo_batch_id)
  values (v_dist_batch_id, v_student1_id, 500, true, v_batch_id);
  insert into distribution_lines (batch_id, student_id, amount, is_demo, demo_batch_id)
  values (v_dist_batch_id, v_student2_id, 400, true, v_batch_id);

  perform set_config('app.allow_distribution_status_change', 'true', true);
  update distribution_batches set status = 'locked_for_masav' where id = v_dist_batch_id;

  -- מס"ב: בוצע בבנק. שורת תלמיד 2 חזרה מהבנק אחר כך (status='returned').
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

  -- תנועת בנק תואמת + התאמה מאושרת
  select id into v_masav_type_id from bank_transaction_types where code = 'masav';
  insert into bank_transactions (organization_bank_account_id, execution_date, direction, amount, description, reference, raw, fingerprint, confirmed_type_id, classification_status, is_demo, demo_batch_id)
  values (v_bank_account_id, v_month, 'debit', 900, 'DEMO - שידור מס"ב', 'DEMO-REF-001', jsonb_build_object('demo', true), 'DEMO-FP-' || v_batch_id::text, v_masav_type_id, 'confirmed', true, v_batch_id)
  returning id into v_bt_id;

  insert into bank_matches (bank_transaction_id, match_type, target_table, target_id, matched_amount, status, suggested_reason, approved_by, approved_at, is_demo, demo_batch_id)
  values (v_bt_id, 'masav_batch', 'masav_batches', v_masav_batch_id, 900, 'approved', 'DEMO - התאמה אוטומטית', auth.uid(), now(), true, v_batch_id);

  -- החזרת תשלום פתוחה (עדיין דורשת טיפול - מדגימה גם חריגה פתוחה בסביבת הדמו)
  insert into payment_returns (masav_line_id, return_date, amount, reason, status, is_demo, demo_batch_id)
  values (v_line2_id, v_month, 400, 'DEMO - חשבון סגור, חזר מהבנק', 'open', true, v_batch_id)
  returning id into v_return_id;

  insert into group_ledger_entries (organization_id, group_id, entry_type, amount, period_month, source_table, source_id, reason, is_demo, demo_batch_id)
  values (v_org_id, v_group_a_id, 'refund', 400, v_month, 'payment_returns', v_return_id, 'DEMO - החזר תשלום', true, v_batch_id);

  perform insert_audit_event('create_demo_batch', 'demo_batches', v_batch_id::text, jsonb_build_object('label', p_label));

  return v_batch_id;
end;
$$;

grant execute on function create_demo_batch(text, text) to authenticated;

-- preview_demo_batch_deletion(): סופרת שורות לפי אצווה, בכל טבלה שהמחולל נוגע בה, כדי
-- להציג ל-UI לפני מחיקה בפועל. רשימת הטבלאות זהה בכוונה לסדר המחיקה ב-delete_demo_batch()
-- למטה (ילדים לפני הורים), כדי ששתי הפונקציות יישארו מסונכרנות ולעולם לא "יתייתמו" שורות.
create or replace function preview_demo_batch_deletion(p_batch_id uuid)
returns table (table_name text, row_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table text;
  v_count integer;
  v_tables text[] := array[
    'group_ledger_entries', 'bank_matches', 'payment_returns', 'bank_transactions',
    'masav_lines', 'masav_batches', 'distribution_lines', 'distribution_batches',
    'donations', 'eligibility_financial_results', 'monthly_eligibility', 'financial_periods',
    'student_bank_accounts', 'student_assignments', 'students', 'groups', 'branches',
    'organization_bank_accounts', 'organizations'
  ];
begin
  if not has_permission('demo_data', 'manage') then
    raise exception 'permission denied';
  end if;
  if not exists (select 1 from demo_batches where id = p_batch_id) then
    raise exception 'אצוות דמו לא נמצאה';
  end if;

  foreach v_table in array v_tables loop
    execute format('select count(*) from %I where demo_batch_id = $1', v_table) into v_count using p_batch_id;
    table_name := v_table;
    row_count := v_count;
    return next;
  end loop;
end;
$$;

grant execute on function preview_demo_batch_deletion(uuid) to authenticated;

-- delete_demo_batch(): מוחקת בפועל, בסדר תלות מפורש (ילדים לפני הורים) כדי לא להסתמך על
-- CASCADE. אישור כפול הוא באחריות ה-UI (זו רק פעולת המחיקה עצמה); כל מחיקה מתועדת ביומן.
-- לא מבצעת יצירה מחדש אוטומטית - זו פעולה נפרדת ומכוונת של המשתמש דרך create_demo_batch().
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

  -- group_ledger_entries חסום ל-DELETE ללא תנאי (block_ledger_mutation, 026) - חריגה
  -- מכוונת ויחידה לדגל הזה, שאך ורק פונקציה זו מפעילה, ורק על שורות עם demo_batch_id תואם.
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

  -- enforce_distribution_lines_mutation() (031) חוסמת גם DELETE על distribution_lines
  -- כשהאצווה שלהן אינה 'draft' (בלי דגל עוקף, כמו ב-INSERT) - נתפס בבדיקה חיה. מחזירים
  -- את האצווה ל-draft (עם הדגל הקיים) לפני מחיקת השורות; האצווה עצמה נמחקת מיד אחרי,
  -- כך שהחזרה הזמנית ל-draft לא "משאירה" שום דבר בסטטוס שגוי.
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

grant execute on function delete_demo_batch(uuid) to authenticated;
