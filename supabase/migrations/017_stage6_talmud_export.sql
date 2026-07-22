-- שלב 6: יצוא תלמידים לתלמוד. פורמט הקובץ (סדר/שמות עמודות) הוא טיוטה עדיין - התבנית
-- המאושרת בפועל של תלמוד/מרכבה טרם התקבלה (ר' יומן ההחלטות/נושאים פתוחים באפיון).
-- מסומן בבירור בממשק כטיוטה, לא כפורמט סופי.

create table export_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  branch_id uuid references branches(id),
  group_id uuid references groups(id),
  period_start date not null,
  period_end date not null,
  file_path text not null,
  file_name text not null,
  file_hash text not null,
  student_count integer not null default 0,
  exported_by uuid references auth.users(id),
  is_override boolean not null default false,
  override_reason text,
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger export_batches_set_updated_at
  before update on export_batches
  for each row execute function set_updated_at();

create index export_batches_org_idx on export_batches (organization_id);

-- מי כלול באיזו אצווה - משמש למניעת יצוא כפול בטעות (בדיקה: התלמיד כבר הופיע באצווה קודמת).
create table export_batch_students (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references export_batches(id) on delete cascade,
  student_id uuid not null references students(id),
  created_at timestamptz not null default now(),
  unique (batch_id, student_id)
);

create index export_batch_students_student_idx on export_batch_students (student_id);

alter table export_batches enable row level security;
alter table export_batch_students enable row level security;

insert into permissions (resource, action, label_he) values
  ('talmud', 'export', 'יצוא תלמידים לתלמוד');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'talmud' and p.action = 'export'
where r.key in ('system_admin', 'operations_manager');

create policy export_batches_select on export_batches for select to authenticated
  using (has_permission('area_ops', 'access'));

create policy export_batch_students_select on export_batch_students for select to authenticated
  using (has_permission('area_ops', 'access'));

-- אין INSERT/UPDATE policy ללקוח - הדרך היחידה היא create_talmud_export() (security definer).

insert into storage.buckets (id, name, public)
values ('talmud-exports', 'talmud-exports', false)
on conflict (id) do nothing;

create policy talmud_exports_select on storage.objects for select to authenticated
  using (bucket_id = 'talmud-exports' and has_permission('talmud', 'export'));

create policy talmud_exports_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'talmud-exports' and has_permission('talmud', 'export'));

-- create_talmud_export(): נקודת הכניסה היחידה ליצוא. בודקת (אלא אם override) שאף אחד
-- מהתלמידים המבוקשים לא כבר הופיע באצווה קודמת - "מניעת יצוא חוזר בטעות". מעבירה כל
-- תלמיד ready_for_talmud -> sent_to_talmud (guard trigger קיים כבר אוכף שרק כאן).
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

grant execute on function create_talmud_export(uuid, uuid, uuid, date, date, uuid[], text, text, text, boolean, text) to authenticated;
