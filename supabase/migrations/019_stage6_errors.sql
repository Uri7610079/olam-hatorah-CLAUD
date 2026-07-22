-- שלב 6: יבוא דוח שגויים מתלמוד. כל סיבת אי-זכאות היא רשומה נפרדת (תלמיד יכול לקבל כמה
-- שגיאות באותו חודש - אין כאן ייחודיות תלמיד+חודש כמו בזכאות). "חוזרת" מסומן אוטומטית
-- אם אותו תלמיד+קוד הופיע גם בחודש הקודם.

create table talmud_errors (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id),
  -- נשמר גם כשלא נמצאה התאמה לתלמיד קיים, כדי לא לאבד את השורה המקורית.
  external_student_ref text,
  organization_id uuid not null references organizations(id),
  month date not null,
  error_code text not null,
  error_description text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'pending_info', 'closed')),
  assigned_to uuid references auth.users(id),
  is_recurring boolean not null default false,
  resolved_at timestamptz,
  source_batch_id uuid references import_batches(id),
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger talmud_errors_set_updated_at
  before update on talmud_errors
  for each row execute function set_updated_at();

create index talmud_errors_student_idx on talmud_errors (student_id);
create index talmud_errors_month_idx on talmud_errors (organization_id, month);
create index talmud_errors_status_idx on talmud_errors (status);

alter table talmud_errors enable row level security;

insert into permissions (resource, action, label_he) values
  ('talmud_errors', 'manage', 'עדכון סטטוס טיפול ואחראי לשגיאות תלמוד');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'talmud_errors' and p.action = 'manage'
where r.key in ('system_admin', 'operations_manager');

create policy talmud_errors_select on talmud_errors for select to authenticated
  using (has_permission('area_ops', 'access'));

-- במכוון אין כאן UPDATE policy ללקוח (בשונה ממה שנכתב בגרסה מוקדמת של הקובץ הזה):
-- policy גורף היה מתיר גם לשנות error_code/error_description/student_id ישירות, לא רק
-- status/assigned_to - בדיוק סוג הפער בין "הכוונה בהערה" למה שה-RLS בפועל מתיר שכבר
-- תוקן פעמיים בשלב 4 (011). resolve_talmud_error() (security definer) לא זקוקה ל-policy
-- כדי לפעול, וזו אכן הדרך היחידה לשנות status/assigned_to - ר' הערת התיעוד שם.

create trigger talmud_errors_audit
  after insert or update on talmud_errors
  for each row execute function audit_table_change();

insert into import_profiles (key, label_he, description) values
  ('talmud_errors', 'דוח שגויים מתלמוד', 'עמודות צפויות: מזהה תלמיד, קוד שגיאה, תיאור שגיאה (לא חובה).');

-- resolve_talmud_error(): הדרך היחידה לשנות סטטוס/אחראי - RPC ולא UPDATE ישיר, כדי שכל
-- שינוי יתועד באופן אחיד (גם דרך audit_table_change הגנרי, אבל זה נותן נקודת בקרה אחת).
create or replace function resolve_talmud_error(p_error_id uuid, p_status text, p_assigned_to uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('talmud_errors', 'manage') then
    raise exception 'permission denied';
  end if;
  if p_status not in ('open', 'in_progress', 'pending_info', 'closed') then
    raise exception 'invalid status: %', p_status;
  end if;

  update talmud_errors
  set status = p_status,
      assigned_to = coalesce(p_assigned_to, assigned_to),
      resolved_at = case when p_status = 'closed' then now() else null end
  where id = p_error_id;
end;
$$;

grant execute on function resolve_talmud_error(uuid, text, uuid) to authenticated;

-- commit_errors_batch(): כמו commit_eligibility_batch - מתאימה לפי מזהה, אבל שומרת גם
-- שורות ללא התאמה (external_student_ref, student_id=null) כי שגיאה על תלמיד לא-קיים
-- עדיין מידע רלוונטי לטיפול ידני. מסמנת is_recurring אם אותו תלמיד+קוד היה גם בחודש הקודם.
create or replace function commit_errors_batch(p_batch_id uuid, p_month date)
returns table (matched_count integer, unmatched_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open_rows integer;
  v_row record;
  v_student_id uuid;
  v_org_id uuid;
  v_code text;
  v_recurring boolean;
  v_matched integer := 0;
  v_unmatched integer := 0;
begin
  if not has_permission('talmud', 'import') then
    raise exception 'permission denied';
  end if;

  select count(*) into v_open_rows from import_rows where batch_id = p_batch_id and status = 'needs_decision';
  if v_open_rows > 0 then
    raise exception 'לא ניתן לקלוט אצווה עם % שורות שטרם הוכרעו במרכז היבוא', v_open_rows;
  end if;

  select organization_id into v_org_id from import_batches where id = p_batch_id;

  for v_row in select * from import_rows where batch_id = p_batch_id and status = 'valid' loop
    begin
      select id into v_student_id from students where external_id = trim(v_row.raw ->> 'מזהה תלמיד') limit 1;
      v_code := trim(v_row.raw ->> 'קוד שגיאה');

      if v_code is null or length(v_code) = 0 then
        update import_rows set status = 'invalid', error_message = 'חסר קוד שגיאה' where id = v_row.id;
        v_unmatched := v_unmatched + 1;
        continue;
      end if;

      v_recurring := false;
      if v_student_id is not null then
        select exists(
          select 1 from talmud_errors
          where student_id = v_student_id and error_code = v_code
            and month = (p_month - interval '1 month')::date
        ) into v_recurring;
      end if;

      insert into talmud_errors (student_id, external_student_ref, organization_id, month, error_code, error_description, is_recurring, source_batch_id)
      values (v_student_id, v_row.raw ->> 'מזהה תלמיד', v_org_id, p_month, v_code, v_row.raw ->> 'תיאור שגיאה', v_recurring, p_batch_id);

      update import_rows set status = 'committed' where id = v_row.id;

      if v_student_id is not null then
        perform set_config('app.allow_student_status_change', 'true', true);
        update students set status = 'active_with_error' where id = v_student_id and status = 'sent_to_talmud';
      end if;

      v_matched := v_matched + 1;
    exception when others then
      update import_rows set status = 'invalid', error_message = 'שגיאה בעיבוד השורה: ' || sqlerrm where id = v_row.id;
      v_unmatched := v_unmatched + 1;
    end;
  end loop;

  update import_batches set status = 'committed', committed_at = now() where id = p_batch_id;

  perform insert_audit_event(
    'commit_errors_batch', 'import_batches', p_batch_id::text,
    jsonb_build_object('month', p_month, 'matched', v_matched, 'unmatched', v_unmatched)
  );

  return query select v_matched, v_unmatched;
end;
$$;

grant execute on function commit_errors_batch(uuid, date) to authenticated;
