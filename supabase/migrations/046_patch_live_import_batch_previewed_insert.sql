-- Patch לפרויקט החי: תוקן אחרי שנתפס בבדיקה חיה של שלב 13 (יבוא רשימת חסרים לביקורת),
-- אבל זה לא באג של שלב 13 - זו רגרסיה שגרם לה ה-patch של 034 (ביקורת רוחבית לקראת
-- שלב 11): 034 החמיר את import_batches_enforce_commit כך ש-INSERT ישיר חייב
-- status='uploaded' בדיוק. אבל lib/importBatches.ts (createImportBatch) - הפונקציה
-- המשותפת שמשמשת את מרכז השגיאות, הזכאות, ועכשיו הביקורות - יוצרת את שורת האצווה
-- ישר במצב 'previewed' (הקובץ כבר נותח וסווג בצד לקוח לפני שהשורה נוצרת בכלל). מהרגע
-- ש-034 רץ בפרויקט החי, כל יבוא דרך המנוע הכללי (מרכז שגיאות/זכאות) היה למעשה שבור -
-- לא נתפס כי הביקורת החוזרת של אז בדקה RLS/ספר תנועות/גבולות הרשאה, לא יבוא-מאפס דרך
-- המסכים האלה בפועל. נתפס עכשיו כי שלב 13 (ביקורות) השתמש באותה תשתית משותפת בדיוק
-- ונכשל בהעלאה הראשונה שלו. 013/034 עודכנו בדיסק לגרסה המתוקנת (מתירה גם 'previewed');
-- זהו ה-patch לפרויקט הקיים.

create or replace function enforce_import_batch_commit()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
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
