import * as XLSX from "xlsx";
import { TALMUD_ID_TYPE, TALMUD_ISRAEL, TALMUD_MARITAL, TALMUD_STUDY_TYPES, TALMUD_VISA_TYPES } from "./talmudCodes";
import { talmudCountryCode } from "./talmudCountry";

export { talmudCountryCode };

// קובץ "קליטת תלמידים מ-Excel" של תלמוד, בתבנית של משרד החינוך
// ("רישום תלמידים במערכת תלמוד.xls"): גיליון Sheet1, שורת כותרות, שורה לתלמיד.
//
// כל שורה נבנית מהנתונים במערכת, ולצידה מה חסר (תלמוד תדחה את השורה) ומה
// כדאי לבדוק. השורה נכנסת לקובץ גם כשחסר בה משהו - המשרד מחליט, והמסך
// מראה בדיוק מה.

export const TALMUD_HEADERS = [
  "משפחה", "פרטי", "סוג מזהה", "ת.ז./ דרכון", "מוצא", "ת. לידה", "מגדר",
  "מצב משפחתי", "סוג לימודים", "ת. כניסה", "ת. עזיבה", "מספר אשרה", "סוג אשרה", "תוקף אשרה",
] as const;

export interface TalmudSource {
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  id_type: string;
  external_id: string;
  passport_country: string | null;
  birth_date: string | null;
  marital_status: string | null;
  study_code: string | null;
  entry_date: string | null;
  exit_date: string | null;
  visa_number: string | null;
  visa_type: number | null;
  visa_expiry: string | null;
}

/** ערך תא: טקסט, מספר, או תאריך (YYYY-MM-DD). null = תא ריק. */
export type TalmudCell = { t: "s"; v: string } | { t: "n"; v: number } | { t: "d"; v: string } | null;

export interface TalmudRow {
  cells: TalmudCell[];
  /** חסר נתון חובה - תלמוד תדחה את השורה */
  missing: string[];
  /** לבדיקה בלבד */
  notes: string[];
}

const STUDY_CODES = new Set(TALMUD_STUDY_TYPES.map((s) => s.code));
const VISA_CODES = new Set(TALMUD_VISA_TYPES.map((v) => v.code));

const text = (v: string | null | undefined): TalmudCell => (v && v.trim() ? { t: "s", v: v.trim() } : null);
const date = (v: string | null | undefined): TalmudCell => (v ? { t: "d", v: v.slice(0, 10) } : null);
const num = (v: number | null | undefined): TalmudCell => (v === null || v === undefined || Number.isNaN(v) ? null : { t: "n", v });

/** שם פרטי ושם משפחה. אם אין שדות נפרדים - פיצול של השם המלא, עם הערה. */
function splitName(s: TalmudSource): { last: string; first: string; note?: string } {
  if (s.first_name?.trim() && s.last_name?.trim()) return { last: s.last_name.trim(), first: s.first_name.trim() };
  // במערכת השם המלא נשמר "משפחה פרטי" ("אבוטבול אביחי"). שם משפחה של שתי
  // מילים ("בן שושן") יתפצל לא נכון - ולכן הערה, ותיקון בכרטיס התלמיד.
  const words = s.full_name.trim().split(/\s+/);
  if (words.length < 2) return { last: s.full_name.trim(), first: "" };
  return { last: words[0], first: words.slice(1).join(" "), note: `השם פוצל אוטומטית (משפחה: ${words[0]}) - כדאי לבדוק` };
}

