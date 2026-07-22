-- שלב 6: יבוא זכאות חודשית. משתמש בתשתית היבוא הגנרית משלב 5 (import_profiles/batches/
-- rows) לצורך Preview/staging, אבל מוסיף כאן commit ייעודי-דומיין שכותב בפועל ל-
-- monthly_eligibility ומתאים תלמידים לפי מזהה בלבד (לא לפי שם) - דרישה מפורשת באפיון.
--
-- פורמט הקובץ (שמות עמודות) הוא הנחה סבירה בלבד עד לקבלת דוגמת קובץ אמיתית מתלמוד -
-- ר' עמודות צפויות בהערת commit_eligibility_batch למטה ובממשק המשתמש.

create table monthly_eligibility (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id),
  organization_id uuid not null references organizations(id),
  branch_id uuid references branches(id),
  group_id uuid references groups(id),
  -- נשמר כ-1 בחודש, לנוחות שאילתה ואינדוקס - לא מייצג יום ספציפי.
  month date not null,
  gross_amount numeric(12, 2) not null,
  score_or_payment_type text,
  status text not null default 'active' check (status in ('active', 'superseded')),
  source_batch_id uuid references import_batches(id),
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger monthly_eligibility_set_updated_at
  before update on monthly_eligibility
  for each row execute function set_updated_at();

-- זכאות אחת "פעילה" לתלמיד/חודש; תיקון רטרואקטיבי (שלב 7) יוצר גרסה חדשה ומסמן את הקודמת
-- כ-superseded, לא דורס - לכן זו אינדקס חלקי (רק על status='active'), לא unique רגיל,
-- כדי לאפשר כמה גרסאות superseded היסטוריות לאותו תלמיד/חודש.
create unique index monthly_eligibility_active_unique on monthly_eligibility (student_id, month) where status = 'active';

create index monthly_eligibility_month_idx on monthly_eligibility (organization_id, month);
create index monthly_eligibility_student_idx on monthly_eligibility (student_id);

alter table monthly_eligibility enable row level security;

insert into permissions (resource, action, label_he) values
  ('talmud', 'import', 'יבוא דוחות זכאות ושגויים מתלמוד');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'talmud' and p.action = 'import'
where r.key in ('system_admin', 'operations_manager');

create policy monthly_eligibility_select on monthly_eligibility for select to authenticated
  using (has_permission('area_ops', 'access') or has_permission('area_finance', 'access'));

-- אין INSERT/UPDATE policy ללקוח - הדרך היחידה היא commit_eligibility_batch() (למטה).

create trigger monthly_eligibility_audit
  after insert or update on monthly_eligibility
  for each row execute function audit_table_change();

insert into import_profiles (key, label_he, description) values
  ('talmud_eligibility', 'דוח זכאות מתלמוד',
   'עמודות צפויות: מזהה תלמיד, סכום ברוטו, ניקוד/סוג תשלום (לא חובה). התאמה לפי מזהה בלבד.');

-- commit_eligibility_batch(): קוראת מ-import_rows (שכבר Preview-ה עברה עליהן דרך מרכז
-- היבוא הכללי), מתאימה תלמיד לפי מזהה, יוצרת/מעדכנת monthly_eligibility, ומעדכנת status
-- sent_to_talmud -> active. אינה נוגעת בשורות שכבר סומנו needs_decision/invalid - אלה
-- חייבות להיפתר במרכז היבוא קודם (אותו כלל כמו commit_import_batch הגנרי).
create or replace function commit_eligibility_batch(p_batch_id uuid, p_month date)
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

      -- לא נמצא תלמיד תואם - מסומן invalid (לא needs_decision): לא חוסם את סגירת
      -- האצווה, אותו עיקרון כמו שורה ריקה במנוע הגנרי (015). נשאר לבדיקה ידנית ב"שגוי".
      if v_student_id is null then
        update import_rows set status = 'invalid', error_message = 'לא נמצא תלמיד עם מזהה זה' where id = v_row.id;
        v_unmatched := v_unmatched + 1;
        continue;
      end if;

      declare
        v_branch_id uuid;
        v_group_id uuid;
        v_amount numeric(12, 2);
      begin
        select sa.branch_id, sa.group_id into v_branch_id, v_group_id
        from student_assignments sa where sa.student_id = v_student_id and sa.is_active = true limit 1;

        if v_branch_id is null then
          update import_rows set status = 'invalid', error_message = 'לתלמיד אין שיוך פעיל' where id = v_row.id;
          v_unmatched := v_unmatched + 1;
          continue;
        end if;

        v_amount := (regexp_replace(v_row.raw ->> 'סכום ברוטו', '[^0-9.\-]', '', 'g'))::numeric;

        -- זכאות קודמת לאותו תלמיד/חודש (אם קיימת מיבוא קודם) מסומנת superseded - לא נדרסת.
        update monthly_eligibility set status = 'superseded'
        where student_id = v_student_id and month = p_month and status = 'active';

        insert into monthly_eligibility (student_id, organization_id, branch_id, group_id, month, gross_amount, score_or_payment_type, source_batch_id)
        values (v_student_id, v_org_id, v_branch_id, v_group_id, p_month, v_amount, v_row.raw ->> 'ניקוד/סוג תשלום', p_batch_id);

        update import_rows set status = 'committed' where id = v_row.id;

        perform set_config('app.allow_student_status_change', 'true', true);
        update students set status = 'active' where id = v_student_id and status = 'sent_to_talmud';

        v_matched := v_matched + 1;
      exception when others then
        -- למשל סכום ברוטו לא ניתן לפרסור כמספר - לא מפילה את כל האצווה, רק את השורה הזו.
        update import_rows set status = 'invalid', error_message = 'שגיאה בעיבוד השורה: ' || sqlerrm where id = v_row.id;
        v_unmatched := v_unmatched + 1;
      end;
    end;
  end loop;

  -- import_batches_enforce_commit (013) חוסמת מעבר ל-committed בלי הדגל הזה - אותו
  -- טריגר שאמור להגן על commit_import_batch() הגנרי מגן גם על ה-commit הדומיין-ספציפי הזה.
  perform set_config('app.allow_batch_commit', 'true', true);
  update import_batches set status = 'committed', committed_at = now() where id = p_batch_id;

  perform insert_audit_event(
    'commit_eligibility_batch', 'import_batches', p_batch_id::text,
    jsonb_build_object('month', p_month, 'matched', v_matched, 'unmatched', v_unmatched)
  );

  return query select v_matched, v_unmatched;
end;
$$;

grant execute on function commit_eligibility_batch(uuid, date) to authenticated;
