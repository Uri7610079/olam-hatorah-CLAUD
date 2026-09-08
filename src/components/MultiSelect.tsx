import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

// בחירה מרובה מרשימה.
//
// לא <select multiple>: הוא מחייב Ctrl-לחיצה כדי לבחור כמה, ומי שלא יודע
// את זה פשוט מחליף את הבחירה בכל לחיצה בלי להבין למה. כאן כל לחיצה
// מוסיפה או מסירה, וזה מה שאנשים מצפים לו.
//
// יש גם חיפוש, כי ברשימה של 62 קבוצות גלילה אינה דרך למצוא משהו.

export interface MultiOption {
  value: string;
  label: string;
  /** שורה שנייה קטנה - סניף, קוד, כל דבר שמבדיל בין שמות זהים. */
  hint?: string;
}

interface MultiSelectProps {
  options: MultiOption[];
  value: string[];
  onChange: (value: string[]) => void;
  label?: string;
  placeholder?: string;
  /** נאמר כשלא נבחר דבר, כשלריק יש משמעות עסקית משלו. */
  emptyMeaning?: string;
  id?: string;
  className?: string;
}

export function MultiSelect({
  options, value, onChange, label, placeholder = "בחירה…", emptyMeaning, id, className,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const fieldId = id ?? `multi-${label ?? "select"}`;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const q = query.trim();
  const shown = useMemo(
    () => (q ? options.filter((o) => o.label.includes(q) || (o.hint ?? "").includes(q)) : options),
    [options, q]
  );

  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <div className={className} ref={boxRef}>
      {label && <label className="field-label" htmlFor={fieldId}>{label}</label>}

      <button
        id={fieldId}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="input-field flex w-full items-center justify-between gap-2 text-right"
      >
        <span className={value.length ? "text-ink" : "text-ink-subtle"}>
          {value.length === 0
            ? emptyMeaning ?? placeholder
            : value.length === 1
              ? byValue.get(value[0])?.label ?? "1 נבחרו"
              : `${value.length} נבחרו`}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" />
      </button>

      {/* מה שנבחר מוצג כתגיות מתחת, ולא רק כמספר: "3 נבחרו" מחייב לפתוח
          את הרשימה כדי לזכור *מה* נבחר, וזה בדיוק הרגע שבו נשמרת בטעות
          בחירה שגויה. */}
      {value.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {value.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink">
              {byValue.get(v)?.label ?? v}
              <button
                type="button"
                onClick={() => toggle(v)}
                aria-label={`הסרה: ${byValue.get(v)?.label ?? v}`}
                className="text-ink-subtle hover:text-danger"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
          {value.length > 1 && (
            <button type="button" onClick={() => onChange([])} className="text-xs text-ink-subtle hover:text-danger">
              ניקוי הכל
            </button>
          )}
        </div>
      )}

      {open && (
        <div className="relative">
          <div className="absolute z-30 mt-1 w-full min-w-[16rem] rounded-control border border-line bg-surface shadow-lg">
            {options.length > 8 && (
              <div className="relative border-b border-line-soft p-2">
                <Search className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle ltr:left-4 rtl:right-4" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="חיפוש…"
                  className="input-field h-8 w-full ps-8 text-sm"
                  autoFocus
                />
              </div>
            )}

            <div className="max-h-64 overflow-y-auto p-1">
              {shown.length === 0 ? (
                <p className="px-3 py-2 text-sm text-ink-subtle">לא נמצא</p>
              ) : (
                shown.map((o) => {
                  const on = value.includes(o.value);
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => toggle(o.value)}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-right text-sm transition hover:bg-surface-muted ${on ? "text-ink" : "text-ink-muted"}`}
                    >
                      <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${on ? "border-brand-500 bg-brand-500 text-white" : "border-line"}`}>
                        {on && <Check className="h-3 w-3" aria-hidden="true" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{o.label}</span>
                        {o.hint && <span className="block truncate text-xs text-ink-subtle">{o.hint}</span>}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {shown.length > 1 && (
              <div className="flex justify-between border-t border-line-soft px-2 py-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => onChange([...new Set([...value, ...shown.map((o) => o.value)])])}
                  className="text-brand-500 hover:underline"
                >
                  {q ? `בחירת ${shown.length} התוצאות` : "בחירת הכל"}
                </button>
                <button type="button" onClick={() => setOpen(false)} className="text-ink-subtle hover:text-ink">
                  סגירה
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
