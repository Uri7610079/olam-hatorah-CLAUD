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
export function Tabs<K extends string>({ tabs, activeTab, onChange, ariaLabel }: TabsProps<K>) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="mb-4 flex flex-wrap gap-1 border-b border-line">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          aria-selected={activeTab === tab.key}
          onClick={() => onChange(tab.key)}
          className={`border-b-2 px-3 py-2 text-sm font-medium transition ${
            activeTab === tab.key
              ? "border-brand-600 text-brand-700"
              : "border-transparent text-ink-subtle hover:text-ink-muted"
          }`}
        >
          {tab.label}
          {tab.badge !== undefined && <span className="tabular text-ink-subtle"> ({tab.badge})</span>}
        </button>
      ))}
    </div>
  );
}
