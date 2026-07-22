-- שלב 5: קודי לימוד. כל 16 הקודים מנספח א' של האפיון, ללא השמטה. קודים בעלי תיאור
-- זהה (600/605, 700/705, 720/725) נשמרים כרשומות נפרדות - אין לאחד אותם, ההבדל ביניהם
-- הוא שאלה פתוחה ביומן ההחלטות שאסור להמציא לה תשובה.

create table study_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text not null,
  category text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger study_codes_set_updated_at
  before update on study_codes
  for each row execute function set_updated_at();

insert into study_codes (code, description) values
  ('300', 'ישיבה גבוהה בנים'),
  ('315', 'ישיבה מועמדת גיוס 15'),
  ('330', 'ישיבה מועמדת גיוס 30'),
  ('345', 'ישיבה מועמדת גיוס 45'),
  ('350', 'ישיבה גבוהה ציונית'),
  ('400', 'ישיבות גבוהות מגויסות'),
  ('500', 'ישיבה גבוהה בשילוב הכשרה תעסוקתית'),
  ('550', 'כולל ערב בשילוב הכשרה תעסוקתית'),
  ('600', 'כולל אברכים יום שלם'),
  ('605', 'כולל אברכים יום שלם'),
  ('700', 'כולל אברכים חצי יום בוקר'),
  ('705', 'כולל אברכים חצי יום בוקר'),
  ('706', 'כולל בוקר גרעין תורני'),
  ('708', 'כולל אברכים חצי יום בוקר בשילוב שירות אזרחי'),
  ('720', 'כולל אברכים חצי יום אחר הצהריים'),
  ('725', 'כולל אברכים חצי יום אחר הצהריים');

alter table study_codes enable row level security;

-- קריאה לכל מאושר עם גישת תפעול (נבחר בטופס קליטת תלמיד). עריכה רק למנהל מערכת -
-- זו רשימת הגדרות מערכת, לא נתון תפעולי יומיומי.
create policy study_codes_select on study_codes for select to authenticated
  using (has_permission('area_ops', 'access'));

insert into permissions (resource, action, label_he) values
  ('study_codes', 'manage', 'עריכת קודי לימוד וערכי מערכת');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'study_codes' and p.action = 'manage'
where r.key = 'system_admin';

create policy study_codes_insert on study_codes for insert to authenticated
  with check (has_permission('study_codes', 'manage'));

create policy study_codes_update on study_codes for update to authenticated
  using (has_permission('study_codes', 'manage'))
  with check (has_permission('study_codes', 'manage'));

create trigger study_codes_audit
  after insert or update on study_codes
  for each row execute function audit_table_change();
