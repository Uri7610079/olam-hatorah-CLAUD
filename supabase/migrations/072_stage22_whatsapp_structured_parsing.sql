-- שלב 22 (המשך) - זיהוי אוטומטי של הודעת WhatsApp במבנה קבוע (אפיון V2 §15.5),
-- לפי תשובת Chani לסעיף 4 ביומן ההחלטות: "כן, אם אפשרי. גם מה שלא יסווג יכנס עם כל הטקסט"
-- (ההתנהגות הקיימת - נשארת ללא שינוי לכל הודעה שלא תואמת את המבנה).
--
-- מבנה מזוהה (לא מחייב, בדיוק כמו בדוגמה באפיון):
--   משימה: <כותרת> | אחראים: <שם, שם> | צוות: <שם צוות> | יעד: <תאריך>
-- זיהוי "יעד" תומך בשלושה פורמטים בלבד (לא NLP חופשי - יעד לא-מזוהה פשוט נשאר ריק,
-- לא מומצא): ISO (YYYY-MM-DD), DD/MM או DD/MM/YYYY, ושמות ימי השבוע בעברית ("יום חמישי").
-- אחראים/צוות מזוהים בהתאמה חלקית (ILIKE) מול full_name/label_he - שם שלא נמצא מדולג
-- בשקט, לא חוסם את יצירת המשימה.

