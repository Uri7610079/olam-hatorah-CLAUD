import Papa from "papaparse";
import * as XLSX from "xlsx";

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
}

const XLSX_EXTENSIONS = [".xlsx", ".xls"];

function isXlsx(file: File): boolean {
  const name = file.name.toLowerCase();
  return XLSX_EXTENSIONS.some((ext) => name.endsWith(ext));
}

// תמיכה ב-CSV ו-XLSX בשלב הראשון. XLS ישן (פורמט בינארי טרום-2007) מתקבל דרך אותה
// ספריית xlsx, אך ללא הבטחת תאימות מלאה - האפיון דורש טיפול ייעודי/המרה, לא תמיכה
// שקטה שמניחה שהכול עובד. לכן מסמנים אזהרה נפרדת ל-.xls (ר' parseImportFile).
export async function parseImportFile(file: File): Promise<ParsedFile> {
  if (isXlsx(file)) return parseXlsx(file);
  return parseCsv(file);
}

export function isLegacyXls(file: File): boolean {
  return file.name.toLowerCase().endsWith(".xls");
}

async function parseCsv(file: File): Promise<ParsedFile> {
  const text = await file.text();
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  const headers = result.meta.fields ?? [];
  return { headers, rows: result.data };
}

async function parseXlsx(file: File): Promise<ParsedFile> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "", raw: false });
  const headerRow = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, range: 0 })[0] ?? [];
  const headers = headerRow.map((h) => String(h).trim());
  return { headers, rows };
}

// hash תוכן הקובץ (לא השם) - מונע יבוא כפול גם אם הקובץ הועלה בשם אחר.
export async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type RowStatus = "valid" | "needs_decision" | "invalid";

export interface ClassifiedRow {
  rowNumber: number;
  raw: Record<string, string>;
  status: RowStatus;
  errorMessage: string | null;
}

// סיווג גנרי בלבד - שלב 5 הוא תשתית בלי דומיין עסקי ספציפי, אז אין כאן עדיין כללים
// כמו "התאמה לפי מזהה" (זה מגיע עם כל דומיין בנפרד, למשל זכאות בשלב 6). שני כללים
// כלליים שתקפים לכל קובץ: שורה ריקה לגמרי = שגויה; שורה שחוזרת בדיוק על שורה קודמת
// באותו קובץ = דורשת החלטה (כפילות אפשרית).
export function classifyRows(rows: Record<string, string>[]): ClassifiedRow[] {
  const seen = new Map<string, number>();
  return rows.map((raw, index) => {
    const rowNumber = index + 1;
    const values = Object.values(raw).map((v) => (v ?? "").toString().trim());
    const isEmpty = values.every((v) => v.length === 0);
    if (isEmpty) {
      return { rowNumber, raw, status: "invalid", errorMessage: "שורה ריקה לגמרי" };
    }

    const signature = JSON.stringify(raw);
    if (seen.has(signature)) {
      return {
        rowNumber,
        raw,
        status: "needs_decision",
        errorMessage: `זהה לחלוטין לשורה ${seen.get(signature)} - כפילות אפשרית`,
      };
    }
    seen.set(signature, rowNumber);
    return { rowNumber, raw, status: "valid", errorMessage: null };
  });
}
