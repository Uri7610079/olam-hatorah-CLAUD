-- שלב 13 (חלק ג'): מסמכי עמותה. document_type נשאר טקסט חופשי (לא רשימה סגורה) - סוגי
-- המסמכים הרלוונטיים לכל עמותה משתנים ולא הוגדרו במפורש באפיון, זו החלטה עסקית פתוחה
-- ולא הומצאה כאן. תוקף/התראות תפוגה מחושבים תמיד בזמן תצוגה (תאריך היום מול expiry_date)
-- ולא מאוחסנים כ-status - אותו עיקרון "לא לאחסן מה שאפשר לחשב" שכבר חוזר לאורך הפרויקט
-- (בדיוק כדי להימנע מבאג ה-drift שכבר תוקן פעמיים בספירות אצוות יבוא, 020/021).
-- "מסמכים רגישים מופרדים ומוגנים" - is_sensitive + הרשאת view_sensitive נפרדת, אותו דפוס
-- בדיוק כמו bank_accounts.view_sensitive (שלב 3).

create table documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  document_type text not null,
  title text not null,
  issued_date date,
  expiry_date date,
  version integer not null default 1,
  file_path text,
  external_link text,
  is_sensitive boolean not null default false,
  status text not null default 'active' check (status in ('active', 'archived')),
  notes text,
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references auth.users(id),
  check (file_path is not null or external_link is not null)
);

create trigger documents_set_updated_at
  before update on documents
  for each row execute function set_updated_at();

create index documents_org_idx on documents (organization_id);

insert into permissions (resource, action, label_he) values
  ('documents', 'manage', 'ניהול מסמכי עמותה'),
  ('documents', 'view_sensitive', 'צפייה במסמכים רגישים');

-- finance_controller נוסף כאן (לא בטיוטה המקורית) - צ'ני אישרה במפורש שמנהל הכספים
-- צריך גם ליצור וגם לערוך מסמכים ומכתבים בעצמו, לא רק לצפות (ר' README, שלב 13 המשך).
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'documents' and p.action = 'manage'
where r.key in ('system_admin', 'operations_manager', 'finance_controller');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'documents' and p.action = 'view_sensitive'
where r.key = 'system_admin';

alter table documents enable row level security;

-- מסמך רגיל: area_ops/area_finance. מסמך רגיש: רק מי שיש לו documents.view_sensitive -
-- שתי מדיניות select נפרדות (לא אחת עם OR מורכב) כדי שההפרדה תישאר קריאה וברורה.
create policy documents_select_regular on documents for select to authenticated
  using (is_sensitive = false and (has_permission('area_ops', 'access') or has_permission('area_finance', 'access')));

create policy documents_select_sensitive on documents for select to authenticated
  using (is_sensitive = true and has_permission('documents', 'view_sensitive'));

-- INSERT מותר גם עם is_sensitive=true בלי view_sensitive - מי שמעלה מסמך רגיש יודע
-- שהוא רגיש בזמן ההעלאה (הוא מזין את הערך בעצמו), אין כאן "כתיבה עיוורת" לשורה שהוא
-- לא יכול לראות.
create policy documents_insert on documents for insert to authenticated
  with check (has_permission('documents', 'manage'));

-- UPDATE: לא מספיק documents.manage לבד - חייב גם להיות מסוגל *לראות* את השורה
-- (כלומר לא רגישה, או שיש לו view_sensitive), אחרת מי שיש לו manage בלבד יכול "לכתוב
-- בעיוורון" על שורה רגישה שהוא לא יכול לראות (למשל UPDATE...WHERE organization_id=X
-- בלי לדעת אילו שורות ספציפיות רגישות). נתפס בביקורת עצמית - אותה בעיה בדיוק שתוקנה
-- למעלה ב-storage.objects, גם על הטבלה עצמה.
create policy documents_update on documents for update to authenticated
  using (has_permission('documents', 'manage') and (is_sensitive = false or has_permission('documents', 'view_sensitive')))
  with check (has_permission('documents', 'manage') and (is_sensitive = false or has_permission('documents', 'view_sensitive')));

create trigger documents_audit
  after insert or update on documents
  for each row execute function audit_table_change();

insert into storage.buckets (id, name, public)
values ('organization-documents', 'organization-documents', false)
on conflict (id) do nothing;

-- מתואם עם ה-RLS על שורת המסמך עצמה (לא רק documents.manage) - אחרת מי שיכול להעלות
-- מסמכים אך אין לו view_sensitive היה יכול להוריד קובץ רגיש ישירות מה-Storage, עוקף
-- את ה-RLS על הטבלה. נתפס בביקורת עצמית לפני הרצה.
create policy organization_documents_files_select on storage.objects for select to authenticated
  using (
    bucket_id = 'organization-documents'
    and exists (
      select 1 from documents d
      where d.file_path = storage.objects.name
        and (
          (d.is_sensitive = false and (has_permission('area_ops', 'access') or has_permission('area_finance', 'access')))
          or (d.is_sensitive = true and has_permission('documents', 'view_sensitive'))
        )
    )
  );

create policy organization_documents_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'organization-documents' and has_permission('documents', 'manage'));
