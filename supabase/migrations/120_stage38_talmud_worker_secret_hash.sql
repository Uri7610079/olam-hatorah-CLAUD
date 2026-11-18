-- שלב 38ג: הסוד של העובד נבדק לפי טביעה (hash) - בלי צעד ידני ב-Supabase
--
-- ב-118 הסוד של העובד היה צריך להיות מוזן ידנית ב-SQL Editor. עכשיו העובד גוזר
-- אותו לבד מהמפתח הפרטי שלו (sha256 של "talmud-worker:" + TALMUD_PRIVATE_KEY),
-- ובמסד נשמרת רק הטביעה של הסוד. מהטביעה אי אפשר לשחזר את הסוד, ולכן מותר לה
-- להיות כאן בקוד. כך ההגדרה היחידה שנשארה היא משתנה סביבה אחד ב-Vercel.
--
-- החלפת המפתחות = מיגרציה חדשה עם הטביעה החדשה.

insert into talmud_worker_config (id, secret)
values (true, 'sha256:fb97e84388e35314dd2316537a01d1da351865e748bd2ae8f6aa6dd5f5bc2fdd')
on conflict (id) do update set secret = excluded.secret;

create or replace function talmud_worker_check(p_secret text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_stored text;
begin
  select secret into v_stored from talmud_worker_config where id;
  if v_stored is null or p_secret is null then raise exception 'unauthorized'; end if;
  if v_stored like 'sha256:%' then
    if encode(digest(p_secret, 'sha256'), 'hex') <> substr(v_stored, 8) then raise exception 'unauthorized'; end if;
  elsif p_secret is distinct from v_stored then
    raise exception 'unauthorized';
  end if;
end;
$$;

revoke execute on function talmud_worker_check(text) from public, anon, authenticated;
