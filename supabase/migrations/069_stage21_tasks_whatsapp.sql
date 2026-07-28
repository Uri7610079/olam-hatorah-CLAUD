-- שלב 21: מודול "ניהול משימות" - קליטת הודעות מ-WhatsApp.
-- מקור: אפיון V2 §15, TASKS_MODULE_PLAN.md.
--
-- הבהרה חשובה: בסביבת הפיתוח הזו אין Supabase CLI/Docker (ר' README.md, שורה 3) ולכן
-- לא ניתן לפרוס Edge Function מכאן. הפתרון: ingest_whatsapp_message() היא פונקציית SQL
-- רגילה, קריאה ישירות דרך ה-REST API האוטומטי של Supabase (POST ל-
-- /rest/v1/rpc/ingest_whatsapp_message עם מפתח ה-anon), בלי צורך ב-Edge Function בכלל.
-- הפונקציה מקבלת שדות כבר מנורמלים (לא JSON גולמי של ספק ספציפי) - כשתיבחר הספק
-- (Twilio/Meta Cloud API/360dialog וכו', סעיף 22 באפיון - עדיין החלטה פתוחה), ההדרכה
-- הבאה תהיה כיצד למפות בדיוק את ה-Webhook של אותו ספק לקריאה הזו (למשל דרך Zapier/Make,
-- או Edge Function אם וכשיהיה CLI זמין) - זו הסיבה שהשלב הזה נבנה ללא תלות בספק ספציפי.
--
-- אבטחה: קריאה ל-ingest_whatsapp_message() לא עוברת דרך משתמש מחובר (זהו Webhook חיצוני
-- אנונימי) - ה-RLS הרגיל לא רלוונטי כאן. הגנה: secret משותף בטבלה נעולה לחלוטין
-- (whatsapp_webhook_config, בלי אף policy - לא ניתנת לקריאה אפילו ע"י authenticated),
-- שנבדק בתוך הפונקציה עצמה (SECURITY DEFINER). רק קבוצות שכבר אושרו/חוברות ידנית
-- (whatsapp_groups, is_active=true) מתקבלות - הודעה מקבוצה לא מוכרת נזרקת בשקט.

create table whatsapp_groups (
  id uuid primary key default gen_random_uuid(),
  provider text,
  external_group_id text not null unique,
  label text not null,
  team_id uuid references teams(id),
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references whatsapp_groups(id) on delete cascade,
  source_message_id text not null,
  sender_name text,
  sender_external_id text,
  body text,
  attachment_url text,
  received_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'converted', 'not_a_task')),
  converted_task_id uuid references tasks(id),
  created_at timestamptz not null default now(),
  unique (group_id, source_message_id)
);

create index whatsapp_messages_status_idx on whatsapp_messages (status);

-- הושלמה זיקת "מקור המשימה" שנפתחה בשלב 18 (tasks.source='whatsapp') - עכשיו יש
-- לאן להצביע.
alter table tasks add column source_whatsapp_message_id uuid references whatsapp_messages(id);

create table whatsapp_webhook_config (
  id boolean primary key default true,
  secret text not null,
  check (id)
);
-- RLS מופעל בלי אף policy = deny-all מוחלט, גם ל-authenticated. רק SECURITY DEFINER
-- (בעל הטבלה) קורא/כותב. הערך עצמו מוזן ע"י Chani דרך SQL Editor (insert/update ידני),
-- לא דרך שום מסך באפליקציה.
alter table whatsapp_webhook_config enable row level security;

alter table whatsapp_groups enable row level security;
alter table whatsapp_messages enable row level security;

create policy whatsapp_groups_select on whatsapp_groups for select to authenticated using (has_permission('area_tasks', 'access'));
create policy whatsapp_groups_manage on whatsapp_groups for all to authenticated
  using (has_permission('tasks', 'manage_whatsapp'))
  with check (has_permission('tasks', 'manage_whatsapp'));

-- תיבת הסיווג נראית רק למי שיכול לפעול עליה (להמיר/לנהל) או שיש לו view_all - לא לכל
-- מי שיש לו גישה כללית לאזור, כי היא עשויה להכיל תוכן שיחה גולמי לפני סינון.
create policy whatsapp_messages_select on whatsapp_messages for select to authenticated
  using (has_permission('tasks', 'convert_whatsapp') or has_permission('tasks', 'manage_whatsapp') or has_permission('tasks', 'view_all'));

create policy whatsapp_messages_update on whatsapp_messages for update to authenticated
  using (has_permission('tasks', 'convert_whatsapp'))
  with check (has_permission('tasks', 'convert_whatsapp'));

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
begin
  select secret into v_stored_secret from whatsapp_webhook_config where id = true;
  if v_stored_secret is null or p_secret is distinct from v_stored_secret then
    raise exception 'invalid webhook secret';
  end if;

  select id into v_group_id from whatsapp_groups where external_group_id = p_external_group_id and is_active = true;
  if v_group_id is null then
    -- קבוצה לא מאושרת/לא פעילה - נזרק בשקט, לא שגיאה (ה-Webhook לא אמור להיכשל בגלל זה).
    return null;
  end if;

  insert into whatsapp_messages (group_id, source_message_id, sender_name, body, attachment_url, received_at)
  values (v_group_id, p_source_message_id, p_sender_name, p_body, p_attachment_url, p_received_at)
  on conflict (group_id, source_message_id) do nothing
  returning id into v_message_id;

  if v_message_id is null then
    select id into v_message_id from whatsapp_messages where group_id = v_group_id and source_message_id = p_source_message_id;
  end if;

  return v_message_id;
end;
$$;

-- anon בכוונה - זהו Webhook חיצוני אנונימי, לא קריאה ממשתמש מחובר. ההגנה היא ה-secret
-- שנבדק בפנים, לא הרשאת REST הכללית.
grant execute on function ingest_whatsapp_message(text, text, text, text, text, text, timestamptz) to anon, authenticated;

create or replace function mark_whatsapp_message_not_a_task(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('tasks', 'convert_whatsapp') then
    raise exception 'permission denied';
  end if;
  update whatsapp_messages set status = 'not_a_task' where id = p_message_id;
end;
$$;

grant execute on function mark_whatsapp_message_not_a_task(uuid) to authenticated;

-- המרה למשימה - טרנזקציה אחת: יצירת המשימה, שיוך אחראים/צוותים, סימון ההודעה כ-converted,
-- ורישום 'converted_from_whatsapp' ב-task_history (סוג האירוע כבר הוגדר בשלב 18, לא נוצל עד עכשיו).
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

grant execute on function convert_whatsapp_message_to_task(uuid, text, text, date, uuid[], uuid[]) to authenticated;

create trigger whatsapp_groups_audit after insert or update on whatsapp_groups for each row execute function audit_table_change();