create or replace function parse_whatsapp_weekday(p_text text)
returns date
language plpgsql
as $$
declare
  v_names text[] := array['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  v_target_dow integer;
begin
  for v_target_dow in 0..6 loop
    if p_text like '%' || v_names[v_target_dow + 1] || '%' then
      return current_date + (((v_target_dow - extract(dow from current_date)::integer) + 7) % 7);
    end if;
  end loop;
  return null;
end;
$$;

create or replace function parse_whatsapp_due_date(p_text text)
returns date
language plpgsql
as $$
declare
  v_trimmed text := trim(p_text);
  v_weekday date;
begin
  if v_trimmed ~ '^\d{4}-\d{2}-\d{2}$' then
    return v_trimmed::date;
  end if;

  if v_trimmed ~ '^\d{1,2}/\d{1,2}/\d{4}$' then
    return to_date(v_trimmed, 'DD/MM/YYYY');
  end if;

  if v_trimmed ~ '^\d{1,2}/\d{1,2}$' then
    return to_date(v_trimmed || '/' || extract(year from current_date)::text, 'DD/MM/YYYY');
  end if;

  v_weekday := parse_whatsapp_weekday(v_trimmed);
  return v_weekday;
exception when others then
  -- פורמט תאריך לא תקין (למשל "50/50") - לא חוסם, פשוט אין יעד.
  return null;
end;
$$;

-- מפרק "משימה: X | אחראים: Y | צוות: Z | יעד: W" (סדר שדות חופשי, "|" מפריד) לשדות.
-- אם אין שדה "משימה"/"כותרת" בכלל - ההודעה לא נחשבת מובנית (matched=false), ההתנהגות
-- הרגילה (תיבת סיווג ידנית) ממשיכה כרגיל.
create or replace function parse_whatsapp_structured_message(p_body text)
returns table (matched boolean, title text, owner_names text[], team_name text, due_date date)
language plpgsql
as $$
declare
  v_segment text;
  v_key text;
  v_value text;
  v_title text;
  v_owners text;
  v_team text;
  v_due text;
begin
  if p_body is null then
    return query select false, null::text, null::text[], null::text, null::date;
    return;
  end if;

  for v_segment in select unnest(regexp_split_to_array(p_body, '\|')) loop
    v_key := trim(split_part(v_segment, ':', 1));
    v_value := trim(substring(v_segment from position(':' in v_segment) + 1));
    if v_value = '' then
      continue;
    end if;
    if v_key in ('משימה', 'כותרת') then
      v_title := v_value;
    elsif v_key in ('אחראים', 'אחראי') then
      v_owners := v_value;
    elsif v_key = 'צוות' then
      v_team := v_value;
    elsif v_key = 'יעד' then
      v_due := v_value;
    end if;
  end loop;

  if v_title is null then
    return query select false, null::text, null::text[], null::text, null::date;
    return;
  end if;

  return query select
    true,
    v_title,
    case when v_owners is not null then
      (select array_agg(trim(name)) from unnest(string_to_array(v_owners, ',')) as name where trim(name) <> '')
    else null end,
    v_team,
    case when v_due is not null then parse_whatsapp_due_date(v_due) else null end;
end;
$$;

-- ingest_whatsapp_message: אחרי ששלב האימות (secret) וזיהוי הקבוצה עוברים בהצלחה (071),
-- מנסה לפרש את ההודעה כמובנית. אם כן - יוצרת משימה ומסמנת את ההודעה כ-converted מיד
-- (בלי סיווג ידני). אם לא - נשמרת כ-pending בדיוק כמו קודם. יצירת המשימה נעשית בשם
-- מי שחיבר את הקבוצה (whatsapp_groups.created_by) - אין משתמש מחובר אמיתי כאן (Webhook
-- אנונימי), אותו עיקרון בדיוק כמו generate_due_recurrences() שמשתמשת ב-rule.created_by.
create or replace function ingest_whatsapp_message(
  p_secret text,
  p_external_group_id text,
  p_source_message_id text,
  p_sender_name text,
  p_body text,
  p_attachment_url text default null,
  p_received_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stored_secret text;
  v_group_id uuid;
  v_group_created_by uuid;
  v_message_id uuid;
  v_safe_attachment_url text;
  v_parsed record;
  v_new_task_id uuid;
  v_owner_name text;
  v_owner_id uuid;
  v_team_id uuid;
begin
  select secret into v_stored_secret from whatsapp_webhook_config where id = true;
  if v_stored_secret is null or p_secret is distinct from v_stored_secret then
    raise exception 'invalid webhook secret';
  end if;

  select id, created_by into v_group_id, v_group_created_by from whatsapp_groups where external_group_id = p_external_group_id and is_active = true;
  if v_group_id is null then
    return null;
  end if;

  v_safe_attachment_url := case when p_attachment_url ~* '^https?://' then p_attachment_url else null end;

  insert into whatsapp_messages (group_id, source_message_id, sender_name, body, attachment_url, received_at)
  values (v_group_id, p_source_message_id, p_sender_name, p_body, v_safe_attachment_url, p_received_at)
  on conflict (group_id, source_message_id) do nothing
  returning id into v_message_id;

  if v_message_id is null then
    -- כבר קיימת (כפילות מהספק) - לא מנסים לפרש/להמיר שוב.
    select id into v_message_id from whatsapp_messages where group_id = v_group_id and source_message_id = p_source_message_id;
    return v_message_id;
  end if;

  select * into v_parsed from parse_whatsapp_structured_message(p_body);

  if v_parsed.matched then
    insert into tasks (title, description, due_date, source, source_whatsapp_message_id, created_by)
    values (v_parsed.title, p_body, v_parsed.due_date, 'whatsapp', v_message_id, v_group_created_by)
    returning id into v_new_task_id;

    if v_parsed.owner_names is not null then
      foreach v_owner_name in array v_parsed.owner_names loop
        select id into v_owner_id from profiles where status = 'approved' and full_name ilike '%' || v_owner_name || '%' limit 1;
        if v_owner_id is not null then
          insert into task_owners (task_id, user_id) values (v_new_task_id, v_owner_id) on conflict do nothing;
        end if;
      end loop;
    end if;

    if v_parsed.team_name is not null then
      select id into v_team_id from teams where is_active = true and label_he ilike '%' || v_parsed.team_name || '%' limit 1;
      if v_team_id is not null then
        insert into task_teams (task_id, team_id) values (v_new_task_id, v_team_id) on conflict do nothing;
      end if;
    end if;

    update whatsapp_messages set status = 'converted', converted_task_id = v_new_task_id where id = v_message_id;

    insert into task_history (task_id, actor_id, event_type, detail)
    values (v_new_task_id, null, 'converted_from_whatsapp', jsonb_build_object('whatsapp_message_id', v_message_id, 'auto_parsed', true));
  end if;

  return v_message_id;
end;
$$;
