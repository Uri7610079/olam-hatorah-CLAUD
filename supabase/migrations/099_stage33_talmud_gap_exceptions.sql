-- מרכז החריגות: מה חסר כדי שדוח "תלמוד" ייקלט במלואו
--
-- אחרי קליטת דוח דרישת תשלום נשאר פער בין הסכום שבקובץ לסכום שנקלט,
-- ועד עכשיו לא הייתה שום דרך במערכת לראות ממה הוא מורכב: ההסבר הופיע
-- רק בכרטיס שלפני הקליטה, ונעלם ברגע שיצאו מהמסך.
--
-- מרחיב את unified_exceptions (048/053/074) בארבעה ענפים במקום לבנות
-- מסך נפרד - אותו עיקרון שהנחה את 074: חריגה היא חריגה, ומקומה עם
-- כל השאר. השורות עצמן כבר נשמרות ב-import_rows עם error_message,
-- אז אין כאן איסוף חדש של נתונים.

create or replace view unified_exceptions
with (security_invoker = true)
as
select ue.* from (
  select exception_type, (case when severity = 'warning' then 'medium' else severity end) as severity,
    organization_id, related_table, related_id, amount, related_date, description
  from bank_reconciliation_exceptions

  union all

  select 'talmud_error', case when te.is_recurring then 'high' else 'medium' end,
    te.organization_id, 'talmud_errors', te.id, null, te.month,
    te.error_code || coalesce(': ' || te.error_description, '')
  from talmud_errors te
  where te.status in ('open', 'in_progress', 'pending_info')

  union all

  select 'audit_attendance', case when aa.is_recurring then 'high' else 'medium' end,
    a.organization_id, 'audit_attendance', aa.id, null, a.audit_date,
    'חוסר בביקורת: ' || coalesce(aa.external_student_ref, '(תלמיד מותאם)')
  from audit_attendance aa
  join audits a on a.id = aa.audit_id
  where aa.status in ('open', 'in_progress', 'pending_info')

  union all

  select 'document_expiry',
    case
      when d.expiry_date < current_date then 'critical'
      when d.expiry_date - current_date <= 7 then 'critical'
      when d.expiry_date - current_date <= 14 then 'high'
      else 'medium'
    end,
    d.organization_id, 'documents', d.id, null, d.expiry_date,
    'תוקף מסמך: ' || d.title
  from documents d
  where d.status = 'active' and d.expiry_date is not null and d.expiry_date - current_date <= 30

  union all

  select 'payment_return_open', 'medium',
    mb.organization_id, 'payment_returns', pr.id, pr.amount, pr.return_date,
    'החזרה פתוחה: ' || pr.reason
  from payment_returns pr
  join masav_lines ml on ml.id = pr.masav_line_id
  join masav_batches mb on mb.id = ml.batch_id
  where pr.status = 'open'

  union all

  select 'masav_needs_correction', 'high',
    mb.organization_id, 'masav_batches', mb.id, mb.total_amount, mb.period_month,
    'אצוות מס"ב דורשת תיקון' || coalesce(': ' || mb.status_reason, '')
  from masav_batches mb
  where mb.status = 'needs_correction'

  union all

  select 'bank_auto_sync_issue', case when r.status = 'failed' then 'critical' else 'high' end,
    oba.organization_id, 'bank_auto_sync_runs', r.id, null, r.started_at::date,
    coalesce(r.gap_detail, 'משיכת תנועות בנק אוטומטית נכשלה: ' || coalesce(r.error_message, 'שגיאה לא ידועה'))
  from bank_auto_sync_runs r
  join bank_auto_sync_settings s on s.id = r.setting_id
  join organization_bank_accounts oba on oba.id = s.organization_bank_account_id
  where r.is_resolved = false and (r.status = 'failed' or r.gap_detected = true)

  union all

  -- ===== מה שחסר כדי שדוח "תלמוד" ייקלט במלואו =====
  --
  -- עד כאן המידע הזה הוצג רק בכרטיס שלפני הקליטה ונעלם ברגע שיצאו מהמסך,
  -- כך שאחרי הקליטה לא הייתה שום דרך לדעת *למה* חסר כסף. השורות עצמן
  -- כבר נשמרות ב-import_rows עם error_message, אז אין כאן איסוף חדש -
  -- רק חשיפה של מה שכבר קיים.
  --
  -- כל ארבעת הענפים *מנקים את עצמם*: הם בודקים את המצב הנוכחי, לא את מה
  -- שהיה בזמן הקליטה. ברגע שהתלמיד נוסף, שויך, או שהסניף נפתח - החריגה
  -- נעלמת מעצמה. חריגה שנשארת אחרי שתוקנה גרועה מאין חריגה בכלל.

  -- 1. תלמיד עם זכאות בפועל שאינו קיים במערכת. זה כסף שלא נכנס.
  select 'talmud_student_missing', 'high',
    b.organization_id, 'import_rows', ir.id,
    nullif(regexp_replace(coalesce(ir.raw ->> 'סכום ברוטו', ''), '[^0-9.\-]', '', 'g'), '')::numeric,
    b.period_month,
    'תלמיד שאינו במערכת: ' || coalesce(nullif(ir.raw ->> 'שם', ''), '(ללא שם)') ||
      ' · ת.ז ' || coalesce(ir.raw ->> 'מזהה תלמיד', '—') ||
      ' · סניף ' || coalesce(nullif(ir.raw ->> 'סניף', ''), '—') ||
      ' · יש לייבא אותו במסך תלמידים'
  from import_rows ir
  join import_batches b on b.id = ir.batch_id
  join import_profiles p on p.id = b.profile_id
  where p.key = 'talmud_eligibility'
    and b.status = 'committed'
    and ir.status = 'invalid'
    and ir.error_message = 'לא נמצא תלמיד עם מזהה זה'
    and coalesce(nullif(regexp_replace(coalesce(ir.raw ->> 'סכום ברוטו', ''), '[^0-9.\-]', '', 'g'), '')::numeric, 0) > 0
    and not exists (
      select 1 from students s
      where normalize_identity(s.external_id) = normalize_identity(ir.raw ->> 'מזהה תלמיד')
    )

  union all

  -- 2. תלמיד קיים אך בלי שיוך פעיל. הקליטה קוראת את הסניף והקבוצה מהשיוך,
  --    ולכן הוא נדחה למרות שהוא במערכת - וזה הכי מבלבל מכל המקרים.
  select 'talmud_student_unassigned', 'high',
    b.organization_id, 'import_rows', ir.id,
    nullif(regexp_replace(coalesce(ir.raw ->> 'סכום ברוטו', ''), '[^0-9.\-]', '', 'g'), '')::numeric,
    b.period_month,
    'תלמיד ללא שיוך פעיל לסניף/קבוצה: ' || coalesce(nullif(ir.raw ->> 'שם', ''), '(ללא שם)') ||
      ' · ת.ז ' || coalesce(ir.raw ->> 'מזהה תלמיד', '—') ||
      ' · הוא קיים במערכת, רק חסר לו שיוך'
  from import_rows ir
  join import_batches b on b.id = ir.batch_id
  join import_profiles p on p.id = b.profile_id
  where p.key = 'talmud_eligibility'
    and b.status = 'committed'
    and ir.status = 'invalid'
    and ir.error_message like 'לתלמיד אין שיוך פעיל%'
    and exists (
      select 1 from students s
      where normalize_identity(s.external_id) = normalize_identity(ir.raw ->> 'מזהה תלמיד')
        and not exists (select 1 from student_assignments sa where sa.student_id = s.id and sa.is_active)
    )

  union all

  -- 3. סניף שמופיע בדוח ואינו קיים. שורה אחת לכל קוד סניף, לא לכל תלמיד.
  --    related_id הוא id של אחת השורות, כדי שמפתח השורה במסך יישאר ייחודי.
  select 'talmud_branch_missing', 'medium',
    b.organization_id, 'import_rows', (array_agg(ir.id order by ir.id))[1], null, b.period_month,
    'סניף ' || btrim(ir.raw ->> 'סניף') || ' מופיע בדוח תלמוד ואינו קיים במערכת' ||
      ' · הזכאות תיזקף לפי השיוך שבמערכת, לא לפי הקובץ'
  from import_rows ir
  join import_batches b on b.id = ir.batch_id
  join import_profiles p on p.id = b.profile_id
  where p.key = 'talmud_eligibility'
    and b.status = 'committed'
    and nullif(btrim(ir.raw ->> 'סניף'), '') is not null
    and not exists (
      select 1 from branches br
      where br.organization_id = b.organization_id
        and br.talmud_branch_code = btrim(ir.raw ->> 'סניף')
    )
  group by b.organization_id, b.period_month, btrim(ir.raw ->> 'סניף')

  union all

  -- 4. תלמידים חסרים ללא זכאות החודש. הם מסוכמים לשורה אחת לכל דוח בכוונה:
  --    בקבצים אמיתיים אלה מעל אלף שורות של 0.00 ש"ח, והצגתן אחת-אחת הייתה
  --    מטביעה את החריגות שבאמת עולות כסף.
  select 'talmud_students_missing_no_amount', 'low',
    b.organization_id, 'import_rows', (array_agg(ir.id order by ir.id))[1], null, b.period_month,
    count(*) || ' תלמידים בדוח אינם קיימים במערכת, אך ללא זכאות החודש (0.00 ש"ח)' ||
      ' · אין השפעה כספית, אבל כדאי להוסיף אותם'
  from import_rows ir
  join import_batches b on b.id = ir.batch_id
  join import_profiles p on p.id = b.profile_id
  where p.key = 'talmud_eligibility'
    and b.status = 'committed'
    and ir.status = 'invalid'
    and ir.error_message = 'לא נמצא תלמיד עם מזהה זה'
    and coalesce(nullif(regexp_replace(coalesce(ir.raw ->> 'סכום ברוטו', ''), '[^0-9.\-]', '', 'g'), '')::numeric, 0) = 0
    and not exists (
      select 1 from students s
      where normalize_identity(s.external_id) = normalize_identity(ir.raw ->> 'מזהה תלמיד')
    )
  group by b.organization_id, b.period_month
) ue
left join organizations o on o.id = ue.organization_id
where coalesce(o.is_demo, false) = false;

grant select on unified_exceptions to authenticated;
