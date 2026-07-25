-- Patch לפרויקט החי: לאחר בניית שלב 15 (052, ניהול נתוני דמו), שתי הפונקציות היחידות
-- שמצטברות גלובלית על פני כל העמותות (בלי בורר עמותה מחייב) - get_ops_dashboard_counts()
-- ו-unified_exceptions (שתיהן כבר רצות חי מ-048) - צריכות לא לכלול נתוני דמו, אחרת חבילת
-- דמו שנוצרת דרך create_demo_batch() תעוות את הכרטיסיות/מרכז החריגות התפעולי האמיתי.
-- 048 עודכן בדיסק עם אותו תיקון בדיוק; זהו ה-patch לפרויקט הקיים.

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
) ue
left join organizations o on o.id = ue.organization_id
where coalesce(o.is_demo, false) = false;

grant select on unified_exceptions to authenticated;
