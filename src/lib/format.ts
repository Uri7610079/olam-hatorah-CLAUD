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
  return `${sign}${abs} ₪`;
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
