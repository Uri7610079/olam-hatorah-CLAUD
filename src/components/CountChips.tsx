// שורת צ'יפים עם ספירה (ערכה v3): תמונת מצב קטנה שהיא גם סינון. לחיצה על צ'יפ
// מסננת את הרשימה, לחיצה נוספת (או "הכול") מבטלת. הספירות מחושבות מהשורות
// שכבר נטענו למסך - לא שאילתה נוספת ולא מספר שהמסך לא מכיר.

export type ChipTone = "neutral" | "ok" | "warn" | "high" | "danger" | "info";

export interface CountChip {
  value: string;
  label: string;
  count: number;
  tone?: ChipTone;
}

const DOT: Record<ChipTone, string> = {
  neutral: "bg-neutral",
  ok: "bg-ok",
  warn: "bg-warn",
  high: "bg-high",
  danger: "bg-danger",
  info: "bg-info",
};

interface CountChipsProps {
  chips: CountChip[];
  active: string | null;
  onSelect: (value: string | null) => void;
  total: number;
  allLabel?: string;
  ariaLabel: string;
}

export function CountChips({ chips, active, onSelect, total, allLabel = "הכול", ariaLabel }: CountChipsProps) {
  const base = "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";
  const on = "border-brand-600 bg-brand-600 text-white";
  const off = "border-line bg-surface text-ink hover:border-brand-300 hover:bg-brand-50";
  return (
    <div role="group" aria-label={ariaLabel} className="mb-3 flex flex-wrap items-center gap-2">
      <button type="button" aria-pressed={active === null} onClick={() => onSelect(null)} className={`${base} ${active === null ? on : off}`}>
        {allLabel}
        <span className="tabular font-semibold">{total.toLocaleString("he-IL")}</span>
      </button>
      {chips
        .filter((c) => c.count > 0)
        .map((c) => {
          const isOn = active === c.value;
          return (
            <button
              key={c.value}
              type="button"
              aria-pressed={isOn}
              onClick={() => onSelect(isOn ? null : c.value)}
              className={`${base} ${isOn ? on : off}`}
            >
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${isOn ? "bg-white" : DOT[c.tone ?? "neutral"]}`} />
              {c.label}
              <span className="tabular font-semibold">{c.count.toLocaleString("he-IL")}</span>
            </button>
          );
        })}
    </div>
  );
}
