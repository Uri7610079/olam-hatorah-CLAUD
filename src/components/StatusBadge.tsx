import { CircleAlert, TriangleAlert, Clock, CircleCheck, Circle, Info, type LucideIcon } from "lucide-react";

export type Severity = "critical" | "high" | "medium" | "low" | "ok" | "neutral";

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "קריטי",
  high: "גבוה",
  medium: "בינוני",
  low: "לידיעה",
  ok: "תקין",
  neutral: "—",
};

const SEVERITY_CLASSES: Record<Severity, string> = {
  critical: "bg-danger-soft text-danger-ink ring-1 ring-danger/25",
  high: "bg-warn-soft text-warn-ink ring-1 ring-warn/25",
  medium: "bg-warn-soft text-warn-ink ring-1 ring-warn/20",
  low: "bg-neutral-soft text-neutral-ink ring-1 ring-neutral/20",
  ok: "bg-ok-soft text-ok-ink ring-1 ring-ok/25",
  neutral: "bg-neutral-soft text-neutral-ink ring-1 ring-neutral/25",
};

// אייקון שונה לכל רמת חומרה - כדי שהמשמעות תיקרא גם דרך צורה, לא רק דרך צבע
// (חשוב במיוחד לצבעוני-עיוורון, ומעבר לדרישת האפיון לטקסט+צבע).
const SEVERITY_ICON: Record<Severity, LucideIcon> = {
  critical: CircleAlert,
  high: TriangleAlert,
  medium: Clock,
  low: Info,
  ok: CircleCheck,
  neutral: Circle,
};

interface StatusBadgeProps {
  severity: Severity;
  label?: string;
}

// חובה: סטטוס תמיד מוצג בטקסט + צבע, לא בצבע בלבד (דרישת נגישות מפורשת באפיון).
export function StatusBadge({ severity, label }: StatusBadgeProps) {
  // unified_exceptions הוא view, ועמודת החומרה שלו היא text חופשי. ערך
  // שאינו מוכר כאן החזיר undefined כאייקון, ו-React הפיל את *כל* המסך -
  // כך שחריגה אחת עם חומרה חדשה מחקה גם את 55 האחרות. נפילה כזו יקרה
  // מכדי להשאיר אותה תלויה בכך שכל מיגרציה עתידית תזכור את הרשימה.
  const safe: Severity = severity in SEVERITY_ICON ? severity : "neutral";
  const Icon = SEVERITY_ICON[safe];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${SEVERITY_CLASSES[safe]}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label ?? SEVERITY_LABEL[safe] ?? severity}
    </span>
  );
}
