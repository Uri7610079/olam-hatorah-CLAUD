-- שלב 13 (חלק ב'): רשימות בימות המשיח. צינור ייעודי (לא מנוע היבוא הגנרי) - כך גם
-- האפיון וגם תוכנית הפרומפטים קוראים לטבלאות בשם המפורש phone_list_imports/entries,
-- אותו מבנה בדיוק כמו bank_import_batches/rows (שלב 11): הלקוח מנתח ומעלה
-- (pending/duplicate/invalid נקבעים כבר בזמן הניתוח - תלויים רק בקובץ עצמו), וההתאמה
-- מול תלמידים פעילים (matched/extra) מתבצעת רק בשרת ב-commit, נגד הנתונים העדכניים.
-- "חסר" (תלמיד פעיל שלא הופיע בקובץ בכלל) אינו מאוחסן בשום שורה - זה נגזר, נשלף לפי
-- דרישה דרך get_phone_list_missing_students() (אותו עיקרון "לא לאחסן מה שאפשר לחשב"
-- כמו group_balances/bank_reconciliation_exceptions).

create table phone_list_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  file_path text not null,
  file_name text not null,
  file_hash text not null,
  row_count integer not null default 0,
  matched_count integer not null default 0,
  extra_count integer not null default 0,
  duplicate_count integer not null default 0,
  invalid_count integer not null default 0,
  status text not null default 'uploaded' check (status in ('uploaded', 'committed', 'rejected')),
  uploaded_by uuid references auth.users(id),
  rejected_reason text,
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  committed_at timestamptz,
  unique (file_hash)
);

create trigger phone_list_imports_set_updated_at
  before update on phone_list_imports
  for each row execute function set_updated_at();

create index phone_list_imports_org_idx on phone_list_imports (organization_id);

