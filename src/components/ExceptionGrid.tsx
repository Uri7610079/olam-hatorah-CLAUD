import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { useIsV3 } from "@/lib/uiTheme";

export interface ExceptionCounter {
  key: string;
  label: string;
  count: number;
  severity: "critical" | "high" | "medium" | "ok" | "neutral";
  href: string;
}

const ORDER = { critical: 0, high: 1, medium: 2, ok: 3, neutral: 4 } as const;
const COUNT_TONE = { critical: "text-danger-ink", high: "text-high-ink", medium: "text-warn-ink", ok: "text-ink-subtle", neutral: "text-ink-subtle" } as const;

// רכיב הדשבורד המרכזי: רק מונים שדורשים טיפול, בלי גרפים דקורטיביים — לפי האפיון.
// כל כרטיס לחיץ ומוביל ישירות לרשימה המסוננת (שאילתות אמת משלב 14, לא נתוני דמו).
//
// v3: הכרטיסים ממוינים לפי חומרה, המספר בצבע החומרה, מונה 0 מאופק, והכרטיס הוא
// קישור אמיתי (אפשר לפתוח בלשונית חדשה). בשאר הערכות - כמו קודם.
export function ExceptionGrid({ items }: { items: ExceptionCounter[] }) {
  const navigate = useNavigate();
  const isV3 = useIsV3();

  if (isV3) {
    const sorted = [...items].sort((a, b) => (a.count > 0 ? 0 : 1) - (b.count > 0 ? 0 : 1) || ORDER[a.severity] - ORDER[b.severity] || b.count - a.count);
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((item) => {
          const zero = item.count === 0;
          return (
            <Link
              key={item.key}
              to={item.href}
              className={`card group flex items-center justify-between gap-3 px-4 py-3.5 text-right transition hover:border-brand-300 ${zero ? "opacity-80" : ""}`}
            >
              <div className="min-w-0">
                <p className="text-sm text-ink-muted">{item.label}</p>
                <p className={`tabular mt-1 text-2xl font-bold ${zero ? "text-ink-subtle" : COUNT_TONE[item.severity]}`}>{item.count.toLocaleString("he-IL")}</p>
              </div>
              <span className="flex shrink-0 items-center gap-2">
                {!zero && <StatusBadge severity={item.severity} />}
                <ChevronLeft className="h-4 w-4 text-ink-subtle transition group-hover:text-brand-600" aria-hidden="true" />
              </span>
            </Link>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <button
          key={item.key}
          onClick={() => navigate(item.href)}
          className="card flex items-center justify-between px-4 py-3.5 text-right transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <div>
            <p className="text-sm text-ink-muted">{item.label}</p>
            <p className="tabular mt-1 text-2xl font-semibold text-ink">{item.count}</p>
          </div>
          <StatusBadge severity={item.severity} />
        </button>
      ))}
    </div>
  );
}
