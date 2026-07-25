-- Patch לפרויקט החי - שלב 17 (Audit סופי): נתפס בביקורת traceability מול תנאי הקבלה
-- ("נתוני דמו אינם יוצאים לאינטגרציות") - עד עכשיו ההגנה היחידה מפני יצוא נתוני דמו
-- לתלמוד הייתה מוסכמתית בלבד (משתמש פשוט לא בוחר בעמותת ה-DEMO), לא חסימה אמיתית
-- בשרת. create_talmud_export() (017) מתעדכנת לדחות יצוא במפורש אם העמותה מתויגת
-- is_demo=true. 017 עודכן בדיסק; זהו ה-patch לפרויקט הקיים - re-create מלא של הפונקציה.
create or replace function create_talmud_export(
  p_organization_id uuid,
  p_branch_id uuid,
  p_group_id uuid,
  p_period_start date,
  p_period_end date,
  p_student_ids uuid[],
  p_file_path text,
  p_file_name text,
  p_file_hash text,
  p_is_override boolean default false,
  p_override_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_already_exported_count integer;
  v_student_id uuid;
begin
  if not has_permission('talmud', 'export') then
    raise exception 'permission denied';
  end if;

  if exists (select 1 from organizations where id = p_organization_id and is_demo = true) then
    raise exception 'לא ניתן לייצא נתוני דמו לתלמוד - עמותת דמו אינה מיועדת לאינטגרציות אמיתיות';
  end if;

  if array_length(p_student_ids, 1) is null or array_length(p_student_ids, 1) = 0 then
    raise exception 'לא נבחרו תלמידים ליצוא';
  end if;

  if p_is_override and (p_override_reason is null or length(trim(p_override_reason)) = 0) then
    raise exception 'יצוא חוזר דורש סיבה';
  end if;

  if not p_is_override then
    select count(distinct ebs.student_id) into v_already_exported_count
    from export_batch_students ebs
    where ebs.student_id = any (p_student_ids);

    if v_already_exported_count > 0 then
      raise exception '% מהתלמידים כבר נכללו ביצוא קודם - יש לסמן "יצוא חוזר" ולציין סיבה', v_already_exported_count;
    end if;
  end if;

  insert into export_batches (
    organization_id, branch_id, group_id, period_start, period_end,
    file_path, file_name, file_hash, student_count, exported_by, is_override, override_reason
  )
  values (
    p_organization_id, p_branch_id, p_group_id, p_period_start, p_period_end,
    p_file_path, p_file_name, p_file_hash, array_length(p_student_ids, 1), auth.uid(), p_is_override, p_override_reason
  )
  returning id into v_batch_id;

  insert into export_batch_students (batch_id, student_id)
  select v_batch_id, s from unnest(p_student_ids) as s;

  perform set_config('app.allow_student_status_change', 'true', true);
  foreach v_student_id in array p_student_ids loop
    update students set status = 'sent_to_talmud' where id = v_student_id and status = 'ready_for_talmud';
  end loop;

  perform insert_audit_event(
    'create_talmud_export', 'export_batches', v_batch_id::text,
    jsonb_build_object('student_count', array_length(p_student_ids, 1), 'is_override', p_is_override)
  );

  return v_batch_id;
end;
$$;