export function buildTalmudRow(s: TalmudSource): TalmudRow {
  const missing: string[] = [];
  const notes: string[] = [];

  const name = splitName(s);
  if (!name.first || !name.last) missing.push("חסר שם פרטי או שם משפחה");
  if (name.note) notes.push(name.note);

  let idType: number | null = null;
  let idCell: TalmudCell = null;
  let origin: number | null = null;
  if (s.id_type === "israeli_id") {
    idType = TALMUD_ID_TYPE.israeli_id;
    const digits = s.external_id.replace(/\D/g, "").replace(/^0+/, "");
    if (digits.length < 5 || digits.length > 9) missing.push("מספר תעודת זהות לא תקין");
    idCell = { t: "s", v: digits.padStart(9, "0") }; // טקסט: האפס המוביל נשמר
    origin = TALMUD_ISRAEL;
  } else if (s.id_type === "passport") {
    idType = TALMUD_ID_TYPE.passport;
    idCell = text(s.external_id);
    origin = talmudCountryCode(s.passport_country);
    if (origin === null) {
      missing.push(s.passport_country?.trim()
        ? `מדינת הדרכון "${s.passport_country.trim()}" לא נמצאה ברשימת המדינות של תלמוד`
        : "חסרה מדינת מוצא");
    }
    if (!s.visa_number || !s.visa_type || !s.visa_expiry) notes.push("תלמיד בדרכון - חסרים פרטי אשרה");
  } else {
    missing.push('סוג מזהה "אחר" - אין לו קוד בתלמוד');
  }

  if (!s.birth_date) missing.push("חסר תאריך לידה");
  const marital = s.marital_status === "single" || s.marital_status === "married" ? TALMUD_MARITAL[s.marital_status] : null;
  if (marital === null) missing.push("חסר מצב משפחתי");

  const study = s.study_code && /^\d+$/.test(s.study_code.trim()) ? Number(s.study_code.trim()) : null;
  if (study === null) missing.push("חסר סוג לימודים (קוד לימוד)");
  else if (!STUDY_CODES.has(study)) notes.push(`קוד לימוד ${study} לא מופיע ברשימת סוגי הלימוד של התבנית`);

  if (!s.entry_date) missing.push("חסר תאריך כניסה");

  const visaNumber = s.visa_number?.trim()
    ? /^\d+$/.test(s.visa_number.trim()) ? num(Number(s.visa_number.trim())) : text(s.visa_number)
    : null;
  if (s.visa_type !== null && s.visa_type !== undefined && !VISA_CODES.has(s.visa_type)) notes.push(`סוג אשרה ${s.visa_type} לא מוכר`);

  return {
    cells: [
      text(name.last), text(name.first), num(idType), idCell, num(origin), date(s.birth_date), num(1),
      num(marital), num(study), date(s.entry_date), date(s.exit_date), visaNumber, num(s.visa_type), date(s.visa_expiry),
    ],
    missing,
    notes,
  };
}

/** תאריך YYYY-MM-DD למספר הימים של אקסל - בלי אזור זמן, כדי שלא יזוז ביום. */
export function excelSerial(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/** התצוגה בתא, כפי שתופיע בקובץ ובמסך */
export function cellText(c: TalmudCell): string {
  if (!c) return "";
  if (c.t === "d") return c.v.split("-").reverse().join("/");
  return String(c.v);
}

/** קובץ xls (המבנה הישן, כמו התבנית) עם גיליון Sheet1 */
export function buildTalmudWorkbook(rows: TalmudRow[]): ArrayBuffer {
  const ws: XLSX.WorkSheet = {};
  TALMUD_HEADERS.forEach((h, c) => { ws[XLSX.utils.encode_cell({ r: 0, c })] = { t: "s", v: h }; });
  rows.forEach((row, i) => {
    row.cells.forEach((cell, c) => {
      if (!cell) return;
      const addr = XLSX.utils.encode_cell({ r: i + 1, c });
      if (cell.t === "s") ws[addr] = { t: "s", v: cell.v, z: "@" };
      else if (cell.t === "n") ws[addr] = { t: "n", v: cell.v, z: "0" };
      else ws[addr] = { t: "n", v: excelSerial(cell.v), z: "dd/mm/yyyy" };
    });
  });
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length, 1), c: TALMUD_HEADERS.length - 1 } });
  ws["!cols"] = [12, 12, 10, 13, 8, 12, 7, 11, 11, 12, 12, 13, 10, 12].map((wch) => ({ wch }));
  ws["!autofilter"] = { ref: "A1:N1" };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "array", bookType: "xls" }) as ArrayBuffer;
}
