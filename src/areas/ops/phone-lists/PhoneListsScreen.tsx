import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Tabs } from "@/components/Tabs";
import { EligibilityCallListTab } from "./EligibilityCallListTab";
import { PhoneListCompareTab } from "./PhoneListCompareTab";

type TabKey = "call" | "compare";

// רשימות טלפוניות (שלב 37): הלשונית הראשית בונה את רשימת החיוג מדוח הזכאים של
// תלמוד. ההשוואה הישנה (העלאת רשימה קיימת מול התלמידים) נשארה כלשונית משנית.
export function PhoneListsScreen() {
  const [tab, setTab] = useState<TabKey>("call");
  return (
    <div>
      <PageHeader
        title="רשימות טלפוניות"
        description="רשימת חיוג לתלמידים הזכאים - למשל להתראה לפני ביקורת. נבנית מדוח הזכאים של תלמוד, עם הטלפון מכרטיס התלמיד."
      />
      <Tabs
        tabs={[
          { key: "call", label: "רשימת חיוג מדוח הזכאים" },
          { key: "compare", label: "השוואה לרשימה קיימת" },
        ]}
        activeTab={tab}
        onChange={setTab}
        ariaLabel="רשימות טלפוניות"
      />
      {tab === "call" ? <EligibilityCallListTab /> : <PhoneListCompareTab />}
    </div>
  );
}
