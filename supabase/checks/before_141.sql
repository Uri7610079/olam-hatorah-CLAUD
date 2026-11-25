-- קריאה בלבד - לפני מיגרציה 141 (החישוב מיולי 2026). לא משנה שום נתון.
-- מה החישוב החד-פעמי מיולי 2026 יעשה: לכל עמותה וחודש - כמה זכאים, כמה כבר חושבו,
-- מצב החודש הכספי, האם יש לעמותה כלל עמלה, וכמה עמלה ונטו ייצאו (אותו חישוב בדיוק).
with rows as (
  select me.organization_id, me.month, me.id as eligibility_id, me.group_id, me.gross_amount,
         r.rule_id, r.commission, r.net,
         exists (select 1 from eligibility_financial_results f where f.eligibility_id = me.id and f.status = 'active') as already_calculated
  from monthly_eligibility me
  join students s on s.id = me.student_id
  cross join lateral (
    select m.id as rule_id, c.commission_amount as commission, c.net_amount as net
    from match_commission_rule(me.organization_id, me.group_id, s.study_code, me.student_id, me.month) m
    cross join lateral compute_commission(m, me.gross_amount) c
  ) r
  where me.status = 'active' and me.month >= date '2026-07-01'
)
select o.legal_name                                                   as organization,
       to_char(r.month, 'YYYY-MM')                                    as month,
       coalesce(fp.status, 'ייפתח')                                   as period_status,
       case when coalesce(fp.status, 'open') = 'open' then 'יחושב' else 'ידולג (החודש לא פתוח)' end as action,
       count(*)                                                       as eligible_rows,
       count(*) filter (where r.already_calculated)                   as already_calculated,
       count(*) filter (where r.group_id is null)                     as without_group,
       sum(r.gross_amount)                                            as gross,
       sum(r.commission)                                              as commission,
       sum(r.net)                                                     as net,
       case when count(*) filter (where r.rule_id is not null) = 0 then 'אין כלל עמלה - העמלה 0, כל הברוטו לקבוצות'
            when count(*) filter (where r.rule_id is null) > 0 then 'לחלק מהשורות אין כלל עמלה'
            else 'יש כלל עמלה' end                                    as commission_rule
from rows r
join organizations o on o.id = r.organization_id
left join financial_periods fp on fp.organization_id = r.organization_id and fp.month = r.month
group by o.legal_name, r.month, fp.status
order by o.legal_name, r.month;
