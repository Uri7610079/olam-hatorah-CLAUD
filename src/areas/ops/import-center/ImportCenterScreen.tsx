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
import { useIsV3 } from "@/lib/uiTheme";

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

// v3: 12 הלשוניות נשברו לכמה שורות. כאן הן מקובצות לפי תחום - בוחרים קבוצה,
// ובתוכה לשונית. אותם מפתחות בדיוק, ואותה התנהגות של ?tab= ושל העברה מהזיהוי.
type GroupKey = "start" | "talmud" | "base" | "bank";
const TAB_GROUPS: { key: GroupKey; label: string; hint: string; tabs: DataTypeKey[] }[] = [
  { key: "start", label: "לא בטוחה מה הקובץ", hint: "זיהוי אוטומטי וקבצים מהתיקייה", tabs: ["auto", "folder"] },
  { key: "talmud", label: "תלמוד", hint: "דוחות, זכאות ושגויים", tabs: ["talmudPulled", "talmudReport", "talmudBatch", "eligibility", "eligibilityList", "errors"] },
  { key: "base", label: "נתוני בסיס", hint: "עמותות, ביקורות, רשימות טלפוניות", tabs: ["master", "audits", "phone"] },
  { key: "bank", label: "בנק", hint: "תנועות בנק", tabs: ["bank"] },
];
const groupOf = (tab: DataTypeKey): GroupKey => TAB_GROUPS.find((g) => g.tabs.includes(tab))?.key ?? "start";

function GroupedTabs({ active, onChange }: { active: DataTypeKey; onChange: (tab: DataTypeKey) => void }) {
  const current = groupOf(active);
  const group = TAB_GROUPS.find((g) => g.key === current)!;
  return (
    <div className="mb-4">
      <div role="group" aria-label="תחום היבוא" className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TAB_GROUPS.map((g) => {
          const on = g.key === current;
          return (
            <button
              key={g.key}
              type="button"
              aria-pressed={on}
              // מעבר לקבוצה אחרת פותח את הלשונית הראשונה שלה - כמו לחיצה עליה
              onClick={() => !on && onChange(g.tabs[0])}
              className={`rounded-card border px-3 py-2 text-right transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                on ? "border-brand-600 bg-brand-50" : "border-line bg-surface hover:border-brand-300"
              }`}
            >
              <span className={`block text-sm font-semibold ${on ? "text-brand-800" : "text-primary"}`}>{g.label}</span>
              <span className="block text-xs text-ink-subtle">{g.hint}</span>
            </button>
          );
        })}
      </div>
      {group.tabs.length > 1 && (
        <Tabs tabs={DATA_TYPE_TABS.filter((t) => group.tabs.includes(t.key))} activeTab={active} onChange={onChange} ariaLabel={`סוג נתונים ליבוא - ${group.label}`} />
      )}
    </div>
  );
}

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
  const isV3 = useIsV3();

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

      {isV3 ? (
        <GroupedTabs active={dataType} onChange={changeTab} />
      ) : (
        <Tabs tabs={DATA_TYPE_TABS} activeTab={dataType} onChange={changeTab} ariaLabel="סוג נתונים ליבוא" />
      )}

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
