-- שלב 14 (חלק א'): פונקציות ה-KPI לשני ה-Dashboards + view מרכז חריגות מאוחד.
-- שתי פונקציות ה-Dashboard הן SECURITY DEFINER עם בדיקת הרשאת אזור בפנים (אותו דפוס
-- בדיוק כמו get_month_close_checklist, שלב 12) - הן מחזירות רק ספירות/סכומים
-- מצטברים, לא שורות פרטניות, כך שאין דליפת מידע בין עמותות דרך ה-bypass של RLS.
--
-- מרכז חריגות: view אחד שמאחד 7 מקורות קיימים לאותה צורת עמודות בדיוק כמו
-- bank_reconciliation_exceptions (שלב 12) - לא ממציא "סטטוס טיפול" חדש (האפיון מפורש:
-- "אין להפוך אותו למודול משימות כללי") - כל שורה מציגה את הסטטוס האמיתי של הרשומה
-- שלה ומקשרת ישירות למסך שבו מטפלים בה בפועל.

create or replace function get_ops_dashboard_counts()
returns table (
  draft_students integer,
  ready_for_export integer,
  open_errors integer,
  recurring_errors integer,
  active_not_in_latest_report integer,
  missing_phone_bank_or_assignment integer,
  pending_phone_lists_or_audits integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('area_ops', 'access') then
    raise exception 'permission denied';
  end if;

  return query
  select
    (select count(*)::integer from students where status = 'draft' and is_demo = false),
    (select count(*)::integer from students where status = 'ready_for_talmud' and is_demo = false),
    (select count(*)::integer from talmud_errors where status in ('open', 'in_progress', 'pending_info') and is_demo = false),
    (select count(*)::integer from talmud_errors where is_recurring = true and status <> 'closed' and is_demo = false),
    (
      select count(*)::integer from students s
      join student_assignments sa on sa.student_id = s.id and sa.is_active = true
      where s.status in ('active', 'active_with_error') and s.is_demo = false
        and not exists (
          select 1 from monthly_eligibility me
          where me.student_id = s.id
            and me.month = (select max(me2.month) from monthly_eligibility me2 where me2.organization_id = sa.organization_id)
        )
    ),
    (
      select count(distinct s.id)::integer from students s
      left join student_assignments sa on sa.student_id = s.id and sa.is_active = true
      left join student_bank_accounts sba on sba.student_id = s.id and sba.is_active = true and sba.verification_status = 'verified'
      where s.status in ('active', 'active_with_error') and s.is_demo = false
        and (s.phone_normalized is null or length(s.phone_normalized) = 0 or sa.id is null or sba.id is null)
    ),
    (
      (select count(*)::integer from phone_list_imports where status = 'uploaded' and is_demo = false)
      + (select count(*)::integer from audits where status = 'draft' and is_demo = false)
    );
end;
$$;

grant execute on function get_ops_dashboard_counts() to authenticated;

-- get_finance_dashboard_counts(): כמו כל מסך כספים אחר במערכת - תמיד לפי עמותה+חודש
-- ספציפיים, לא ניסיון "לצבור הכול על פני כל העמותות" בכרטיסייה אחת חסרת משמעות
-- (סטטוס חודש למשל לא ניתן לצבירה בין עמותות שונות).
create or replace function get_finance_dashboard_counts(p_organization_id uuid, p_month date)
returns table (
  period_status text,
  gross_amount numeric,
  commission_amount numeric,
  net_amount numeric,
  masav_in_process_count integer,
  masav_transmitted_not_completed_count integer,
  group_commitment_total numeric,
  open_bank_exceptions integer,
  open_returns integer,
  unclassified_transactions integer,
  unassigned_donations integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('area_finance', 'access') then
    raise exception 'permission denied';
  end if;

  return query
  select
    (select status from financial_periods where organization_id = p_organization_id and month = p_month),
    -- efr.gross_amount/commission_amount/net_amount מוקדשים במפורש (alias לטבלה) - בלי זה
    -- Postgres מתבלבל בין שם העמודה בטבלה לבין שם עמודת הפלט של הפונקציה עצמה (אותו שם
    -- בדיוק) ומחזיר "column reference is ambiguous". נתפס בבדיקה חיה, לא בביקורת עצמית.
    (select coalesce(sum(efr.gross_amount), 0) from eligibility_financial_results efr where efr.organization_id = p_organization_id and efr.month = p_month and efr.status = 'active'),
    (select coalesce(sum(efr.commission_amount), 0) from eligibility_financial_results efr where efr.organization_id = p_organization_id and efr.month = p_month and efr.status = 'active'),
    (select coalesce(sum(efr.net_amount), 0) from eligibility_financial_results efr where efr.organization_id = p_organization_id and efr.month = p_month and efr.status = 'active'),
    (select count(*)::integer from masav_batches where organization_id = p_organization_id and period_month = p_month and status in ('draft', 'pending_review', 'pending_approval', 'approved', 'file_generated')),
    (select count(*)::integer from masav_batches where organization_id = p_organization_id and period_month = p_month and status = 'transmitted'),
    (select coalesce(sum(gb.balance), 0) from group_balances gb where gb.organization_id = p_organization_id),
    (select count(*)::integer from bank_reconciliation_exceptions where organization_id = p_organization_id),
    (
      select count(*)::integer from payment_returns pr
      join masav_lines ml on ml.id = pr.masav_line_id
      join masav_batches mb on mb.id = ml.batch_id
      where mb.organization_id = p_organization_id and pr.status = 'open'
    ),
    (
      select count(*)::integer from bank_transactions bt
      join organization_bank_accounts oba on oba.id = bt.organization_bank_account_id
      where oba.organization_id = p_organization_id and bt.classification_status <> 'confirmed'
    ),
    (select count(*)::integer from donations where organization_id = p_organization_id and (group_id is null or status = 'pending'));
end;
$$;

grant execute on function get_finance_dashboard_counts(uuid, date) to authenticated;

-- מרכז חריגות מאוחד. כל מקור תורם באותה צורת עמודות: exception_type, severity
-- ('critical'|'high'|'medium'|'warning'), organization_id, related_table, related_id,
-- amount, related_date, description. security_invoker=true (מכבד RLS על כל טבלת בסיס -
-- אותו עיקרון כמו bank_reconciliation_exceptions עצמו, שמאוחד כאן כמקור ראשון).
-- הערה: bank_reconciliation_exceptions (שלב 12) משתמשת בסולם חומרה דו-ערכי משלה
-- ('critical'/'warning'), כי BankMatchingScreen מרנדרת אותה בעצמה בלי StatusBadge. כאן,
-- באיחוד, ממפים 'warning' ל-'medium' כדי שכל השורות ישתמשו באותו סולם תלת-ערכי
-- (critical/high/medium) שתואם את הערכים האמיתיים של StatusBadge - לא נוגעים ב-view
-- המקורי עצמו, רק במיפוי כאן.
--
-- העטיפה החיצונית (join ל-organizations.is_demo) מסננת נתוני דמו מהתצוגה המאוחדת הזו,
-- כי זו תצוגת "כל החריגות מכל העמותות" בלי בורר עמותה מחייב - נתוני דמו לא אמורים
-- להתערבב לתוך התמונה הכוללת. עמותת הדמו עצמה עדיין נבדקת ישירות דרך המסכים
-- הספציפיים (למשל BankMatchingScreen עם עמותת ה-DEMO נבחרת), שממשיכים לעבוד רגיל כי
-- bank_reconciliation_exceptions עצמו לא מסונן. left join+coalesce (לא inner join) כדי
-- שלא לאבד שורה בטעות אם אי-פעם יהיה organization_id ללא התאמה בטבלת organizations.
create view unified_exceptions
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
) ue
left join organizations o on o.id = ue.organization_id
where coalesce(o.is_demo, false) = false;

grant select on unified_exceptions to authenticated;
