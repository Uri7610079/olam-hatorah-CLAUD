-- שלב 15 (חלק ב'): אשף מעבר לנתוני אמת - יבוא קובץ אב (עמותות/סניפים/קבוצות/ראשי קבוצה)
-- על גבי מנוע היבוא הגנרי (שלב 5), בדיוק כמו כל דומיין קודם (ביקורות, בימות המשיח...):
-- פרופיל ייעודי + commit ספציפי-דומיין שקורא מ-import_rows.raw וכותב לטבלאות היעד.
-- אין מיפוי עמודות גרפי - כמו כל פרופיל אחר במערכת, שמות העמודות בקובץ חייבים להתאים
-- לשמות השדות המצופים (מתועד במסך עצמו), התאמה לפי שם כותרת בלבד.
--
-- find-or-create לכל רמה: עמותה לפי org_number (אם קיים) אחרת לפי legal_name מדויק;
-- סניף לפי (עמותה, talmud_branch_code); ראש קבוצה לפי (full_name, phone); קבוצה לפי
-- (סניף, name). לא נוצר כפול בתוך אותה הרצה כי כל שורה בודקת existence לפני insert.
-- לעולם לא is_demo=true - זו בכוונה אותה הפרדה מבנית בין אמת לדמו כמו create_demo_batch()
-- (052) בכיוון ההפוך: שם רק מדגים SECURITY DEFINER סגור יוצר דמו; כאן הפונקציה פשוט
-- לעולם לא נוגעת בדגל is_demo, כך שאין דרך "לערבב" - אין באג לתקן, זו תוצאה של המבנה עצמו.

insert into import_profiles (key, label_he, description) values
  ('master_data', 'יבוא קובץ אב (עמותות/סניפים/קבוצות/ראשי קבוצה)', 'עמודות מצופות: legal_name, org_number, contact_phone, contact_email, contact_address, talmud_branch_code, branch_internal_name, branch_address, group_name, group_leader_name, group_leader_phone. legal_name חובה בכל שורה.');

insert into permissions (resource, action, label_he) values
  ('master_data_import', 'perform', 'יבוא קובץ אב - עמותות/סניפים/קבוצות/ראשי קבוצה');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'master_data_import' and p.action = 'perform'
where r.key = 'system_admin';

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
  -- בדיקת סטטוס-אצווה מוקדמת (כמו commit_bank_import_batch, שלב 11) - נתפס בביקורת שלב
  -- 17, אותה סיבה בדיוק כמו commit_audit_attendance_batch (042).
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

    -- enforce_group_leader_transition() (010) חוסמת INSERT עם group_leader_id שאינו null
    -- ללא תנאי - קבוצה תמיד נוצרת בלי ראש קבוצה, ושיוך ראשון נעשה בנפרד (כמו
    -- reassign_group_leader() עצמה: שורת group_leader_assignments + UPDATE עם הדגל).
    -- נתפס בבדיקה חיה, לא בביקורת עצמית.
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

grant execute on function commit_master_data_import_batch(uuid) to authenticated;
