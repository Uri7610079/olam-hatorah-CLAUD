-- תיקון: קליטת הבנק נכשלה ב-"function min(uuid) does not exist" (2026-11-19)
--
-- אחרי התיקון של 126 הקליטה התקדמה שלב, ונפלה בשלב סימון הכפילויות בתוך אותו קובץ:
-- ingest_bank_transactions_core (123/124) משתמשת ב-min(br2.id) כדי להשאיר שורה אחת מכל
-- כפילות, ו-Postgres אינו מגדיר min/max לשדה מסוג uuid. במקום להעתיק שוב את כל
-- הפונקציה, מוסיפים את הצבירה החסרה - ואז הקוד הקיים עובד כמו שהוא.

create or replace function uuid_smaller(a uuid, b uuid)
returns uuid
language sql
immutable
parallel safe
as $$ select case when a is null then b when b is null then a when a < b then a else b end $$;

create or replace function uuid_larger(a uuid, b uuid)
returns uuid
language sql
immutable
parallel safe
as $$ select case when a is null then b when b is null then a when a > b then a else b end $$;

do $$
begin
  if not exists (
    select 1 from pg_aggregate a join pg_proc p on p.oid = a.aggfnoid
    where p.proname = 'min' and p.proargtypes = '2950'::oidvector
  ) then
    create aggregate public.min(uuid) (sfunc = uuid_smaller, stype = uuid, combinefunc = uuid_smaller, sortop = <, parallel = safe);
  end if;
  if not exists (
    select 1 from pg_aggregate a join pg_proc p on p.oid = a.aggfnoid
    where p.proname = 'max' and p.proargtypes = '2950'::oidvector
  ) then
    create aggregate public.max(uuid) (sfunc = uuid_larger, stype = uuid, combinefunc = uuid_larger, sortop = >, parallel = safe);
  end if;
end $$;

-- הקליטות שנכשלו בגלל התקלה הזו - המשיכה הבאה תקלוט את התנועות שלהן מחדש.
update bank_auto_sync_runs
set is_resolved = true, resolved_at = now()
where status = 'failed' and is_resolved = false and error_message like '%function min(uuid) does not exist%';
