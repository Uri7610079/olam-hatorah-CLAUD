-- שלב 22 (המשך) - תיקוני אבטחה שנמצאו בביקורת ייעודית (subagent) על מודול המשימות
-- (065-070), לפני שהמודול נחשב גמור. כל התיקונים כאן הם patch על מיגרציות שכבר רצו
-- נגד הפרויקט החי - create or replace/revoke בלבד, בלי לגעת בקבצים 065-069 עצמם.

-- 1. generate_due_recurrences() (067) הייתה SECURITY DEFINER בלי revoke - כמו כל
-- שאר הפונקציות הפנימיות-בלבד במערכת (insert_audit_event וכו'), EXECUTE ניתן
-- ל-PUBLIC כברירת מחדל ב-Postgres. משמעות בפועל: כל authenticated (ואולי anon) יכול
-- היה לקרוא לה ישירות דרך REST ולכפות יצירת המופע הבא של כלל חזרה מוקדם, בלי
-- tasks.create/area_tasks.access - עוקף את ה-RLS הרגיל על tasks/task_owners/task_teams.
revoke execute on function generate_due_recurrences() from public, anon, authenticated;

-- 2. ingest_whatsapp_message() (069) שמרה attachment_url כטקסט חופשי בלי בדיקה - קישור
-- עם סכמה javascript: היה מוצג כ-<a href> ב-TasksWhatsAppScreen ומופעל בלחיצה (XSS
-- מאוחסן) בסשן של עובד המשרד שילחץ על "קובץ מצורף". כעת: רק http/https מתקבל, כל דבר
-- אחר מנוקה ל-null (לא חוסם את קליטת ההודעה כולה - רק את קישור הקובץ הבעייתי ספציפית).
create or replace function ingest_whatsapp_message(
  p_secret text,
  p_external_group_id text,
  p_source_message_id text,
  p_sender_name text,
  p_body text,
  p_attachment_url text default null,
  p_received_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stored_secret text;
  v_group_id uuid;
  v_message_id uuid;
  v_safe_attachment_url text;
begin
  select secret into v_stored_secret from whatsapp_webhook_config where id = true;
  if v_stored_secret is null or p_secret is distinct from v_stored_secret then
    raise exception 'invalid webhook secret';
  end if;

  select id into v_group_id from whatsapp_groups where external_group_id = p_external_group_id and is_active = true;
  if v_group_id is null then
    return null;
  end if;

  v_safe_attachment_url := case
    when p_attachment_url ~* '^https?://' then p_attachment_url
    else null
  end;

  insert into whatsapp_messages (group_id, source_message_id, sender_name, body, attachment_url, received_at)
  values (v_group_id, p_source_message_id, p_sender_name, p_body, v_safe_attachment_url, p_received_at)
  on conflict (group_id, source_message_id) do nothing
  returning id into v_message_id;

  if v_message_id is null then
    select id into v_message_id from whatsapp_messages where group_id = v_group_id and source_message_id = p_source_message_id;
  end if;

  return v_message_id;
end;
$$;

-- 3. convert_whatsapp_message_to_task() (069) שיוכה אחראים/צוותים ישירות (SECURITY
-- DEFINER, עוקף את ה-RLS הרגיל של task_owners/task_teams) תוך בדיקת tasks.convert_whatsapp
-- בלבד - בלי לוודא tasks.assign_users/assign_teams. לא נוצל בפועל (רק system_admin
-- מחזיק כרגע tasks.convert_whatsapp), אבל אם הרשאה זו תוקצה בעתיד למשתמש רגיל בלי
-- ההרשאות הנלוות, זו הייתה דרך לעקוף אותן. נוסף בדיקה מפורשת, תואמת ל-policy הרגיל.
create or replace function convert_whatsapp_message_to_task(
  p_message_id uuid,
  p_title text,
  p_description text,
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
  v_new_task_id uuid;
begin
  if not has_permission('tasks', 'convert_whatsapp') then
    raise exception 'permission denied';
  end if;

  if p_owner_ids is not null and array_length(p_owner_ids, 1) > 0 and not has_permission('tasks', 'assign_users') then
    raise exception 'permission denied: tasks.assign_users required to assign owners';
  end if;
  if p_team_ids is not null and array_length(p_team_ids, 1) > 0 and not has_permission('tasks', 'assign_teams') then
    raise exception 'permission denied: tasks.assign_teams required to assign teams';
  end if;

  insert into tasks (title, description, due_date, source, source_whatsapp_message_id, created_by)
  values (p_title, p_description, p_due_date, 'whatsapp', p_message_id, auth.uid())
  returning id into v_new_task_id;

  if p_owner_ids is not null and array_length(p_owner_ids, 1) > 0 then
    insert into task_owners (task_id, user_id) select v_new_task_id, unnest(p_owner_ids);
  end if;
  if p_team_ids is not null and array_length(p_team_ids, 1) > 0 then
    insert into task_teams (task_id, team_id) select v_new_task_id, unnest(p_team_ids);
  end if;

  update whatsapp_messages set status = 'converted', converted_task_id = v_new_task_id where id = p_message_id;

  insert into task_history (task_id, actor_id, event_type, detail)
  values (v_new_task_id, auth.uid(), 'converted_from_whatsapp', jsonb_build_object('whatsapp_message_id', p_message_id));

  return v_new_task_id;
end;
$$;

-- 4. Storage policy ל-task-attachments (065) בדקה רק area_tasks.access, לא את המשימה
-- הספציפית שמקודדת בנתיב הקובץ ({taskId}/...) - משתמש עם area_tasks.access יכול היה
-- להעלות קובץ תחת נתיב של משימה שהוא לא רואה (בזבוז אחסון, לא דליפת מידע - קריאה
-- עדיין חסומה ע"י המדיניות הקיימת שדורשת שורת task_attachments תואמת + can_view_task).
-- כעת נבדק can_edit_task על ה-UUID שבתחילת הנתיב, לפני ההעלאה.
drop policy if exists task_attachments_files_insert on storage.objects;

create policy task_attachments_files_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'task-attachments'
    and can_edit_task((split_part(storage.objects.name, '/', 1))::uuid)
  );
