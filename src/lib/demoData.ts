// נתוני דמו מקומיים בלבד לשלב 1 — לצורך תצוגת שלד הדשבורדים.
// יוחלפו לגמרי בשאילתות Supabase אמיתיות (מסוננות is_demo) משלב 3 והלאה.

export interface ExceptionCounter {
  key: string;
  label: string;
  count: number;
  severity: "critical" | "high" | "medium" | "ok" | "neutral";
  href: string;
}

export const OPS_EXCEPTIONS: ExceptionCounter[] = [
  { key: "drafts", label: "תלמידים בטיוטה שטרם הושלמו", count: 7, severity: "medium", href: "/ops/students" },
  { key: "waiting-export", label: "ממתינים ליצוא לתלמוד", count: 12, severity: "neutral", href: "/ops/talmud/export" },
  { key: "open-errors", label: "שגיאות תלמוד פתוחות", count: 4, severity: "high", href: "/ops/talmud/errors" },
  {
    key: "missing-from-report",
    label: "תלמידים פעילים שלא הופיעו בדוח",
    count: 2,
    severity: "critical",
    href: "/ops/talmud/eligibility",
  },
  { key: "no-phone", label: "תלמידים ללא טלפון", count: 3, severity: "medium", href: "/ops/students" },
  { key: "no-bank", label: "תלמידים ללא חשבון בנק מאומת", count: 5, severity: "high", href: "/ops/students" },
  { key: "phone-gaps", label: "פערים ברשימת בימות המשיח", count: 6, severity: "medium", href: "/ops/phone-lists" },
];

export const FINANCE_EXCEPTIONS: ExceptionCounter[] = [
  { key: "month-status", label: "חודש נוכחי בסטטוס", count: 0, severity: "neutral", href: "/finance/months" },
  { key: "pending-distribution", label: "חלוקות ממתינות לאישור", count: 3, severity: "medium", href: "/finance/distributions" },
  { key: "masav-not-matched", label: "מס\"בים שהופקו ולא סומנו כבוצעו", count: 2, severity: "high", href: "/finance/masav" },
  { key: "returned-payments", label: "תשלומים שחזרו ולא טופלו", count: 1, severity: "high", href: "/finance/returns" },
  {
    key: "unrecognized-transactions",
    label: "תנועות בנק לא מזוהות",
    count: 4,
    severity: "critical",
    href: "/finance/bank-matching",
  },
  { key: "unassigned-donations", label: "תרומות לא משויכות", count: 2, severity: "medium", href: "/finance/donations" },
  { key: "ratio-90-10", label: "מצב 90%/10%", count: 0, severity: "neutral", href: "/finance/reports" },
];
