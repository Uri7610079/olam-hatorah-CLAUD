-- שלב 35ג: תשובה לשאלה של ראש קבוצה - עם קובץ מצורף.
--
-- המשרד יכול לצרף לתשובה קובץ (טופס, אישור, הוראות), וראש הקבוצה מוריד אותו
-- מהפורטל. הקובץ נשמר כמו הקובץ שראש הקבוצה מצרף לשאלה: עד 5MB, בתוך הטבלה.

alter table portal_questions add column if not exists answer_attachment_name text;
alter table portal_questions add column if not exists answer_attachment_type text;
alter table portal_questions add column if not exists answer_attachment_data bytea;

-- תשובה: זהה ל-111, ונוסף קובץ. החתימה הישנה (2 פרמטרים) נמחקת - שתי גרסאות
-- באותו שם מבלבלות את PostgREST.
drop function if exists portal_answer_question(uuid, text);
create or replace function portal_answer_question(
  p_question_id uuid, p_answer text,
  p_file_name text default null, p_file_type text default null, p_file_base64 text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_file bytea;
begin
  if not has_permission('students', 'manage') then
    raise exception 'permission denied';
  end if;
  if coalesce(p_file_base64, '') <> '' then
    v_file := decode(p_file_base64, 'base64');
    if octet_length(v_file) > 5 * 1024 * 1024 then raise exception 'הקובץ גדול מ-5MB'; end if;
  end if;
  -- תשובה בכתב, או קובץ, או שניהם. אבל לא כלום.
  if coalesce(btrim(p_answer), '') = '' and v_file is null then raise exception 'יש לכתוב תשובה או לצרף קובץ'; end if;
  update portal_questions
    set answer = nullif(btrim(coalesce(p_answer, '')), ''), status = 'answered', answered_by = auth.uid(), answered_at = now(),
        answer_attachment_name = case when v_file is not null then nullif(btrim(p_file_name), '') end,
        answer_attachment_type = case when v_file is not null then nullif(btrim(p_file_type), '') end,
        answer_attachment_data = v_file
    where id = p_question_id;
  if not found then raise exception 'השאלה לא נמצאה'; end if;
  perform insert_audit_event('portal_question_answered', 'portal_questions', p_question_id::text, null);
end;
$$;

-- השאלות שלי: זהה ל-111, ונוסף שם הקובץ שבתשובה. סוג ההחזרה משתנה - drop.
drop function if exists portal_my_questions(text);
create or replace function portal_my_questions(p_token text)
returns table (
  id uuid, student_name text, context text, body text, attachment_name text,
  status text, answer text, answer_attachment_name text, answered_at timestamptz, created_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_leader uuid := portal_session_leader(p_token);
begin
  return query
  select q.id, s.full_name, q.context, q.body, q.attachment_name, q.status, q.answer, q.answer_attachment_name, q.answered_at, q.created_at
  from portal_questions q
  left join students s on s.id = q.student_id
  where q.group_leader_id = v_leader
  order by q.created_at desc
  limit 200;
end;
$$;

-- ראש הקבוצה מוריד את הקובץ שבתשובה - רק לשאלה שלו
create or replace function portal_answer_attachment_for_leader(p_token text, p_question_id uuid)
returns table (file_name text, file_type text, file_base64 text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_leader uuid := portal_session_leader(p_token);
begin
  return query
  select q.answer_attachment_name, q.answer_attachment_type, encode(q.answer_attachment_data, 'base64')
  from portal_questions q
  where q.id = p_question_id and q.group_leader_id = v_leader and q.answer_attachment_data is not null;
end;
$$;

-- המשרד רואה את הקובץ שצורף לתשובה
create or replace function portal_answer_attachment(p_question_id uuid)
returns table (file_name text, file_type text, file_base64 text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('area_ops', 'access') then raise exception 'permission denied'; end if;
  return query
  select q.answer_attachment_name, q.answer_attachment_type, encode(q.answer_attachment_data, 'base64')
  from portal_questions q where q.id = p_question_id and q.answer_attachment_data is not null;
end;
$$;

revoke execute on function portal_answer_question(uuid, text, text, text, text) from public, anon;
grant execute on function portal_answer_question(uuid, text, text, text, text) to authenticated;
grant execute on function portal_my_questions(text) to anon, authenticated;
grant execute on function portal_answer_attachment_for_leader(text, uuid) to anon, authenticated;
revoke execute on function portal_answer_attachment(uuid) from public, anon;
grant execute on function portal_answer_attachment(uuid) to authenticated;
