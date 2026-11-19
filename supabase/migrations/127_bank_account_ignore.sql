-- חשבון בנק "להתעלם" (2026-11-19)
--
-- החלטת צ'ני: חשבון מרכנתיל 0098529821 שמופיע בכניסה של אחת העמותות אינו חשבון
-- שמנהלים במערכת. חשבון כזה לא נקלט (כמו כל חשבון לא רשום), אבל גם לא מופיע יותר
-- כחריגה. הסימון נעשה במסך "משיכה אוטומטית מהבנק" (כפתור "להתעלם מהחשבון הזה"),
-- וניתן לבטל אותו שם. אם יום אחד ירשמו את החשבון תחת עמותה - הוא ייקלט כרגיל.

alter table bank_scraper_unmatched_accounts add column if not exists ignored_at timestamptz;
alter table bank_scraper_unmatched_accounts add column if not exists ignored_by uuid references auth.users(id);

create or replace function set_unmatched_bank_account_ignored(p_id uuid, p_ignored boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('bank_import', 'perform') then raise exception 'permission denied'; end if;
  update bank_scraper_unmatched_accounts
  set ignored_at = case when p_ignored then now() end, ignored_by = case when p_ignored then auth.uid() end
  where id = p_id;
  if not found then raise exception 'החשבון לא נמצא'; end if;
  perform insert_audit_event('set_unmatched_bank_account_ignored', 'bank_scraper_unmatched_accounts', p_id::text, jsonb_build_object('ignored', p_ignored));
end;
$$;
revoke execute on function set_unmatched_bank_account_ignored(uuid, boolean) from public, anon;
grant execute on function set_unmatched_bank_account_ignored(uuid, boolean) to authenticated;

-- הסקרייפר: זהה ל-123, ונוספה בדיקת "להתעלם" כשאין חשבון רשום
create or replace function ingest_scraped_bank_account(
  p_secret text,
  p_connection_key text,
  p_bank_code text,
  p_account_number text,
  p_bank_balance numeric,
  p_pending_count integer,
  p_transactions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_bank text := lpad(regexp_replace(coalesce(p_bank_code, ''), '[^0-9]', '', 'g'), 2, '0');
  v_all text := scraper_account_digits(p_account_number);
  v_parts text[] := array_remove(regexp_split_to_array(coalesce(p_account_number, ''), '[^0-9]+'), '');
  v_last text;
  v_first text;
  v_matches uuid[];
  v_account uuid;
  v_org uuid;
  v_org_name text;
  v_setting uuid;
  v_run uuid;
  v_prev_balance numeric;
  v_prev_pending integer;
  v_net numeric;
  v_committed integer;
  v_duplicates integer;
  v_status text;
  v_reason text;
begin
  perform bank_scraper_check(p_secret);

  v_last := scraper_account_digits(v_parts[array_length(v_parts, 1)]);
  v_first := case when array_length(v_parts, 1) > 1 then scraper_account_digits(v_parts[1]) end;

  select array_agg(a.id) into v_matches
  from organization_bank_accounts a
  where a.is_active
    and lpad(coalesce(nullif(a.bank_code, ''), resolve_bank_code(a.bank_name), ''), 2, '0') = v_bank
    and scraper_account_digits(a.account_number) is not null
    and (
      scraper_account_digits(a.account_number) = v_all
      or (scraper_account_digits(a.account_number) = v_last
          and (v_first is null or v_first = scraper_account_digits(a.bank_branch_code)))
      or scraper_account_digits(coalesce(a.bank_branch_code, '') || a.account_number) = v_all
    );

  if coalesce(array_length(v_matches, 1), 0) <> 1 then

  -- (127) לא נמצא חשבון רשום, והחשבון סומן "להתעלם": לא נרשם שוב כחריגה. חשבון שנרשם
  -- בהמשך תחת עמותה כן נקלט - הבדיקה כאן רק כשאין התאמה.
  if exists (
    select 1 from bank_scraper_unmatched_accounts u
    where u.bank_code = lpad(regexp_replace(coalesce(p_bank_code, ''), '[^0-9]', '', 'g'), 2, '0')
      and u.account_number = coalesce(p_account_number, '')
      and u.ignored_at is not null
  ) then
    return jsonb_build_object('status', 'unmatched', 'reason', 'ignored',
      'message', 'החשבון ' || coalesce(p_account_number, '?') || ' מסומן במערכת "להתעלם" - לא נקלט.');
  end if;
    v_reason := case when coalesce(array_length(v_matches, 1), 0) = 0 then 'not_found' else 'ambiguous' end;
    insert into bank_scraper_unmatched_accounts (bank_code, account_number, connection_key, reason, transactions_count, bank_balance)
    values (v_bank, coalesce(p_account_number, ''), p_connection_key, v_reason,
            coalesce(jsonb_array_length(p_transactions), 0), p_bank_balance)
    on conflict (bank_code, account_number) do update
      set connection_key = excluded.connection_key, reason = excluded.reason,
          transactions_count = excluded.transactions_count, bank_balance = excluded.bank_balance,
          last_seen_at = now(), resolved_at = null;
    return jsonb_build_object(
      'status', 'unmatched',
      'reason', v_reason,
      'message', case when v_reason = 'not_found'
        then 'החשבון ' || coalesce(p_account_number, '?') || ' (בנק ' || v_bank || ') לא רשום במערכת תחת אף עמותה - לא נקלט.'
        else 'לחשבון ' || coalesce(p_account_number, '?') || ' (בנק ' || v_bank || ') נמצאו כמה חשבונות במערכת - לא נקלט עד שיתוקן.' end);
  end if;

  v_account := v_matches[1];
  select a.organization_id, o.legal_name into v_org, v_org_name
  from organization_bank_accounts a join organizations o on o.id = a.organization_id
  where a.id = v_account;

  update bank_scraper_unmatched_accounts set resolved_at = now()
  where bank_code = v_bank and account_number = coalesce(p_account_number, '') and resolved_at is null;

  insert into bank_auto_sync_settings (organization_bank_account_id, provider, frequency, is_enabled, created_by)
  values (v_account, 'office_scraper', 'daily', true, null)
  on conflict (organization_bank_account_id) do update set provider = 'office_scraper', is_enabled = true
  returning id into v_setting;

  -- היתרה הקודמת שהבנק דיווח, מהריצה הקודמת של אותו חשבון שהצליחה
  select r.bank_reported_balance, r.bank_pending_count into v_prev_balance, v_prev_pending
  from bank_auto_sync_runs r
  where r.setting_id = v_setting and r.bank_reported_balance is not null and r.status in ('success', 'partial')
  order by r.started_at desc limit 1;

  v_run := ingest_bank_transactions_core(v_setting, coalesce(p_transactions, '[]'::jsonb));

  select r.status, r.transactions_committed, r.transactions_duplicate into v_status, v_committed, v_duplicates
  from bank_auto_sync_runs r where r.id = v_run;

  update bank_auto_sync_runs set bank_reported_balance = p_bank_balance, bank_pending_count = coalesce(p_pending_count, 0) where id = v_run;

  -- בדיקת היתרה. רק כשאין תנועות ממתינות: הבנק כבר מוריד אותן מהיתרה, והסקרייפר
  -- בכוונה לא קולט אותן עד שייסגרו - ולכן איתן היתרה לעולם לא "תסתדר".
  if v_status in ('success', 'partial') and v_prev_balance is not null and p_bank_balance is not null
     and coalesce(p_pending_count, 0) = 0 and coalesce(v_prev_pending, 0) = 0 then
    select coalesce(sum(case when bt.direction = 'credit' then bt.amount else -bt.amount end), 0) into v_net
    from bank_transactions bt
    join bank_auto_sync_runs r on r.batch_id = bt.batch_id
    where r.id = v_run;
    if abs(v_prev_balance + v_net - p_bank_balance) >= 0.01 then
      update bank_auto_sync_runs set
        status = 'partial', gap_detected = true,
        gap_detail = 'בדיקת יתרה: היתרה הקודמת ' || to_char(v_prev_balance, 'FM999,999,990.00') ||
          ' ועוד התנועות שנקלטו (' || to_char(v_net, 'FM999,999,990.00') || ') = ' ||
          to_char(v_prev_balance + v_net, 'FM999,999,990.00') || ', אבל הבנק מדווח ' ||
          to_char(p_bank_balance, 'FM999,999,990.00') || '. ייתכן שחסרות תנועות - כדאי להשוות לדף החשבון.'
      where id = v_run;
      v_status := 'partial';
    end if;
  end if;

  return jsonb_build_object(
    'status', v_status,
    'run_id', v_run,
    'organization', v_org_name,
    'committed', coalesce(v_committed, 0),
    'duplicates', coalesce(v_duplicates, 0),
    'message', (select coalesce(r.error_message, r.gap_detail) from bank_auto_sync_runs r where r.id = v_run));
end;
$$;


revoke execute on function ingest_scraped_bank_account(text, text, text, text, numeric, integer, jsonb) from public;
grant execute on function ingest_scraped_bank_account(text, text, text, text, numeric, integer, jsonb) to anon, authenticated;

-- החשבון שצ'ני ביקשה להתעלם ממנו
update bank_scraper_unmatched_accounts set ignored_at = now()
where bank_code = '17' and ltrim(account_number, '0') = '98529821' and ignored_at is null;

-- מרכז החריגות: זהה ל-125, וחשבון שסומן "להתעלם" לא מופיע
create or replace view unified_exceptions
with (security_invoker = true)
as
-- materialized במפורש: בלעדיו Postgres משכפל את ה-CTE לתוך כל אחד
-- מחמשת הענפים, וזו בדיוק הבעיה שהמיגרציה הזו מתקנת.
with talmud_gap as materialized (
  select
    ir.id as row_id,
    ir.status as row_status,
    ir.raw as raw,
    b.organization_id,
    b.period_month,
    nullif(btrim(ir.raw ->> 'סניף'), '') as branch_code,
    coalesce(nullif(regexp_replace(coalesce(ir.raw ->> 'סכום ברוטו', ''), '[^0-9.\-]', '', 'g'), '')::numeric, 0) as amount,
    s.id as student_id,
    (asg.student_id is not null) as has_assignment,
    (el.student_id is not null) as has_eligibility,
    (br.id is not null) as branch_exists
  from import_rows ir
  join import_batches b on b.id = ir.batch_id and b.status = 'committed'
  join import_profiles p on p.id = b.profile_id and p.key = 'talmud_eligibility'
  left join students s
    on normalize_identity(s.external_id) = normalize_identity(ir.raw ->> 'מזהה תלמיד')
  left join lateral (
    select sa.student_id from student_assignments sa
    where sa.student_id = s.id and sa.is_active = true limit 1
  ) asg on true
  left join lateral (
    select me.student_id from monthly_eligibility me
    where me.student_id = s.id and me.month = b.period_month and me.status = 'active' limit 1
  ) el on true
  left join branches br
    on br.organization_id = b.organization_id
   and br.talmud_branch_code = btrim(ir.raw ->> 'סניף')
  -- שורה שהמפעיל דחה בכוונה אינה פער לתיקון (110)
  where ir.error_message is distinct from 'נדחתה ידנית בבדיקה'
)
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
  -- כל חמשת הענפים מנקים את עצמם: הם קוראים את המצב הנוכחי מתוך
  -- talmud_gap, לא את מה שהיה בזמן הקליטה. ברגע שהתלמיד נוסף, שויך,
  -- או שהסניף נפתח - החריגה נעלמת מעצמה. חריגה שנשארת אחרי שתוקנה
  -- מאמנת להתעלם מהמסך, וזה גרוע מלא להציג אותו בכלל.

  -- 1. תלמיד עם זכאות בפועל שאינו קיים במערכת. זה כסף שלא נכנס.
  select 'talmud_student_missing', 'high',
    g.organization_id, 'import_rows', g.row_id, g.amount, g.period_month,
    'תלמיד שאינו במערכת: ' || coalesce(nullif(g.raw ->> 'שם', ''), '(ללא שם)') ||
      ' · ת.ז ' || coalesce(g.raw ->> 'מזהה תלמיד', '—') ||
      ' · סניף ' || coalesce(g.branch_code, '—') ||
      ' · יש לייבא אותו במסך תלמידים'
  from talmud_gap g
  where g.row_status = 'invalid' and g.student_id is null and g.amount > 0

  union all

  -- 2. תלמיד קיים אך בלי שיוך פעיל. הקליטה קוראת את הסניף והקבוצה
  --    מהשיוך, ולכן הוא נדחה למרות שהוא במערכת - וזה הכי מבלבל.
  select 'talmud_student_unassigned', 'high',
    g.organization_id, 'import_rows', g.row_id, g.amount, g.period_month,
    'תלמיד ללא שיוך פעיל לסניף/קבוצה: ' || coalesce(nullif(g.raw ->> 'שם', ''), '(ללא שם)') ||
      ' · ת.ז ' || coalesce(g.raw ->> 'מזהה תלמיד', '—') ||
      ' · הוא קיים במערכת, רק חסר לו שיוך'
  from talmud_gap g
  where g.row_status = 'invalid' and g.student_id is not null and not g.has_assignment

  union all

  -- 3. סניף שמופיע בדוח ואינו קיים. שורה אחת לכל קוד סניף, לא לכל תלמיד.
  select 'talmud_branch_missing', 'medium',
    g.organization_id, 'import_rows', (array_agg(g.row_id order by g.row_id))[1], null, g.period_month,
    'סניף ' || g.branch_code || ' מופיע בדוח תלמוד ואינו קיים במערכת' ||
      ' · הזכאות תיזקף לפי השיוך שבמערכת, לא לפי הקובץ'
  from talmud_gap g
  where g.branch_code is not null and not g.branch_exists
  group by g.organization_id, g.period_month, g.branch_code

  union all

  -- 4. חסרים ללא זכאות החודש, מסוכמים לשורה אחת לכל דוח בכוונה: בקבצים
  --    אמיתיים אלה מאות שורות של 0.00, והצגתן אחת-אחת הייתה מטביעה את
  --    החריגות שבאמת עולות כסף.
  select 'talmud_students_missing_no_amount', 'low',
    g.organization_id, 'import_rows', (array_agg(g.row_id order by g.row_id))[1], null, g.period_month,
    count(*) || ' תלמידים בדוח אינם קיימים במערכת, אך ללא זכאות החודש (0.00 ש"ח)' ||
      ' · אין השפעה כספית, אבל כדאי להוסיף אותם'
  from talmud_gap g
  where g.row_status = 'invalid' and g.student_id is null and g.amount = 0
  group by g.organization_id, g.period_month

  union all

  -- 5. שורה שנדחתה, והנתונים שחסרו לה הוזנו מאז. ארבעת הענפים שמעל
  --    שותקים כאן - התלמיד כבר לא חסר ולא חסר שיוך - אבל הכסף שלו לא
  --    נזקף, כי הקליטה כבר רצה. בלי הענף הזה הפער בלתי נראה.
  select 'talmud_row_recoverable', 'high',
    g.organization_id, 'import_rows', g.row_id, g.amount, g.period_month,
    'זכאות שנדחתה וניתן להשלים: ' || coalesce(nullif(g.raw ->> 'שם', ''), '(ללא שם)') ||
      ' · ת.ז ' || coalesce(g.raw ->> 'מזהה תלמיד', '—') ||
      ' · התלמיד קיים ומשויך כעת · יש להריץ "השלמת שורות שנדחו" במסך זכאות'
  from talmud_gap g
  where g.row_status = 'invalid' and g.student_id is not null
    and g.has_assignment and not g.has_eligibility and g.amount > 0

  union all

  -- ===== תלמוד = מערכת האמת (122) =====
  -- שלושת הענפים מנקים את עצמם, כמו הענפים שמעל: ברגע שהנתון הוזן, או
  -- שהתלמיד הועבר סניף - השורה נעלמת.

  -- 6. "חסר נתון": מה שתלמוד לא יודע ונחוץ לעבודה. שורה אחת לכל תלמיד.
  --    בינוני כשחסר מה שמעכב תשלום (בנק, ראש קבוצה); אחרת - לידיעה.
  select 'student_missing_data',
    case when md.missing && array['חשבון בנק', 'ראש קבוצה'] then 'medium' else 'low' end,
    md.organization_id, 'students', md.student_id, null, null,
    'חסר נתון: ' || array_to_string(md.missing, ', ') || ' · ' || md.full_name || ' · ' || md.external_id
  from student_missing_data md

  union all

  -- 7. יצא אצלנו, ותלמוד עדיין רושם אותו בדוח האחרון (אחרי תאריך היציאה).
  --    לא מחזירים ל"פעיל" לבד: כנראה פשוט לא דווחה היציאה לתלמוד.
  (select distinct on (s.id) 'talmud_exited_but_listed', 'high',
    l.organization_id, 'students', s.id, null, l.month,
    'יצא במערכת' || coalesce(' (' || to_char(s.exit_date, 'DD/MM/YYYY') || ')', '') ||
      ' ועדיין רשום בתלמוד בחודש ' || to_char(l.month, 'MM/YYYY') ||
      ' (' || case when x.eligible then 'זכאי' else 'אינו זכאי' end || ')' ||
      ' · ' || s.full_name || ' · ' || s.external_id ||
      ' · יש לדווח את היציאה לתלמוד, או להחזיר אותו לפעיל'
  from talmud_latest_lists l
  join talmud_eligibility_list_rows x on x.list_id = l.id
  join students s on s.id = x.student_id
  where s.status = 'inactive'
    and coalesce(s.exit_date, date '1900-01-01') < l.month
  order by s.id, x.eligible desc)

  union all

  -- 8. תלמוד רושם אותו בסניף אחר מהשיוך שלנו. לא מעבירים לבד: מעבר סניף
  --    הוא גם מעבר ראש קבוצה, ואת זה תלמוד לא יודע.
  (select distinct on (s.id) 'talmud_branch_differs', 'medium',
    l.organization_id, 'students', s.id, null, l.month,
    'בתלמוד: ' || o.legal_name || ' סניף ' || coalesce(x.branch_code, '—') ||
      ' · במערכת: ' || coalesce(ao.legal_name, '—') || ' סניף ' || coalesce(ab.talmud_branch_code, '—') ||
      ' · ' || s.full_name || ' · ' || s.external_id ||
      ' · יש להעביר לסניף שבתלמוד ולבחור ראש קבוצה'
  from talmud_latest_lists l
  join organizations o on o.id = l.organization_id
  join talmud_eligibility_list_rows x on x.list_id = l.id
  join students s on s.id = x.student_id and s.status <> 'inactive'
  join student_assignments sa on sa.student_id = s.id and sa.is_active = true
  join organizations ao on ao.id = sa.organization_id
  join branches ab on ab.id = sa.branch_id
  where not exists (
    -- אחת השורות שלו בדוח תואמת שיוך פעיל כלשהו שלו
    select 1 from talmud_eligibility_list_rows x2
    join student_assignments sa2 on sa2.student_id = x2.student_id and sa2.is_active = true
    join branches b2 on b2.id = sa2.branch_id
    where x2.list_id = l.id and x2.student_id = s.id
      and sa2.organization_id = l.organization_id and b2.talmud_branch_code = x2.branch_code
  )
  order by s.id, x.eligible desc)

  union all

  -- ===== הסקרייפר במשרד (123) =====
  -- 9. חשבון שהבנק החזיר ואין לו בעלים במערכת (או שיש לו שניים). התנועות שלו לא
  --    נקלטו. נעלם מעצמו ברגע שהחשבון נרשם תחת העמותה והמשיכה הבאה קולטת אותו.
  select 'bank_account_unmatched', 'high',
    null::uuid, 'bank_scraper_unmatched_accounts', u.id, u.bank_balance, u.last_seen_at::date,
    case when u.reason = 'not_found'
      then 'חשבון בנק ' || u.bank_code || ' / ' || u.account_number || ' נמשך מהבנק ואינו רשום תחת אף עמותה · ' ||
           u.transactions_count || ' תנועות לא נקלטו · יש להוסיף את החשבון בכרטיס העמותה'
      else 'חשבון בנק ' || u.bank_code || ' / ' || u.account_number || ' תואם לכמה חשבונות במערכת · ' ||
           u.transactions_count || ' תנועות לא נקלטו · יש להשאיר רק חשבון פעיל אחד עם המספר הזה'
    end
  from bank_scraper_unmatched_accounts u
  where u.resolved_at is null and u.ignored_at is null

  union all

  -- ===== תשלומי משרד החינוך (124) =====
  -- 10. תלמוד אומר ששולם, ובבנק לא נמצאה תנועת זכות באותו סכום - 14 ימים אחרי תאריך
  --     החישוב. נעלם מעצמו כשהתנועה נקלטת והתאמה נמצאת.
  select 'talmud_payment_not_in_bank', 'high',
    r.organization_id, 'talmud_report_rows', r.id, (r.data ->> 'amount')::numeric, coalesce(talmud_text_date(r.data ->> 'calc_date'), r.month),
    'משרד החינוך: ' || coalesce(r.data ->> 'payment_type', 'תשלום') ||
      coalesce(' לחודש ' || (r.data ->> 'report_month'), '') ||
      ' · סניף ' || coalesce(r.branch_code, '—') ||
      ' · ' || to_char((r.data ->> 'amount')::numeric, 'FM999,999,990.00') || ' ש"ח' ||
      ' · לא נמצאה תנועה באותו סכום בבנק העמותה · כדאי לבדוק מול דף החשבון'
  from talmud_report_rows r
  where r.report_key = 'institute_payments'
    and coalesce((r.data ->> 'amount')::numeric, 0) > 0
    and coalesce(talmud_text_date(r.data ->> 'calc_date'), r.month) < current_date - 14
    and not exists (select 1 from talmud_payment_bank_links l where l.report_row_id = r.id)

  union all

  -- ===== החזרים מהבנק (125) =====
  -- 11. תנועת זכות שסווגה "החזר תשלום" ואין לה החזרה רשומה - לא נמצאה לה שורת מס"ב
  --     אחת ויחידה באותו סכום. נעלם מעצמו כשההחזרה נרשמת (ידנית או אוטומטית).
  select 'bank_return_unrecorded', 'high',
    a.organization_id, 'bank_transactions', bt.id, bt.amount, bt.execution_date,
    'החזר תשלום בבנק שלא נרשם: ' || to_char(bt.amount, 'FM999,999,990.00') || ' ש"ח' ||
      coalesce(' · ' || left(bt.description, 80), '') ||
      ' · לא נמצא תשלום מס"ב אחד באותו סכום · יש לרשום את ההחזרה במסך ההחזרות'
  from bank_transactions bt
  join organization_bank_accounts a on a.id = bt.organization_bank_account_id
  join bank_transaction_types tt on tt.id = bt.confirmed_type_id and tt.code = 'payment_return'
  where bt.classification_status = 'confirmed' and bt.direction = 'credit'
    and not exists (
      select 1 from bank_matches bm
      where bm.bank_transaction_id = bt.id and bm.target_table = 'payment_returns' and bm.status <> 'rejected'
    )
    -- החזרה שנרשמה ידנית במסך ההחזרות (בלי קישור לתנועה): אותה עמותה, סכום ותאריך סמוך
    and not exists (
      select 1 from payment_returns pr
      join masav_lines ml on ml.id = pr.masav_line_id
      join masav_batches mb on mb.id = ml.batch_id
      where mb.organization_id = a.organization_id
        and abs(pr.amount - bt.amount) < 0.01
        and pr.return_date between bt.execution_date - 10 and bt.execution_date + 10
    )
) ue
left join organizations o on o.id = ue.organization_id
where coalesce(o.is_demo, false) = false;
