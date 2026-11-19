import { useIsV3 } from "@/lib/uiTheme";
import { formatDate } from "@/lib/format";
import { relativeDayLabel, todayIso } from "./dateUtils";

// תאריך יעד של משימה. בערכות הקודמות - בדיוק כמו קודם (YYYY-MM-DD גולמי).
// ב-v3: התאריך בפורמט האחיד, ולידו תיאור יחסי ("היום", "לפני 3 ימים").
// done: משימה שהושלמה לא נצבעת כ"באיחור" גם אם התאריך עבר.
export function DueDateLabel({ date, done = false }: { date: string; done?: boolean }) {
  const isV3 = useIsV3();
  if (!isV3) return <span className="tabular">{date}</span>;

  const relative = relativeDayLabel(date);
  const today = todayIso();
  const tone = done ? "text-ink-subtle" : date < today ? "text-danger-ink" : date === today ? "font-medium text-ink" : "text-ink-muted";
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className="tabular">{formatDate(date)}</span>
      {relative && <span className={tone}>· {relative}</span>}
    </span>
  );
}
