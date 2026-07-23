-- שלב 8 (חלק ג'): תוצאות חישוב עמלה לפי זכאות, ספר תנועות קבוצות (append-only) ויתרות.
--
-- הנחת עבודה מתועדת (סימון סכומים ב-ledger, לא כלל עסקי): כל שורה נשמרת עם הסימן
-- (+/-) שכבר משקף את השפעתה בפועל על היתרה - מלגה נטו/תרומה/זיכוי/החזרה/תיקון-לטובה
-- נשמרים חיוביים, תשלום/חיוב/תיקון-לחובה נשמרים שליליים. כך group_balances הוא SUM
-- פשוט על העמודה, וכל שורה קריאה/ניתנת לביקורת בפני עצמה בלי צורך בפרשנות של entry_type.

create table eligibility_financial_results (
  id uuid primary key default gen_random_uuid(),
  eligibility_id uuid not null references monthly_eligibility(id),
  organization_id uuid not null references organizations(id),
  branch_id uuid references branches(id),
  group_id uuid references groups(id),
  student_id uuid not null references students(id),
  month date not null,
  gross_amount numeric(12, 2) not null,
  -- rule_id יכול להצביע לכלל שבינתיים נערך/נסגר - rule_snapshot הוא המקור האמיתי
  -- להיסטוריה (העתק מלא של שורת הכלל בזמן החישוב), rule_id הוא רק קישור נוח.
  rule_id uuid references commission_rules(id),
  rule_snapshot jsonb,
  commission_amount numeric(12, 2) not null default 0,
  net_amount numeric(12, 2) not null,
  calculation_detail jsonb,
  financial_period_id uuid references financial_periods(id),
  status text not null default 'active' check (status in ('active', 'superseded')),
  created_at timestamptz not null default now()
);

-- תוצאה פעילה אחת לכל זכאות; חישוב חוזר (אחרי תיקון גורם ל-gross שהשתנה, או כלל שהשתנה)
-- מסמן את הקודמת superseded ויוצר שורה חדשה - אותו דפוס בדיוק כמו monthly_eligibility עצמה.
create unique index eligibility_financial_results_active_unique on eligibility_financial_results (eligibility_id) where status = 'active';
create index eligibility_financial_results_group_idx on eligibility_financial_results (group_id, month);
create index eligibility_financial_results_org_month_idx on eligibility_financial_results (organization_id, month);

alter table eligibility_financial_results enable row level security;

create policy eligibility_financial_results_select on eligibility_financial_results for select to authenticated
  using (has_permission('area_finance', 'access') or has_permission('area_ops', 'access'));

-- אין INSERT/UPDATE policy ללקוח - הדרך היחידה היא commit_commission_calculation() למטה.

create trigger eligibility_financial_results_audit
  after insert or update on eligibility_financial_results
  for each row execute function audit_table_change();

create table group_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  group_id uuid not null references groups(id),
  entry_type text not null check (entry_type in ('net_scholarship', 'donation', 'credit', 'payment', 'refund', 'charge', 'correction')),
  amount numeric(12, 2) not null,
  period_month date,
  -- source_table/source_id: לא FK אמיתי (יכול להצביע לכמה טבלאות שונות לאורך השלבים
  -- הבאים - תרומות/מס"ב וכו') - רק תיעוד מקור לצורך ביקורת ומניעת כפילות.
  source_table text,
  source_id uuid,
  reference text,
  reason text,
  notes text,
  created_by uuid references auth.users(id),
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now()
);

-- מניעת יצירה כפולה מאותו מקור - הגנת-עומק בשכבת ה-DB, בנוסף לבדיקה בקוד ה-RPC עצמו
-- (commit_commission_calculation מדלג על מקור שלא השתנה מאז החישוב הקודם). מוגבל
-- במפורש ל-eligibility_financial_results בלבד: זה המקור היחיד שבו "מקור -> תנועה" הוא
-- 1:1 אמיתי (כל שורת תוצאה נוצרת פעם אחת בלבד, superseded לא נדרס). מקורות אחרים -
-- למשל תרומות משלב 9 - יכולים לגיטימית לייצר כמה תנועות באותו source_id לאורך חיי
-- הרשומה (פרסום ראשוני, ביטול עקב שינוי שיוך, פרסום מחדש) ומגינים על עצמם בדרך אחרת
-- (מכונת מצבים דרך RPC ייעודי), לא דרך unique index גורף (ר' 029 לתיקון החי).
create unique index group_ledger_entries_source_unique on group_ledger_entries (source_table, source_id)
  where source_table = 'eligibility_financial_results' and source_id is not null;
create index group_ledger_entries_group_idx on group_ledger_entries (group_id, created_at);
create index group_ledger_entries_org_month_idx on group_ledger_entries (organization_id, period_month);

-- append-only: אותו דפוס כמו audit_events (שלב 2) ו-payment_calculation_versions (שלב 7).
-- תיקון = שורה נגדית חדשה, לעולם לא עריכה/מחיקה של שורה קיימת.
create or replace function block_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'group_ledger_entries is append-only: % not allowed', tg_op;
end;
$$;

create trigger group_ledger_entries_no_update
  before update on group_ledger_entries
  for each row execute function block_ledger_mutation();

create trigger group_ledger_entries_no_delete
  before delete on group_ledger_entries
  for each row execute function block_ledger_mutation();

alter table group_ledger_entries enable row level security;

insert into permissions (resource, action, label_he) values
  ('ledger', 'correct', 'יצירת תנועת תיקון בספר התנועות');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'ledger' and p.action = 'correct'
where r.key in ('system_admin', 'operations_manager', 'finance_controller');

create policy group_ledger_entries_select on group_ledger_entries for select to authenticated
  using (has_permission('area_finance', 'access') or has_permission('area_ops', 'access'));

-- אין INSERT policy ללקוח בכלל - גם תנועת תיקון עוברת דרך create_ledger_correction()
-- (SECURITY DEFINER, בודקת הרשאה+סיבה בעצמה) ולא INSERT ישיר.

create trigger group_ledger_entries_audit
  after insert on group_ledger_entries
  for each row execute function audit_table_change();

-- group_balances: view מחושב, לא שדה לעריכה - בדיוק כמו monthly_quotas.registered_count/
-- eligible_count בשלב 7. security_invoker=true כדי לכבד RLS על group_ledger_entries.
create view group_balances
with (security_invoker = true)
as
select
  g.id as group_id,
  g.branch_id,
  b.organization_id,
  g.name as group_name,
  coalesce(sum(gle.amount), 0)::numeric(12, 2) as balance
from groups g
join branches b on b.id = g.branch_id
left join group_ledger_entries gle on gle.group_id = g.id
group by g.id, g.branch_id, b.organization_id, g.name;

grant select on group_balances to authenticated;

-- preview_commission_calculation(): קריאה בלבד, לא כותבת דבר - לכל זכאות פעילה באותו
-- עמותה/חודש, מריצה match+compute ומחזירה מה היה קורה, כולל דגל אם כבר חושבה בעבר.
create or replace function preview_commission_calculation(p_organization_id uuid, p_month date)
returns table (
  eligibility_id uuid,
  student_id uuid,
  student_external_id text,
  student_name text,
  group_id uuid,
  group_name text,
  gross_amount numeric,
  rule_id uuid,
  calculation_type text,
  commission_amount numeric,
  net_amount numeric,
  already_calculated boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('commission', 'calculate') then
    raise exception 'permission denied';
  end if;

  return query
  select
    me.id,
    s.id,
    s.external_id,
    s.full_name,
    me.group_id,
    g.name,
    me.gross_amount,
    r.id,
    r.calculation_type,
    c.commission_amount,
    c.net_amount,
    exists(select 1 from eligibility_financial_results efr where efr.eligibility_id = me.id and efr.status = 'active')
  from monthly_eligibility me
  join students s on s.id = me.student_id
  left join groups g on g.id = me.group_id
  cross join lateral match_commission_rule(p_organization_id, me.group_id, s.study_code, s.id, p_month) as r
  cross join lateral compute_commission(r, me.gross_amount) as c
  where me.organization_id = p_organization_id and me.month = p_month and me.status = 'active'
  order by g.name, s.full_name;
end;
$$;

grant execute on function preview_commission_calculation(uuid, date) to authenticated;

-- commit_commission_calculation(): הביצוע בפועל. דורש חודש כספי פתוח. עבור כל זכאות
-- פעילה: אם התוצאה זהה לתוצאה הפעילה הקודמת (אם קיימת) - מדלגת (אין יצירה כפולה).
-- אחרת מסמנת superseded, יוצרת eligibility_financial_results חדשה עם snapshot מלא של
-- הכלל, ומפרסמת לספר התנועות רק את ה-delta (הפרש מהתוצאה הקודמת) - כך שסכום כל
-- התנועות שפורסמו אי-פעם עבור הזכאות הזו תמיד שווה לנטו הנוכחי, גם אחרי כמה חישובים חוזרים.
create or replace function commit_commission_calculation(p_organization_id uuid, p_month date)
returns table (processed_count integer, total_commission numeric, total_net numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_id uuid;
  v_row record;
  v_processed integer := 0;
  v_total_commission numeric := 0;
  v_total_net numeric := 0;
begin
  if not has_permission('commission', 'calculate') then
    raise exception 'permission denied';
  end if;

  select id into v_period_id from financial_periods where organization_id = p_organization_id and month = p_month;
  perform assert_financial_period_open(p_organization_id, p_month);

  for v_row in
    select me.id as eligibility_id, me.group_id, me.branch_id, me.student_id, me.gross_amount, s.study_code
    from monthly_eligibility me
    join students s on s.id = me.student_id
    where me.organization_id = p_organization_id and me.month = p_month and me.status = 'active'
  loop
    -- בלוק declare מקונן משבט שורה חדש בכל איטרציה - קריטי כאן: v_prior_net נקרא דרך
    -- SELECT INTO שעשוי להחזיר 0 שורות (זכאות שטרם חושבה כלל), ו-SELECT INTO **לא**
    -- מאפס משתנה ל-NULL כשאין שורה תואמת - הוא פשוט משאיר את הערך הקודם. בלי הבלוק
    -- הזה, זכאות ללא תוצאה קודמת הייתה עלולה "לרשת" בטעות את v_prior_net מהתלמיד
    -- הקודם בלולאה. אותו דפוס הגנה בדיוק כמו commit_eligibility_batch (018).
    declare
      v_rule commission_rules;
      v_commission numeric;
      v_net numeric;
      v_result_id uuid;
      v_prior_net numeric;
      v_delta numeric;
    begin
      select * into v_rule from match_commission_rule(p_organization_id, v_row.group_id, v_row.study_code, v_row.student_id, p_month);
      select c.commission_amount, c.net_amount into v_commission, v_net from compute_commission(v_rule, v_row.gross_amount) c;

      select net_amount into v_prior_net from eligibility_financial_results where eligibility_id = v_row.eligibility_id and status = 'active';

      if v_prior_net is not distinct from v_net then
        continue;
      end if;

      update eligibility_financial_results set status = 'superseded' where eligibility_id = v_row.eligibility_id and status = 'active';

      insert into eligibility_financial_results (
        eligibility_id, organization_id, branch_id, group_id, student_id, month,
        gross_amount, rule_id, rule_snapshot, commission_amount, net_amount, calculation_detail, financial_period_id
      )
      values (
        v_row.eligibility_id, p_organization_id, v_row.branch_id, v_row.group_id, v_row.student_id, p_month,
        v_row.gross_amount, v_rule.id, to_jsonb(v_rule), v_commission, v_net,
        jsonb_build_object('gross', v_row.gross_amount, 'commission', v_commission, 'net', v_net),
        v_period_id
      )
      returning id into v_result_id;

      v_delta := v_net - coalesce(v_prior_net, 0);

      if v_row.group_id is not null and v_delta <> 0 then
        insert into group_ledger_entries (organization_id, group_id, entry_type, amount, period_month, source_table, source_id, reference, created_by)
        values (p_organization_id, v_row.group_id, 'net_scholarship', v_delta, p_month, 'eligibility_financial_results', v_result_id, 'חישוב עמלה חודשי', auth.uid());
      end if;

      v_processed := v_processed + 1;
      v_total_commission := v_total_commission + v_commission;
      v_total_net := v_total_net + v_net;
    end;
  end loop;

  perform insert_audit_event(
    'commit_commission_calculation', 'financial_periods', v_period_id::text,
    jsonb_build_object('organization_id', p_organization_id, 'month', p_month, 'processed', v_processed)
  );

  return query select v_processed, v_total_commission, v_total_net;
end;
$$;

grant execute on function commit_commission_calculation(uuid, date) to authenticated;

-- create_ledger_correction(): הדרך היחידה לתקן יתרה - תמיד תנועה נגדית עם סיבה, אף פעם
-- לא עריכה של שורה קיימת. דורשת גם היא חודש כספי פתוח (לחודש שאליו התיקון משויך).
create or replace function create_ledger_correction(
  p_organization_id uuid,
  p_group_id uuid,
  p_period_month date,
  p_amount numeric,
  p_reason text,
  p_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not has_permission('ledger', 'correct') then
    raise exception 'permission denied';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'נדרשת סיבה לתיקון';
  end if;

  if p_amount = 0 then
    raise exception 'סכום תיקון לא יכול להיות אפס';
  end if;

  perform assert_financial_period_open(p_organization_id, p_period_month);

  insert into group_ledger_entries (organization_id, group_id, entry_type, amount, period_month, reason, reference, created_by)
  values (p_organization_id, p_group_id, 'correction', p_amount, p_period_month, p_reason, p_reference, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function create_ledger_correction(uuid, uuid, date, numeric, text, text) to authenticated;
