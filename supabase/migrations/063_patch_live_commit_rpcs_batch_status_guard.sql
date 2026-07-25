-- Patch לפרויקט החי - שלב 17 (Audit סופי): נתפס בביקורת traceability מול תנאי הקבלה
-- ("staging + commit טרנזקציוני מונעים אצווה חצי-קלוטה") - commit_master_data_import_batch
-- (054/059) ו-commit_audit_attendance_batch (042) הסתמכו רק על סינון שורות status='valid'
-- כדי למנוע עיבוד כפול, בלי בדיקת סטטוס-אצווה מוקדמת ומפורשת כמו commit_bank_import_batch
-- (036, שלב 11). בטוח פונקציונלית כפי שהיה (אין שורות valid שנשארות באצווה כבר-committed),
-- אבל פחות עקבי ופחות מפורש. שתי הפונקציות מתעדכנות להוסיף את אותה בדיקה. 042/054 עודכנו
-- בדיסק; זהו ה-patch לפרויקט הקיים - re-create מלא של שתי הפונקציות.

create or replace function commit_audit_attendance_batch(p_batch_id uuid, p_audit_id uuid)
returns table (matched_count integer, unmatched_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open_rows integer;
  v_row record;
  v_student_id uuid;
  v_group_id uuid;
  v_org_id uuid;
  v_ref text;
  v_recurring boolean;
  v_matched integer := 0;
  v_unmatched integer := 0;
  v_batch_status text;
begin
  if not has_permission('audits', 'import') then
    raise exception 'permission denied';
  end if;

  select organization_id into v_org_id from audits where id = p_audit_id;
  if v_org_id is null then
    raise exception 'אירוע ביקורת לא נמצא';
  end if;

  select status into v_batch_status from import_batches where id = p_batch_id;
  if v_batch_status is null then
    raise exception 'אצוות יבוא לא נמצאה';
  end if;
  if v_batch_status not in ('uploaded', 'previewed') then
    raise exception 'לא ניתן לקלוט אצווה בסטטוס %', v_batch_status;
  end if;

  select count(*) into v_open_rows from import_rows where batch_id = p_batch_id and status = 'needs_decision';
  if v_open_rows > 0 then
    raise exception 'לא ניתן לקלוט קובץ עם % שורות שטרם הוכרעו', v_open_rows;
  end if;

  for v_row in select * from import_rows where batch_id = p_batch_id and status = 'valid' loop
    begin
      v_ref := trim(v_row.raw ->> 'מזהה תלמיד');
      if v_ref is null or length(v_ref) = 0 then
        update import_rows set status = 'invalid', error_message = 'חסר מזהה תלמיד' where id = v_row.id;
        v_unmatched := v_unmatched + 1;
        continue;
      end if;

      select id into v_student_id from students where external_id = v_ref limit 1;
      v_group_id := null;
      if v_student_id is not null then
        select group_id into v_group_id from student_assignments
        where student_id = v_student_id and is_active = true
        order by start_date desc limit 1;
      end if;

      v_recurring := false;
      if v_student_id is not null then
        select exists(
          select 1 from audit_attendance aa join audits a on a.id = aa.audit_id
          where aa.student_id = v_student_id and a.organization_id = v_org_id and aa.audit_id <> p_audit_id
        ) into v_recurring;
      end if;

      insert into audit_attendance (audit_id, external_student_ref, student_id, group_id, is_recurring, source_batch_id, created_by)
      values (p_audit_id, v_ref, v_student_id, v_group_id, v_recurring, p_batch_id, auth.uid());

      update import_rows set status = 'committed' where id = v_row.id;
      v_matched := v_matched + 1;
    exception when others then
      update import_rows set status = 'invalid', error_message = 'שגיאה בעיבוד השורה: ' || sqlerrm where id = v_row.id;
      v_unmatched := v_unmatched + 1;
    end;
  end loop;

  update import_batches set
    valid_count = (select count(*) from import_rows where batch_id = p_batch_id and status in ('valid', 'committed')),
    needs_decision_count = (select count(*) from import_rows where batch_id = p_batch_id and status = 'needs_decision'),
    invalid_count = (select count(*) from import_rows where batch_id = p_batch_id and status = 'invalid')
  where id = p_batch_id;

  perform set_config('app.allow_batch_commit', 'true', true);
  update import_batches set status = 'committed', committed_at = now() where id = p_batch_id;

  perform set_config('app.allow_audit_complete', 'true', true);
  update audits set status = 'completed', source_batch_id = p_batch_id where id = p_audit_id;

  perform insert_audit_event(
    'commit_audit_attendance_batch', 'audits', p_audit_id::text,
    jsonb_build_object('batch_id', p_batch_id, 'matched', v_matched, 'unmatched', v_unmatched)
  );

  return query select v_matched, v_unmatched;
end;
$$;

create or replace function commit_master_data_import_batch(p_batch_id uuid)
returns table (
  created_organizations integer,
  created_branches integer,
  created_groups integer,
  created_group_leaders integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_open_rows integer;
  v_org_id uuid;
  v_branch_id uuid;
  v_leader_id uuid;
  v_group_id uuid;
  v_created_orgs integer := 0;
  v_created_branches integer := 0;
  v_created_groups integer := 0;
  v_created_leaders integer := 0;
  v_legal_name text;
  v_org_number text;
  v_branch_code text;
  v_branch_name text;
  v_group_name text;
  v_leader_name text;
  v_leader_phone text;
  v_batch_status text;
begin
  if not has_permission('master_data_import', 'perform') then
    raise exception 'permission denied';
  end if;

  select ib.status into v_batch_status
  from import_batches ib join import_profiles ip on ip.id = ib.profile_id
  where ib.id = p_batch_id and ip.key = 'master_data';
  if v_batch_status is null then
    raise exception 'האצווה אינה מפרופיל יבוא קובץ אב';
  end if;
  if v_batch_status not in ('uploaded', 'previewed') then
    raise exception 'לא ניתן לקלוט אצווה בסטטוס %', v_batch_status;
  end if;

  select count(*) into v_open_rows from import_rows where batch_id = p_batch_id and status = 'needs_decision';
  if v_open_rows > 0 then
    raise exception 'לא ניתן לקלוט אצווה עם % שורות שטרם הוכרעו ("דורש החלטה")', v_open_rows;
  end if;

  for v_row in select * from import_rows where batch_id = p_batch_id and status = 'valid' order by row_number loop
    v_legal_name := nullif(trim(v_row.raw->>'legal_name'), '');
    v_org_number := nullif(trim(v_row.raw->>'org_number'), '');
    v_branch_code := nullif(trim(v_row.raw->>'talmud_branch_code'), '');
    v_branch_name := nullif(trim(v_row.raw->>'branch_internal_name'), '');
    v_group_name := nullif(trim(v_row.raw->>'group_name'), '');
    v_leader_name := nullif(trim(v_row.raw->>'group_leader_name'), '');
    v_leader_phone := nullif(trim(v_row.raw->>'group_leader_phone'), '');

    if v_legal_name is null then
      update import_rows set status = 'committed' where id = v_row.id;
      continue;
    end if;

    v_org_id := null;
    if v_org_number is not null then
      select id into v_org_id from organizations where org_number = v_org_number limit 1;
    end if;
    if v_org_id is null then
      select id into v_org_id from organizations where legal_name = v_legal_name limit 1;
    end if;
    if v_org_id is null then
      insert into organizations (legal_name, org_number, contact_phone, contact_email, contact_address)
      values (
        v_legal_name, v_org_number,
        nullif(trim(v_row.raw->>'contact_phone'), ''), nullif(trim(v_row.raw->>'contact_email'), ''), nullif(trim(v_row.raw->>'contact_address'), '')
      )
      returning id into v_org_id;
      v_created_orgs := v_created_orgs + 1;
    end if;

    v_branch_id := null;
    if v_branch_code is not null then
      select id into v_branch_id from branches where organization_id = v_org_id and talmud_branch_code = v_branch_code;
      if v_branch_id is null then
        insert into branches (organization_id, talmud_branch_code, internal_name, address)
        values (v_org_id, v_branch_code, coalesce(v_branch_name, v_branch_code), nullif(trim(v_row.raw->>'branch_address'), ''))
        returning id into v_branch_id;
        v_created_branches := v_created_branches + 1;
      end if;
    end if;

    v_leader_id := null;
    if v_leader_name is not null then
      select id into v_leader_id from group_leaders where full_name = v_leader_name and coalesce(phone, '') = coalesce(v_leader_phone, '') limit 1;
      if v_leader_id is null then
        insert into group_leaders (full_name, phone) values (v_leader_name, v_leader_phone) returning id into v_leader_id;
        v_created_leaders := v_created_leaders + 1;
      end if;
    end if;

    if v_group_name is not null and v_branch_id is not null then
      select id into v_group_id from groups where branch_id = v_branch_id and name = v_group_name;
      if v_group_id is null then
        insert into groups (branch_id, name) values (v_branch_id, v_group_name) returning id into v_group_id;
        v_created_groups := v_created_groups + 1;
      end if;
      if v_leader_id is not null and not exists (select 1 from group_leader_assignments where group_id = v_group_id and is_active = true) then
        insert into group_leader_assignments (group_id, group_leader_id, start_date, is_active)
        values (v_group_id, v_leader_id, current_date, true);
        perform set_config('app.allow_group_leader_change', 'true', true);
        update groups set group_leader_id = v_leader_id where id = v_group_id;
      end if;
    end if;

    update import_rows set status = 'committed' where id = v_row.id;
  end loop;

  perform set_config('app.allow_batch_commit', 'true', true);
  update import_batches set status = 'committed', committed_at = now() where id = p_batch_id;

  perform insert_audit_event(
    'commit_master_data_import_batch', 'import_batches', p_batch_id::text,
    jsonb_build_object('created_organizations', v_created_orgs, 'created_branches', v_created_branches, 'created_groups', v_created_groups, 'created_group_leaders', v_created_leaders)
  );

  created_organizations := v_created_orgs;
  created_branches := v_created_branches;
  created_groups := v_created_groups;
  created_group_leaders := v_created_leaders;
  return next;
end;
$$;
