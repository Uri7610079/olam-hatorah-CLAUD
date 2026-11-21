-- 140: כללי עמלה - הכלל הספציפי מנצח, ושמירה של כלל חסר או שגוי נחסמת (ביקורת מסך כללי העמלה, 21.11).
--
-- 1. איזה כלל נבחר. עד היום: עדיפות, ואם שווה - הכלל שנוצר אחרון. ברירת המחדל של
--    העדיפות היא 0 לכולם, ולכן כלל "כל העמותה 10%" שנוצר אחרי חריג "קבוצה X 5%" דרס
--    את החריג - הקבוצה קיבלה 10%. מעכשיו, כשהעדיפות שווה, מנצח הכלל הספציפי יותר:
--    תלמיד, אחר כך קבוצה + קוד לימוד, אחר כך קבוצה או קוד לימוד, ובסוף כל העמותה.
--    עדיפות שנקבעה במפורש עדיין גוברת על הכול, כמו קודם.
--
-- 2. כלל שאי אפשר לחשב ממנו עמלה נחסם בשמירה, עם הסבר בעברית:
--    - "אחוז" בלי אחוז, "סכום קבוע" בלי סכום, "משולב" בלי שניהם (עד היום נשמר
--      בשקט והעמלה יצאה 0).
--    - קבוצה או תלמיד שאינם שייכים לעמותה של הכלל (עד היום נשמר, ולא חל על אף אחד).
--    - אחוז מעל 100 או סכום שלילי - אותה בדיקה שהייתה, עכשיו עם הודעה בעברית.
--    הבדיקה חלה על כלל חדש ועל שינוי כלל. כללים קיימים לא נבדקים ולא משתנים
--    (טריגר, לא אילוץ - כך גם כלל ישן חריג לא חוסם את המיגרציה).
--
-- שום נתון קיים לא משתנה.

-- ===== 1 =====
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
  order by priority desc,
           (case when student_id is not null then 4 else 0 end
            + case when group_id is not null then 2 else 0 end
            + case when study_code is not null then 1 else 0 end) desc,
           created_at desc
  limit 1;
$$;
revoke execute on function match_commission_rule(uuid, uuid, text, uuid, date) from public, anon, authenticated;

-- ===== 2 =====
create or replace function validate_commission_rule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.calculation_type = 'percentage' and new.percentage is null then
    raise exception 'בכלל מסוג "אחוז" צריך למלא את האחוז.';
  end if;
  if new.calculation_type = 'fixed' and new.fixed_amount is null then
    raise exception 'בכלל מסוג "סכום קבוע" צריך למלא את הסכום.';
  end if;
  if new.calculation_type = 'combined' and (new.percentage is null or new.fixed_amount is null) then
    raise exception 'בכלל מסוג "משולב" צריך למלא גם אחוז וגם סכום קבוע.';
  end if;
  if new.percentage is not null and (new.percentage < 0 or new.percentage > 100) then
    raise exception 'האחוז צריך להיות בין 0 ל-100.';
  end if;
  if new.fixed_amount is not null and new.fixed_amount < 0 then
    raise exception 'הסכום הקבוע לא יכול להיות שלילי.';
  end if;
  if new.effective_until is not null and new.effective_until < new.effective_from then
    raise exception 'תאריך הסיום של הכלל לא יכול להיות לפני תאריך ההתחלה.';
  end if;
  if new.group_id is not null and not exists (
    select 1 from groups g join branches b on b.id = g.branch_id
    where g.id = new.group_id and b.organization_id = new.organization_id
  ) then
    raise exception 'הקבוצה שנבחרה אינה שייכת לעמותה של הכלל.';
  end if;
  if new.student_id is not null and not exists (
    select 1 from student_assignments sa
    where sa.student_id = new.student_id and sa.organization_id = new.organization_id
  ) then
    raise exception 'התלמיד שנבחר אינו משויך לעמותה של הכלל.';
  end if;
  return new;
end;
$$;
revoke execute on function validate_commission_rule() from public, anon, authenticated;

drop trigger if exists commission_rules_validate on commission_rules;
create trigger commission_rules_validate
  before insert or update of calculation_type, percentage, fixed_amount, effective_from, effective_until, group_id, student_id, organization_id
  on commission_rules
  for each row execute function validate_commission_rule();
