import { ArrowDownLeft, ArrowUpRight, Info } from "lucide-react";
import { formatMoney, formatNumber } from "@/lib/format";

// חלקי תצוגה של מסך תנועות הבנק בערכה v3 (שלב ג' של שדרוג העיצוב, 2026-11).
// בקובץ נפרד בכוונה: BankTransactionsScreen משתנה הרבה בעבודה השוטפת על הבנק,
// וכך השינוי העיצובי בו נשאר קטן - בחירה בין התצוגה הקודמת לזו, ותו לא.
// תצוגה בלבד: אף רכיב כאן לא מחשב סכום שנשמר או משנה סיווג.

type Direction = "debit" | "credit";

/** סכום עם כיוון: חץ + סימן + מילה. זכות/חובה לא מועברים בצבע בלבד. */
export function AmountCell({ amount, direction }: { amount: number; direction: Direction }) {
  const credit = direction === "credit";
  const Icon = credit ? ArrowDownLeft : ArrowUpRight;
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold ${credit ? "text-ok-ink" : "text-ink"}`}>
      <Icon className={`h-3.5 w-3.5 shrink-0 ${credit ? "text-ok" : "text-ink-subtle"}`} aria-hidden="true" />
      <span className="tabular">{formatMoney(credit ? amount : -amount)}</span>
    </span>
  );
}

export function DirectionTag({ direction }: { direction: Direction }) {
  const credit = direction === "credit";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${credit ? "bg-ok-soft text-ok-ink" : "bg-neutral-soft text-neutral-ink"}`}>
      {credit ? "זכות · נכנס" : "חובה · יצא"}
    </span>
  );
}

/** הצעת סיווג אוטומטית: מסגרת מקווקוות - כדי שלא תיראה כמו סיווג שאושר (תג מלא). */
export function SuggestionTag({ label, confidence }: { label: string; confidence: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-brand-400 bg-brand-50/60 px-2.5 py-0.5 text-xs text-brand-800">
      <span className="font-medium">הצעה: {label}</span>
      {confidence && <span className="text-ink-subtle">· ודאות {confidence}</span>}
    </span>
  );
}

/** סיכום התנועות שמוצגות כרגע: כמה, וסך זכות וחובה. מחושב מהשורות שעל המסך בלבד. */
export function ShownTotals({ rows }: { rows: { amount: number; direction: Direction }[] }) {
  if (rows.length === 0) return null;
  let credit = 0;
  let debit = 0;
  for (const r of rows) {
    if (r.direction === "credit") credit += r.amount;
    else debit += r.amount;
  }
  return (
    <p className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
      <span>
        בתצוגה: <span className="tabular font-semibold text-ink">{formatNumber(rows.length)}</span> תנועות
      </span>
      <span className="inline-flex items-center gap-1">
        <ArrowDownLeft className="h-3.5 w-3.5 text-ok" aria-hidden="true" />
        נכנס <span className="tabular font-semibold text-ok-ink">{formatMoney(credit)}</span>
      </span>
      <span className="inline-flex items-center gap-1">
        <ArrowUpRight className="h-3.5 w-3.5 text-ink-subtle" aria-hidden="true" />
        יצא <span className="tabular font-semibold text-ink">{formatMoney(debit)}</span>
      </span>
    </p>
  );
}

/**
 * תוצאת יבוא במילים. קובץ שכולו כפילויות הוא מצב תקין ("אין חדש"), לא שגיאה -
 * עד היום הוצג כ"0 / 152 / 0" בצבע אזהרה.
 */
export function batchResultText(b: { status: string; valid_count: number; duplicate_count: number; invalid_count: number }): string {
  if (b.status === "rejected") return "בוטל";
  if (b.valid_count === 0 && b.invalid_count === 0 && b.duplicate_count > 0) {
    return `אין תנועות חדשות · כל ${formatNumber(b.duplicate_count)} כבר קיימות`;
  }
  const parts = [
    b.valid_count > 0 ? `${formatNumber(b.valid_count)} ${b.status === "committed" ? "נקלטו" : "חדשות"}` : null,
    b.duplicate_count > 0 ? `${formatNumber(b.duplicate_count)} כבר היו` : null,
    b.invalid_count > 0 ? `${formatNumber(b.invalid_count)} שגויות` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "קובץ ריק";
}

/** פס קטן של חלוקת השורות: חדשות / כבר היו / שגויות. רק כשיש יותר מסוג אחד. */
export function BatchMix({ valid, duplicate, invalid }: { valid: number; duplicate: number; invalid: number }) {
  const total = valid + duplicate + invalid;
  if (!total || [valid, duplicate, invalid].filter((n) => n > 0).length < 2) return null;
  const seg = (n: number, cls: string) => (n > 0 ? <span className={cls} style={{ width: `${(n / total) * 100}%` }} /> : null);
  return (
    <span className="flex h-1.5 w-20 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
      {seg(valid, "bg-ok")}
      {seg(duplicate, "bg-neutral/50")}
      {seg(invalid, "bg-danger")}
    </span>
  );
}

/** הודעה רגועה (לא שגיאה) - למצבים צפויים כמו קובץ שכבר יובא. */
export function CalmNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-control border border-info/30 bg-info-soft p-3 text-sm text-info-ink" role="status">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
