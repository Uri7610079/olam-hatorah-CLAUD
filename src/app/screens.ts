import type { LucideIcon } from "lucide-react";
import {
  Users,
  Building2,
  Network,
  Upload,
  Send,
  CheckSquare,
  AlertTriangle,
  RotateCcw,
  Gauge,
  ClipboardList,
  Phone,
  FileText,
  Calendar,
  Percent,
  Wallet,
  HeartHandshake,
  Split,
  Landmark,
  Undo2,
  ArrowLeftRight,
  GitMerge,
  UserCog,
  BookOpen,
  Tags,
  ScanSearch,
  FlaskConical,
  History,
} from "lucide-react";
import type { Area } from "./AreaContext";

export interface ScreenDef {
  path: string;
  area: Area;
  navLabel: string;
  title: string;
  description?: string;
  builtInStage: string;
  icon: LucideIcon;
}

// מפת המסכים — תואמת לאפיון V3 §6 ולתוכנית השלבים. כולל רק מסכים בתוך ה-Scope
// (אין כאן פניות תלמידים, משימות, תזכורות דיווח וכו' — הוסרו/נדחו באפיון).
// האייקונים פונקציונליים בלבד (זיהוי מהיר של קטגוריה בניווט) - לא דקורטיביים.
export const SCREENS: ScreenDef[] = [
  // תפעול שוטף
  { path: "/ops/students", area: "ops", navLabel: "תלמידים", title: "תלמידים", builtInStage: "שלב 4", icon: Users },
  {
    path: "/ops/organizations",
    area: "ops",
    navLabel: "עמותות",
    title: "עמותות",
    builtInStage: "שלב 3",
    icon: Building2,
  },
  {
    path: "/ops/branches-groups",
    area: "ops",
    navLabel: "סניפים וקבוצות",
    title: "סניפים וקבוצות",
    builtInStage: "שלב 3",
    icon: Network,
  },
  {
    path: "/ops/import-center",
    area: "ops",
    navLabel: "מרכז יבוא",
    title: "מרכז יבוא",
    builtInStage: "שלב 5",
    icon: Upload,
  },
  {
    path: "/ops/talmud/export",
    area: "ops",
    navLabel: "יצוא לתלמוד",
    title: "יצוא תלמידים לתלמוד",
    builtInStage: "שלב 6",
    icon: Send,
  },
  {
    path: "/ops/talmud/eligibility",
    area: "ops",
    navLabel: "זכאות",
    title: "זכאות חודשית",
    builtInStage: "שלב 6",
    icon: CheckSquare,
  },
  {
    path: "/ops/talmud/errors",
    area: "ops",
    navLabel: "מרכז שגיאות",
    title: "מרכז שגיאות תלמוד",
    builtInStage: "שלב 6",
    icon: AlertTriangle,
  },
  {
    path: "/ops/talmud/retro",
    area: "ops",
    navLabel: "רטרו והפרשים",
    title: "רטרו והפרשים",
    builtInStage: "שלב 7",
    icon: RotateCcw,
  },
  { path: "/ops/quotas", area: "ops", navLabel: "מכסות", title: "מכסות", builtInStage: "שלב 7", icon: Gauge },
  {
    path: "/ops/audits",
    area: "ops",
    navLabel: "ביקורות",
    title: "ביקורות משרד החינוך",
    builtInStage: "שלב 13",
    icon: ClipboardList,
  },
  {
    path: "/ops/phone-lists",
    area: "ops",
    navLabel: "רשימות טלפוניות",
    title: "רשימות בימות המשיח",
    builtInStage: "שלב 13",
    icon: Phone,
  },
  {
    path: "/ops/documents",
    area: "ops",
    navLabel: "מסמכים",
    title: "מסמכים ומכתבים",
    builtInStage: "שלב 13",
    icon: FileText,
  },

  // כספים ובקרה
  {
    path: "/finance/months",
    area: "finance",
    navLabel: "חודשים כספיים",
    title: "חודשים כספיים",
    builtInStage: "שלב 8",
    icon: Calendar,
  },
  {
    path: "/finance/commission-rules",
    area: "finance",
    navLabel: "כללי עמלה",
    title: "כללי עמלה",
    builtInStage: "שלב 8",
    icon: Percent,
  },
  {
    path: "/finance/group-balances",
    area: "finance",
    navLabel: "יתרות קבוצות",
    title: "יתרות קבוצות",
    builtInStage: "שלב 8",
    icon: Wallet,
  },
  {
    path: "/finance/donations",
    area: "finance",
    navLabel: "תרומות",
    title: "תרומות",
    builtInStage: "שלב 9",
    icon: HeartHandshake,
  },
  {
    path: "/finance/distributions",
    area: "finance",
    navLabel: "חלוקות",
    title: "הוראות חלוקה",
    builtInStage: "שלב 9",
    icon: Split,
  },
  {
    path: "/finance/masav",
    area: "finance",
    navLabel: "מס\"ב",
    title: "מס\"ב ותשלומים",
    builtInStage: "שלב 10",
    icon: Landmark,
  },
  {
    path: "/finance/returns",
    area: "finance",
    navLabel: "החזרות",
    title: "החזרות ותשלום חוזר",
    builtInStage: "שלב 10",
    icon: Undo2,
  },
  {
    path: "/finance/bank-transactions",
    area: "finance",
    navLabel: "תנועות בנק",
    title: "תנועות בנק",
    builtInStage: "שלב 11",
    icon: ArrowLeftRight,
  },
  {
    path: "/finance/bank-matching",
    area: "finance",
    navLabel: "התאמות בנק",
    title: "התאמות בנק",
    builtInStage: "שלב 12",
    icon: GitMerge,
  },
  {
    path: "/finance/reports",
    area: "finance",
    navLabel: "דוחות",
    title: "דוחות כספיים",
    builtInStage: "שלב 14",
    icon: ClipboardList,
  },

  // ניהול
  {
    path: "/admin/users",
    area: "admin",
    navLabel: "משתמשים והרשאות",
    title: "משתמשים והרשאות",
    builtInStage: "שלב 2",
    icon: UserCog,
  },
  {
    path: "/admin/study-codes",
    area: "admin",
    navLabel: "קודי לימוד",
    title: "קודי לימוד וערכי מערכת",
    builtInStage: "שלב 5",
    icon: BookOpen,
  },
  {
    path: "/admin/transaction-types",
    area: "admin",
    navLabel: "סוגי תנועה",
    title: "סוגי תנועות בנק",
    builtInStage: "שלב 11",
    icon: Tags,
  },
  {
    path: "/admin/recognition-rules",
    area: "admin",
    navLabel: "כללי זיהוי",
    title: "כללי זיהוי בנק",
    builtInStage: "שלב 11",
    icon: ScanSearch,
  },
  {
    path: "/admin/demo-data",
    area: "admin",
    navLabel: "נתוני דמו",
    title: "ניהול נתוני דמו",
    builtInStage: "שלב 15",
    icon: FlaskConical,
  },
  {
    path: "/admin/audit-log",
    area: "admin",
    navLabel: "יומן פעילות",
    title: "יומן פעילות",
    builtInStage: "שלב 2",
    icon: History,
  },
];

export function screensForArea(area: Area): ScreenDef[] {
  return SCREENS.filter((s) => s.area === area);
}
