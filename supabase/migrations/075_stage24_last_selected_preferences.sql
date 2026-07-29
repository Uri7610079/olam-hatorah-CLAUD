-- שלב 24 (חלק א'): "זכירת בחירה אחרונה" - לבקשת Chani אחרי סבב סקירת UX: כמעט בכל מסך
-- כספים/תפעול מאלצים לבחור מחדש את אותה עמותה/חשבון/קבוצה בכל פעם. טבלת מפתח-ערך
-- אישית פר-משתמש (לא localStorage) - כדי שהבחירה תישמר גם במעבר בין מחשבים/דפדפנים,
-- אותו עיקרון בדיוק כמו saved_filters (מיגרציה מוקדמת יותר): נתון אישי גרידא, RLS לפי
-- בעלות בלבד, בלי בדיקת הרשאה נוספת ובלי audit (זו העדפת תצוגה, לא אירוע עסקי).
create table user_ui_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  pref_key text not null,
  pref_value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, pref_key)
);

create trigger user_ui_preferences_set_updated_at
  before update on user_ui_preferences
  for each row execute function set_updated_at();

alter table user_ui_preferences enable row level security;

-- 4 policies נפרדות (לא for all אחת) - תואם את הדפדוק שכבר נוהג ב-saved_filters (050):
-- update+with check דרוש במפורש כדי ש-upsert (שמירה חוזרת על אותו מפתח) יעבוד בפועל
-- כ-UPDATE, לא רק כ-INSERT ראשוני.
create policy user_ui_preferences_select on user_ui_preferences for select to authenticated
  using (user_id = auth.uid());

create policy user_ui_preferences_insert on user_ui_preferences for insert to authenticated
  with check (user_id = auth.uid());

create policy user_ui_preferences_update on user_ui_preferences for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy user_ui_preferences_delete on user_ui_preferences for delete to authenticated
  using (user_id = auth.uid());
