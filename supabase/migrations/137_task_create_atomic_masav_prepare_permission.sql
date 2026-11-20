-- מיגרציה 137: תיקונים מביקורת העומק של 20.11.2026
--
-- 1. יצירת משימה: המשימה, האחראים והצוותים נשמרים בפעולה אחת. עד היום אלה היו
--    שלוש קריאות נפרדות מהדפדפן. כשל באמצע השאיר משימה בלי אחראים, ומי שיצר אותה
--    (בלי הרשאה לראות את כל המשימות) לא יכול היה לראות אותה בכלל.
--    ההרשאות נבדקות בפונקציה בדיוק כמו בחוקי הטבלאות: יצירה (tasks.create), שיוך
--    משתמשים אחרים (tasks.assign_users), שיוך צוותים (tasks.assign_teams). היוצר עצמו
--    נרשם תמיד כאחראי, גם בלי הרשאת שיוך. זו הכוונה המקורית (ראו api.ts), ועד היום
--    מי שלא היה לו assign_users קיבל משימה בלי אחראים, שהוא עצמו לא רואה.
-- 2. "הכנה ואישור" של מס"ב: מי שיש לו הרשאת ניהול מס"ב בלי הרשאת אישור - האצווה
--    מוכנה ונעצרת ב"ממתין לאישור". עד היום כל הפעולה נכשלה בשלב האישור ("permission
--    denied") ובוטלה כולה, גם ההכנה. מי שיש לו הרשאת אישור - בדיוק כמו קודם.
--
-- שום נתון קיים לא משתנה.

-- ===== 1. יצירת משימה בפעולה אחת =====

create or replace function create_task_with_assignments(
  p_title text,
  p_description text,
  p_priority text,
  p_category_id uuid,
  p_due_date date,
  p_owner_ids uuid[],
  p_team_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task uuid;
  v_me uuid := auth.uid();
begin
  if v_me is null or not has_permission('tasks', 'create') then
    raise exception 'permission denied';
  end if;
  if exists (select 1 from unnest(coalesce(p_owner_ids, '{}'::uuid[])) u where u <> v_me)
     and not has_permission('tasks', 'assign_users') then
    raise exception 'אין הרשאה לשייך משתמשים אחרים למשימה';
  end if;
  if coalesce(array_length(p_team_ids, 1), 0) > 0 and not has_permission('tasks', 'assign_teams') then
    raise exception 'אין הרשאה לשייך צוותים למשימה';
  end if;

  insert into tasks (title, description, priority, category_id, due_date, created_by)
  values (p_title, p_description, coalesce(p_priority, 'normal'), p_category_id, p_due_date, v_me)
  returning id into v_task;

  -- היוצר תמיד בין האחראים (ר' ההערה ב-src/areas/tasks/api.ts)
  insert into task_owners (task_id, user_id)
  select v_task, u
  from (select distinct unnest(coalesce(p_owner_ids, '{}'::uuid[]) || array[v_me]) as u) x;

  insert into task_teams (task_id, team_id)
  select v_task, t
  from (select distinct unnest(coalesce(p_team_ids, '{}'::uuid[])) as t) x;

  return v_task;
end;
$$;

revoke all on function create_task_with_assignments(text, text, text, uuid, date, uuid[], uuid[]) from public, anon;
grant execute on function create_task_with_assignments(text, text, text, uuid, date, uuid[], uuid[]) to authenticated;

-- ===== 2. "הכנה ואישור" למי שאין לו הרשאת אישור =====
-- זהה ל-125, חוץ מהעצירה לפני האישור כשאין הרשאה.

create or replace function prepare_masav_batch(p_organization_id uuid, p_organization_bank_account_id uuid, p_period_month date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch uuid;
  v_valid integer;
  v_rejected integer;
  v_reasons text;
begin
  v_batch := create_masav_batch(p_organization_id, p_organization_bank_account_id, p_period_month);
  perform submit_masav_for_review(v_batch);
  perform run_masav_validation(v_batch);

  select count(*) filter (where status = 'valid'), count(*) filter (where status = 'rejected'),
         string_agg(distinct rejection_code, ' · ') filter (where status = 'rejected')
  into v_valid, v_rejected, v_reasons
  from masav_lines where batch_id = v_batch;

  if v_rejected > 0 or v_valid = 0 then
    return jsonb_build_object('batch_id', v_batch, 'status', 'pending_review', 'valid', v_valid, 'rejected', v_rejected,
      'message', v_rejected || ' שורות נפסלו בבדיקה (' || coalesce(v_reasons, '') || ') - האצווה נעצרה לפני האישור, לבדיקה.');
  end if;

  perform submit_masav_for_approval(v_batch);

  if not has_permission('masav', 'approve') then
    return jsonb_build_object('batch_id', v_batch, 'status', 'pending_approval', 'valid', v_valid, 'rejected', 0,
      'message', 'האצווה הוכנה ועברה את כל הבדיקות: ' || v_valid || ' תשלומים. היא ממתינה לאישור של מי שיש לו הרשאת אישור מס"ב.');
  end if;

  perform approve_masav_batch(v_batch);
  return jsonb_build_object('batch_id', v_batch, 'status', 'approved', 'valid', v_valid, 'rejected', 0,
    'message', 'האצווה הוכנה ואושרה: ' || v_valid || ' תשלומים. הצעד הבא - הפקת הקובץ ושידור לבנק, ידנית.');
end;
$$;
