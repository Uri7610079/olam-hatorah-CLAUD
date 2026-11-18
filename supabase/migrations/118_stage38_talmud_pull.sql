-- שלב 38: משיכה אוטומטית מאתר תלמוד (talmud.edu.gov.il)
--
-- המזכיר לוחץ "משיכת קבצים" במערכת. תוכנית על השרת ("העובד") נכנסת לתלמוד בשם
-- כל עמותה עם הסיסמה השמורה, תלמוד שולח SMS, המזכיר מקליד את הקוד בתיבה במסך,
-- והעובד מוריד את הדוחות. לכל עמותה בתלמוד שם משתמש וסיסמה משלה - ולכן כל
-- עמותה היא כניסה נפרדת ו-SMS נפרד, אחת אחרי השנייה.
--
-- הסיסמה מוצפנת כבר בדפדפן במפתח הציבורי של העובד (RSA-OAEP). במסד נשמר רק
-- הטקסט המוצפן, ורק העובד, שמחזיק את המפתח הפרטי, יכול לפתוח אותו. אין פונקציה
-- שמחזירה את הסיסמה למסך - גם לא המוצפנת.
--
-- העובד מדבר עם המסד כמו סנכרון הבנק (074): מפתח anon + סוד משותף שנבדק בכל
-- פונקציה. הסוד בטבלה בלי אף policy, ומוזן פעם אחת ב-SQL Editor.

-- ===== 1. הרשאה =====

insert into permissions (resource, action, label_he)
values ('talmud', 'pull', 'משיכת קבצים מתלמוד וניהול משתמשי תלמוד')
on conflict (resource, action) do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'talmud' and p.action = 'pull'
where r.key in ('system_admin', 'operations_manager')
on conflict do nothing;

-- ===== 2. טבלאות =====

create table if not exists talmud_worker_config (
  id boolean primary key default true,
  secret text not null,
  check (id)
);
alter table talmud_worker_config enable row level security;

-- שם משתמש וסיסמה לכל עמותה
create table if not exists talmud_credentials (
  organization_id uuid primary key references organizations(id),
  username text not null,
  password_encrypted text not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  last_login_ok_at timestamptz,
  last_login_error text
);
alter table talmud_credentials enable row level security;

