export type Severity = "critical" | "high" | "medium" | "ok" | "neutral";

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "קריטי",
  high: "גבוה",
  medium: "בינוני",
  ok: "תקין",
  neutral: "—",
};

const SEVERITY_CLASSES: Record<Severity, string> = {
  critical: "bg-red-50 text-red-700 ring-1 ring-red-200",
  high: "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
  medium: "bg-yellow-50 text-yellow-800 ring-1 ring-yellow-200",
  ok: "bg-green-50 text-green-700 ring-1 ring-green-200",
  neutral: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
};

interface StatusBadgeProps {
  severity: Severity;
  label?: string;
}

// חובה: סטטוס תמיד מוצג בטקסט + צבע, לא בצבע בלבד (דרישת נגישות מפורשת באפיון).
export function StatusBadge({ severity, label }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${SEVERITY_CLASSES[severity]}`}
    >
      {label ?? SEVERITY_LABEL[severity]}
    </span>
  );
}
