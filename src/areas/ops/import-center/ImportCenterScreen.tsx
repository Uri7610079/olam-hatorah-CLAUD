import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, type TabDef } from "@/components/Tabs";
import { MasterDataImportWizard } from "@/areas/admin/MasterDataImportWizard";
import { AutoDetectPanel } from "./panels/AutoDetectPanel";
import { FolderInboxPanel } from "./panels/FolderInboxPanel";
import { TalmudFilesPanel } from "./panels/TalmudFilesPanel";
import { TalmudReportImportPanel } from "./panels/TalmudReportImportPanel";
import type { StoredReportKey } from "@/lib/talmudReports";
import { EligibilityImportPanel } from "./panels/EligibilityImportPanel";
import { EligibilityListImportPanel } from "./panels/EligibilityListImportPanel";
import { ErrorsImportPanel } from "./panels/ErrorsImportPanel";
import { AuditsImportPanel } from "./panels/AuditsImportPanel";
import { PhoneListsImportPanel } from "./panels/PhoneListsImportPanel";
import { BankImportPanel } from "./panels/BankImportPanel";
import { TalmudBatchImportPanel } from "./panels/TalmudBatchImportPanel";

type DataTypeKey = "auto" | "talmudPulled" | "talmudReport" | "folder" | "master" | "talmudBatch" | "eligibility" | "eligibilityList" | "errors" | "audits" | "phone" | "bank";

const DATA_TYPE_TABS: TabDef<DataTypeKey>[] = [
  { key: "auto", label: "זיהוי אוטומטי" },
  { key: "talmudPulled", label: "קבצים מתלמוד" },
  { key: "talmudReport", label: "תשלומים ובג\"ץ מתלמוד" },
  { key: "folder", label: "קבצים מהתיקייה" },
  { key: "master", label: "עמותות/סניפים/קבוצות" },
  { key: "talmudBatch", label: "דוחות תלמוד (כמה יחד)" },
  { key: "eligibility", label: "זכאות חודשית (דוח תשלום)" },
  { key: "eligibilityList", label: "דוח זכאים" },
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
//
// לשונית "זיהוי אוטומטי" היא ברירת המחדל: מי שלא יודע לאיזה תחום הקובץ שייך מעלה
// אותו שם, והמערכת מזהה לפי כותרות העמודות ומעבירה לטאב הנכון עם הקובץ שכבר נבחר.
type HandoffMeta = { orgId?: string | null; month?: string | null; reportKey?: string | null };

export function ImportCenterScreen() {
  // ?tab=talmudPulled - קישור ישיר ללשונית (מהמסך "משיכה מתלמוד")
  const [params] = useSearchParams();
  const [dataType, setDataType] = useState<DataTypeKey>(() => (DATA_TYPE_TABS.some((t) => t.key === params.get("tab")) ? (params.get("tab") as DataTypeKey) : "auto"));
  // הקובץ עובר מהזיהוי האוטומטי לטאב היעד, כדי שלא יהיה צורך לבחור אותו פעמיים.
  const [handoffFile, setHandoffFile] = useState<File | null>(null);
  // קובץ ממשיכה מתלמוד מגיע עם העמותה והחודש שלו
  const [handoffMeta, setHandoffMeta] = useState<HandoffMeta>({});

  const routeToTab = (tab: string, file: File, meta: HandoffMeta = {}) => {
    setHandoffFile(file);
    setHandoffMeta(meta);
    setDataType(tab as DataTypeKey);
  };

  const changeTab = (tab: DataTypeKey) => {
    // מעבר ידני בין לשוניות מנקה קובץ שהועבר מהזיהוי - אחרת הוא היה "נדבק" לטאב
    // שהמשתמשת בחרה בעצמה מסיבה אחרת.
    setHandoffFile(null);
    setHandoffMeta({});
    setDataType(tab);
  };

  return (
    <div>
      <PageHeader
        title="מרכז יבוא"
        description="נקודת גישה אחת לכל סוגי היבוא הקיימים במערכת - אפשר להעלות קובץ בלי לדעת לאיזה תחום הוא שייך, או לבחור סוג ידנית. כל קליטה עוברת תצוגה מקדימה ואישור."
      />

      <Tabs tabs={DATA_TYPE_TABS} activeTab={dataType} onChange={changeTab} ariaLabel="סוג נתונים ליבוא" />

      {dataType === "auto" && <AutoDetectPanel onRouteToTab={routeToTab} />}
      {dataType === "talmudPulled" && <TalmudFilesPanel onRouteToTab={routeToTab} />}
      {dataType === "talmudReport" && (
        <TalmudReportImportPanel
          file={handoffFile}
          reportKey={(handoffMeta.reportKey as StoredReportKey | undefined) ?? null}
          orgId={handoffMeta.orgId ?? null}
          month={handoffMeta.month ?? null}
        />
      )}
      {dataType === "folder" && <FolderInboxPanel onRouteToTab={routeToTab} />}
      {dataType === "master" && <MasterDataImportWizard initialFile={handoffFile} />}
      {dataType === "talmudBatch" && <TalmudBatchImportPanel />}
      {dataType === "eligibility" && <EligibilityImportPanel initialFile={handoffFile} initialOrgId={handoffMeta.orgId} initialMonth={handoffMeta.month} />}
      {dataType === "eligibilityList" && <EligibilityListImportPanel initialFile={handoffFile} />}
      {dataType === "errors" && <ErrorsImportPanel initialFile={handoffFile} initialOrgId={handoffMeta.orgId} initialMonth={handoffMeta.month} />}
      {dataType === "audits" && <AuditsImportPanel initialFile={handoffFile} />}
      {dataType === "phone" && <PhoneListsImportPanel initialFile={handoffFile} />}
      {dataType === "bank" && <BankImportPanel initialFile={handoffFile} />}
    </div>
  );
}
