-- שלב 3: תיעוד אוטומטי של שינויים בטבלאות היסוד ל-audit_events, כדי שלשונית "היסטוריה"
-- בכרטיס עמותה תציג נתונים אמיתיים בלי שכל מסך צריך לזכור לקרוא לפונקציית audit בעצמו.

create or replace function audit_table_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into audit_events (actor_id, action, resource, resource_id, detail)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(new.id, old.id)::text,
    case
      when tg_op = 'INSERT' then to_jsonb(new)
      when tg_op = 'UPDATE' then jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new))
      else to_jsonb(old)
    end
  );
  return coalesce(new, old);
end;
$$;

create trigger organizations_audit
  after insert or update on organizations
  for each row execute function audit_table_change();

create trigger organization_officeholders_audit
  after insert or update on organization_officeholders
  for each row execute function audit_table_change();

create trigger branches_audit
  after insert or update on branches
  for each row execute function audit_table_change();

create trigger group_leaders_audit
  after insert or update on group_leaders
  for each row execute function audit_table_change();

create trigger groups_audit
  after insert or update on groups
  for each row execute function audit_table_change();

-- חשבונות בנק: פונקציית audit ייעודית שממסכת את מספר החשבון בתוך ה-detail, כדי שהערך
-- הגלמי לא יזלוג ליומן הכללי מחוץ למנגנון reveal_bank_account_number() המבוקר והמתועד בנפרד.
create or replace function audit_bank_account_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new jsonb;
  v_old jsonb;
begin
  v_new := (to_jsonb(new) - 'account_number') || jsonb_build_object('account_number_masked', mask_account_number(new.account_number));
  if tg_op = 'UPDATE' then
    v_old := (to_jsonb(old) - 'account_number') || jsonb_build_object('account_number_masked', mask_account_number(old.account_number));
  end if;

  insert into audit_events (actor_id, action, resource, resource_id, detail)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    new.id::text,
    case when tg_op = 'UPDATE' then jsonb_build_object('before', v_old, 'after', v_new) else v_new end
  );
  return new;
end;
$$;

create trigger organization_bank_accounts_audit
  after insert or update on organization_bank_accounts
  for each row execute function audit_bank_account_change();
