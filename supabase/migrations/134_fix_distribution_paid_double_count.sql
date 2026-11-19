-- 134: שני תיקונים שנמצאו בסקירת שדרוג העיצוב (20.11.2026).
--
-- 1. אישור אצוות חלוקה ניכה פעמיים אצווה שכבר שולמה.
--    approve_distribution_batch (031) בודקת שהסכום לא עובר את "היתרה הזמינה" =
--    יתרת הקבוצה פחות מה שמוקצה לאצוות מאושרות אחרות (approved/locked_for_masav).
--    אבל אצוות חלוקה נשארת locked_for_masav גם אחרי שהמס"ב שלה שודר - ובשידור
--    (032, transmit) כבר נרשמה תנועת payment שמורידה את היתרה. כך סכום ששולם
--    ירד פעם אחת מהיתרה ופעם שנייה כ"מוקצה", וככל שמצטברות אצוות ששולמו - אישור
--    חדש נחסם בלי סיבה.
--    התיקון: אצוות שכבר שודרו (יש להן שורת מס"ב באצוות מס"ב שסטטוסה transmitted או
--    bank_completed) לא נספרות כ"מוקצות" - הכסף שלהן כבר משתקף ביתרה עצמה (וגם החזרה,
--    אם הייתה, כבר נרשמה ביתרה כ-refund ב-033). כל השאר בפונקציה זהה למקור (031).
--
-- 2. "משימות ותזכורות" כאזור ברירת מחדל.
--    מסך המשתמשים מציע את האזור tasks, אבל ה-check על profiles.default_area (002)
--    ועל user_invitations.default_area (107) מכיר רק ops/finance/admin - ולכן בחירה
--    ב"משימות" נכשלה בשגיאת constraint. כאן מוסיפים את tasks לשתיהן.

create or replace function approve_distribution_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch distribution_batches;
  v_total numeric;
  v_committed_elsewhere numeric;
  v_available numeric;
  v_balance numeric;
  v_inactive_count integer;
  v_unverified_count integer;
begin
  if not has_permission('distributions', 'approve') then
    raise exception 'permission denied';
  end if;

  select * into v_batch from distribution_batches where id = p_batch_id;
  if v_batch.id is null then
    raise exception 'אצווה לא נמצאה';
  end if;
  if v_batch.status <> 'in_review' then
    raise exception 'ניתן לאשר רק אצווה בבדיקה (סטטוס נוכחי: %)', v_batch.status;
  end if;

  perform assert_financial_period_open(v_batch.organization_id, v_batch.period_month);

  select count(*) into v_inactive_count
  from distribution_lines dl join students s on s.id = dl.student_id
  where dl.batch_id = p_batch_id and s.status = 'inactive';
  if v_inactive_count > 0 then
    raise exception 'לא ניתן לאשר: % שורות עם תלמיד לא פעיל', v_inactive_count;
  end if;

  select count(*) into v_unverified_count
  from distribution_lines dl
  where dl.batch_id = p_batch_id
    and not exists (
      select 1 from student_bank_accounts sba
      where sba.student_id = dl.student_id and sba.is_active = true and sba.verification_status = 'verified'
    );
  if v_unverified_count > 0 then
    raise exception 'לא ניתן לאשר: % שורות עם תלמיד ללא חשבון בנק מאומת', v_unverified_count;
  end if;

  select coalesce(sum(amount), 0) into v_total from distribution_lines where batch_id = p_batch_id;
  if v_total <= 0 then
    raise exception 'לא ניתן לאשר אצווה ללא שורות';
  end if;

  select balance into v_balance from group_balances where group_id = v_batch.group_id;
  v_balance := coalesce(v_balance, 0);

  -- מוקצה לאצוות אחרות - רק כסף שעוד לא יצא. אצווה שהמס"ב שלה שודר כבר ירדה
  -- מהיתרה בתנועת payment, ואין לנכות אותה שוב (ר' ההסבר בראש הקובץ).
  select coalesce(sum(dl2.amount), 0) into v_committed_elsewhere
  from distribution_batches db2
  join distribution_lines dl2 on dl2.batch_id = db2.id
  where db2.group_id = v_batch.group_id
    and db2.id <> p_batch_id
    and db2.status in ('approved', 'locked_for_masav')
    and not exists (
      select 1
      from masav_lines ml
      join masav_batches mb on mb.id = ml.batch_id
      where ml.source_distribution_batch_id = db2.id
        and mb.status in ('transmitted', 'bank_completed')
    );

  v_available := v_balance - v_committed_elsewhere;

  if v_total > v_available then
    raise exception 'הסכום הכולל (%) חורג מהיתרה הזמינה לחלוקה (%) - יתרת קבוצה % בניכוי % שכבר הוקצו לאצוות מאושרות אחרות',
      v_total, v_available, v_balance, v_committed_elsewhere;
  end if;

  perform set_config('app.allow_distribution_status_change', 'true', true);
  update distribution_batches set status = 'approved' where id = p_batch_id;

  perform insert_audit_event('approve_distribution_batch', 'distribution_batches', p_batch_id::text, jsonb_build_object('total', v_total));
end;
$$;

-- ===== 2. tasks כאזור ברירת מחדל =====
-- שמות ה-constraint נוצרו אוטומטית מה-check שבשורת העמודה (002, 107).
alter table profiles drop constraint if exists profiles_default_area_check;
alter table profiles add constraint profiles_default_area_check
  check (default_area in ('ops', 'finance', 'admin', 'tasks'));

alter table user_invitations drop constraint if exists user_invitations_default_area_check;
alter table user_invitations add constraint user_invitations_default_area_check
  check (default_area in ('ops', 'finance', 'admin', 'tasks'));
