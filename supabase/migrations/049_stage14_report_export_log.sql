-- שלב 14 (חלק ב'): רישום כל יצוא דוח ביומן. הלקוח לא יכול לקרוא ל-insert_audit_event
-- ישירות (revoked מ-authenticated, ר' README/שלב 2) - כל קריאה ליומן עוברת דרך פונקציית
-- SECURITY DEFINER ייעודית, אותו דפוס בדיוק כמו כל שאר הפעולות במערכת.
create or replace function log_report_export(p_report_type text, p_filters jsonb, p_row_count integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (has_permission('area_ops', 'access') or has_permission('area_finance', 'access')) then
    raise exception 'permission denied';
  end if;

  perform insert_audit_event('export_report', 'reports', p_report_type, jsonb_build_object('filters', p_filters, 'row_count', p_row_count));
end;
$$;

grant execute on function log_report_export(text, jsonb, integer) to authenticated;
