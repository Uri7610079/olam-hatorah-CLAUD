-- שיוך מרוכז של תלמידים שנדחו מדוח תלמוד בגלל חוסר שיוך
--
-- אחרי קליטת דוחות אוגוסט 2026 נשארו 48 תלמידים שקיימים במערכת אך אין
-- להם שיוך פעיל, ולכן הזכאות שלהם - 20,587.50 ש"ח - לא נזקפה. שיוך
-- ידני של 48 תלמידים אחד-אחד הוא עבודה שאיש לא יעשה עד הסוף.
--
-- מה אפשר לגזור אוטומטית ומה לא:
--
--   עמותה  - ידועה מהאצווה.
--   סניף   - מופיע בדוח עצמו (Textbox145), ולכן ידוע לכל תלמיד.
--   קבוצה  - *אינה* מופיעה בדוח בשום צורה. בדוח יש קוד לימוד (600),
--            ו-study_codes הוא טבלת תיאורים בלבד - אין ממנו דרך
--            לקבוצה. ברוב הסניפים יש כמה קבוצות (בסניף 01 של ברכת
--            אלימלך יש 28), אז אין כאן ניחוש סביר.
--
-- לכן הקבוצה נבחרת בידי אדם - אבל פעם אחת לכל סניף, לא לכל תלמיד.
-- 48 התלמידים מתפלגים על שישה סניפים בלבד, כך שהמשתמש מכריע שש
-- הכרעות ולא ארבעים ושמונה.

-- ===== מי חסר שיוך, ומה ידוע עליו =====
--
-- distinct on (s.id): תלמיד יכול להופיע בכמה שורות בדוח - בכמה קודי
-- לימוד, או בשני סניפים אחרי מעבר. נבחרת השורה בעלת הסכום הגבוה,
-- כלומר הסניף שבו הוא זכאי בפועל. זה אותו כלל שמנחה את איחוד השורות
-- בקליטה עצמה, ואי-עקביות בינו לבין כאן הייתה משייכת לסניף הישן.

create or replace view talmud_unassigned_students
with (security_invoker = true)
as
select distinct on (s.id)
  s.id as student_id,
  s.full_name,
  s.external_id,
  b.organization_id,
  o.legal_name as organization_name,
  btrim(ir.raw ->> 'סניף') as branch_code,
  br.id as branch_id,
  br.internal_name as branch_name,
  b.period_month,
  coalesce(nullif(regexp_replace(coalesce(ir.raw ->> 'סכום ברוטו', ''), '[^0-9.\-]', '', 'g'), '')::numeric, 0) as amount
from import_rows ir
join import_batches b on b.id = ir.batch_id and b.status = 'committed'
join import_profiles p on p.id = b.profile_id and p.key = 'talmud_eligibility'
join organizations o on o.id = b.organization_id
join students s
  on normalize_identity(s.external_id) = normalize_identity(ir.raw ->> 'מזהה תלמיד')
left join branches br
  on br.organization_id = b.organization_id
 and br.talmud_branch_code = btrim(ir.raw ->> 'סניף')
where ir.status = 'invalid'
  and not exists (
    select 1 from student_assignments sa
    where sa.student_id = s.id and sa.is_active = true
  )
order by s.id, coalesce(nullif(regexp_replace(coalesce(ir.raw ->> 'סכום ברוטו', ''), '[^0-9.\-]', '', 'g'), '')::numeric, 0) desc;

comment on view talmud_unassigned_students is
  'תלמידים שקיימים במערכת ונדחו מדוח תלמוד בגלל חוסר שיוך, עם הסניף שהדוח מייחס להם. ראה מיגרציה 103.';

grant select on talmud_unassigned_students to authenticated;

-- ===== השיוך עצמו =====
--
-- הקבוצה היא הפרמטר היחיד: הסניף נגזר ממנה והעמותה מהסניף, ולכן אי
-- אפשר ליצור כאן שיוך שאינו עקבי - למשל תלמיד לקבוצה של סניף אחד
-- ולעמותה של סניף אחר.

create or replace function bulk_assign_students(p_group_id uuid, p_student_ids uuid[])
returns table (assigned_count integer, skipped_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id uuid;
  v_org_id uuid;
  v_student_id uuid;
  v_assigned integer := 0;
  v_skipped integer := 0;
begin
  if not has_permission('students', 'manage') then
    raise exception 'permission denied';
  end if;

  select g.branch_id, br.organization_id into v_branch_id, v_org_id
  from groups g
  join branches br on br.id = g.branch_id
  where g.id = p_group_id and g.status = 'active';

  if v_branch_id is null then
    raise exception 'הקבוצה שנבחרה אינה קיימת או אינה פעילה';
  end if;

  foreach v_student_id in array coalesce(p_student_ids, '{}'::uuid[]) loop
    -- תלמיד שכבר שויך בינתיים - במסך אחר, או בלחיצה קודמת - מדולג
    -- בשקט. שני שיוכים פעילים לאותו תלמיד היו שוברים את הקליטה, שקוראת
    -- את הסניף מהשיוך הפעיל ומצפה לאחד בלבד.
    if exists (select 1 from student_assignments sa
               where sa.student_id = v_student_id and sa.is_active = true) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if not exists (select 1 from students s where s.id = v_student_id) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into student_assignments
      (student_id, organization_id, branch_id, group_id, start_date, is_active)
    values (v_student_id, v_org_id, v_branch_id, p_group_id, current_date, true);

    v_assigned := v_assigned + 1;
  end loop;

  perform insert_audit_event(
    'bulk_assign_students', 'groups', p_group_id::text,
    jsonb_build_object('assigned', v_assigned, 'skipped', v_skipped,
                       'requested', coalesce(array_length(p_student_ids, 1), 0))
  );

  return query select v_assigned, v_skipped;
end;
$$;

comment on function bulk_assign_students(uuid, uuid[]) is
  'משייך כמה תלמידים לקבוצה אחת. הסניף והעמותה נגזרים מהקבוצה. ראה מיגרציה 103.';

revoke execute on function bulk_assign_students(uuid, uuid[]) from public, anon;
grant execute on function bulk_assign_students(uuid, uuid[]) to authenticated;
