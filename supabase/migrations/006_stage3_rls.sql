-- שלב 3: RLS על טבלאות היסוד. תבנית קבועה: SELECT לכל מאושר עם גישת אזור תפעול,
-- כתיבה (INSERT/UPDATE) רק עם הרשאת manage הספציפית. אין DELETE policy בשום מקום -
-- סגירה נעשית ב-UPDATE (status='closed'), לא במחיקה (soft close, לפי דרישת האפיון).

alter table organizations enable row level security;
alter table organization_bank_accounts enable row level security;
alter table organization_officeholders enable row level security;
alter table branches enable row level security;
alter table group_leaders enable row level security;
alter table groups enable row level security;

-- area_finance נכלל גם כאן (לא רק area_ops) - מסכי כספים (שלבים 7-8 ואילך) צריכים
-- לקרוא שם/מבנה עמותה-סניף-קבוצה כדי לתפקד. זה נתון לא רגיש (שם/קוד) - ההגנה על
-- פרטים רגישים (מספר חשבון בנק) קיימת בנפרד דרך ה-view הממסך + reveal RPC למטה.
create policy organizations_select on organizations for select to authenticated
  using (has_permission('area_ops', 'access') or has_permission('area_finance', 'access'));

create policy organizations_insert on organizations for insert to authenticated
  with check (has_permission('organizations', 'manage'));

create policy organizations_update on organizations for update to authenticated
  using (has_permission('organizations', 'manage'))
  with check (has_permission('organizations', 'manage'));

-- גישה ישירה לטבלה עצמה (ולכן למספר החשבון הגולמי, לא רק לגרסה הממוסכת) דורשת
-- bank_accounts.view_sensitive - בדיוק כמו reveal_bank_account_number() למטה. מי שיש לו
-- רק גישת תפעול/כספים (בלי view_sensitive) חייב לעבור דרך organization_bank_accounts_view
-- (למטה, שרצה כ-owner ולא כ-invoker בדיוק בשביל זה) כדי לראות שורה בכלל, ממוסכת.
-- נתפס בביקורת אבטחה בשלב 16: לפני התיקון הזה, כל מי שיש לו area_ops/area_finance יכול
-- היה לקרוא ישירות מהטבלה ולקבל את המספר האמיתי, עוקף לגמרי את המיסוך - view_sensitive
-- הגן רק על reveal_bank_account_number(), לא על SELECT ישיר.
create policy organization_bank_accounts_select on organization_bank_accounts for select to authenticated
  using (has_permission('bank_accounts', 'view_sensitive'));

create policy organization_bank_accounts_insert on organization_bank_accounts for insert to authenticated
  with check (has_permission('organizations', 'manage'));

create policy organization_bank_accounts_update on organization_bank_accounts for update to authenticated
  using (has_permission('organizations', 'manage'))
  with check (has_permission('organizations', 'manage'));

-- area_finance נכלל גם כאן: בעלי תפקידים/מורשי חתימה רלוונטיים לאישור תשלומים בצד
-- הכספים, לא רק לניהול תפעולי (אותה הרחבה כמו organizations/branches/groups לעיל).
create policy organization_officeholders_select on organization_officeholders for select to authenticated
  using (has_permission('area_ops', 'access') or has_permission('area_finance', 'access'));

create policy organization_officeholders_insert on organization_officeholders for insert to authenticated
  with check (has_permission('organizations', 'manage'));

create policy organization_officeholders_update on organization_officeholders for update to authenticated
  using (has_permission('organizations', 'manage'))
  with check (has_permission('organizations', 'manage'));

create policy branches_select on branches for select to authenticated
  using (has_permission('area_ops', 'access') or has_permission('area_finance', 'access'));

create policy branches_insert on branches for insert to authenticated
  with check (has_permission('branches', 'manage'));

create policy branches_update on branches for update to authenticated
  using (has_permission('branches', 'manage'))
  with check (has_permission('branches', 'manage'));

create policy group_leaders_select on group_leaders for select to authenticated
  using (has_permission('area_ops', 'access'));

create policy group_leaders_insert on group_leaders for insert to authenticated
  with check (has_permission('groups', 'manage'));

create policy group_leaders_update on group_leaders for update to authenticated
  using (has_permission('groups', 'manage'))
  with check (has_permission('groups', 'manage'));

create policy groups_select on groups for select to authenticated
  using (has_permission('area_ops', 'access') or has_permission('area_finance', 'access'));

create policy groups_insert on groups for insert to authenticated
  with check (has_permission('groups', 'manage'));

create policy groups_update on groups for update to authenticated
  using (has_permission('groups', 'manage'))
  with check (has_permission('groups', 'manage'));
