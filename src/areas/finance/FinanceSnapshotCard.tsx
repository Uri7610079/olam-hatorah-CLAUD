import { useQuery } from "@tanstack/react-query";
import { MetricCard } from "@/components/MetricCard";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { formatDate, formatMoney, formatMonth, formatNumber } from "@/lib/format";
import { fetchFinanceSnapshot } from "@/lib/financeSnapshot";
import type { FinanceCounts } from "./FinanceDashboard";

// "תמונת מצב חודשית": חמש התשובות שאיש הכספים מחפש, במקום אחד ובראש הדשבורד -
// כמה כסף יש בבנק, כמה נכנס ויצא החודש, כמה שולם לקבוצות, כמה חייבים להן, וכמה
// בעיות פתוחות. כל כרטיס מוביל למסך שבו רואים את הפירוט.
export function openProblemsCount(c: FinanceCounts): number {
  return (
    (c.unclassified_transactions ?? 0) +
    (c.open_bank_exceptions ?? 0) +
    (c.masav_transmitted_not_completed_count ?? 0) +
    (c.open_returns ?? 0) +
    (c.unassigned_donations ?? 0)
  );
}

export function FinanceSnapshotCard({ orgId, month, counts }: { orgId: string; month: string; counts: FinanceCounts | undefined }) {
  const query = useQuery({
    queryKey: ["finance-snapshot", orgId, month],
    queryFn: () => fetchFinanceSnapshot(orgId, month),
    enabled: !!orgId,
  });

  if (query.isLoading) return <LoadingState rows={2} />;
  if (query.error) return <ErrorState message="לא ניתן לטעון את תמונת המצב החודשית." onRetry={() => query.refetch()} />;
  const s = query.data;
  if (!s) return null;

  const problems = counts ? openProblemsCount(counts) : null;
  const oldestAsOf = s.accounts.map((a) => a.asOf).filter(Boolean).sort()[0] ?? null;
  const balanceHint =
    s.accounts.length === 0
      ? "לעמותה אין חשבון בנק פעיל במערכת"
      : s.totalBalance === null
        ? "עוד לא נקלטה תנועה עם יתרה"
        : [
            oldestAsOf ? `נכון ל-${formatDate(oldestAsOf)}` : null,
            s.accounts.length > 1 ? `${formatNumber(s.accounts.length)} חשבונות` : s.accounts[0]?.label,
            s.balanceMissing ? `${formatNumber(s.balanceMissing)} בלי יתרה ידועה` : null,
          ].filter(Boolean).join(" · ");

  return (
    <section aria-labelledby="finance-snapshot-title" className="mb-6">
      <h2 id="finance-snapshot-title" className="mb-2 text-base font-semibold text-ink">
        תמונת מצב - {formatMonth(month)}
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          label="יתרה בבנק"
          value={s.totalBalance === null ? "—" : formatMoney(s.totalBalance)}
          hint={balanceHint}
          tone={s.totalBalance !== null && s.totalBalance < 0 ? "high" : "primary"}
          muted={s.totalBalance === null}
          href={`/finance/bank-transactions?org=${orgId}`}
        />
        <MetricCard
          label="נכנס החודש"
          value={formatMoney(s.moneyIn)}
          hint={`${formatNumber(s.inCount)} תנועות זכות בבנק`}
          tone="ok"
          muted={s.inCount === 0}
          href={`/finance/bank-transactions?org=${orgId}`}
        />
        <MetricCard
          label="יצא החודש"
          value={formatMoney(s.moneyOut)}
          hint={`${formatNumber(s.outCount)} תנועות חובה בבנק`}
          tone="neutral"
          muted={s.outCount === 0}
          href={`/finance/bank-transactions?org=${orgId}`}
        />
        <MetricCard
          label={"שולם במס\"ב"}
          value={formatMoney(s.paidCompleted)}
          hint={
            s.paidTransmitted > 0
              ? `מס"ב שבוצע בבנק · ועוד ${formatMoney(s.paidTransmitted)} שודר וממתין לאישור הבנק`
              : `מס"ב שבוצע בבנק עבור ${formatMonth(month)}`
          }
          tone="ok"
          muted={s.paidCompleted === 0 && s.paidTransmitted === 0}
          href={`/finance/masav?org=${orgId}`}
        />
        <MetricCard
          label="חייבים לקבוצות"
          value={counts ? formatMoney(counts.group_commitment_total) : "…"}
          hint={problems === null ? undefined : problems > 0 ? `${formatNumber(problems)} בעיות פתוחות בכספים` : "אין בעיות פתוחות בכספים"}
          tone={problems ? "high" : "primary"}
          href={`/finance/group-balances?org=${orgId}`}
        />
      </div>
    </section>
  );
}
