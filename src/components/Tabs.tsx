import { useRef, type KeyboardEvent } from "react";

export interface TabDef<K extends string> {
  key: K;
  label: string;
  badge?: string | number;
}

interface TabsProps<K extends string> {
  tabs: TabDef<K>[];
  activeTab: K;
  onChange: (key: K) => void;
  ariaLabel: string;
}

// רכיב לשוניות גנרי - משמש גם את ImportPreviewTabs (3 לשוניות קבועות ליבוא) וגם
// כל מסך פרטים עם כמה טאבים (למשל כרטיס עמותה משלב 3).
//
// מקלדת: חצים ימינה/שמאלה, Home ו-End עוברים בין הלשוניות (תקן ARIA ללשוניות).
// בעמוד מימין לשמאל חץ שמאלה = הלשונית הבאה.
// v3: המספר בלשונית מוצג כתג קטן ולא בסוגריים.
export function Tabs<K extends string>({ tabs, activeTab, onChange, ariaLabel }: TabsProps<K>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = tabs.length - 1;
    const next =
      e.key === "ArrowLeft" ? (i === last ? 0 : i + 1)
      : e.key === "ArrowRight" ? (i === 0 ? last : i - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(tabs[next].key);
  };

  return (
    <div role="tablist" aria-label={ariaLabel} className="mb-4 flex flex-wrap gap-1 border-b border-line">
      {tabs.map((tab, i) => {
        const active = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(e) => onKey(e, i)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition ${
              active
                ? "border-brand-600 text-brand-700 v3:font-semibold"
                : "border-transparent text-ink-subtle hover:text-ink-muted v3:text-ink-muted v3:hover:text-ink"
            }`}
          >
            {tab.label}
            {tab.badge !== undefined && (
              <>
                <span className="tabular text-ink-subtle v3:hidden"> ({tab.badge})</span>
                <span
                  className={`ms-1.5 hidden rounded-full px-1.5 py-px text-xs tabular v3:inline-block ${
                    active ? "bg-brand-100 text-brand-800" : "bg-surface-muted text-ink-muted"
                  }`}
                >
                  {tab.badge}
                </span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
