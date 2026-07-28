-- שלב 19 (המשך ליבה): רשימת משתמשים מינימלית לצורך שיוך (אחראים/צוותים/צופים).
--
-- הבעיה: RLS על profiles (004) מתיר לכל משתמש לראות רק את השורה שלו, ולמי שיש לו
-- users.manage לראות הכל. אבל שיוך משימה לאחראי דורש מכל משתמש עם גישה לאזור המשימות
-- לראות רשימת שמות של עמיתים - גם בלי users.manage. פונקציה זו חושפת תת-קבוצה מינימלית
-- ולא רגישה (id + full_name בלבד, לא email/status/role) למי שיש לו area_tasks.access,
-- בלי לפרוץ את ה-RLS הכללי של profiles עצמה.

create or replace function list_assignable_users()
returns table (id uuid, full_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not has_permission('area_tasks', 'access') then
    raise exception 'permission denied';
  end if;

  return query
    select p.id, coalesce(p.full_name, p.email, 'משתמש ללא שם')
    from profiles p
    where p.status = 'approved'
    order by p.full_name;
end;
$$;

grant execute on function list_assignable_users() to authenticated;
