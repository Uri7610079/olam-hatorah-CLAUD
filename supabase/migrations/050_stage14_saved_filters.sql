-- שלב 14 (חלק ג'): מסננים שמורים. נתון אישי גרידא (איך משתמש מסוים אוהב לסנן מסך
-- מסוים) - לא משאב עסקי משותף, ולכן RLS פשוטה לפי בעלות (user_id = auth.uid()) בלי
-- שום הרשאת resource/action ייעודית, ובלי אכיפה ברמת RPC - זה בדיוק אותו דפוס כמו
-- העדפות משתמש רגילות בכל מערכת.
create table saved_filters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  screen_key text not null,
  name text not null,
  filters jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, screen_key, name)
);

create index saved_filters_user_screen_idx on saved_filters (user_id, screen_key);

alter table saved_filters enable row level security;

create policy saved_filters_select on saved_filters for select to authenticated
  using (user_id = auth.uid());

create policy saved_filters_insert on saved_filters for insert to authenticated
  with check (user_id = auth.uid());

-- נדרש כדי ש-upsert (שמירה חוזרת תחת אותו שם - עדכון) תעבוד; onConflict מתבצע כ-UPDATE
-- בפועל, לא רק INSERT.
create policy saved_filters_update on saved_filters for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy saved_filters_delete on saved_filters for delete to authenticated
  using (user_id = auth.uid());
