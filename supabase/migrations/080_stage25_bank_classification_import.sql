-- שלב 25: יבוא/יצוא אקסל למסך "בנק - סיווג תנועות" (BankClassificationScreen.tsx), לבקשת
-- הלקוח להוסיף יבוא/יצוא אקסל לכל מסך שבו מוסיפים רשומות ידנית. שני הטאבים במסך הזה
-- (סוגי תנועה, כללי זיהוי) חיים כבר, אז שני פרופילים + שני commit RPCs באותו קובץ, לא שני
-- קבצים נפרדים - אותה נקודת גישה בדיוק כמו master_data (054, כמה טבלאות יעד, פרופיל אחד
-- לכל טבלה, אותו קובץ). על גבי מנוע היבוא הכללי (import_profiles/import_batches/import_rows,
-- שלב 5) - לא reuse-ing את bank_import_batches/rows הייעודי לבנק (036), כי זה לא יבוא תנועות
-- בנק בעצמו, אלא יבוא-קטלוג/הגדרות, בדיוק כמו master_data.

insert into import_profiles (key, label_he, description) values
  ('bank_transaction_types', 'קטלוג סוגי תנועת בנק', 'עמודות צפויות: קוד (חובה, ייחודי גלובלית), תווית (חובה).'),
  ('recognition_rules', 'כללי זיהוי בנק', 'עמודות צפויות: חשבון בנק (לא חובה - "שם בנק · מספר ממוסך" בדיוק כפי שמוצג בטבלת הכללים/ביצוא; ריק = כל החשבונות), כיוון (חובה/זכות, לא חובה), סוג התאמת טקסט (מכיל/מתחיל ב), ערך התאמת טקסט (שני השדות האחרונים תמיד ביחד או ריקים ביחד), שם צד שכנגד, סכום מינימום, סכום מקסימום, התאמת אסמכתה, תקף מתאריך, תקף עד תאריך, קוד סוג תנועה מוצע (חובה - קוד קיים בקטלוג סוגי תנועה), רמת ביטחון (גבוהה/בינונית/נמוכה, חובה), עדיפות (מספר, ברירת מחדל 0).');

