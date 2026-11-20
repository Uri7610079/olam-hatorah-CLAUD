// שכבת תצוגה אחידה לסכומים, מספרים, תאריכים וחודשים (ערכה v3, שדרוג 2026-11).
//
// תצוגה בלבד: הפונקציות כאן לא מעגלות ערך שנשמר, לא משנות חישוב ולא
// משמשות להשוואה. עד היום כל מסך כתב לעצמו money()/monthLabel() משלו, ולכן
// אותו סכום הופיע פעם "1,234.5" ופעם "1,234.50 ₪", ואותו תאריך פעם
// 19.11.2026 ופעם 2026-11-19 - לפעמים באותו מסך.
export { formatIsraeliPhone as formatPhone } from "./israeliPhone";

const MONEY = new Intl.NumberFormat("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const WHOLE = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 });
const NUMBER = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 2 });

const toNumber = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** ‏1,234.50 ₪. ריק/לא מספר → "—". whole: בלי אגורות (לסיכומים גדולים). */
export function formatMoney(v: number | string | null | undefined, opts: { whole?: boolean; sign?: boolean } = {}): string {
  const n = toNumber(v);
  if (n === null) return "—";
  const abs = (opts.whole ? WHOLE : MONEY).format(Math.abs(n));
  // סימן מינוס מפורש לפני הסכום (ולא רק צבע) - דרישת נגישות: חובה/זכות לא מועברים בצבע בלבד.
  const sign = n < 0 ? "−" : opts.sign && n > 0 ? "+" : "";
  // בעמוד מימין לשמאל סימן מינוס לפני מספר "קופץ" לצד השני שלו (נראה כ-11,137.00−).
  // בידוד שמאל-לימין (LRI…PDI) סביב הסימן והמספר בלבד שומר אותם יחד, ו-₪ נשאר
  // באותו מקום כמו בסכום חיובי.
  return sign ? `⁦${sign}${abs}⁩ ₪` : `${abs} ₪`;
}

/** מספר רגיל עם מפריד אלפים: 1,583 */
export function formatNumber(v: number | string | null | undefined): string {
  const n = toNumber(v);
  return n === null ? "—" : NUMBER.format(n);
}

const parseDate = (v: string | Date): Date | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  // "2026-11-19" לבד מפוענח כ-UTC וזז ביום אחורה בשעון ישראל - מוסיפים שעה מקומית.
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00` : v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** ‏19.11.2026 - הפורמט האחיד לתאריך בכל המערכת. */
export function formatDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = parseDate(v);
  if (!d) return String(v);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

/** ‏19.11.2026 · 14:05 */
export function formatDateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = parseDate(v);
  if (!d) return String(v);
  return `${formatDate(d)} · ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "נובמבר 2026" מתוך "2026-11" או "2026-11-01". */
export function formatMonth(v: string | null | undefined): string {
  if (!v) return "—";
  const [y, m] = v.split("-").map(Number);
  if (!y || !m) return v;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("he-IL", { month: "long", year: "numeric", timeZone: "UTC" });
}

// זמן מהמסד (UTC) בשעון ישראל, לדוחות ולקבצי יצוא: "2026-11-20 09:45". עד היום חלק
// מהדוחות חתכו את המחרוזת מהמסד והציגו שעה עולמית - אותה כניסה הופיעה ב-07:45 בדוח
// וב-09:45 ביומן הפעילות (INT-09). בלי תלות באזור הזמן של המחשב.
const ISRAEL_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export function israelDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const p = Object.fromEntries(ISRAEL_PARTS.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
export function israelDate(v: string | null | undefined): string {
  const s = israelDateTime(v);
  return s === "—" ? s : s.slice(0, 10);
}
