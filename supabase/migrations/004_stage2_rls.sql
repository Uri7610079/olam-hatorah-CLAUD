-- שלב 2: RLS על כל טבלה מהשלב הזה. ברירת מחדל = אין policy = אין גישה בכלל.
-- אין policies ל-INSERT/UPDATE/DELETE על אף טבלה כאן - כל כתיבה עוברת דרך הפונקציות
-- ב-003 (security definer, עוקפות RLS) כדי שכל שינוי יתועד ב-audit ויעבור בדיקת הרשאה מרכזית אחת.

alter table roles enable row level security;
alter table permissions enable row level security;
alter table role_permissions enable row level security;
alter table profiles enable row level security;
alter table access_requests enable row level security;
alter table user_permissions enable row level security;
alter table audit_events enable row level security;

-- roles/permissions/role_permissions: קטלוג קריאה-בלבד לכל משתמש מאושר (לא רגיש, נחוץ ל-UI
-- כדי להציג שמות תפקידים/הרשאות). לא ניתן לעריכה מהלקוח בשלב זה - רק דרך migration חדש.
create policy roles_select_approved on roles for select to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and status = 'approved'));

create policy permissions_select_approved on permissions for select to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and status = 'approved'));

create policy role_permissions_select_approved on role_permissions for select to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and status = 'approved'));

-- profiles: כל משתמש רואה תמיד את השורה של עצמו, כולל כשהוא עדיין pending
-- (נדרש כדי שמסך "ממתין לאישור" יוכל להציג את הסטטוס). מי שיש לו users.manage רואה הכל.
create policy profiles_select_own on profiles for select to authenticated
  using (id = auth.uid());

create policy profiles_select_all_with_permission on profiles for select to authenticated
  using (has_permission('users', 'manage'));

-- access_requests: בעל הבקשה רואה את שלו; מי שיש לו users.manage רואה הכל (למסך אישור משתמשים).
create policy access_requests_select_own on access_requests for select to authenticated
  using (user_id = auth.uid());

create policy access_requests_select_all_with_permission on access_requests for select to authenticated
  using (has_permission('users', 'manage'));

-- user_permissions: בעל ההרשאה רואה את שלו (כדי להבין למה יש/אין לו גישה); מי שיש לו
-- users.manage רואה הכל.
create policy user_permissions_select_own on user_permissions for select to authenticated
  using (user_id = auth.uid());

create policy user_permissions_select_all_with_permission on user_permissions for select to authenticated
  using (has_permission('users', 'manage'));

-- audit_events: רק למי שיש לו audit.view. אין INSERT policy בכלל - כתיבה רק דרך insert_audit_event().
create policy audit_events_select_with_permission on audit_events for select to authenticated
  using (has_permission('audit', 'view'));
