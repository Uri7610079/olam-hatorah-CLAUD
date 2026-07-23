-- שלב 9 (חלק ב'): הוראות חלוקה. חלוקה תמיד ברמת קבוצה אחת - שואבת מהיתרה המצרפית שלה
-- (group_balances, שלב 8), לא ממקור-כסף נפרד לכל סוג (source_type הוא תיוג תיאורי
-- בלבד לצורך תיעוד/סינון, לא מפריד "תת-יתרות" - הכסף בקבוצה הוא סכום אחד פונגיבילי).
--
-- period_month: לאיזה חודש כספי הוראת החלוקה הזו שייכת - נדרש כדי לאכוף
-- assert_financial_period_open (שלב 8) בדיוק כמו כל כתיבה כספית אחרת.
--
-- "אין שידור תשלום בשלב זה": אישור/נעילה כאן הם רק אימות+נעילת התוכנית - הם *לא*
-- יוצרים תנועת 'payment' בספר הקבוצה. תנועת ה-payment האמיתית תיווצר בשלב 10 כשמס"ב
-- אכן מוכן/משודר. במקום זאת, אישור בודק "יתרה זמינה" = יתרת הקבוצה בניכוי סכום כל
-- האצוות האחרות שכבר אושרו/ננעלו לאותה קבוצה וטרם שולמו - כך ששתי אצוות לא "יתחרו"
-- על אותו כסף בטעות. זו החלטת עבודה מתועדת, לא כלל עסקי מומצא - היא רק מוודאת
-- שהבדיקה ("בדיקת יתרה" באפיון) משקפת התחייבויות קיימות, לא רק את היתרה הגולמית.

create table distribution_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  group_id uuid not null references groups(id),
  period_month date not null,
  source_type text not null check (source_type in ('net_scholarships', 'donations', 'retro', 'combined')),
  method text not null check (method in ('equal', 'fixed_amounts', 'percentages', 'instruction_file', 'manual')),
  -- מכונת מצבים לפי האפיון: טיוטה -> בדיקה -> אישור -> נעולה להכנת מס"ב. superseded
  -- הוא מצב נוסף (לא באפיון המקורי, אבל נדרש טכנית) - מסמן אצווה מאושרת/נעולה שהוחלפה
  -- בגרסה חדשה (create_distribution_version), כדי שלא תיספר פעמיים בבדיקת יתרה זמינה.
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'locked_for_masav', 'superseded')),
  version integer not null default 1,
  supersedes_batch_id uuid references distribution_batches(id),
  notes text,
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references auth.users(id)
);

create trigger distribution_batches_set_updated_at
  before update on distribution_batches
  for each row execute function set_updated_at();

create index distribution_batches_group_idx on distribution_batches (group_id, status);
create index distribution_batches_org_month_idx on distribution_batches (organization_id, period_month);

-- סכום נגזר תמיד משורות בזמן שאילתה (לא נשמר כשדה - אותו עיקרון כמו monthly_quotas
-- בשלב 7, כדי לא ליצור עוד מקור-כפול-לאמת). כפילות תלמיד באותה אצווה חסומה מבנית
-- (unique), סכום אפס/שלילי חסום מבנית (check) - שתיים מתוך חמש הבדיקות באפיון נאכפות
-- כאן ולא רק ב-RPC.
create table distribution_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references distribution_batches(id),
  student_id uuid not null references students(id),
  amount numeric(12, 2) not null check (amount > 0),
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  unique (batch_id, student_id)
);

create index distribution_lines_batch_idx on distribution_lines (batch_id);
create index distribution_lines_student_idx on distribution_lines (student_id);

alter table distribution_batches enable row level security;
alter table distribution_lines enable row level security;

