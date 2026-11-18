-- שלב 38ב: אישורי לימודים מתלמוד לרשימת תלמידים
--
-- במסך "משיכה מתלמוד" → "אישורי לימודים" מדביקים רשימת מספרי ת.ז. המערכת מוצאת
-- לכל תלמיד את העמותה שלו (השיוך הפעיל), נכנסת לתלמוד בשם כל עמותה (סיסמה
-- שמורה + SMS, כמו המשיכה החודשית), ומורידה לכל תלמיד את "הפקת אישורי לימודים"
-- כ-PDF. המסך שומר כל קובץ בתיקיית ההורדות ברגע שהוא מגיע.
--
-- נשען על 118: אותן טבלאות ואותו עובד. כאן רק התוספות.

-- ===== 1. שדות =====

alter table talmud_pull_jobs add column if not exists kind text not null default 'reports';
do $$ begin
  alter table talmud_pull_jobs add constraint talmud_pull_jobs_kind_check check (kind in ('reports', 'certificates'));
exception when duplicate_object then null; end $$;

-- התלמידים של העמותה במשיכת אישורים: [{external_id, name}]
alter table talmud_pull_job_orgs add column if not exists items jsonb;
-- תלמידים שלא נמצאו בתלמוד בעמותה הזו: [{external_id, name, reason}]
alter table talmud_pull_job_orgs add column if not exists item_errors jsonb not null default '[]'::jsonb;

alter table talmud_pulled_files add column if not exists student_external_id text;

-- ===== 2. אישורי לימודים =====