-- commit_transaction_types_import_batch(): הכי פשוט במערכת - שני שדות טקסט, אילוץ ייחודיות
-- יחיד (code). מסמנת invalid בלי לחסום את שאר האצווה, בדיוק כמו כל commit RPC אחר (עיקרון
-- קבוע מאז commit_eligibility_batch, שלב 6): קוד שכבר קיים (בטבלה או בשורה קודמת באותה
-- אצווה עצמה - הבדיקה "exists" רואה גם שורות שכבר נכתבו קודם באותה לולאה/טרנזקציה) לא אמור
-- להפיל את כל היבוא, רק את השורה הזו.
create or replace function commit_transaction_types_import_batch(p_batch_id uuid)
returns table (created_count integer, invalid_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_status text;
  v_open_rows integer;
  v_row record;
  v_code text;
  v_label text;
  v_created integer := 0;
  v_invalid integer := 0;
begin
  if not has_permission('transaction_classification', 'perform') then
    raise exception 'permission denied';
  end if;

  select ib.status into v_batch_status
  from import_batches ib join import_profiles ip on ip.id = ib.profile_id
  where ib.id = p_batch_id and ip.key = 'bank_transaction_types';
  if v_batch_status is null then
    raise exception 'האצווה אינה מפרופיל יבוא סוגי תנועה';
  end if;
  if v_batch_status not in ('uploaded', 'analyzed', 'previewed') then
    raise exception 'לא ניתן לקלוט אצווה בסטטוס %', v_batch_status;
  end if;

  select count(*) into v_open_rows from import_rows where batch_id = p_batch_id and status = 'needs_decision';
  if v_open_rows > 0 then
    raise exception 'לא ניתן לקלוט אצווה עם % שורות שטרם הוכרעו ("דורש החלטה")', v_open_rows;
  end if;

  for v_row in select * from import_rows where batch_id = p_batch_id and status = 'valid' order by row_number loop
    v_code := nullif(trim(v_row.raw ->> 'קוד'), '');
    v_label := nullif(trim(v_row.raw ->> 'תווית'), '');

    if v_code is null or v_label is null then
      update import_rows set status = 'invalid', error_message = 'קוד ותווית הם שדות חובה' where id = v_row.id;
      v_invalid := v_invalid + 1;
      continue;
    end if;

    if exists (select 1 from bank_transaction_types where code = v_code) then
      update import_rows set status = 'invalid', error_message = format('קוד "%s" כבר קיים בקטלוג', v_code) where id = v_row.id;
      v_invalid := v_invalid + 1;
      continue;
    end if;

    begin
      insert into bank_transaction_types (code, label_he) values (v_code, v_label);
      update import_rows set status = 'committed' where id = v_row.id;
      v_created := v_created + 1;
    exception when others then
      update import_rows set status = 'invalid', error_message = 'שגיאה בעיבוד השורה: ' || sqlerrm where id = v_row.id;
      v_invalid := v_invalid + 1;
    end;
  end loop;

  update import_batches set
    valid_count = (select count(*) from import_rows where batch_id = p_batch_id and status in ('valid', 'committed')),
    needs_decision_count = (select count(*) from import_rows where batch_id = p_batch_id and status = 'needs_decision'),
    invalid_count = (select count(*) from import_rows where batch_id = p_batch_id and status = 'invalid')
  where id = p_batch_id;

  perform set_config('app.allow_batch_commit', 'true', true);
  update import_batches set status = 'committed', committed_at = now() where id = p_batch_id;

  perform insert_audit_event(
    'commit_transaction_types_import_batch', 'import_batches', p_batch_id::text,
    jsonb_build_object('created', v_created, 'invalid', v_invalid)
  );

  created_count := v_created;
  invalid_count := v_invalid;
  return next;
end;
$$;

grant execute on function commit_transaction_types_import_batch(uuid) to authenticated;

-- commit_recognition_rules_import_batch(): תשעה עמודות אופציונליות + שלוש חובה
-- (סוג תנועה מוצע, רמת ביטחון - ושדה חשבון-בנק, שהוא אופציונלי מתוך עיצוב, לא נבדק בטעות
-- כחובה). כל אילוצי ה-check שב-recognition_rules (036) מאומתים כאן במפורש עם הודעה ברורה
-- בעברית *לפני* ה-INSERT, כדי שהמשתמש יידע בדיוק מה לתקן בקובץ - לא רק "שגיאת בסיס נתונים"
-- גנרית; ה-INSERT עצמו עדיין עטוף ב-exception כרשת ביטחון נוספת (אותו עיקרון כמו כל commit
-- RPC אחר), למקרה של אילוץ שלא נצפה כאן במפורש.
create or replace function commit_recognition_rules_import_batch(p_batch_id uuid)
returns table (created_count integer, invalid_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_status text;
  v_open_rows integer;
  v_row record;
  v_account_text text;
  v_account_id uuid;
  v_direction_raw text;
  v_direction text;
  v_match_type_raw text;
  v_match_type text;
  v_match_value text;
  v_counterparty text;
  v_amount_min numeric(12, 2);
  v_amount_max numeric(12, 2);
  v_reference text;
  v_from_raw text;
  v_until_raw text;
  v_effective_from date;
  v_effective_until date;
  v_type_code text;
  v_type_id uuid;
  v_confidence_raw text;
  v_confidence text;
  v_priority_raw text;
  v_priority integer;
  v_is_invalid boolean;
  v_error text;
  v_created integer := 0;
  v_invalid integer := 0;
begin
  if not has_permission('transaction_classification', 'perform') then
    raise exception 'permission denied';
  end if;

  select ib.status into v_batch_status
  from import_batches ib join import_profiles ip on ip.id = ib.profile_id
  where ib.id = p_batch_id and ip.key = 'recognition_rules';
  if v_batch_status is null then
    raise exception 'האצווה אינה מפרופיל יבוא כללי זיהוי';
  end if;
  if v_batch_status not in ('uploaded', 'analyzed', 'previewed') then
    raise exception 'לא ניתן לקלוט אצווה בסטטוס %', v_batch_status;
  end if;

  select count(*) into v_open_rows from import_rows where batch_id = p_batch_id and status = 'needs_decision';
  if v_open_rows > 0 then
    raise exception 'לא ניתן לקלוט אצווה עם % שורות שטרם הוכרעו ("דורש החלטה")', v_open_rows;
  end if;

  for v_row in select * from import_rows where batch_id = p_batch_id and status = 'valid' order by row_number loop
    v_is_invalid := false;
    v_error := null;

    -- חשבון בנק: לא חובה. אם צוין, חייב להתאים בדיוק לטקסט "שם בנק · מספר ממוסך" כפי
    -- שמוצג בטבלת הכללים ובקובץ היצוא - ר' הערת organization_bank_accounts_view (005/060):
    -- מספר החשבון המלא אינו נחשף כלל מחוץ ל-reveal RPC ייעודי, כך שהתאמה יכולה להיעשות
    -- רק מול הטקסט הממוסך שהמשתמש רואה בפועל. "לא נמצא אך לא ריק" מסומן invalid במפורש
    -- (לא null בשקט) - כדי שלא ייווצר כלל עם scope שגוי בלי שהמשתמש ישים לב.
    v_account_text := nullif(trim(v_row.raw ->> 'חשבון בנק'), '');
    v_account_id := null;
    if v_account_text is not null then
      select id into v_account_id
      from organization_bank_accounts_view
      where trim(coalesce(bank_name, '') || ' · ' || coalesce(account_number_masked, '')) = v_account_text
      limit 1;
      if v_account_id is null then
        v_is_invalid := true;
        v_error := format('לא נמצא חשבון בנק התואם לטקסט "%s" (יש להעתיק בדיוק מעמודת "חשבון" בטבלת הכללים)', v_account_text);
      end if;
    end if;

    v_direction_raw := nullif(trim(v_row.raw ->> 'כיוון'), '');
    v_direction := case v_direction_raw
      when 'חובה' then 'debit'
      when 'זכות' then 'credit'
      when 'debit' then 'debit'
      when 'credit' then 'credit'
      else null
    end;
    if v_direction_raw is not null and v_direction is null then
      v_is_invalid := true;
      v_error := coalesce(v_error, format('ערך כיוון לא מוכר: "%s" (חובה/זכות)', v_direction_raw));
    end if;

    v_match_type_raw := nullif(trim(v_row.raw ->> 'סוג התאמת טקסט'), '');
    v_match_value := nullif(trim(v_row.raw ->> 'ערך התאמת טקסט'), '');
    v_match_type := case v_match_type_raw
      when 'מכיל' then 'contains'
      when 'מתחיל ב' then 'starts_with'
      when 'contains' then 'contains'
      when 'starts_with' then 'starts_with'
      else null
    end;
    if v_match_type_raw is not null and v_match_type is null then
      v_is_invalid := true;
      v_error := coalesce(v_error, format('סוג התאמת טקסט לא מוכר: "%s" (מכיל/מתחיל ב)', v_match_type_raw));
    elsif (v_match_type is null) <> (v_match_value is null) then
      -- אילוץ ה-DB (036): שני השדות תמיד ביחד או ריקים ביחד.
      v_is_invalid := true;
      v_error := coalesce(v_error, 'סוג התאמת טקסט וערך התאמת טקסט חייבים להיות שניהם מלאים או שניהם ריקים');
    end if;

    v_counterparty := nullif(trim(v_row.raw ->> 'שם צד שכנגד'), '');
    v_reference := nullif(trim(v_row.raw ->> 'התאמת אסמכתה'), '');

    v_amount_min := null;
    begin
      if nullif(trim(v_row.raw ->> 'סכום מינימום'), '') is not null then
        v_amount_min := (regexp_replace(v_row.raw ->> 'סכום מינימום', '[^0-9.\-]', '', 'g'))::numeric;
      end if;
    exception when others then
      v_is_invalid := true;
      v_error := coalesce(v_error, format('סכום מינימום אינו מספר תקין: "%s"', v_row.raw ->> 'סכום מינימום'));
    end;

    v_amount_max := null;
    begin
      if nullif(trim(v_row.raw ->> 'סכום מקסימום'), '') is not null then
        v_amount_max := (regexp_replace(v_row.raw ->> 'סכום מקסימום', '[^0-9.\-]', '', 'g'))::numeric;
      end if;
    exception when others then
      v_is_invalid := true;
      v_error := coalesce(v_error, format('סכום מקסימום אינו מספר תקין: "%s"', v_row.raw ->> 'סכום מקסימום'));
    end;

    v_from_raw := nullif(trim(v_row.raw ->> 'תקף מתאריך'), '');
    v_effective_from := null;
    begin
      if v_from_raw is not null then
        v_effective_from := v_from_raw::date;
      end if;
    exception when others then
      v_is_invalid := true;
      v_error := coalesce(v_error, format('"תקף מתאריך" אינו תאריך תקין: "%s"', v_from_raw));
    end;

    v_until_raw := nullif(trim(v_row.raw ->> 'תקף עד תאריך'), '');
    v_effective_until := null;
    begin
      if v_until_raw is not null then
        v_effective_until := v_until_raw::date;
      end if;
    exception when others then
      v_is_invalid := true;
      v_error := coalesce(v_error, format('"תקף עד תאריך" אינו תאריך תקין: "%s"', v_until_raw));
    end;

    if v_effective_from is not null and v_effective_until is not null and v_effective_until < v_effective_from then
      v_is_invalid := true;
      v_error := coalesce(v_error, '"תקף עד תאריך" מוקדם מ"תקף מתאריך"');
    end if;

    -- סוג תנועה מוצע: חובה (FK). התאמה לפי code, לא label_he - אותו עיקרון כמו התאמת
    -- תלמיד לפי external_id (לא שם) בכל commit RPC אחר.
    v_type_code := nullif(trim(v_row.raw ->> 'קוד סוג תנועה מוצע'), '');
    v_type_id := null;
    if v_type_code is null then
      v_is_invalid := true;
      v_error := coalesce(v_error, 'קוד סוג תנועה מוצע הוא שדה חובה');
    else
      select id into v_type_id from bank_transaction_types where code = v_type_code;
      if v_type_id is null then
        v_is_invalid := true;
        v_error := coalesce(v_error, format('לא נמצא סוג תנועה עם קוד "%s"', v_type_code));
      end if;
    end if;

    -- רמת ביטחון: חובה, אנום קבוע. מתקבל גם התרגום העברי לתצוגה (התאמה לפורמט היצוא) וגם
    -- הערך האנגלי הגולמי, לנוחות קובץ שהוכן ידנית.
    v_confidence_raw := nullif(trim(v_row.raw ->> 'רמת ביטחון'), '');
    v_confidence := case v_confidence_raw
      when 'גבוהה' then 'high'
      when 'בינונית' then 'medium'
      when 'נמוכה' then 'low'
      when 'high' then 'high'
      when 'medium' then 'medium'
      when 'low' then 'low'
      else null
    end;
    if v_confidence_raw is null then
      v_is_invalid := true;
      v_error := coalesce(v_error, 'רמת ביטחון היא שדה חובה');
    elsif v_confidence is null then
      v_is_invalid := true;
      v_error := coalesce(v_error, format('רמת ביטחון לא מוכרת: "%s" (גבוהה/בינונית/נמוכה)', v_confidence_raw));
    end if;

    v_priority_raw := nullif(trim(v_row.raw ->> 'עדיפות'), '');
    if v_priority_raw is null then
      v_priority := 0;
    else
      begin
        v_priority := round(v_priority_raw::numeric)::integer;
      exception when others then
        v_is_invalid := true;
        v_error := coalesce(v_error, format('עדיפות אינה מספר שלם תקין: "%s"', v_priority_raw));
        v_priority := 0;
      end;
    end if;

    if v_is_invalid then
      update import_rows set status = 'invalid', error_message = v_error where id = v_row.id;
      v_invalid := v_invalid + 1;
      continue;
    end if;

    begin
      insert into recognition_rules (
        organization_bank_account_id, direction, text_match_type, text_match_value,
        counterparty_name, amount_min, amount_max, reference_match,
        effective_from, effective_until, suggested_type_id, confidence_level, priority
      ) values (
        v_account_id, v_direction, v_match_type, v_match_value,
        v_counterparty, v_amount_min, v_amount_max, v_reference,
        v_effective_from, v_effective_until, v_type_id, v_confidence, v_priority
      );
      update import_rows set status = 'committed' where id = v_row.id;
      v_created := v_created + 1;
    exception when others then
      update import_rows set status = 'invalid', error_message = 'שגיאה בעיבוד השורה: ' || sqlerrm where id = v_row.id;
      v_invalid := v_invalid + 1;
    end;
  end loop;

  update import_batches set
    valid_count = (select count(*) from import_rows where batch_id = p_batch_id and status in ('valid', 'committed')),
    needs_decision_count = (select count(*) from import_rows where batch_id = p_batch_id and status = 'needs_decision'),
    invalid_count = (select count(*) from import_rows where batch_id = p_batch_id and status = 'invalid')
  where id = p_batch_id;

  perform set_config('app.allow_batch_commit', 'true', true);
  update import_batches set status = 'committed', committed_at = now() where id = p_batch_id;

  perform insert_audit_event(
    'commit_recognition_rules_import_batch', 'import_batches', p_batch_id::text,
    jsonb_build_object('created', v_created, 'invalid', v_invalid)
  );

  created_count := v_created;
  invalid_count := v_invalid;
  return next;
end;
$$;

grant execute on function commit_recognition_rules_import_batch(uuid) to authenticated;