-- distributions.approve כבר קיים משלב 2 (001) - מוענק ל-finance_controller בלבד + system_admin,
-- הכרעה מכוונת שכבר נעשתה אז (אישור חלוקות כספיות הוא רגיש יותר מרישום/עריכת טיוטה).
-- לא מרחיב אותו עכשיו - רק מוסיף distributions.manage לעריכת טיוטות, ברמת ההרשאה
-- שכבר ניתנה לתפקידים המקבילים בשלבים 7-8.
insert into permissions (resource, action, label_he) values
  ('distributions', 'manage', 'יצירה ועריכת טיוטת הוראת חלוקה');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'distributions' and p.action = 'manage'
where r.key in ('system_admin', 'operations_manager', 'finance_controller');

create policy distribution_batches_select on distribution_batches for select to authenticated
  using (has_permission('area_finance', 'access') or has_permission('area_ops', 'access'));

create policy distribution_batches_insert on distribution_batches for insert to authenticated
  with check (has_permission('distributions', 'manage'));

create policy distribution_batches_update on distribution_batches for update to authenticated
  using (has_permission('distributions', 'manage'))
  with check (has_permission('distributions', 'manage'));

create policy distribution_lines_select on distribution_lines for select to authenticated
  using (has_permission('area_finance', 'access') or has_permission('area_ops', 'access'));

create policy distribution_lines_insert on distribution_lines for insert to authenticated
  with check (has_permission('distributions', 'manage'));

create policy distribution_lines_update on distribution_lines for update to authenticated
  using (has_permission('distributions', 'manage'))
  with check (has_permission('distributions', 'manage'));

create policy distribution_lines_delete on distribution_lines for delete to authenticated
  using (has_permission('distributions', 'manage'));

-- enforce_distribution_batch_mutation(): status מותר לשנות רק דרך ה-RPCs הייעודיים
-- למטה. פרטי הגדרה (סניף/עמותה/חודש/שיטה/מקור) ננעלים ברגע שיוצאים מטיוטה - "שינוי
-- לאחר אישור יוצר גרסה חדשה; אין עריכה שקטה" באפיון.
create or replace function enforce_distribution_batch_mutation()
returns trigger
language plpgsql
as $$
begin
  -- כמו אצל donations: בלי הבדיקה הזו, INSERT ישיר יכול היה ליצור אצווה שכבר
  -- "approved"/"locked_for_masav" מרגע הלידה - עוקף את כל בדיקות approve_distribution_batch
  -- (תלמיד לא פעיל, חשבון לא מאומת, יתרה זמינה). אצווה חדשה תמיד נולדת בטיוטה.
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'אצוות חלוקה חדשה תמיד נוצרת בטיוטה';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status
     and coalesce(current_setting('app.allow_distribution_status_change', true), '') <> 'true' then
    raise exception 'שינוי סטטוס אצוות חלוקה מותר רק דרך הגשה לבדיקה/אישור/נעילה/יצירת גרסה חדשה';
  end if;

  if old.status <> 'draft'
     and (new.organization_id is distinct from old.organization_id
       or new.group_id is distinct from old.group_id
       or new.period_month is distinct from old.period_month
       or new.method is distinct from old.method
       or new.source_type is distinct from old.source_type) then
    raise exception 'לא ניתן לערוך פרטי אצווה שאינה בטיוטה - שינוי דורש יצירת גרסה חדשה';
  end if;

  return new;
end;
$$;

create trigger distribution_batches_enforce_mutation
  before insert or update on distribution_batches
  for each row execute function enforce_distribution_batch_mutation();

-- enforce_distribution_lines_mutation(): שורות ניתנות לעריכה חופשית רק כשהאצווה בטיוטה.
create or replace function enforce_distribution_lines_mutation()
returns trigger
language plpgsql
as $$
declare
  v_batch_status text;
begin
  select status into v_batch_status from distribution_batches where id = coalesce(new.batch_id, old.batch_id);
  if v_batch_status is distinct from 'draft' then
    raise exception 'ניתן לערוך שורות חלוקה רק כאשר האצווה בטיוטה (סטטוס נוכחי: %)', v_batch_status;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger distribution_lines_enforce_mutation
  before insert or update or delete on distribution_lines
  for each row execute function enforce_distribution_lines_mutation();

