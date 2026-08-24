-- השלמת שורות שנדחו באצווה שכבר נקלטה
--
-- הרקע: דוח שנקלט לפני מיגרציה 098 דחה שורות בגלל אפס מוביל בת.ז. אחרי
-- התיקון אותם תלמידים מזוהים היטב - ולכן הם *כבר לא* מופיעים כחריגה
-- "תלמיד שאינו במערכת" - אבל הכסף שלהם עדיין לא נזקף, כי הקליטה כבר
-- רצה. במסד החי זה 1,350 ש"ח של תכלת מרדכי שנעלמו מכל מסך.
--
-- אותו דבר יקרה בכל פעם שדוח נקלט לפני שהוזן תלמיד או נפתח סניף: השורה
-- נדחתה, הנתונים תוקנו, והכסף נשאר בחוץ בלי שאיש ידע.
--
-- קליטה חוזרת של הקובץ אינה פתרון: import_batches.file_hash הוא unique,
-- והחסימה הזו נכונה - היא מונעת זכאות כפולה. לכן במקום לקלוט מחדש,
-- מריצים את ההתאמה שוב על השורות שנדחו באותה אצווה.

create or replace function retry_rejected_eligibility_rows(p_batch_id uuid)
returns table (recovered_count integer, already_had_count integer, still_rejected_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_org_id uuid;
  v_month date;
  v_student_id uuid;
  v_branch_id uuid;
  v_group_id uuid;
  v_amount numeric(12, 2);
  v_recovered integer := 0;
  v_already integer := 0;
  v_left integer := 0;
begin
  if not has_permission('talmud', 'import') then
    raise exception 'permission denied';
  end if;

  select b.organization_id, b.period_month into v_org_id, v_month
  from import_batches b
  join import_profiles p on p.id = b.profile_id
  where b.id = p_batch_id and b.status = 'committed' and p.key = 'talmud_eligibility';

  if v_month is null then
    raise exception 'אצווה זו אינה דוח זכאות שנקלט, ולכן אין בה שורות להשלמה';
  end if;

  for v_row in select * from import_rows where batch_id = p_batch_id and status = 'invalid' loop
    begin
      select id into v_student_id from students
      where normalize_identity(external_id) = normalize_identity(v_row.raw ->> 'מזהה תלמיד')
      limit 1;

      if v_student_id is null then
        v_left := v_left + 1;
        continue;
      end if;

      select sa.branch_id, sa.group_id into v_branch_id, v_group_id
      from student_assignments sa
      where sa.student_id = v_student_id and sa.is_active = true
      limit 1;

      if v_branch_id is null then
        v_left := v_left + 1;
        continue;
      end if;

      -- לתלמיד כבר נזקפה זכאות פעילה לחודש הזה. השורה תקינה מבחינת הנתונים,
      -- אבל אסור לזקוף שוב - זו בדיוק הזכאות הכפולה שחסימת ה-hash מונעת.
      -- מסמנים אותה כמטופלת כדי שתפסיק לצוף כחריגה, בלי להוסיף כסף.
      if exists (
        select 1 from monthly_eligibility
        where student_id = v_student_id and month = v_month and status = 'active'
      ) then
        update import_rows set status = 'committed', error_message = null where id = v_row.id;
        v_already := v_already + 1;
        continue;
      end if;

      v_amount := (regexp_replace(v_row.raw ->> 'סכום ברוטו', '[^0-9.\-]', '', 'g'))::numeric;

      insert into monthly_eligibility (
        student_id, organization_id, branch_id, group_id, month,
        gross_amount, score_or_payment_type, source_batch_id
      )
      values (
        v_student_id, v_org_id, v_branch_id, v_group_id, v_month,
        v_amount, v_row.raw ->> 'ניקוד/סוג תשלום', p_batch_id
      );

      update import_rows set status = 'committed', error_message = null where id = v_row.id;

      perform set_config('app.allow_student_status_change', 'true', true);
      update students set status = 'active' where id = v_student_id and status = 'sent_to_talmud';

      v_recovered := v_recovered + 1;
    exception when others then
      update import_rows set error_message = 'השלמה נכשלה: ' || sqlerrm where id = v_row.id;
      v_left := v_left + 1;
    end;
  end loop;

  -- סנכרון הספירות, מאותו טעם שתוקן ב-021: אחרת ההיסטוריה תמשיך להציג
  -- את המספרים מרגע הקליטה ולא את המצב בפועל.
  update import_batches set
    valid_count = (select count(*) from import_rows where batch_id = p_batch_id and status in ('valid', 'committed')),
    invalid_count = (select count(*) from import_rows where batch_id = p_batch_id and status = 'invalid')
  where id = p_batch_id;

  perform insert_audit_event(
    'retry_rejected_eligibility_rows', 'import_batches', p_batch_id::text,
    jsonb_build_object('month', v_month, 'recovered', v_recovered,
                       'already_had', v_already, 'still_rejected', v_left)
  );

  return query select v_recovered, v_already, v_left;
end;
$$;

comment on function retry_rejected_eligibility_rows(uuid) is
  'מריץ מחדש את ההתאמה על שורות שנדחו באצווה שנקלטה, אחרי שהנתונים החסרים הוזנו. ראה מיגרציה 100.';

revoke execute on function retry_rejected_eligibility_rows(uuid) from public, anon;
grant execute on function retry_rejected_eligibility_rows(uuid) to authenticated;

-- ===== מרכז החריגות: הענף החמישי - זכאות שניתן להשלים =====
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

  union all

  -- 5. שורה שנדחתה בקליטה, אך הנתונים שחסרו לה הוזנו מאז.
  --
  -- זה המקרה שנוצר אחרי מיגרציה 098: התלמיד נדחה בגלל אפס מוביל בת.ז,
  -- כעת הוא מזוהה היטב, ולכן ארבעת הענפים שמעל *לא* יראו אותו - הוא כבר
  -- לא חסר ולא חסר שיוך. אבל הכסף שלו לא נזקף, כי הקליטה כבר רצה.
  -- בלי הענף הזה הפער היה בלתי נראה לחלוטין.
  --
  -- אותו דבר בכל פעם שדוח נקלט לפני שהוזן תלמיד או נפתח סניף.
  select 'talmud_row_recoverable', 'high',
    b.organization_id, 'import_rows', ir.id,
    nullif(regexp_replace(coalesce(ir.raw ->> 'סכום ברוטו', ''), '[^0-9.\-]', '', 'g'), '')::numeric,
    b.period_month,
    'זכאות שנדחתה וניתן להשלים: ' || coalesce(nullif(ir.raw ->> 'שם', ''), '(ללא שם)') ||
      ' · ת.ז ' || coalesce(ir.raw ->> 'מזהה תלמיד', '—') ||
      ' · התלמיד קיים ומשויך כעת · יש להריץ "השלמת שורות שנדחו" במסך זכאות'
  from import_rows ir
  join import_batches b on b.id = ir.batch_id
  join import_profiles p on p.id = b.profile_id
  where p.key = 'talmud_eligibility'
    and b.status = 'committed'
    and ir.status = 'invalid'
    and coalesce(nullif(regexp_replace(coalesce(ir.raw ->> 'סכום ברוטו', ''), '[^0-9.\-]', '', 'g'), '')::numeric, 0) > 0
    and exists (
      select 1 from students s
      where normalize_identity(s.external_id) = normalize_identity(ir.raw ->> 'מזהה תלמיד')
        and exists (select 1 from student_assignments sa where sa.student_id = s.id and sa.is_active)
        and not exists (
          select 1 from monthly_eligibility me
          where me.student_id = s.id and me.month = b.period_month and me.status = 'active'
        )
    )
) ue
left join organizations o on o.id = ue.organization_id
where coalesce(o.is_demo, false) = false;

grant select on unified_exceptions to authenticated;
