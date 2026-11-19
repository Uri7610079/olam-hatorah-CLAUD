import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, type LucideIcon } from "lucide-react";

// כרטיס מדד לדשבורדים (ערכה v3, שדרוג 2026-11): מספר מרכזי, כותרת קצרה, הסבר
// אופציונלי, ומעבר לרשימה שממנה המספר נגזר.
//
// שני כללים:
//  * רק מספרים אמיתיים מהשאילתות הקיימות - הכרטיס לא מחשב ולא מנחש כלום.
//  * מדד ריק (0) מוצג מאופק: אפס שנראה בדיוק כמו "27 תנועות לא מסווגות" מושך
//    את העין למקום הלא נכון. "muted" נקבע ע"י המסך, כי רק הוא יודע מה ריק.

export type MetricTone = "neutral" | "ok" | "warn" | "high" | "danger" | "info" | "accent" | "primary";

const TONE_BAR: Record<MetricTone, string> = {
  neutral: "bg-line-strong",
  ok: "bg-ok",
  warn: "bg-warn",
  high: "bg-high",
  danger: "bg-danger",
  info: "bg-info",
  accent: "bg-accent",
  primary: "bg-primary",
};

const TONE_VALUE: Record<MetricTone, string> = {
  neutral: "text-ink",
  ok: "text-ok-ink",
  warn: "text-warn-ink",
  high: "text-high-ink",
  danger: "text-danger-ink",
  info: "text-info-ink",
  accent: "text-primary",
  primary: "text-primary",
};

interface MetricCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: MetricTone;
  icon?: LucideIcon;
  href?: string;
  // מדד ריק - מוצג בעדינות ובלי צבע
  muted?: boolean;
  // כרטיס מרכזי - מספר גדול יותר
  emphasis?: boolean;
}

export function MetricCard({ label, value, hint, tone = "neutral", icon: Icon, href, muted, emphasis }: MetricCardProps) {
  const body = (
    <>
      <span aria-hidden="true" className={`absolute inset-y-3 right-0 w-[3px] rounded-full ${muted ? "bg-line" : TONE_BAR[tone]}`} />
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-ink-muted">
          {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
          {label}
        </span>
        {href && <ChevronLeft className="h-4 w-4 shrink-0 text-ink-subtle transition group-hover:-translate-x-0.5 group-hover:text-brand-600" aria-hidden="true" />}
      </span>
      <span
        className={`mt-1.5 block font-bold tabular leading-tight ${emphasis ? "text-3xl" : "text-2xl"} ${muted ? "text-ink-subtle" : TONE_VALUE[tone]}`}
      >
        {value}
      </span>
      {hint && <span className="mt-1 block text-xs text-ink-subtle">{hint}</span>}
    </>
  );

  const base = "card group relative block overflow-hidden px-4 py-3.5 text-right";
  if (href) {
    return (
      <Link to={href} className={`${base} transition hover:border-brand-300 focus-visible:border-brand-500`}>
        {body}
      </Link>
    );
  }
  return <div className={base}>{body}</div>;
}

/** כותרת לאזור בתוך מסך: כותרת, תיאור קצר ופעולה אופציונלית בצד. */
export function SectionHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-base font-semibold text-ink v3:text-primary">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