create trigger distribution_batches_audit
  after insert or update on distribution_batches
  for each row execute function audit_table_change();

create trigger distribution_lines_audit
  after insert or update on distribution_lines
  for each row execute function audit_table_change();

-- submit_distribution_for_review(): טיוטה -> בדיקה. חוסם אצווה ריקה.
create or replace function submit_distribution_for_review(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_line_count integer;
begin
  if not has_permission('distributions', 'manage') then
    raise exception 'permission denied';
  end if;

  select status into v_status from distribution_batches where id = p_batch_id;
  if v_status is null then
    raise exception 'אצווה לא נמצאה';
  end if;
  if v_status <> 'draft' then
    raise exception 'ניתן להגיש לבדיקה רק אצווה בטיוטה (סטטוס נוכחי: %)', v_status;
  end if;

  select count(*) into v_line_count from distribution_lines where batch_id = p_batch_id;
  if v_line_count = 0 then
    raise exception 'לא ניתן להגיש אצווה ריקה לבדיקה';
  end if;

  perform set_config('app.allow_distribution_status_change', 'true', true);
  update distribution_batches set status = 'in_review' where id = p_batch_id;

  perform insert_audit_event('submit_distribution_for_review', 'distribution_batches', p_batch_id::text, null);
end;
$$;

grant execute on function submit_distribution_for_review(uuid) to authenticated;

-- approve_distribution_batch(): אוכפת בשרת (לא רק ב-UI) את חמש הבדיקות באפיון: תלמיד
-- לא פעיל, ללא חשבון מאומת, כפילות (unique constraint), סכום אפס (check constraint),
-- וסכום מעל היתרה הזמינה (יתרת קבוצה בניכוי אצוות אחרות שכבר אושרו/ננעלו לאותה קבוצה).
create or replace function approve_distribution_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch distribution_batches;
  v_total numeric;
  v_committed_elsewhere numeric;
  v_available numeric;
  v_balance numeric;
  v_inactive_count integer;
  v_unverified_count integer;
begin
  if not has_permission('distributions', 'approve') then
    raise exception 'permission denied';
  end if;

  select * into v_batch from distribution_batches where id = p_batch_id;
  if v_batch.id is null then
    raise exception 'אצווה לא נמצאה';
  end if;
  if v_batch.status <> 'in_review' then
    raise exception 'ניתן לאשר רק אצווה בבדיקה (סטטוס נוכחי: %)', v_batch.status;
  end if;

  perform assert_financial_period_open(v_batch.organization_id, v_batch.period_month);

  select count(*) into v_inactive_count
  from distribution_lines dl join students s on s.id = dl.student_id
  where dl.batch_id = p_batch_id and s.status = 'inactive';
  if v_inactive_count > 0 then
    raise exception 'לא ניתן לאשר: % שורות עם תלמיד לא פעיל', v_inactive_count;
  end if;

  select count(*) into v_unverified_count
  from distribution_lines dl
  where dl.batch_id = p_batch_id
    and not exists (
      select 1 from student_bank_accounts sba
      where sba.student_id = dl.student_id and sba.is_active = true and sba.verification_status = 'verified'
    );
  if v_unverified_count > 0 then
    raise exception 'לא ניתן לאשר: % שורות עם תלמיד ללא חשבון בנק מאומת', v_unverified_count;
  end if;

  select coalesce(sum(amount), 0) into v_total from distribution_lines where batch_id = p_batch_id;
  if v_total <= 0 then
    raise exception 'לא ניתן לאשר אצווה ללא שורות';
  end if;

  select balance into v_balance from group_balances where group_id = v_batch.group_id;
  v_balance := coalesce(v_balance, 0);

  select coalesce(sum(dl2.amount), 0) into v_committed_elsewhere
  from distribution_batches db2
  join distribution_lines dl2 on dl2.batch_id = db2.id
  where db2.group_id = v_batch.group_id
    and db2.id <> p_batch_id
    and db2.status in ('approved', 'locked_for_masav');

  v_available := v_balance - v_committed_elsewhere;

  if v_total > v_available then
    raise exception 'הסכום הכולל (%) חורג מהיתרה הזמינה לחלוקה (%) - יתרת קבוצה % בניכוי % שכבר הוקצו לאצוות מאושרות אחרות',
      v_total, v_available, v_balance, v_committed_elsewhere;
  end if;

  perform set_config('app.allow_distribution_status_change', 'true', true);
  update distribution_batches set status = 'approved' where id = p_batch_id;

  perform insert_audit_event('approve_distribution_batch', 'distribution_batches', p_batch_id::text, jsonb_build_object('total', v_total));
end;
$$;

grant execute on function approve_distribution_batch(uuid) to authenticated;

-- lock_distribution_for_masav(): הצעד הרביעי והאחרון בשלב הזה - "נעולה להכנת מס״ב".
-- שלב 10 יהיה זה שבפועל מכין/משדר תשלום ויוצר תנועת payment בספר הקבוצה.
create or replace function lock_distribution_for_masav(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not has_permission('distributions', 'approve') then
    raise exception 'permission denied';
  end if;

  select status into v_status from distribution_batches where id = p_batch_id;
  if v_status is null then
    raise exception 'אצווה לא נמצאה';
  end if;
  if v_status <> 'approved' then
    raise exception 'ניתן לנעול להכנת מס"ב רק אצווה מאושרת (סטטוס נוכחי: %)', v_status;
  end if;

  perform set_config('app.allow_distribution_status_change', 'true', true);
  update distribution_batches set status = 'locked_for_masav' where id = p_batch_id;

  perform insert_audit_event('lock_distribution_for_masav', 'distribution_batches', p_batch_id::text, null);
end;
$$;

grant execute on function lock_distribution_for_masav(uuid) to authenticated;

-- create_distribution_version(): "שינוי לאחר אישור יוצר גרסה חדשה; אין עריכה שקטה".
-- מעתיקה את האצווה+שורותיה לגרסה חדשה בטיוטה (ניתנת לעריכה חופשית עכשיו), ומסמנת את
-- הישנה כ-superseded (לא נמחקת - נשארת לביקורת, אך לא נספרת יותר ב"יתרה זמינה").
create or replace function create_distribution_version(p_batch_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old distribution_batches;
  v_new_id uuid;
begin
  if not has_permission('distributions', 'manage') then
    raise exception 'permission denied';
  end if;

  select * into v_old from distribution_batches where id = p_batch_id;
  if v_old.id is null then
    raise exception 'אצווה לא נמצאה';
  end if;
  if v_old.status not in ('approved', 'locked_for_masav') then
    raise exception 'ניתן ליצור גרסה חדשה רק מאצווה מאושרת או נעולה (סטטוס נוכחי: %)', v_old.status;
  end if;

  insert into distribution_batches (organization_id, group_id, period_month, source_type, method, status, version, supersedes_batch_id, notes, created_by)
  values (v_old.organization_id, v_old.group_id, v_old.period_month, v_old.source_type, v_old.method, 'draft', v_old.version + 1, v_old.id, v_old.notes, auth.uid())
  returning id into v_new_id;

  insert into distribution_lines (batch_id, student_id, amount)
  select v_new_id, student_id, amount from distribution_lines where batch_id = p_batch_id;

  perform set_config('app.allow_distribution_status_change', 'true', true);
  update distribution_batches set status = 'superseded' where id = p_batch_id;

  perform insert_audit_event('create_distribution_version', 'distribution_batches', p_batch_id::text, jsonb_build_object('new_batch_id', v_new_id));

  return v_new_id;
end;
$$;

grant execute on function create_distribution_version(uuid) to authenticated;
