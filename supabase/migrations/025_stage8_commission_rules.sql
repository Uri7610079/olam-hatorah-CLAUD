-- שלב 8 (חלק ב'): כללי עמלה. עריכת/סגירת כלל קיים לא פוגעת בהיסטוריה - ההגנה על תוצאות
-- שכבר חושבו היא ה-snapshot שנשמר ב-eligibility_financial_results (חלק ג'), לא נעילת
-- הכלל עצמו. לכן מותרת עריכה/UPDATE רגילה כאן, עם audit trigger.
--
-- הנחת עבודה מתועדת (לא כלל עסקי מהרשימה האסורה לקיבוע - זו מנגנון גנרי, לא ערך ספציפי):
-- calculation_type='combined' מחשב עמלה = (gross * percentage / 100) + fixed_amount.
-- אם יתברר שהצירוף הנכון שונה (למשל fixed קודם ואז אחוז על השארית), יש לתקן כאן בלבד -
-- שינוי לא ישפיע על eligibility_financial_results היסטוריים כי הם שומרים snapshot+תוצאה.

create table commission_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  -- כל שדה scope הוא null = "לא מגביל את הממד הזה". שילוב הממדים המוגדרים הוא ה-match.
  group_id uuid references groups(id),
  study_code text references study_codes(code),
  student_id uuid references students(id),
  calculation_type text not null check (calculation_type in ('percentage', 'fixed', 'combined')),
  percentage numeric(5, 2) check (percentage is null or (percentage >= 0 and percentage <= 100)),
  fixed_amount numeric(12, 2) check (fixed_amount is null or fixed_amount >= 0),
  rounding_rule text not null default 'none' check (rounding_rule in ('none', 'round_int', 'ceil_int', 'floor_int')),
  -- עדיפות מוגדרת ידנית - כאשר כמה כללים תואמים לאותו תאריך, המנצח הוא priority הגבוה
  -- ביותר (שובר שוויון: הכלל שנוצר מאוחר יותר). אין היררכיית "תלמיד תמיד מנצח קבוצה"
  -- מקובעת בקוד - זו בדיוק הסיבה שהאפיון ביקש שדה עדיפות מפורש.
  priority integer not null default 0,
  effective_from date not null,
  effective_until date,
  is_active boolean not null default true,
  notes text,
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references auth.users(id),
  check (effective_until is null or effective_until >= effective_from)
);

create trigger commission_rules_set_updated_at
  before update on commission_rules
  for each row execute function set_updated_at();

create index commission_rules_org_idx on commission_rules (organization_id, effective_from);
create index commission_rules_group_idx on commission_rules (group_id);
create index commission_rules_student_idx on commission_rules (student_id);

alter table commission_rules enable row level security;

insert into permissions (resource, action, label_he) values
  ('commission_rules', 'manage', 'יצירה/עריכה של כללי עמלה'),
  ('commission', 'calculate', 'הרצת חישוב עמלה חודשי');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource in ('commission_rules', 'commission') and p.action in ('manage', 'calculate')
where r.key in ('system_admin', 'operations_manager', 'finance_controller');

create policy commission_rules_select on commission_rules for select to authenticated
  using (has_permission('area_finance', 'access') or has_permission('area_ops', 'access'));

create policy commission_rules_insert on commission_rules for insert to authenticated
  with check (has_permission('commission_rules', 'manage'));

create policy commission_rules_update on commission_rules for update to authenticated
  using (has_permission('commission_rules', 'manage'))
  with check (has_permission('commission_rules', 'manage'));

create trigger commission_rules_audit
  after insert or update on commission_rules
  for each row execute function audit_table_change();

-- match_commission_rule(): מקום יחיד לבחירת הכלל התואם - נקרא גם מהתצוגה המקדימה
-- (preview_commission_calculation), גם מהחישוב הסופי (commit_commission_calculation) וגם
-- מהסימולציה (simulate_commission_rule), כדי שלא ייווצר פער לוגיקה בין preview לביצוע
-- בפועל (בדיוק סוג הבאג שתוקן כמה פעמים בשלב 6). security invoker (ברירת מחדל) - מכבדת
-- RLS על commission_rules כרגיל; אין לה הרשאות מוגברות משלה, ולכן EXECUTE נשלל מהציבור
-- ומוענק רק ל-RPCs הפנימיים דרך SECURITY DEFINER שלהם.
create or replace function match_commission_rule(
  p_organization_id uuid,
  p_group_id uuid,
  p_study_code text,
  p_student_id uuid,
  p_date date
)
returns commission_rules
language sql
stable
as $$
  select *
  from commission_rules
  where organization_id = p_organization_id
    and is_active = true
    and effective_from <= p_date
    and (effective_until is null or effective_until >= p_date)
    and (group_id is null or group_id = p_group_id)
    and (study_code is null or study_code = p_study_code)
    and (student_id is null or student_id = p_student_id)
  order by priority desc, created_at desc
  limit 1;
$$;

revoke execute on function match_commission_rule(uuid, uuid, text, uuid, date) from public, anon, authenticated;

-- compute_commission(): חישוב טהור, בלי גישה לטבלאות - p_rule.id is null = לא נמצא כלל
-- תואם. הוחלט (החלטה פתוחה מתועדת) שבמקרה כזה העמלה היא 0 והנטו = הברוטו במלואו,
-- כדי שחישוב חודשי לא ייחסם בשקט לקבוצה שעדיין ממתינה לאישור כלל עמלה - לא להמציא
-- ברירת מחדל של אחוז עמלה.
create or replace function compute_commission(p_rule commission_rules, p_gross numeric)
returns table (commission_amount numeric, net_amount numeric)
language plpgsql
immutable
as $$
declare
  v_commission numeric;
begin
  if p_rule.id is null then
    return query select 0::numeric(12, 2), round(p_gross, 2)::numeric(12, 2);
    return;
  end if;

  v_commission := case p_rule.calculation_type
    when 'percentage' then p_gross * coalesce(p_rule.percentage, 0) / 100
    when 'fixed' then coalesce(p_rule.fixed_amount, 0)
    when 'combined' then (p_gross * coalesce(p_rule.percentage, 0) / 100) + coalesce(p_rule.fixed_amount, 0)
    else 0
  end;

  v_commission := case p_rule.rounding_rule
    when 'round_int' then round(v_commission)
    when 'ceil_int' then ceil(v_commission)
    when 'floor_int' then floor(v_commission)
    else v_commission
  end;

  -- הגנת סנאטי (לא כלל עסקי): עמלה לעולם לא שלילית ולא גדולה מהברוטו עצמו.
  v_commission := greatest(0, least(v_commission, p_gross));

  return query select v_commission::numeric(12, 2), (p_gross - v_commission)::numeric(12, 2);
end;
$$;

revoke execute on function compute_commission(commission_rules, numeric) from public, anon, authenticated;

-- simulate_commission_rule(): "סימולציה לפני הפעלה" מהאפיון - מריצה את אותה match+compute
-- בלי לכתוב כלום, כדי לבדוק כלל לפני שהוא משפיע על חישוב אמיתי.
create or replace function simulate_commission_rule(
  p_organization_id uuid,
  p_group_id uuid,
  p_study_code text,
  p_student_id uuid,
  p_date date,
  p_gross_amount numeric
)
returns table (
  rule_id uuid,
  calculation_type text,
  percentage numeric,
  fixed_amount numeric,
  rounding_rule text,
  commission_amount numeric,
  net_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule commission_rules;
  v_commission numeric;
  v_net numeric;
begin
  if not has_permission('commission_rules', 'manage') then
    raise exception 'permission denied';
  end if;

  select * into v_rule from match_commission_rule(p_organization_id, p_group_id, p_study_code, p_student_id, p_date);
  select c.commission_amount, c.net_amount into v_commission, v_net from compute_commission(v_rule, p_gross_amount) c;

  return query select v_rule.id, v_rule.calculation_type, v_rule.percentage, v_rule.fixed_amount, v_rule.rounding_rule, v_commission, v_net;
end;
$$;

grant execute on function simulate_commission_rule(uuid, uuid, text, uuid, date, numeric) to authenticated;