-- normalized_phone: ספרות בלבד (אותו נרמול בדיוק כמו students.phone_normalized בצד
-- לקוח - replace(/\D/g,'') - כדי ששתי הצדדים יושוו על אותה שפה. "נייד מול קווי" נשאר
-- כלל פתוח באפיון - אין כאן שום אימות פורמט/אורך, רק "יש ספרות בכלל או לא".
create table phone_list_entries (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references phone_list_imports(id) on delete cascade,
  row_number integer not null,
  raw_phone text,
  normalized_phone text,
  status text not null default 'pending' check (status in ('pending', 'matched', 'extra', 'duplicate', 'invalid')),
  matched_student_id uuid references students(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger phone_list_entries_set_updated_at
  before update on phone_list_entries
  for each row execute function set_updated_at();

create index phone_list_entries_import_idx on phone_list_entries (import_id);

insert into permissions (resource, action, label_he) values
  ('phone_lists', 'perform', 'יבוא והתאמת רשימות בימות המשיח');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'phone_lists' and p.action = 'perform'
where r.key in ('system_admin', 'operations_manager');

alter table phone_list_imports enable row level security;
alter table phone_list_entries enable row level security;

create policy phone_list_imports_select on phone_list_imports for select to authenticated
  using (has_permission('area_ops', 'access'));

create policy phone_list_imports_insert on phone_list_imports for insert to authenticated
  with check (has_permission('phone_lists', 'perform'));

create policy phone_list_imports_update on phone_list_imports for update to authenticated
  using (has_permission('phone_lists', 'perform'))
  with check (has_permission('phone_lists', 'perform'));

create policy phone_list_entries_select on phone_list_entries for select to authenticated
  using (has_permission('area_ops', 'access'));

create policy phone_list_entries_insert on phone_list_entries for insert to authenticated
  with check (has_permission('phone_lists', 'perform'));

create policy phone_list_entries_update on phone_list_entries for update to authenticated
  using (has_permission('phone_lists', 'perform'))
  with check (has_permission('phone_lists', 'perform'));

-- אותו עיקרון בדיוק כמו enforce_bank_import_batch_commit/row_commit (שלב 11): אצווה/שורה
-- חדשה לעולם לא נוצרת כבר "נקלטה"; מעבר לזה מותר רק דרך commit_phone_list_import().
create or replace function enforce_phone_list_import_commit()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'uploaded' then
      raise exception 'ייבוא רשימת טלפונים חדש תמיד נוצר בסטטוס "הועלה"';
    end if;
    return new;
  end if;

  if new.status = 'committed' and old.status is distinct from 'committed'
     and coalesce(current_setting('app.allow_phone_list_commit', true), '') <> 'true' then
    raise exception 'קליטת רשימת טלפונים מותרת רק דרך commit_phone_list_import()';
  end if;
  return new;
end;
$$;

create trigger phone_list_imports_enforce_commit
  before insert or update on phone_list_imports
  for each row execute function enforce_phone_list_import_commit();

create or replace function enforce_phone_list_entry_commit()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status in ('matched', 'extra') then
      raise exception 'שורת רשימת טלפונים חדשה לא יכולה להיווצר כבר מותאמת';
    end if;
    return new;
  end if;

  -- חוסמת גם שינוי סטטוס לתוך matched/extra וגם שינוי matched_student_id בעצמו (למשל
  -- על שורה שכבר matched) בלי הדגל - אחרת אפשר היה "לשייך מחדש" שורה מותאמת לתלמיד
  -- שרירותי בלי לעבור דרך ההתאמה האמיתית מול הנתונים העדכניים.
  if (new.status in ('matched', 'extra') and old.status is distinct from new.status
      or new.matched_student_id is distinct from old.matched_student_id)
     and coalesce(current_setting('app.allow_phone_list_commit', true), '') <> 'true' then
    raise exception 'התאמת רשימת טלפונים מותרת רק דרך commit_phone_list_import()';
  end if;
  return new;
end;
$$;

create trigger phone_list_entries_enforce_commit
  before insert or update on phone_list_entries
  for each row execute function enforce_phone_list_entry_commit();

create trigger phone_list_imports_audit
  after insert or update on phone_list_imports
  for each row execute function audit_table_change();

create trigger phone_list_entries_audit
  after insert or update on phone_list_entries
  for each row execute function audit_table_change();

-- bucket פרטי לקבצי רשימות בימות המשיח - אותו דפוס בדיוק כמו bank-import-files.
insert into storage.buckets (id, name, public)
values ('phone-list-files', 'phone-list-files', false)
on conflict (id) do nothing;

create policy phone_list_files_select on storage.objects for select to authenticated
  using (bucket_id = 'phone-list-files' and has_permission('phone_lists', 'perform'));

create policy phone_list_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'phone-list-files' and has_permission('phone_lists', 'perform'));

-- commit_phone_list_import(): ההתאמה האמיתית היחידה - לכל שורה "pending" מחפשת תלמיד
-- פעיל (active/active_with_error) באותה עמותה עם אותו טלפון מנורמל בדיוק. אם יש כמה
-- תלמידים עם אותו טלפון (טלפון בית משותף למשל) - מתאימה לראשון (לפי id), לא חוסמת.
create or replace function commit_phone_list_import(p_import_id uuid)
returns table (matched_count integer, extra_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_matched integer := 0;
  v_extra integer := 0;
begin
  if not has_permission('phone_lists', 'perform') then
    raise exception 'permission denied';
  end if;

  select organization_id into v_org_id from phone_list_imports where id = p_import_id;
  if v_org_id is null then
    raise exception 'ייבוא רשימת טלפונים לא נמצא';
  end if;

  perform set_config('app.allow_phone_list_commit', 'true', true);

  update phone_list_entries e set
    status = 'matched',
    matched_student_id = s.id
  from students s
  where e.import_id = p_import_id
    and e.status = 'pending'
    and s.phone_normalized = e.normalized_phone
    and s.status in ('active', 'active_with_error')
    and s.id = (
      select s2.id from students s2
      where s2.phone_normalized = e.normalized_phone and s2.status in ('active', 'active_with_error')
      order by s2.id limit 1
    );

  update phone_list_entries set status = 'extra' where import_id = p_import_id and status = 'pending';

  select count(*) into v_matched from phone_list_entries where import_id = p_import_id and status = 'matched';
  select count(*) into v_extra from phone_list_entries where import_id = p_import_id and status = 'extra';

  update phone_list_imports set
    matched_count = v_matched,
    extra_count = v_extra,
    status = 'committed',
    committed_at = now()
  where id = p_import_id;

  perform insert_audit_event('commit_phone_list_import', 'phone_list_imports', p_import_id::text, jsonb_build_object('matched', v_matched, 'extra', v_extra));

  return query select v_matched, v_extra;
end;
$$;

grant execute on function commit_phone_list_import(uuid) to authenticated;

-- get_phone_list_missing_students(): תלמידים פעילים בעמותה עם טלפון רשום שלא הופיע
-- באף שורה של הייבוא הזה - "חסר טלפון במערכת" הוא חריגה נפרדת (מרכז חריגות, שלב 14),
-- לא נכלל כאן כדי לא לערבב שתי בעיות שונות.
create or replace function get_phone_list_missing_students(p_import_id uuid)
returns table (student_id uuid, external_id text, full_name text, phone_normalized text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  if not has_permission('area_ops', 'access') then
    raise exception 'permission denied';
  end if;

  select organization_id into v_org_id from phone_list_imports where id = p_import_id;
  if v_org_id is null then
    raise exception 'ייבוא רשימת טלפונים לא נמצא';
  end if;

  return query
  select s.id, s.external_id, s.full_name, s.phone_normalized
  from students s
  join student_assignments sa on sa.student_id = s.id and sa.is_active = true
  where sa.organization_id = v_org_id
    and s.status in ('active', 'active_with_error')
    and s.phone_normalized is not null and length(s.phone_normalized) > 0
    and not exists (
      select 1 from phone_list_entries e where e.import_id = p_import_id and e.normalized_phone = s.phone_normalized
    )
  order by s.full_name;
end;
$$;

grant execute on function get_phone_list_missing_students(uuid) to authenticated;
