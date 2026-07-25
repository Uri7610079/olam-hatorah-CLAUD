-- Patch לפרויקט החי: תיקוני ביקורת רוחבית שבוצעה על כל 33 המיגרציות הקודמות (לקראת
-- שלב 11), במיוחד מחלקת הבאג שכבר נתפסה ותוקנה פעמיים בשלב 9 (donations,
-- distribution_batches): טריגר guard שבודק רק UPDATE, כך ש-INSERT ישיר יכול ליצור שורה
-- שכבר במצב "מאושר" מרגע הלידה - עוקף לגמרי את כל הבדיקות שה-RPC הייעודי היה אמור
-- לאכוף. הביקורת מצאה זאת גם ב-students (החמור מכולם - מזין ישירות למחזור הזכאות/
-- עמלה/מס"ב) ובאופן דומה ב-import_batches ו-groups. ר' README.md להסבר מלא.
-- idempotent (create or replace + drop trigger if exists + create).

-- 1. students: תלמיד חדש תמיד נולד בסטטוס טיוטה - לא ניתן עוד ליצור ישירות תלמיד
--    "active"/"sent_to_talmud" וכו', עוקף את advance_student_status().
create or replace function enforce_student_status_transition()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'תלמיד חדש תמיד נוצר בסטטוס טיוטה';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status
     and coalesce(current_setting('app.allow_student_status_change', true), '') <> 'true' then
    raise exception 'שינוי סטטוס תלמיד מותר רק דרך advance_student_status() או exit_student()';
  end if;
  return new;
end;
$$;

drop trigger if exists students_enforce_status_transition on students;
create trigger students_enforce_status_transition
  before insert or update on students
  for each row execute function enforce_student_status_transition();

-- 2. import_batches: אצוות יבוא חדשה תמיד נולדת "הועלה" - לא ניתן ליצור ישירות אצווה
--    "committed", עוקף את commit_import_batch().
create or replace function enforce_import_batch_commit()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- 'previewed' מותר גם הוא - ר' אותה הערה ב-013 (תוקן רטרואקטיבית ב-046 אחרי שנמצא
    -- בבדיקה חיה של שלב 13, ולא כאן במקור - זו הגרסה המתוקנת כדי שהתקנה טרייה תהיה עקבית).
    if new.status not in ('uploaded', 'previewed') then
      raise exception 'אצוות יבוא חדשה תמיד נוצרת בסטטוס "הועלה" או "נסקר" (לאחר ניתוח בצד לקוח)';
    end if;
    return new;
  end if;

  if new.status = 'committed' and old.status is distinct from 'committed'
     and coalesce(current_setting('app.allow_batch_commit', true), '') <> 'true' then
    raise exception 'סגירת אצווה מותרת רק דרך commit_import_batch()';
  end if;
  return new;
end;
$$;

drop trigger if exists import_batches_enforce_commit on import_batches;
create trigger import_batches_enforce_commit
  before insert or update on import_batches
  for each row execute function enforce_import_batch_commit();

-- 3. groups: קבוצה חדשה תמיד נולדת בלי ראש קבוצה - שיוך ראשון נעשה אך ורק דרך
--    reassign_group_leader() (שיוצרת גם את שורת group_leader_assignments התואמת).
--    הלקוח הקיים כבר עובד ככה - זו רק סגירת פער מול קריאת API עתידית/ישירה.
create or replace function enforce_group_leader_transition()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.group_leader_id is not null then
      raise exception 'קבוצה נוצרת תמיד בלי ראש קבוצה - שיוך ראשון נעשה דרך reassign_group_leader() לאחר היצירה';
    end if;
    return new;
  end if;

  if new.group_leader_id is distinct from old.group_leader_id
     and coalesce(current_setting('app.allow_group_leader_change', true), '') <> 'true' then
    raise exception 'שינוי ראש קבוצה מותר רק דרך reassign_group_leader()';
  end if;
  return new;
end;
$$;

drop trigger if exists groups_enforce_leader_transition on groups;
create trigger groups_enforce_leader_transition
  before insert or update on groups
  for each row execute function enforce_group_leader_transition();

-- 4. organization_officeholders: פתיחת קריאה גם ל-area_finance (בעלי תפקידים/מורשי
--    חתימה רלוונטיים לאישור תשלומים), אותה הרחבה כמו organizations/branches/groups.
drop policy if exists organization_officeholders_select on organization_officeholders;
create policy organization_officeholders_select on organization_officeholders for select to authenticated
  using (has_permission('area_ops', 'access') or has_permission('area_finance', 'access'));
