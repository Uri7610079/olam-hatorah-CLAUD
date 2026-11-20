-- 139: ממצאים בינוניים מביקורת האבטחה (20.11).
--
-- 1. ממצא 13 - שורת חלוקה לא עוברת בין אצוות. עד היום הבדיקה בדקה רק את האצווה שאליה
--    השורה עוברת (שבטיוטה), ולא את האצווה שממנה היא יוצאת. כך אפשר היה להוציא שורה
--    מאצווה מאושרת או נעולה למס"ב בעדכון אחד. מעכשיו האצווה של שורה קיימת לא משתנה
--    בכלל, ושתי האצוות נבדקות. שאר הכללים בדיוק כמו קודם (עריכה רק בטיוטה).
--
-- 2. ממצא 9 - פיצול משימות ב-OpenAI. עד היום כל מי שמחובר, גם משתמש שעוד ממתין לאישור,
--    יכול היה להפעיל אותו בלי הגבלה, וכל הפעלה עולה כסף. claim_ai_task_parse() נקראת
--    מהשרת לפני כל פנייה ל-OpenAI: רק משתמש מאושר עם הרשאת יצירת משימות, ועד 30
--    הפעלות בשעה למשתמש. כל הפעלה נרשמת ביומן. כשהבקשה נדחית, המסך עובר לפיצול הפשוט.
--
-- שום נתון קיים לא משתנה: פונקציית טריגר מוחלפת, פונקציה חדשה ואינדקס חדש.

-- ===== 1 =====
create or replace function enforce_distribution_lines_mutation()
returns trigger
language plpgsql
as $$
declare
  v_batch_status text;
begin
  if tg_op = 'UPDATE' and new.batch_id is distinct from old.batch_id then
    raise exception 'לא ניתן להעביר שורת חלוקה מאצווה לאצווה';
  end if;
  select status into v_batch_status from distribution_batches where id = coalesce(new.batch_id, old.batch_id);
  if v_batch_status is distinct from 'draft' then
    raise exception 'ניתן לערוך שורות חלוקה רק כאשר האצווה בטיוטה (סטטוס נוכחי: %)', v_batch_status;
  end if;
  return coalesce(new, old);
end;
$$;

-- ===== 2 =====
create index if not exists audit_events_ai_task_parse_idx
  on audit_events (actor_id, created_at desc) where action = 'ai_task_parse';

create or replace function claim_ai_task_parse()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null or not has_permission('tasks', 'create') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select count(*) into v_count from audit_events
  where action = 'ai_task_parse' and actor_id = auth.uid() and created_at > now() - interval '1 hour';
  if v_count >= 30 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;
  perform insert_audit_event('ai_task_parse', 'tasks', null, null);
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function claim_ai_task_parse() from public, anon;
grant execute on function claim_ai_task_parse() to authenticated;
