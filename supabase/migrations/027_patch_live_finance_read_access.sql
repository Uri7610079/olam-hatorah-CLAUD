-- Patch לפרויקט החי: organizations_select/branches_select/groups_select (005/006, שלב 3)
-- ו-study_codes_select (012, שלב 5) כבר רצו נגד הפרויקט הקיים ומתירות SELECT רק ל-
-- area_ops - ר' הסבר מלא ב-006/012 המעודכנים על הדיסק ובקובץ README זה. idempotent
-- (drop if exists + create).

drop policy if exists organizations_select on organizations;
create policy organizations_select on organizations for select to authenticated
  using (has_permission('area_ops', 'access') or has_permission('area_finance', 'access'));

drop policy if exists branches_select on branches;
create policy branches_select on branches for select to authenticated
  using (has_permission('area_ops', 'access') or has_permission('area_finance', 'access'));

drop policy if exists groups_select on groups;
create policy groups_select on groups for select to authenticated
  using (has_permission('area_ops', 'access') or has_permission('area_finance', 'access'));

drop policy if exists study_codes_select on study_codes;
create policy study_codes_select on study_codes for select to authenticated
  using (has_permission('area_ops', 'access') or has_permission('area_finance', 'access'));
