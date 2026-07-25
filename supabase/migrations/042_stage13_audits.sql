-- שלב 13 (חלק א'): ביקורות משרד החינוך. אירוע ביקורת (עמותה+סניף+תאריך) + רשימת חסרים
-- שמיובאת דרך מנוע היבוא הגנרי (שלב 5, import_batches/import_rows) - בדיוק כמו שהאפיון
-- מבקש ("יבוא רשימת חסרים דרך מנוע היבוא"), לא צינור ייעודי כמו בנק (שלב 11). מתאים
-- לתלמיד לפי מזהה בזמן ה-commit (אותו דפוס בדיוק כמו commit_errors_batch, שלב 6) - לא
-- בזמן הסיווג הגנרי (classifyRows נשאר גנרי לגמרי, בלי היכרות עם דומיין).

create table audits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  branch_id uuid references branches(id),
  audit_date date not null,
  status text not null default 'draft' check (status in ('draft', 'completed')),
  source_batch_id uuid references import_batches(id),
  assigned_to uuid references auth.users(id),
  notes text,
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references auth.users(id)
);

create trigger audits_set_updated_at
  before update on audits
  for each row execute function set_updated_at();

create index audits_org_idx on audits (organization_id);

-- audit_attendance: שורה אחת לכל תלמיד שהופיע כ"חסר" בקובץ הביקורת. group_id הוא
-- תמונת-מצב של השיוך הפעיל של התלמיד ברגע ההתאמה (לא FK חי לצורך "השיוך הנוכחי") -
-- כי שיוך יכול להשתנות אחרי הביקורת וההיסטוריה צריכה לשקף את מצב הביקורת עצמה, לא את
-- ההווה. status נשאר "לא מותאם" (student_id null) עד שמישהו יקשר ידנית או שהמזהה יתוקן
-- ויובא מחדש - "לא מותאם נשאר להחלטה" באפיון.
create table audit_attendance (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audits(id),
  external_student_ref text,
  student_id uuid references students(id),
  group_id uuid references groups(id),
  status text not null default 'open' check (status in ('open', 'in_progress', 'pending_info', 'closed')),
  reason text,
  is_recurring boolean not null default false,
  resolved_at timestamptz,
  source_batch_id uuid references import_batches(id),
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references auth.users(id)
);

create trigger audit_attendance_set_updated_at
  before update on audit_attendance
  for each row execute function set_updated_at();

create index audit_attendance_audit_idx on audit_attendance (audit_id);
create index audit_attendance_student_idx on audit_attendance (student_id);

insert into permissions (resource, action, label_he) values
  ('audits', 'import', 'יבוא רשימות חסרים לביקורת'),
  ('audits', 'manage', 'ניהול אירועי ביקורת וטיפול בחוסרים');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'audits' and p.action in ('import', 'manage')
where r.key in ('system_admin', 'operations_manager');

alter table audits enable row level security;
alter table audit_attendance enable row level security;

create policy audits_select on audits for select to authenticated
  using (has_permission('area_ops', 'access'));

create policy audits_insert on audits for insert to authenticated
  with check (has_permission('audits', 'manage'));

create policy audits_update on audits for update to authenticated
  using (has_permission('audits', 'manage'))
  with check (has_permission('audits', 'manage'));

-- guard: אירוע ביקורת חדש תמיד נוצר "טיוטה" - "completed" מותר רק דרך
-- commit_audit_attendance_batch() (שחייבת קודם לוודא שהקובץ באמת נקלט). בלי הבדיקה הזו
-- INSERT/UPDATE ישיר יכול היה לסמן ביקורת כ"הושלמה" בלי שאף רשומת חוסר נקלטה בפועל -
-- אותה מחלקת באג בדיוק שכבר תוקנה 5 פעמים בשלבים קודמים (ר' README, שלב 034).
create or replace function enforce_audit_completion()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'אירוע ביקורת חדש תמיד נוצר בסטטוס "טיוטה"';
    end if;
    return new;
  end if;

  if new.status = 'completed' and old.status is distinct from 'completed'
     and coalesce(current_setting('app.allow_audit_complete', true), '') <> 'true' then
    raise exception 'סימון ביקורת כ"הושלמה" מותר רק דרך קליטת רשימת החסרים בפועל';
  end if;
  return new;
end;
$$;

create trigger audits_enforce_completion
  before insert or update on audits
  for each row execute function enforce_audit_completion();

create policy audit_attendance_select on audit_attendance for select to authenticated
  using (has_permission('area_ops', 'access'));

-- אין INSERT policy ל-audit_attendance - יצירה רק דרך commit_audit_attendance_batch()
-- (חייבת גם לחשב is_recurring וגם לסגור את אצוות היבוא בטרנזקציה אחת). UPDATE ישיר מותר
-- לשדות טיפול בלבד (status/reason) - הטריגר חוסם עריכת שיוך/תלמיד/is_recurring.
create policy audit_attendance_update on audit_attendance for update to authenticated
  using (has_permission('audits', 'manage'))
  with check (has_permission('audits', 'manage'));

create or replace function enforce_audit_attendance_mutation()
returns trigger
language plpgsql
as $$
begin
  if new.student_id is distinct from old.student_id
     or new.external_student_ref is distinct from old.external_student_ref
     or new.group_id is distinct from old.group_id
     or new.is_recurring is distinct from old.is_recurring
     or new.audit_id is distinct from old.audit_id then
    raise exception 'לא ניתן לערוך שיוך תלמיד/קבוצה של רשומת חוסר - ניתן לעדכן רק סטטוס טיפול/סיבה';
  end if;
  if new.status = 'closed' and old.status is distinct from 'closed' then
    new.resolved_at := now();
  end if;
  return new;
end;
$$;

create trigger audit_attendance_enforce_mutation
  before update on audit_attendance
  for each row execute function enforce_audit_attendance_mutation();

create trigger audits_audit
  after insert or update on audits
  for each row execute function audit_table_change();

create trigger audit_attendance_audit
  after insert or update on audit_attendance
  for each row execute function audit_table_change();

insert into import_profiles (key, label_he, description) values
  ('audit_attendance', 'רשימת חסרים לביקורת משרד החינוך', 'עמודה "מזהה תלמיד" חובה - כל שורה נוספת נשמרת כפרטי גולמי בלבד.');

-- commit_audit_attendance_batch(): כמו commit_errors_batch (שלב 6) - מתאימה לפי מזהה,
-- שומרת גם שורות ללא התאמה, מסמנת is_recurring אם לתלמיד יש כבר רשומת חוסר קודמת
-- (מביקורת אחרת) לאותה עמותה - לא סף שרירותי, "חוזר" פשוט אומר "קרה כבר לפני כן".
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

  -- בדיקת סטטוס-אצווה מוקדמת (כמו commit_bank_import_batch, שלב 11) - נתפס בביקורת
  -- שלב 17: הפונקציה הסתמכה עד עכשיו רק על סינון שורות status='valid' כדי למנוע קליטה
  -- כפולה, בלי בדיקה מפורשת שהאצווה עצמה לא כבר committed - בטוח בפועל (אין שורות valid
  -- שנשארות בכזו אצווה), אבל פחות עקבי/מפורש משאר ה-commit RPCs.
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

  -- import_batches_enforce_commit (013) חוסמת מעבר ל-committed בלי הדגל הזה.
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

grant execute on function commit_audit_attendance_batch(uuid, uuid) to authenticated;
