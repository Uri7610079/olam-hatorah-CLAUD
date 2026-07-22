import type { Area } from "./AreaContext";

export interface ScreenDef {
  path: string;
  area: Area;
  navLabel: string;
  title: string;
  description?: string;
  builtInStage: string;
}

// מפת המסכים — תואמת לאפיון V3 §6 ולתוכנית השלבים. כולל רק מסכים בתוך ה-Scope
// (אין כאן פניות תלמידים, משימות, תזכורות דיווח וכו' — הוסרו/נדחו באפיון).
export const SCREENS: ScreenDef[] = [
  // תפעול שוטף
  { path: "/ops/students", area: "ops", navLabel: "תלמידים", title: "תלמידים", builtInStage: "שלב 4" },
  { path: "/ops/organizations", area: "ops", navLabel: "עמותות", title: "עמותות", builtInStage: "שלב 3" },
  {
    path: "/ops/branches-groups",
    area: "ops",
    navLabel: "סניפים וקבוצות",
    title: "סניפים וקבוצות",
    builtInStage: "שלב 3",
  },
  {
    path: "/ops/import-center",
    area: "ops",
    navLabel: "מרכז יבוא",
    title: "מרכז יבוא",
    builtInStage: "שלב 5",
  },
  {
    path: "/ops/talmud/export",
    area: "ops",
    navLabel: "יצוא לתלמוד",
    title: "יצוא תלמידים לתלמוד",
    builtInStage: "שלב 6",
  },
  {
    path: "/ops/talmud/eligibility",
    area: "ops",
    navLabel: "זכאות",
    title: "זכאות חודשית",
    builtInStage: "שלב 6",
  },
  {
    path: "/ops/talmud/errors",
    area: "ops",
    navLabel: "מרכז שגיאות",
    title: "מרכז שגיאות תלמוד",
    builtInStage: "שלב 6",
  },
  {
    path: "/ops/talmud/retro",
    area: "ops",
    navLabel: "רטרו והפרשים",
    title: "רטרו והפרשים",
    builtInStage: "שלב 7",
  },
  { path: "/ops/quotas", area: "ops", navLabel: "מכסות", title: "מכסות", builtInStage: "שלב 7" },
  { path: "/ops/audits", area: "ops", navLabel: "ביקורות", title: "ביקורות משרד החינוך", builtInStage: "שלב 13" },
  {
    path: "/ops/phone-lists",
    area: "ops",
    navLabel: "רשימות טלפוניות",
    title: "רשימות בימות המשיח",
    builtInStage: "שלב 13",
  },
  { path: "/ops/documents", area: "ops", navLabel: "מסמכים", title: "מסמכים ומכתבים", builtInStage: "שלב 13" },

  // כספים ובקרה
  { path: "/finance/months", area: "finance", navLabel: "חודשים כספיים", title: "חודשים כספיים", builtInStage: "שלב 8" },
  {
    path: "/finance/commission-rules",
    area: "finance",
    navLabel: "כללי עמלה",
    title: "כללי עמלה",
    builtInStage: "שלב 8",
  },
  {
    path: "/finance/group-balances",
    area: "finance",
    navLabel: "יתרות קבוצות",
    title: "יתרות קבוצות",
    builtInStage: "שלב 8",
  },
  { path: "/finance/donations", area: "finance", navLabel: "תרומות", title: "תרומות", builtInStage: "שלב 9" },
  {
    path: "/finance/distributions",
    area: "finance",
    navLabel: "חלוקות",
    title: "הוראות חלוקה",
    builtInStage: "שלב 9",
  },
  { path: "/finance/masav", area: "finance", navLabel: "מס\"ב", title: "מס\"ב ותשלומים", builtInStage: "שלב 10" },
  { path: "/finance/returns", area: "finance", navLabel: "החזרות", title: "החזרות ותשלום חוזר", builtInStage: "שלב 10" },
  {
    path: "/finance/bank-transactions",
    area: "finance",
    navLabel: "תנועות בנק",
    title: "תנועות בנק",
    builtInStage: "שלב 11",
  },
  {
    path: "/finance/bank-matching",
    area: "finance",
    navLabel: "התאמות בנק",
    title: "התאמות בנק",
    builtInStage: "שלב 12",
  },
  { path: "/finance/reports", area: "finance", navLabel: "דוחות", title: "דוחות כספיים", builtInStage: "שלב 14" },

  // ניהול
  { path: "/admin/users", area: "admin", navLabel: "משתמשים והרשאות", title: "משתמשים והרשאות", builtInStage: "שלב 2" },
  {
    path: "/admin/study-codes",
    area: "admin",
    navLabel: "קודי לימוד",
    title: "קודי לימוד וערכי מערכת",
    builtInStage: "שלב 5",
  },
  {
    path: "/admin/transaction-types",
    area: "admin",
    navLabel: "סוגי תנועה",
    title: "סוגי תנועות בנק",
    builtInStage: "שלב 11",
  },
  {
    path: "/admin/recognition-rules",
    area: "admin",
    navLabel: "כללי זיהוי",
    title: "כללי זיהוי בנק",
    builtInStage: "שלב 11",
  },
  { path: "/admin/demo-data", area: "admin", navLabel: "נתוני דמו", title: "ניהול נתוני דמו", builtInStage: "שלב 15" },
  { path: "/admin/audit-log", area: "admin", navLabel: "יומן פעילות", title: "יומן פעילות", builtInStage: "שלב 2" },
];

export function screensForArea(area: Area): ScreenDef[] {
  return SCREENS.filter((s) => s.area === area);
}
