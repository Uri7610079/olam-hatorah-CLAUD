import { useIsV3 } from "@/lib/uiTheme";

// תוכן שורה מקובץ יבוא, בתצוגה מקדימה (ערכה v3).
//
// עד היום הוצג JSON גולמי - {"שם":"...","ת.ז":"..."} - בדיוק ברגע שבו בודקים
// ומאשרים את הנתונים. כאן: "שם עמודה: ערך", בלי עמודות ריקות. בשאר הערכות -
// בדיוק כמו קודם. תצוגה בלבד; הנתונים שנקלטים לא משתנים.

const MAX_PAIRS = 6;

export function RawRowPreview({ raw }: { raw: unknown }) {
  const isV3 = useIsV3();
  if (!isV3) return <span className="text-xs">{JSON.stringify(raw)}</span>;
  if (!raw || typeof raw !== "object") return <span className="text-ink-subtle">—</span>;

  const pairs = Object.entries(raw as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "");
  if (pairs.length === 0) return <span className="text-ink-subtle">שורה ריקה</span>;
  const shown = pairs.slice(0, MAX_PAIRS);
  const rest = pairs.length - shown.length;

  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs" title={pairs.map(([k, v]) => `${k}: ${String(v)}`).join("\n")}>
      {shown.map(([k, v]) => (
        <span key={k} className="whitespace-nowrap">
          <span className="text-ink-subtle">{k}:</span> <bdi className="text-ink">{String(v)}</bdi>
        </span>
      ))}
      {rest > 0 && <span className="text-ink-subtle">ועוד {rest}</span>}
    </span>
  );
}
