import { useNavigate } from "react-router-dom";
import { StatusBadge } from "./StatusBadge";

export interface ExceptionCounter {
  key: string;
  label: string;
  count: number;
  severity: "critical" | "high" | "medium" | "ok" | "neutral";
  href: string;
}

// רכיב הדשבורד המרכזי: רק מונים שדורשים טיפול, בלי גרפים דקורטיביים — לפי האפיון.
// כל כרטיס לחיץ ומוביל ישירות לרשימה המסוננת (שאילתות אמת משלב 14, לא נתוני דמו).
export function ExceptionGrid({ items }: { items: ExceptionCounter[] }) {
  const navigate = useNavigate();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <button
          key={item.key}
          onClick={() => navigate(item.href)}
          className="card flex items-center justify-between px-4 py-3.5 text-right transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <div>
            <p className="text-sm text-slate-600">{item.label}</p>
            <p className="tabular mt-1 text-2xl font-semibold text-slate-900">{item.count}</p>
          </div>
          <StatusBadge severity={item.severity} />
        </button>
      ))}
    </div>
  );
}