create table if not exists talmud_pull_jobs (
  id uuid primary key default gen_random_uuid(),
  month date not null,
  requested_by uuid references auth.users(id),
  status text not null default 'active' check (status in ('active', 'finished', 'cancelled')),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table talmud_pull_jobs enable row level security;

-- עמותה בתוך משיכה. המצבים, לפי הסדר:
--   queued → logging_in → waiting_sms → downloading → done
--   ובכל שלב: failed (עם הסבר) או cancelled
create table if not exists talmud_pull_job_orgs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references talmud_pull_jobs(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  seq integer not null,
  status text not null default 'queued'
    check (status in ('queued', 'logging_in', 'waiting_sms', 'downloading', 'done', 'failed', 'cancelled')),
  message text,
  -- הקוד שהמזכיר הקליד. נמחק ברגע שהעובד לוקח אותו.
  sms_code text,
  sms_requested_at timestamptz,
  files_total integer,
  files_done integer not null default 0,
  -- החיבור הפתוח לתלמוד בין צעד לצעד (עוגיות וטופס), מוצפן בידי העובד. נמחק בסוף.
  worker_state text,
  -- צעד של העובד בעבודה. עד הזמן הזה אף צעד אחר לא נוגע בעמותה.
  worker_lock_until timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  unique (job_id, organization_id)
);
create index if not exists talmud_pull_job_orgs_job_idx on talmud_pull_job_orgs (job_id, seq);
create index if not exists talmud_pull_job_orgs_open_idx on talmud_pull_job_orgs (status)
  where status in ('queued', 'logging_in', 'waiting_sms', 'downloading');
alter table talmud_pull_job_orgs enable row level security;

create table if not exists talmud_pulled_files (
  id uuid primary key default gen_random_uuid(),
  job_org_id uuid not null references talmud_pull_job_orgs(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  report_key text not null,
  report_label text not null,
  month date,
  file_name text not null,
  file_type text,
  file_hash text not null,
  data bytea not null,
  created_at timestamptz not null default now()
);
create index if not exists talmud_pulled_files_job_org_idx on talmud_pulled_files (job_org_id);
create index if not exists talmud_pulled_files_hash_idx on talmud_pulled_files (file_hash);
alter table talmud_pulled_files enable row level security;

-- קריאה ישירה רק של המשיכות והקבצים (בלי תוכן הקובץ - ר' הפונקציה למטה).
-- את הקוד עצמו אין טעם להציג, וגם הוא נמחק אחרי שימוש.
drop policy if exists talmud_pull_jobs_select on talmud_pull_jobs;
create policy talmud_pull_jobs_select on talmud_pull_jobs for select to authenticated
  using ((select has_permission('talmud', 'pull')));

-- ===== 3. משתמשי תלמוד (המשרד) =====

create or replace function talmud_credentials_list()
returns table (
  organization_id uuid,
  legal_name text,
  username text,
  has_password boolean,
  updated_at timestamptz,
  last_login_ok_at timestamptz,
  last_login_error text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not has_permission('talmud', 'pull') then raise exception 'permission denied'; end if;
  return query
    select o.id, o.legal_name, c.username, c.password_encrypted is not null, c.updated_at, c.last_login_ok_at, c.last_login_error
    from organizations o
    left join talmud_credentials c on c.organization_id = o.id
    where o.status = 'active'
    order by o.legal_name;
end;
$$;

-- p_password_encrypted null = שומרים את הסיסמה הקיימת (רק שם המשתמש השתנה)
create or replace function talmud_set_credentials(p_organization_id uuid, p_username text, p_password_encrypted text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('talmud', 'pull') then raise exception 'permission denied'; end if;
  if coalesce(btrim(p_username), '') = '' then raise exception 'חסר שם משתמש'; end if;
  if not exists (select 1 from organizations where id = p_organization_id) then raise exception 'העמותה לא נמצאה'; end if;

  if p_password_encrypted is null then
    update talmud_credentials set username = btrim(p_username), updated_by = auth.uid(), updated_at = now()
    where organization_id = p_organization_id;
    if not found then raise exception 'חסרה סיסמה'; end if;
  else
    if length(p_password_encrypted) < 100 then raise exception 'הסיסמה לא הוצפנה כראוי'; end if;
    insert into talmud_credentials (organization_id, username, password_encrypted, updated_by, updated_at)
    values (p_organization_id, btrim(p_username), p_password_encrypted, auth.uid(), now())
    on conflict (organization_id) do update
      set username = excluded.username, password_encrypted = excluded.password_encrypted,
          updated_by = excluded.updated_by, updated_at = now(),
          last_login_ok_at = null, last_login_error = null;
  end if;

  -- ביומן בלי הסיסמה - גם לא המוצפנת
  perform insert_audit_event('talmud_credentials_set', 'talmud_credentials', p_organization_id::text,
    jsonb_build_object('username', btrim(p_username), 'password_changed', p_password_encrypted is not null));
end;
$$;

create or replace function talmud_delete_credentials(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('talmud', 'pull') then raise exception 'permission denied'; end if;
  delete from talmud_credentials where organization_id = p_organization_id;
  perform insert_audit_event('talmud_credentials_deleted', 'talmud_credentials', p_organization_id::text, null);
end;
$$;

-- ===== 4. משיכה (המשרד) =====

-- p_organization_ids null = כל העמותות שיש להן משתמש. מחזיר את מזהה המשיכה.
create or replace function talmud_start_pull(p_month date, p_organization_ids uuid[] default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job uuid;
  v_count integer;
begin
  if not has_permission('talmud', 'pull') then raise exception 'permission denied'; end if;
  if p_month is null then raise exception 'יש לבחור חודש'; end if;
  -- משיכה אחת בכל פעם: עמותה שמחכה ל-SMS לא תקבל שתי כניסות במקביל
  if exists (select 1 from talmud_pull_jobs where status = 'active') then
    raise exception 'כבר מתבצעת משיכה. אפשר להמשיך אותה או לבטל אותה.';
  end if;

  insert into talmud_pull_jobs (month, requested_by) values (date_trunc('month', p_month)::date, auth.uid())
  returning id into v_job;

  insert into talmud_pull_job_orgs (job_id, organization_id, seq)
  select v_job, c.organization_id, row_number() over (order by o.legal_name)
  from talmud_credentials c
  join organizations o on o.id = c.organization_id and o.status = 'active'
  where p_organization_ids is null or c.organization_id = any(p_organization_ids);
  get diagnostics v_count = row_count;
  if v_count = 0 then raise exception 'לאף אחת מהעמותות שנבחרו אין משתמש תלמוד שמור'; end if;

  perform insert_audit_event('talmud_pull_started', 'talmud_pull_jobs', v_job::text,
    jsonb_build_object('month', p_month, 'organizations', v_count));
  return v_job;
end;
$$;

-- מצב משיכה: המשיכה האחרונה (או זו שביקשו) וכל עמותה בה
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
  finished_at timestamptz
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
           jo.status, jo.message, jo.sms_requested_at, jo.sms_code is not null, jo.files_total, jo.files_done, jo.finished_at
    from talmud_pull_jobs j
    join talmud_pull_job_orgs jo on jo.job_id = j.id
    join organizations o on o.id = jo.organization_id
    where j.id = v_job
    order by jo.seq;
end;
$$;

create or replace function talmud_submit_sms(p_job_org_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := regexp_replace(coalesce(p_code, ''), '\s', '', 'g');
begin
  if not has_permission('talmud', 'pull') then raise exception 'permission denied'; end if;
  if v_code !~ '^[0-9]{4,8}$' then raise exception 'הקוד צריך להכיל 4 עד 8 ספרות'; end if;
  update talmud_pull_job_orgs set sms_code = v_code
  where id = p_job_org_id and status = 'waiting_sms';
  if not found then raise exception 'העמותה הזו כבר לא מחכה לקוד'; end if;
end;
$$;

create or replace function talmud_cancel_pull(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('talmud', 'pull') then raise exception 'permission denied'; end if;
  update talmud_pull_job_orgs
    set status = 'cancelled', sms_code = null, worker_state = null, finished_at = now(), message = 'בוטל במשרד'
    where job_id = p_job_id and status in ('queued', 'logging_in', 'waiting_sms', 'downloading');
  update talmud_pull_jobs set status = 'cancelled', finished_at = now() where id = p_job_id and status = 'active';
  perform insert_audit_event('talmud_pull_cancelled', 'talmud_pull_jobs', p_job_id::text, null);
end;
$$;

-- הקבצים שירדו (בלי התוכן), ותוכן קובץ אחד להורדה/קליטה
create or replace function talmud_pulled_files_list(p_job_id uuid default null)
returns table (
  id uuid, job_id uuid, organization_id uuid, legal_name text, report_key text, report_label text,
  month date, file_name text, file_type text, file_hash text, size_bytes integer, created_at timestamptz
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
           f.month, f.file_name, f.file_type, f.file_hash, octet_length(f.data), f.created_at
    from talmud_pulled_files f
    join talmud_pull_job_orgs jo on jo.id = f.job_org_id
    join organizations o on o.id = f.organization_id
    where p_job_id is null or jo.job_id = p_job_id
    order by f.created_at desc
    limit 500;
end;
$$;

create or replace function talmud_pulled_file(p_file_id uuid)
returns table (file_name text, file_type text, file_base64 text)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if not has_permission('talmud', 'pull') then raise exception 'permission denied'; end if;
  return query select f.file_name, f.file_type, encode(f.data, 'base64') from talmud_pulled_files f where f.id = p_file_id;
end;
$$;

-- ===== 5. העובד (מפתח anon + סוד) =====

create or replace function talmud_worker_check(p_secret text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select secret into v_secret from talmud_worker_config where id;
  if v_secret is null or p_secret is distinct from v_secret then raise exception 'unauthorized'; end if;
end;
$$;

-- העמותה הבאה לטיפול. עמותה אחת בכל פעם: כל עוד יש עמותה באמצע (כניסה, SMS,
-- הורדה) - לא מתחילים את הבאה. קוד שלא הגיע תוך 5 דקות - נכשל, וממשיכים.
create or replace function talmud_worker_next(p_secret text)
returns table (
  job_org_id uuid, job_id uuid, organization_id uuid, legal_name text, month date,
  username text, password_encrypted text, status text, worker_state text, files_done integer
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
           c.username, c.password_encrypted, v_row.status, v_row.worker_state, v_row.files_done
    from talmud_pull_jobs j
    join organizations o on o.id = v_row.organization_id
    left join talmud_credentials c on c.organization_id = v_row.organization_id
    where j.id = v_row.job_id;
end;
$$;

-- מעבר מצב, ושחרור הצעד. waiting_sms מאפס את הקוד ומתחיל את 5 הדקות.
-- p_state: החיבור הפתוח (מוצפן) להמשך; null = בלי שינוי. בסיום - נמחק.
create or replace function talmud_worker_update(
  p_secret text, p_job_org_id uuid, p_status text, p_message text default null, p_files_total integer default null,
  p_state text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  perform talmud_worker_check(p_secret);
  if p_status not in ('logging_in', 'waiting_sms', 'downloading', 'done', 'failed') then
    raise exception 'מצב לא מוכר: %', p_status;
  end if;

  update talmud_pull_job_orgs set
    status = p_status,
    message = p_message,
    files_total = coalesce(p_files_total, files_total),
    sms_code = case when p_status = 'waiting_sms' then null else sms_code end,
    sms_requested_at = case when p_status = 'waiting_sms' then now() else sms_requested_at end,
    worker_state = case when p_status in ('done', 'failed') then null else coalesce(p_state, worker_state) end,
    worker_lock_until = null,
    finished_at = case when p_status in ('done', 'failed') then now() else finished_at end
  where id = p_job_org_id and status not in ('done', 'failed', 'cancelled')
  returning organization_id into v_org;
  if not found then raise exception 'העמותה כבר לא בטיפול (בוטלה או הסתיימה)'; end if;

  -- מצב הכניסה האחרונה - מוצג במסך משתמשי תלמוד
  if p_status = 'downloading' then
    update talmud_credentials set last_login_ok_at = now(), last_login_error = null where organization_id = v_org;
  elsif p_status = 'failed' then
    update talmud_credentials set last_login_error = p_message where organization_id = v_org;
  end if;
end;
$$;

-- הקוד שהמזכיר הקליד. נמחק מהמסד באותה פעולה.
create or replace function talmud_worker_take_sms(p_secret text, p_job_org_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  perform talmud_worker_check(p_secret);
  update talmud_pull_job_orgs set sms_code = null
  where id = p_job_org_id and status = 'waiting_sms' and sms_code is not null
  returning (select sms_code from talmud_pull_job_orgs where id = p_job_org_id) into v_code;
  return v_code;
end;
$$;

-- קובץ שירד. אותו קובץ בדיוק (אותה טביעה) לאותה עמותה - לא נשמר פעמיים.
create or replace function talmud_worker_add_file(
  p_secret text, p_job_org_id uuid, p_report_key text, p_report_label text,
  p_file_name text, p_file_type text, p_file_base64 text
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

  if not exists (select 1 from talmud_pulled_files where organization_id = v_jo.organization_id and file_hash = v_hash) then
    insert into talmud_pulled_files (job_org_id, organization_id, report_key, report_label, month, file_name, file_type, file_hash, data)
    values (p_job_org_id, v_jo.organization_id, p_report_key, p_report_label, v_month, p_file_name, p_file_type, v_hash, v_data);
    v_new := true;
  end if;
  update talmud_pull_job_orgs set files_done = files_done + 1 where id = p_job_org_id;
  return v_new;
end;
$$;

-- ===== 6. מי יכול לקרוא למה =====

revoke execute on function talmud_credentials_list() from public, anon;
revoke execute on function talmud_set_credentials(uuid, text, text) from public, anon;
revoke execute on function talmud_delete_credentials(uuid) from public, anon;
revoke execute on function talmud_start_pull(date, uuid[]) from public, anon;
revoke execute on function talmud_pull_status(uuid) from public, anon;
revoke execute on function talmud_submit_sms(uuid, text) from public, anon;
revoke execute on function talmud_cancel_pull(uuid) from public, anon;
revoke execute on function talmud_pulled_files_list(uuid) from public, anon;
revoke execute on function talmud_pulled_file(uuid) from public, anon;
grant execute on function talmud_credentials_list() to authenticated;
grant execute on function talmud_set_credentials(uuid, text, text) to authenticated;
grant execute on function talmud_delete_credentials(uuid) to authenticated;
grant execute on function talmud_start_pull(date, uuid[]) to authenticated;
grant execute on function talmud_pull_status(uuid) to authenticated;
grant execute on function talmud_submit_sms(uuid, text) to authenticated;
grant execute on function talmud_cancel_pull(uuid) to authenticated;
grant execute on function talmud_pulled_files_list(uuid) to authenticated;
grant execute on function talmud_pulled_file(uuid) to authenticated;

-- העובד: anon + סוד. talmud_worker_check עצמה פנימית.
revoke execute on function talmud_worker_check(text) from public, anon, authenticated;
grant execute on function talmud_worker_next(text) to anon;
grant execute on function talmud_worker_update(text, uuid, text, text, integer, text) to anon;
grant execute on function talmud_worker_take_sms(text, uuid) to anon;
grant execute on function talmud_worker_add_file(text, uuid, text, text, text, text, text) to anon;
