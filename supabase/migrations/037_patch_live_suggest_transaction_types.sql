-- Patch לפרויקט החי: suggest_transaction_types() (036, שלב 11) נכשלה בפועל בהרצה
-- הראשונה - "invalid reference to FROM-clause entry for table bt". UPDATE...FROM LATERAL
-- לא יכול להתייחס לטבלת היעד של ה-UPDATE עצמה (bt) בתוך ביטוי ה-LATERAL. הפתרון:
-- self-join דרך alias שני (bt2) שהוא כן פריט FROM לגיטימי, ו-WHERE מקשר bt ל-bt2 לפי id.
-- idempotent (create or replace).

create or replace function suggest_transaction_types(p_organization_bank_account_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not has_permission('transaction_classification', 'perform') then
    raise exception 'permission denied';
  end if;

  update bank_transactions bt
  set suggested_type_id = r.suggested_type_id,
      suggested_confidence = r.confidence_level,
      suggested_reason = 'התאמה לכלל זיהוי (עדיפות ' || r.priority || ')',
      suggested_rule_id = r.id,
      classification_status = 'suggested'
  from bank_transactions bt2
  cross join lateral match_recognition_rule(bt2.organization_bank_account_id, bt2.direction, bt2.amount, bt2.description, bt2.reference, bt2.execution_date) r
  where bt.id = bt2.id
    and bt2.organization_bank_account_id = p_organization_bank_account_id
    and bt2.classification_status = 'unclassified'
    and r.id is not null;

  get diagnostics v_count = row_count;

  perform insert_audit_event(
    'suggest_transaction_types', 'bank_transactions', p_organization_bank_account_id::text,
    jsonb_build_object('suggested_count', v_count)
  );

  return v_count;
end;
$$;
