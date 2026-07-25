-- שלב 12 (חלק ד'): סגירת חודש. מרחיב את financial_periods (שלב 8, migration 024) -
-- כבר רץ בפרויקט החי, לכן זה גם live patch (ר' README). מוסיף עמודת status_reason,
-- ומחליף את set_financial_period_status() כך שלא תוכל עוד לקבוע 'closed' ישירות -
-- סגירה אמיתית עוברת אך ורק דרך close_financial_month() עם רשימת התנאים למטה, ופתיחה
-- מחדש של חודש סגור עוברת אך ורק דרך reopen_financial_month() (הרשאה + סיבה חובה).
--
-- 10 התנאים (בדיוק לפי מספר האפיון, לא נאלץ - ר' הסבר ב-get_month_close_checklist):
-- 1. יבוא בנק - אין אצוות פתוחות/לא-קלוטות. 2. חריגות קריטיות - אין אף אחת פתוחה.
-- 3. תנועות לא מזוהות - כולן סווגו סופית. 4. שגיאות תלמוד - אין פתוחות/בטיפול/ממתינות.
-- 5. עמלה - לכל זכאות פעילה יש תוצאת חישוב פעילה. 6. תרומות - אין ממתינות לאישור.
-- 7. חלוקות - אין בטיוטה/בבדיקה. 8. מס"ב - אין שנשארה לפני שידור/ביצוע בפועל.
-- 9. החזרות - אין פתוחות. 10. התאמות - אין הצעה תלויה בלי החלטה.
-- רטרו ודוח הנה"ח הם פריטי סקירה בצ'קליסט (מוצגים), לא תנאי חסימה - אין להם "מצב
-- פתוח/סגור" מובנה בנתונים (רטרו הוא נתון היסטורי append-only; "דוח הנה"ח" הוא דוח
-- שטרם נבנה, לא ישות עם סטטוס - שלב 14).

alter table financial_periods add column if not exists status_reason text;

create or replace function set_financial_period_status(p_period_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_status text;
begin
  if not has_permission('financial_periods', 'manage') then
    raise exception 'permission denied';
  end if;

  if p_status not in ('open', 'in_review', 'closed') then
    raise exception 'invalid status: %', p_status;
  end if;

  select status into v_current_status from financial_periods where id = p_period_id;
  if v_current_status is null then
    raise exception 'חודש כספי לא נמצא';
  end if;

  if v_current_status = 'closed' then
    raise exception 'חודש סגור - פתיחה מחדש דורשת הרשאה וסיבה (reopen_financial_month)';
  end if;
  if p_status = 'closed' then
    raise exception 'סגירת חודש דורשת עמידה ברשימת תנאים (close_financial_month)';
  end if;

  update financial_periods set status = p_status where id = p_period_id;

  perform insert_audit_event('set_financial_period_status', 'financial_periods', p_period_id::text, jsonb_build_object('status', p_status));
end;
$$;

-- get_month_close_checklist(): קריאה בלבד - מחזירה עשרה תנאי הסגירה + ספירת "פתוח"
-- לכל אחד, לתצוגה במסך לפני שמנסים לסגור בפועל.
create or replace function get_month_close_checklist(p_organization_id uuid, p_month date)
returns table (item_key text, label_he text, open_count integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('financial_periods', 'manage') then
    raise exception 'permission denied';
  end if;

  return query
  select 'bank_import'::text, 'יבוא בנק - אצוות פתוחות'::text,
    (select count(*)::integer from bank_import_batches bib
     join organization_bank_accounts oba on oba.id = bib.organization_bank_account_id
     where oba.organization_id = p_organization_id and bib.status in ('uploaded', 'analyzed', 'previewed'))
  union all
  select 'critical_exceptions', 'חריגות קריטיות פתוחות',
    (select count(*)::integer from bank_reconciliation_exceptions e
     where e.organization_id = p_organization_id and e.severity = 'critical')
  union all
  select 'unidentified_transactions', 'תנועות בנק לא מסווגות סופית',
    (select count(*)::integer from bank_transactions bt
     join organization_bank_accounts oba on oba.id = bt.organization_bank_account_id
     where oba.organization_id = p_organization_id and bt.classification_status <> 'confirmed'
       and date_trunc('month', bt.execution_date)::date = p_month)
  union all
  select 'talmud_errors', 'שגיאות תלמוד פתוחות/בטיפול',
    (select count(*)::integer from talmud_errors te
     where te.organization_id = p_organization_id and te.month = p_month
       and te.status in ('open', 'in_progress', 'pending_info'))
  union all
  select 'commission', 'זכאויות ללא חישוב עמלה',
    (select count(*)::integer from monthly_eligibility me
     where me.organization_id = p_organization_id and me.month = p_month and me.status = 'active'
       and not exists (
         select 1 from eligibility_financial_results efr
         where efr.eligibility_id = me.id and efr.status = 'active'
       ))
  union all
  select 'donations', 'תרומות ממתינות לאישור',
    (select count(*)::integer from donations d
     where d.organization_id = p_organization_id and d.status = 'pending'
       and date_trunc('month', d.donation_date)::date = p_month)
  union all
  select 'distributions', 'הוראות חלוקה בטיוטה/בבדיקה',
    (select count(*)::integer from distribution_batches db
     where db.organization_id = p_organization_id and db.period_month = p_month
       and db.status in ('draft', 'in_review'))
  union all
  select 'masav', 'אצוות מס"ב שטרם שודרו/בוצעו',
    (select count(*)::integer from masav_batches mb
     where mb.organization_id = p_organization_id and mb.period_month = p_month
       and mb.status in ('draft', 'pending_review', 'pending_approval', 'approved', 'file_generated'))
  union all
  select 'returns', 'החזרות תשלום פתוחות',
    (select count(*)::integer from payment_returns pr
     join masav_lines ml on ml.id = pr.masav_line_id
     join masav_batches mb on mb.id = ml.batch_id
     where mb.organization_id = p_organization_id and mb.period_month = p_month
       and pr.status = 'open')
  union all
  select 'bank_matches', 'התאמות בנק ממתינות להחלטה',
    (select count(*)::integer from bank_matches bm
     join organization_bank_accounts oba on oba.id = (select organization_bank_account_id from bank_transactions bt where bt.id = bm.bank_transaction_id)
     where oba.organization_id = p_organization_id and bm.status = 'suggested');
end;
$$;

grant execute on function get_month_close_checklist(uuid, date) to authenticated;

-- close_financial_month(): מריצה מחדש את כל עשרת התנאים בשרת (לא סומכת על מה שהוצג
-- בלקוח) - אוספת את כל הכשלים ומעלה חריגה אחת עם כולם, לא רק הראשון שנתקל.
create or replace function close_financial_month(p_organization_id uuid, p_month date, p_period_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_failures text[] := array[]::text[];
  v_item record;
begin
  if not has_permission('financial_periods', 'manage') then
    raise exception 'permission denied';
  end if;

  select status into v_status from financial_periods where id = p_period_id;
  if v_status is null then
    raise exception 'חודש כספי לא נמצא';
  end if;
  if v_status = 'closed' then
    raise exception 'החודש כבר סגור';
  end if;

  for v_item in select * from get_month_close_checklist(p_organization_id, p_month) loop
    if v_item.open_count > 0 then
      v_failures := array_append(v_failures, v_item.label_he || ' (' || v_item.open_count || ')');
    end if;
  end loop;

  if array_length(v_failures, 1) > 0 then
    raise exception 'לא ניתן לסגור את החודש - תנאים פתוחים: %', array_to_string(v_failures, '; ');
  end if;

  update financial_periods set status = 'closed', closed_at = now() where id = p_period_id;

  perform insert_audit_event('close_financial_month', 'financial_periods', p_period_id::text, jsonb_build_object('organization_id', p_organization_id, 'month', p_month));
end;
$$;

grant execute on function close_financial_month(uuid, date, uuid) to authenticated;

-- reopen_financial_month(): הדרך היחידה לפתוח מחדש חודש סגור - הרשאה (כבר נבדקת) + סיבה חובה.
create or replace function reopen_financial_month(p_period_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not has_permission('financial_periods', 'manage') then
    raise exception 'permission denied';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'נדרשת סיבה לפתיחה מחדש של חודש סגור';
  end if;

  select status into v_status from financial_periods where id = p_period_id;
  if v_status is null then
    raise exception 'חודש כספי לא נמצא';
  end if;
  if v_status <> 'closed' then
    raise exception 'ניתן לפתוח מחדש רק חודש סגור (סטטוס נוכחי: %)', v_status;
  end if;

  update financial_periods set status = 'open', closed_at = null, status_reason = p_reason where id = p_period_id;

  perform insert_audit_event('reopen_financial_month', 'financial_periods', p_period_id::text, jsonb_build_object('reason', p_reason));
end;
$$;

grant execute on function reopen_financial_month(uuid, text) to authenticated;
