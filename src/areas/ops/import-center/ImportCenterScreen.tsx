import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, type TabDef } from "@/components/Tabs";
import { MasterDataImportWizard } from "@/areas/admin/MasterDataImportWizard";
import { EligibilityImportPanel } from "./panels/EligibilityImportPanel";
import { ErrorsImportPanel } from "./panels/ErrorsImportPanel";
import { AuditsImportPanel } from "./panels/AuditsImportPanel";
import { PhoneListsImportPanel } from "./panels/PhoneListsImportPanel";
import { BankImportPanel } from "./panels/BankImportPanel";

type DataTypeKey = "master" | "eligibility" | "errors" | "audits" | "phone" | "bank";

const DATA_TYPE_TABS: TabDef<DataTypeKey>[] = [
  { key: "master", label: "עמותות/סניפים/קבוצות" },
  { key: "eligibility", label: "זכאות חודשית" },
  { key: "errors", label: "שגיאות תלמוד" },
  { key: "audits", label: "ביקורות" },
  { key: "phone", label: "רשימות טלפוניות" },
  { key: "bank", label: "תנועות בנק" },
];

// מרכז יבוא - נקודת גישה אחת לכל סוגי היבוא הקיימים באמת במערכת, כל אחד עם לוגיקת
// היבוא/אימות/קליטה המקורית שלו (ר' הפאנלים תחת ./panels ו-MasterDataImportWizard).
// לא הומצאה כאן שום יכולת יבוא חדשה - כל טאב הוא עטיפה סביב מסך שכבר קיים ועובד,
// שנשאר גם הוא זמין במקומו המקורי (זו נקודת גישה נוספת, לא תחליף). תלמידים/תרומות/
// חלוקות/מס"ב/כללי עמלה - אין להם היום יבוא אמיתי, ולכן אין להם כאן טאב.
export function ImportCenterScreen() {
  const [dataType, setDataType] = useState<DataTypeKey>("master");

  return (
    <div>
      <PageHeader
        title="מרכז יבוא"
        description="נקודת גישה אחת לכל סוגי היבוא הקיימים במערכת - בחרי סוג נתונים, וכל שאר התהליך (העלאה, תצוגה מקדימה לפי תקין/דורש החלטה/שגוי, וקליטה) זהה למסך המקורי של אותו סוג."
      />

      <Tabs tabs={DATA_TYPE_TABS} activeTab={dataType} onChange={setDataType} ariaLabel="סוג נתונים ליבוא" />

      {dataType === "master" && <MasterDataImportWizard />}
      {dataType === "eligibility" && <EligibilityImportPanel />}
      {dataType === "errors" && <ErrorsImportPanel />}
      {dataType === "audits" && <AuditsImportPanel />}
      {dataType === "phone" && <PhoneListsImportPanel />}
      {dataType === "bank" && <BankImportPanel />}
    </div>
  );
}
