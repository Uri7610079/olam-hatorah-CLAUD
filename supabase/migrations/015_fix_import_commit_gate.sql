-- תיקון: commit_import_batch() חסמה סגירת אצווה גם על שורות 'invalid', בלי שהייתה
-- דרך "לסיים איתן" - שורה ריקה בסוף קובץ (למשל) הייתה תוקעת את האצווה לצמיתות, כי אין
-- פעולה שמעבירה שורה שגויה למצב אחר מלבד "תקין" (שלא תמיד נכון) או "שגוי" (חוזר לאותו מקום).
--
-- הכלל הנכון: 'needs_decision' חוסם (המשתמש עדיין לא החליט), 'invalid' לא חוסם -
-- שורה שגויה נשארת מחוץ לאצווה הסגורה, וזה תקין ("יובאו 149 שורות, 1 שורה נפסלה").
create or replace function commit_import_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open_rows integer;
begin
  if not has_permission('import', 'perform') then
    raise exception 'permission denied';
  end if;

  select count(*) into v_open_rows
  from import_rows
  where batch_id = p_batch_id and status = 'needs_decision';

  if v_open_rows > 0 then
    raise exception 'לא ניתן לסגור אצווה עם % שורות שטרם הוכרעו ("דורש החלטה")', v_open_rows;
  end if;

  update import_rows set status = 'committed' where batch_id = p_batch_id and status = 'valid';

  perform set_config('app.allow_batch_commit', 'true', true);
  update import_batches set status = 'committed', committed_at = now() where id = p_batch_id;

  perform insert_audit_event('commit_import_batch', 'import_batches', p_batch_id::text, null);
end;
$$;
