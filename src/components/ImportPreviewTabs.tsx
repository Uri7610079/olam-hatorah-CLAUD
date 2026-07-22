import { type ReactNode, useState } from "react";
import { Tabs } from "./Tabs";

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
  const tabs = (Object.keys(TAB_LABEL) as ImportPreviewTabKey[]).map((key) => ({
    key,
    label: TAB_LABEL[key],
    badge: key === "valid" ? validCount : key === "needsDecision" ? needsDecisionCount : invalidCount,
  }));

  return (
    <div>
      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} ariaLabel="תצוגה מקדימה של יבוא" />
      {children(activeTab)}
    </div>
  );
}
