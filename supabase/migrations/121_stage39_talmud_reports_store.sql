-- שלב 39: קליטת דוחות תלמוד שאין להם עד היום מקום במערכת
--
-- מהמשיכה מתלמוד (118) יורדים גם שלושה דוחות חדשים. השיוך שאושר (חני, 2026-11-18):
--   תשלומים למוסד       → כספים: הסכום שתלמוד שילם לכל סניף וחודש, להתאמה מול הבנק
--   זכאות בעקבות בג"ץ   → כרטיס התלמיד: מושעה בג"ץ לכל חודש, ורשימה מרוכזת
--   הסבר תשלומים וקיזוזים → רטרו והפרשים: הפרשים וקיזוזים לכל חודש דיווח
-- (סיבות אי זכאות נכנסות למרכז השגיאות בקליטה הקיימת - שם אין צורך במבנה חדש.)
--
-- מבנה אחד לשלושתם: קליטה (קובץ) ושורות. כל שורה משויכת לעמותה, לחודש ולסניף,
-- ולתלמיד כשיש בה מספר זהות (אותה התאמה כמו בשאר המערכת - normalize_identity, 098).
-- השדות של כל דוח נשמרים ב-data כפי שפוענחו במסך (src/lib/talmudReports.ts).
-- קליטה חדשה לאותו דוח, עמותה וחודש מחליפה את הקודמת - תלמוד מעדכן דוחות.

create table if not exists talmud_report_imports (
  id uuid primary key default gen_random_uuid(),
  report_key text not null check (report_key in ('institute_payments', 'bagatz', 'payment_explanation')),
  organization_id uuid not null references organizations(id),
  month date not null,
  file_name text not null,
  file_hash text not null,
  row_count integer not null default 0,
  matched_count integer not null default 0,
  imported_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (report_key, organization_id, month)
);

create table if not exists talmud_report_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references talmud_report_imports(id) on delete cascade,
  report_key text not null,
  organization_id uuid not null references organizations(id),
  month date not null,
  branch_code text,
  external_id text,
  student_id uuid references students(id),
  data jsonb not null
);
create index if not exists talmud_report_rows_import_idx on talmud_report_rows (import_id);
create index if not exists talmud_report_rows_student_idx on talmud_report_rows (student_id, report_key, month desc);
create index if not exists talmud_report_rows_key_idx on talmud_report_rows (report_key, organization_id, month);

alter table talmud_report_imports enable row level security;
alter table talmud_report_rows enable row level security;

drop policy if exists talmud_report_imports_select on talmud_report_imports;
create policy talmud_report_imports_select on talmud_report_imports for select to authenticated
  using ((select has_permission('area_ops', 'access')));
drop policy if exists talmud_report_rows_select on talmud_report_rows;
create policy talmud_report_rows_select on talmud_report_rows for select to authenticated
  using ((select has_permission('area_ops', 'access')));

-- p_rows: [{branch_code, external_id, data}]. מחזיר: מזהה הקליטה, כמה שורות, כמה הותאמו לתלמיד.
create or replace function import_talmud_report(
  p_report_key text, p_organization_id uuid, p_month date, p_file_name text, p_file_hash text, p_rows jsonb
)
returns table (import_id uuid, row_count integer, matched_count integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_import uuid;
  v_month date := date_trunc('month', p_month)::date;
  v_rows integer;
  v_matched integer;
begin
  if not has_permission('talmud', 'import') then raise exception 'permission denied'; end if;
  if p_report_key not in ('institute_payments', 'bagatz', 'payment_explanation') then raise exception 'סוג דוח לא מוכר'; end if;
  if p_month is null then raise exception 'חסר חודש'; end if;
  if not exists (select 1 from organizations where id = p_organization_id) then raise exception 'העמותה לא נמצאה'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'אין שורות בקובץ'; end if;

  -- אותו דוח, עמותה וחודש: הקליטה החדשה מחליפה את הקודמת (השורות נמחקות איתה)
  delete from talmud_report_imports
  where report_key = p_report_key and organization_id = p_organization_id and month = v_month;

  insert into talmud_report_imports (report_key, organization_id, month, file_name, file_hash, imported_by)
  values (p_report_key, p_organization_id, v_month, p_file_name, p_file_hash, auth.uid())
  returning id into v_import;

  insert into talmud_report_rows (import_id, report_key, organization_id, month, branch_code, external_id, student_id, data)
  select v_import, p_report_key, p_organization_id, v_month,
         nullif(btrim(r ->> 'branch_code'), ''),
         nullif(btrim(r ->> 'external_id'), ''),
         (select s.id from students s
          where nullif(btrim(r ->> 'external_id'), '') is not null
            and normalize_identity(s.external_id) = normalize_identity(r ->> 'external_id')
          order by s.created_at limit 1),
         coalesce(r -> 'data', '{}'::jsonb)
  from jsonb_array_elements(p_rows) r;

  select count(*), count(student_id) into v_rows, v_matched from talmud_report_rows where import_id = v_import;
  update talmud_report_imports set row_count = v_rows, matched_count = v_matched where id = v_import;

  perform insert_audit_event('talmud_report_imported', 'talmud_report_imports', v_import::text,
    jsonb_build_object('report', p_report_key, 'month', v_month, 'rows', v_rows, 'matched', v_matched));
  return query select v_import, v_rows, v_matched;
end;
$$;

revoke execute on function import_talmud_report(text, uuid, date, text, text, jsonb) from public, anon;
grant execute on function import_talmud_report(text, uuid, date, text, text, jsonb) to authenticated;
