-- שלב 12 (חלק ג'): הרחבת payment_returns (שלב 10) - שני כללים חדשים מהאפיון:
-- "חסום תשלום חוזר עד אימות חשבון חדש" ו-"סגור רק לאחר התאמת התשלום החוזר לבנק".
-- מרחיב את enforce_payment_return_mutation הקיימת (לא יוצר טריגר/RPC נפרד) - היא כבר
-- הדרך היחידה לעדכן retry_masav_line_id/status דרך UPDATE ישיר (עם הרשאת
-- payment_returns.manage), אז זה המקום הנכון לאכוף את שני הכללים.
create or replace function enforce_payment_return_mutation()
returns trigger
language plpgsql
as $$
declare
  v_account_ok boolean;
  v_batch_status text;
begin
  if new.masav_line_id is distinct from old.masav_line_id
     or new.return_date is distinct from old.return_date
     or new.amount is distinct from old.amount
     or new.reason is distinct from old.reason then
    raise exception 'לא ניתן לערוך את פרטי ההחזרה הכספיים (תשלום/תאריך/סכום/סיבה) - ניתן לעדכן רק סטטוס/הערות/חשבון חדש/קישור לתשלום חוזר';
  end if;

  -- חסימת תשלום חוזר עד אימות חשבון חדש: קישור retry_masav_line_id (לראשונה) מותר
  -- רק אם new_bank_account_id מוגדר ומאומת בפועל.
  if new.retry_masav_line_id is distinct from old.retry_masav_line_id and new.retry_masav_line_id is not null then
    if new.new_bank_account_id is null then
      raise exception 'לא ניתן לקשר תשלום חוזר בלי חשבון בנק חדש מוגדר';
    end if;

    select (verification_status = 'verified' and is_active = true) into v_account_ok
    from student_bank_accounts where id = new.new_bank_account_id;

    if not coalesce(v_account_ok, false) then
      raise exception 'לא ניתן לקשר תשלום חוזר לפני שהחשבון החדש אומת';
    end if;
  end if;

  -- סגירה (resolved) רק לאחר שהתשלום החוזר בפועל הותאם ואושר מול הבנק - נבדק דרך
  -- מצב אצוות המס"ב של שורת התשלום החוזר (מגיע ל-bank_completed רק דרך
  -- approve_bank_match(), שלב 12).
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    if new.retry_masav_line_id is null then
      raise exception 'לא ניתן לסגור החזרה בלי תשלום חוזר מקושר';
    end if;

    select mb.status into v_batch_status
    from masav_lines ml join masav_batches mb on mb.id = ml.batch_id
    where ml.id = new.retry_masav_line_id;

    if v_batch_status is distinct from 'bank_completed' then
      raise exception 'ניתן לסגור החזרה רק לאחר שהתשלום החוזר הותאם ואושר בפועל מול הבנק';
    end if;
  end if;

  return new;
end;
$$;