-- p_items: [{organization_id, external_id, name}]. מחזיר את מזהה המשיכה.
create or replace function talmud_start_certificates(p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job uuid;
  v_count integer;
  v_missing text;
begin
  if not has_permission('talmud', 'pull') then raise exception 'permission denied'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'הרשימה ריקה'; end if;
  if jsonb_array_length(p_items) > 300 then raise exception 'אפשר עד 300 תלמידים בבת אחת'; end if;
  if exists (select 1 from talmud_pull_jobs where status = 'active') then
    raise exception 'כבר מתבצעת משיכה. אפשר להמשיך אותה או לבטל אותה.';
  end if;

  select string_agg(distinct o.legal_name, ', ') into v_missing
  from jsonb_array_elements(p_items) i
  join organizations o on o.id = (i ->> 'organization_id')::uuid
  where not exists (select 1 from talmud_credentials c where c.organization_id = o.id);
  if v_missing is not null then
    raise exception 'אין משתמש תלמוד שמור לעמותה: %', v_missing;
  end if;

  insert into talmud_pull_jobs (month, requested_by, kind)
  values (date_trunc('month', current_date)::date, auth.uid(), 'certificates')
  returning id into v_job;

  insert into talmud_pull_job_orgs (job_id, organization_id, seq, items, files_total)
  select v_job, g.organization_id, row_number() over (order by o.legal_name), g.items, jsonb_array_length(g.items)
  from (
    select (i ->> 'organization_id')::uuid as organization_id,
           jsonb_agg(jsonb_build_object('external_id', btrim(i ->> 'external_id'), 'name', coalesce(i ->> 'name', ''))
                     order by i ->> 'name') as items
    from jsonb_array_elements(p_items) i
    where coalesce(btrim(i ->> 'external_id'), '') <> ''
    group by 1
  ) g
  join organizations o on o.id = g.organization_id;
  get diagnostics v_count = row_count;
  if v_count = 0 then raise exception 'הרשימה ריקה'; end if;

  perform insert_audit_event('talmud_certificates_started', 'talmud_pull_jobs', v_job::text,
    jsonb_build_object('students', jsonb_array_length(p_items), 'organizations', v_count));
  return v_job;
end;
$$;

-- תלמיד שלא נמצא בתלמוד בעמותה: נרשם, והתור מתקדם
create or replace function talmud_worker_item_failed(p_secret text, p_job_org_id uuid, p_external_id text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform talmud_worker_check(p_secret);
  update talmud_pull_job_orgs set
    files_done = files_done + 1,
    item_errors = item_errors || jsonb_build_array(jsonb_build_object(
      'external_id', p_external_id,
      'name', (select it ->> 'name' from jsonb_array_elements(items) it where it ->> 'external_id' = p_external_id limit 1),
      'reason', p_reason))
  where id = p_job_org_id;
end;
$$;

revoke execute on function talmud_start_certificates(jsonb) from public, anon;
grant execute on function talmud_start_certificates(jsonb) to authenticated;
revoke execute on function talmud_worker_item_failed(text, uuid, text, text) from public, authenticated;
grant execute on function talmud_worker_item_failed(text, uuid, text, text) to anon;

-- ===== 3. פונקציות של 118 שהשתנו (חוזרות כאן במלואן, עם התוספות) =====

drop function if exists talmud_worker_next(text);
create or replace function talmud_worker_next(p_secret text)
returns table (
  job_org_id uuid, job_id uuid, organization_id uuid, legal_name text, month date,
  username text, password_encrypted text, status text, worker_state text, files_done integer,
  kind text, items jsonb
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_row talmud_pull_job_orgs;
begin
  perform talmud_worker_check(p_secret);

  update talmud_pull_job_orgs
    set status = 'failed', sms_code = null, worker_state = null, finished_at = now(),
        message = 'הקוד לא הוקלד תוך 5 דקות. אפשר להתחיל משיכה חדשה.'
    where status = 'waiting_sms' and sms_code is null and sms_requested_at < now() - interval '5 minutes';

  -- עמותה באמצע - העובד ממשיך אותה. אם צעד אחר עובד עליה עכשיו - לא עושים כלום.
  select * into v_row from talmud_pull_job_orgs
  where status in ('logging_in', 'waiting_sms', 'downloading')
  order by started_at limit 1
  for update skip locked;

  if found then
    if v_row.worker_lock_until > now() then return; end if;
    -- מחכה לקוד שעוד לא הוקלד - אין מה לעשות
    if v_row.status = 'waiting_sms' and v_row.sms_code is null then return; end if;
    update talmud_pull_job_orgs set worker_lock_until = now() + interval '90 seconds' where id = v_row.id;
  elsif exists (select 1 from talmud_pull_job_orgs where status in ('logging_in', 'waiting_sms', 'downloading')) then
    return;
  else
    select jo.* into v_row from talmud_pull_job_orgs jo
    join talmud_pull_jobs j on j.id = jo.job_id and j.status = 'active'
    where jo.status = 'queued'
    order by j.created_at, jo.seq
    limit 1
    for update of jo skip locked;
    if not found then
      -- משיכות שכל העמותות שלהן הסתיימו
      update talmud_pull_jobs j set status = 'finished', finished_at = now()
      where j.status = 'active'
        and not exists (select 1 from talmud_pull_job_orgs jo where jo.job_id = j.id
                        and jo.status in ('queued', 'logging_in', 'waiting_sms', 'downloading'));
      return;
    end if;
    update talmud_pull_job_orgs
      set status = 'logging_in', started_at = now(), message = null, worker_lock_until = now() + interval '90 seconds'
    where id = v_row.id;
    v_row.status := 'logging_in';
  end if;

  return query
    select v_row.id, v_row.job_id, v_row.organization_id, o.legal_name, j.month,
           c.username, c.password_encrypted, v_row.status, v_row.worker_state, v_row.files_done,
           j.kind, v_row.items
    from talmud_pull_jobs j
    join organizations o on o.id = v_row.organization_id
    left join talmud_credentials c on c.organization_id = v_row.organization_id
    where j.id = v_row.job_id;
end;
$$;

drop function if exists talmud_pull_status(uuid);
create or replace function talmud_pull_status(p_job_id uuid default null)
returns table (
  job_id uuid,
  job_month date,
  job_status text,
  job_created_at timestamptz,
  job_org_id uuid,
  organization_id uuid,
  legal_name text,
  seq integer,
  status text,
  message text,
  sms_requested_at timestamptz,
  code_submitted boolean,
  files_total integer,
  files_done integer,
  finished_at timestamptz,
  job_kind text,
  item_errors jsonb
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_job uuid := p_job_id;
begin
  if not has_permission('talmud', 'pull') then raise exception 'permission denied'; end if;
  if v_job is null then
    select id into v_job from talmud_pull_jobs order by created_at desc limit 1;
  end if;
  return query
    select j.id, j.month, j.status, j.created_at, jo.id, jo.organization_id, o.legal_name, jo.seq,
           jo.status, jo.message, jo.sms_requested_at, jo.sms_code is not null, jo.files_total, jo.files_done, jo.finished_at,
           j.kind, jo.item_errors
    from talmud_pull_jobs j
    join talmud_pull_job_orgs jo on jo.job_id = j.id
    join organizations o on o.id = jo.organization_id
    where j.id = v_job
    order by jo.seq;
end;
$$;

drop function if exists talmud_worker_add_file(text, uuid, text, text, text, text, text);
create or replace function talmud_worker_add_file(
  p_secret text, p_job_org_id uuid, p_report_key text, p_report_label text,
  p_file_name text, p_file_type text, p_file_base64 text, p_student_external_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_jo talmud_pull_job_orgs;
  v_month date;
  v_data bytea := decode(p_file_base64, 'base64');
  v_hash text := encode(digest(v_data, 'sha256'), 'hex');
  v_new boolean := false;
begin
  perform talmud_worker_check(p_secret);
  select * into v_jo from talmud_pull_job_orgs where id = p_job_org_id;
  if not found then raise exception 'העמותה לא נמצאה במשיכה'; end if;
  select month into v_month from talmud_pull_jobs where id = v_jo.job_id;

  -- כפילות נבדקת רק בתוך אותה משיכה: אישור לימודים שמבקשים שוב צריך לרדת שוב.
  -- (קובץ דוח שכבר נקלט - נעצר בקליטה עצמה, לפי טביעת הקובץ ב-import_batches.)
  if not exists (select 1 from talmud_pulled_files where job_org_id = p_job_org_id and file_hash = v_hash) then
    insert into talmud_pulled_files (job_org_id, organization_id, report_key, report_label, month, file_name, file_type, file_hash, data, student_external_id)
    values (p_job_org_id, v_jo.organization_id, p_report_key, p_report_label, v_month, p_file_name, p_file_type, v_hash, v_data,
            nullif(btrim(p_student_external_id), ''));
    v_new := true;
  end if;
  update talmud_pull_job_orgs set files_done = files_done + 1 where id = p_job_org_id;
  return v_new;
end;
$$;

drop function if exists talmud_pulled_files_list(uuid);
create or replace function talmud_pulled_files_list(p_job_id uuid default null)
returns table (
  id uuid, job_id uuid, organization_id uuid, legal_name text, report_key text, report_label text,
  month date, file_name text, file_type text, file_hash text, size_bytes integer, created_at timestamptz,
  student_external_id text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not has_permission('talmud', 'pull') then raise exception 'permission denied'; end if;
  return query
    select f.id, jo.job_id, f.organization_id, o.legal_name, f.report_key, f.report_label,
           f.month, f.file_name, f.file_type, f.file_hash, octet_length(f.data), f.created_at,
           f.student_external_id
    from talmud_pulled_files f
    join talmud_pull_job_orgs jo on jo.id = f.job_org_id
    join organizations o on o.id = f.organization_id
    where p_job_id is null or jo.job_id = p_job_id
    order by f.created_at desc
    limit 500;
end;
$$;

revoke execute on function talmud_pull_status(uuid) from public, anon;
revoke execute on function talmud_pulled_files_list(uuid) from public, anon;
grant execute on function talmud_pull_status(uuid) to authenticated;
grant execute on function talmud_pulled_files_list(uuid) to authenticated;
grant execute on function talmud_worker_next(text) to anon;
grant execute on function talmud_worker_add_file(text, uuid, text, text, text, text, text, text) to anon;
