import { type ReactNode, useState } from "react";

export type ImportPreviewTabKey = "valid" | "needsDecision" | "invalid";

interface ImportPreviewTabsProps {
  validCount: number;
  needsDecisionCount: number;
  invalidCount: number;
  children: (activeTab: ImportPreviewTabKey) => ReactNode;
  defaultTab?: ImportPreviewTabKey;
}

const TAB_LABEL: Record<ImportPreviewTabKey, string> = {
  valid: "תקין",
  needsDecision: "דורש החלטה",
  invalid: "שגוי",
};

// שלד ה-Preview ליבוא (שלב 5 ואילך): שלוש לשוניות קבועות לפי האפיון — תקין / דורש החלטה / שגוי.
// אינו שולף נתונים בעצמו; מקבל ספירות ומרנדר תוכן דרך children לפי הלשונית הפעילה.
export function ImportPreviewTabs({
  validCount,
  needsDecisionCount,
  invalidCount,
  children,
  defaultTab = "valid",
}: ImportPreviewTabsProps) {
  const [activeTab, setActiveTab] = useState<ImportPreviewTabKey>(defaultTab);
  const counts: Record<ImportPreviewTabKey, number> = {
    valid: validCount,
    needsDecision: needsDecisionCount,
    invalid: invalidCount,
  };

  return (
    <div>
      <div role="tablist" aria-label="תצוגה מקדימה של יבוא" className="mb-4 flex gap-1 border-b border-slate-200">
        {(Object.keys(TAB_LABEL) as ImportPreviewTabKey[]).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition ${
              activeTab === tab
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {TAB_LABEL[tab]} <span className="tabular text-slate-400">({counts[tab]})</span>
          </button>
        ))}
      </div>
      {children(activeTab)}
    </div>
  );
}
