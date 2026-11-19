// בורר אפשרויות כשורת צ'יפים (ערכה v3, שדרוג 2026-11). מחליף לשוניות שמקוננות בתוך
// לשוניות אחרות: אותו מצב בדיוק (תמיד אפשרות אחת פעילה), אבל נראה כסינון בתוך
// האזור ולא כרמה שלישית של ניווט. הספירה (אם יש) - מהשורות שכבר נטענו.

export interface SegmentOption<K extends string> {
  key: K;
  label: string;
  count?: number;
}

interface SegmentedChipsProps<K extends string> {
  options: SegmentOption<K>[];
  active: K;
  onChange: (key: K) => void;
  ariaLabel: string;
}

export function SegmentedChips<K extends string>({ options, active, onChange, ariaLabel }: SegmentedChipsProps<K>) {
  const base = "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";
  const on = "border-brand-600 bg-brand-600 text-white";
  const off = "border-line bg-surface text-ink hover:border-brand-300 hover:bg-brand-50";
  return (
    <div role="group" aria-label={ariaLabel} className="mb-3 flex flex-wrap items-center gap-2">
      {options.map((o) => {
        const isOn = o.key === active;
        return (
          <button key={o.key} type="button" aria-pressed={isOn} onClick={() => onChange(o.key)} className={`${base} ${isOn ? on : off}`}>
            {o.label}
            {o.count !== undefined && <span className="tabular font-semibold">{o.count.toLocaleString("he-IL")}</span>}
          </button>
        );
      })}
    </div>
  );
}
