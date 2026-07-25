-- שלב 13 (חלק ד'): תבניות מכתבים ומכתבים. אישור אנושי חובה לפני "נשלח" - נאכף בטריגר,
-- לא רק במסך (כדי שגם אם AI יחובר בעתיד, לא יהיה מסלול לדלג על האישור). אין שליחה
-- אוטומטית ואין חיבור דוא"ל: "נשלח" הוא סימון ידני בלבד לאחר שהמכתב יצא בפועל מחוץ
-- למערכת (דואר/מייל/פקס - אופן השליחה טקסט חופשי, לא רשימה סגורה, מאותה סיבה כמו
-- document_type ב-044).

create table letter_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label_he text not null,
  subject_template text not null,
  body_template text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger letter_templates_set_updated_at
  before update on letter_templates
  for each row execute function set_updated_at();

create table letters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  template_id uuid references letter_templates(id),
  recipient_name text not null,
  recipient_details text,
  subject text not null,
  draft_body text not null,
  final_body text,
  status text not null default 'draft' check (status in ('draft', 'approved', 'sent', 'answered', 'archived')),
  ai_suggested boolean not null default false,
  send_method text,
  sent_at date,
  response_notes text,
  responded_at date,
  is_demo boolean not null default false,
  demo_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz
);

create trigger letters_set_updated_at
  before update on letters
  for each row execute function set_updated_at();

create index letters_org_idx on letters (organization_id);

insert into permissions (resource, action, label_he) values
  ('letter_templates', 'manage', 'ניהול תבניות מכתבים'),
  ('letters', 'manage', 'ניסוח, אישור ומעקב מכתבים');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'letter_templates' and p.action = 'manage'
where r.key = 'system_admin';

-- finance_controller נוסף כאן - צ'ני אישרה במפורש שמנהל הכספים צריך גם ליצור וגם
-- לערוך מכתבים בעצמו (לא ביקורות/רשימות טלפוניות - אלה נשארו ללא שינוי).
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'letters' and p.action = 'manage'
where r.key in ('system_admin', 'operations_manager', 'finance_controller');

alter table letter_templates enable row level security;
alter table letters enable row level security;

create policy letter_templates_select on letter_templates for select to authenticated
  using (has_permission('area_ops', 'access') or has_permission('area_finance', 'access'));

create policy letter_templates_write on letter_templates for insert to authenticated
  with check (has_permission('letter_templates', 'manage'));

create policy letter_templates_update on letter_templates for update to authenticated
  using (has_permission('letter_templates', 'manage'))
  with check (has_permission('letter_templates', 'manage'));

create policy letters_select on letters for select to authenticated
  using (has_permission('area_ops', 'access') or has_permission('area_finance', 'access'));

create policy letters_insert on letters for insert to authenticated
  with check (has_permission('letters', 'manage'));

create policy letters_update on letters for update to authenticated
  using (has_permission('letters', 'manage'))
  with check (has_permission('letters', 'manage'));

-- מכונת המצבים: draft -> approved (חובה final_body מלא, רק מתוך draft) -> sent (רק מתוך
-- approved) -> answered (רק מתוך sent). archived מותר מכל מצב (סגירה/גניזה). לאחר sent
-- אי אפשר לערוך את תוכן המכתב/הנמען - זה מה שבאמת נשלח, לא נערך בדיעבד.
create or replace function enforce_letter_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'מכתב חדש תמיד נוצר כטיוטה';
    end if;
    return new;
  end if;

  if old.status in ('sent', 'answered', 'archived')
     and (new.subject is distinct from old.subject
          or new.draft_body is distinct from old.draft_body
          or new.final_body is distinct from old.final_body
          or new.recipient_name is distinct from old.recipient_name
          or new.recipient_details is distinct from old.recipient_details) then
    raise exception 'לא ניתן לערוך תוכן מכתב שכבר נשלח/נענה/נגנז';
  end if;

  if new.status = 'approved' and old.status is distinct from 'approved' then
    if old.status <> 'draft' then
      raise exception 'ניתן לאשר מכתב רק מתוך טיוטה';
    end if;
    if new.final_body is null or length(trim(new.final_body)) = 0 then
      raise exception 'אישור מכתב דורש נוסח סופי מלא';
    end if;
    new.approved_by := auth.uid();
    new.approved_at := now();
  end if;

  if new.status = 'sent' and old.status is distinct from 'sent' then
    if old.status <> 'approved' then
      raise exception 'ניתן לסמן כנשלח רק מכתב שאושר';
    end if;
    if new.send_method is null or length(trim(new.send_method)) = 0 then
      raise exception 'נדרש אופן שליחה כדי לסמן מכתב כנשלח';
    end if;
    if new.sent_at is null then
      new.sent_at := current_date;
    end if;
  end if;

  if new.status = 'answered' and old.status is distinct from 'answered' then
    if old.status <> 'sent' then
      raise exception 'ניתן לסמן תשובה רק למכתב שנשלח';
    end if;
    if new.responded_at is null then
      new.responded_at := current_date;
    end if;
  end if;

  return new;
end;
$$;

create trigger letters_enforce_mutation
  before insert or update on letters
  for each row execute function enforce_letter_mutation();

create trigger letter_templates_audit
  after insert or update on letter_templates
  for each row execute function audit_table_change();

create trigger letters_audit
  after insert or update on letters
  for each row execute function audit_table_change();
