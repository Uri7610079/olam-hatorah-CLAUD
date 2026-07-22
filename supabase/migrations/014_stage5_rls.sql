-- שלב 5: RLS על תשתית היבוא + bucket פרטי לקובצי מקור.

alter table import_profiles enable row level security;
alter table import_batches enable row level security;
alter table import_rows enable row level security;

create policy import_profiles_select on import_profiles for select to authenticated
  using (has_permission('area_ops', 'access') or has_permission('area_finance', 'access'));

create policy import_profiles_insert on import_profiles for insert to authenticated
  with check (has_permission('import_profiles', 'manage'));

create policy import_profiles_update on import_profiles for update to authenticated
  using (has_permission('import_profiles', 'manage'))
  with check (has_permission('import_profiles', 'manage'));

-- import_batches: כתיבה ישירה מהלקוח מותרת (הפרסור עצמו קורה בצד לקוח ולא מתאים
-- ל-RPC יחיד), אבל המעבר ל-status='committed' חסום בטריגר (013) חוץ מ-commit_import_batch().
create policy import_batches_select on import_batches for select to authenticated
  using (has_permission('import', 'perform'));

create policy import_batches_insert on import_batches for insert to authenticated
  with check (has_permission('import', 'perform'));

create policy import_batches_update on import_batches for update to authenticated
  using (has_permission('import', 'perform'))
  with check (has_permission('import', 'perform'));

create policy import_rows_select on import_rows for select to authenticated
  using (
    has_permission('import', 'perform')
    and exists (select 1 from import_batches b where b.id = batch_id)
  );

create policy import_rows_insert on import_rows for insert to authenticated
  with check (has_permission('import', 'perform'));

create policy import_rows_update on import_rows for update to authenticated
  using (has_permission('import', 'perform'))
  with check (has_permission('import', 'perform'));

insert into storage.buckets (id, name, public)
values ('import-files', 'import-files', false)
on conflict (id) do nothing;

create policy import_files_select on storage.objects for select to authenticated
  using (bucket_id = 'import-files' and has_permission('import', 'perform'));

create policy import_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'import-files' and has_permission('import', 'perform'));
