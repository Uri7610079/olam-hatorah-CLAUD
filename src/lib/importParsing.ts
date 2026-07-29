import Papa from "papaparse";
import * as XLSX from "xlsx";

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
  // שורה (0-מבוססת) שזוהתה/נבחרה ככותרות בפועל - ר' detectHeaderRow.
  headerRowIndex: number;
  // "high" = הכותרות בשורה הראשונה (המקרה הנפוץ - כל היבואים שכבר עבדו היום) - אין
  // צורך להציג חלונית אישור. "low" = זוהה שצריך לדלג על שורה אחת או יותר (למשל כותרת
  // מוסדית/פרטי חשבון לפני הטבלה עצמה, כמו בדוח בנק אמיתי) - **תמיד** מוצג אישור
  // למשתמשת, לעולם לא מדלגים בשקט על שורות בלי שהיא ראתה ואישרה מה בדיוק דולג.
  headerConfidence: "high" | "low";
  // 15 השורות הגולמיות הראשונות (מערך-בתוך-מערך, לא לפי כותרות) - לצורך תצוגת אישור/
  // בחירה ידנית של שורת הכותרות (HeaderRowConfirm).
  previewRows: string[][];
}

const XLSX_EXTENSIONS = [".xlsx", ".xls"];

function isXlsx(file: File): boolean {
  const name = file.name.toLowerCase();
  return XLSX_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function countNonEmpty(row: unknown[] | undefined): number {
  if (!row) return 0;
  return row.filter((c) => c !== null && c !== undefined && String(c).trim() !== "").length;
}

// זיהוי אוטומטי של שורת הכותרות - נבנה אחרי שקבצים אמיתיים מלקוח (דוח תנועות בנק, דוחות
// משרד הדתות) התבררו כמכילים שורות כותרת/מטא-דאטה (שם חשבון, טווח תאריכים, כותרת
// מוסדית) לפני שורת הכותרות האמיתית - ההנחה הישנה "שורה 1 = תמיד כותרות" הייתה נכשלת
// עליהם בשקט (כל השורות יוצאות ריקות/שגויות). היוריסטיקה: סורקים את 20 השורות הראשונות,
// מוצאים את הרוחב (מספר תאים לא-ריקים) המקסימלי, ומחפשים את השורה הראשונה שמגיעה
// לפחות ל-70% מהרוחב הזה - זו שורת הכותרות הסבירה (שורות כותרת/מטא-דאטה בד"כ צרות
// הרבה יותר מהטבלה עצמה).
export function detectHeaderRow(matrix: unknown[][]): { index: number; confidence: "high" | "low" } {
  const scanLimit = Math.min(matrix.length, 20);
  const widths: number[] = [];
  for (let i = 0; i < scanLimit; i++) widths.push(countNonEmpty(matrix[i]));
  const maxWidth = Math.max(0, ...widths);
  if (maxWidth === 0) return { index: 0, confidence: "high" };

  const threshold = Math.max(2, Math.ceil(maxWidth * 0.7));
  let candidateIndex = widths.findIndex((w) => w >= threshold);
  if (candidateIndex === -1) candidateIndex = 0;

  // "high" רק כשהכותרות כבר בשורה הראשונה - כל מקרה שדורש דילוג נחשב "low" תמיד,
  // גם אם ה-heuristic די בטוח בעצמו, כדי שדילוג שורות לעולם לא יקרה בלי אישור מפורש.
  return { index: candidateIndex, confidence: candidateIndex === 0 ? "high" : "low" };
}

function rowsFromMatrix(matrix: string[][], headerRowIndex: number): { headers: string[]; rows: Record<string, string>[] } {
  const headerRow = matrix[headerRowIndex] ?? [];
  const headers = headerRow.map((h) => String(h ?? "").trim());
  const rows: Record<string, string>[] = [];
  for (let i = headerRowIndex + 1; i < matrix.length; i++) {
    const raw = matrix[i] ?? [];
    if (raw.every((c) => String(c ?? "").trim() === "")) continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (!h) return;
      obj[h] = String(raw[idx] ?? "");
    });
    rows.push(obj);
  }
  return { headers, rows };
}

// תמיכה ב-CSV ו-XLSX בשלב הראשון. XLS ישן (פורמט בינארי טרום-2007) מתקבל דרך אותה
// ספריית xlsx, אך ללא הבטחת תאימות מלאה - האפיון דורש טיפול ייעודי/המרה, לא תמיכה
// שקטה שמניחה שהכול עובד. לכן מסמנים אזהרה נפרדת ל-.xls (ר' parseImportFile).
//
// @param headerRowIndexOverride - כשהמשתמשת אישרה/בחרה ידנית שורת כותרות (אחרי חלונית
// HeaderRowConfirm) - מדלג על הזיהוי האוטומטי ומשתמש בשורה הזו ישירות.
export async function parseImportFile(file: File, headerRowIndexOverride?: number): Promise<ParsedFile> {
  if (isXlsx(file)) return parseXlsx(file, headerRowIndexOverride);
  return parseCsv(file, headerRowIndexOverride);
}

export function isLegacyXls(file: File): boolean {
  return file.name.toLowerCase().endsWith(".xls");
}

async function parseCsv(file: File, headerRowIndexOverride?: number): Promise<ParsedFile> {
  const text = await file.text();
  const raw = Papa.parse<string[]>(text, { skipEmptyLines: true });
  const matrix = raw.data;
  const detected = detectHeaderRow(matrix);
  const headerRowIndex = headerRowIndexOverride ?? detected.index;
  const { headers, rows } = rowsFromMatrix(matrix, headerRowIndex);
  return {
    headers,
    rows,
    headerRowIndex,
    headerConfidence: headerRowIndexOverride !== undefined ? "high" : detected.confidence,
    previewRows: matrix.slice(0, 15),
  };
}

async function parseXlsx(file: File, headerRowIndexOverride?: number): Promise<ParsedFile> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, range: 0, defval: "", raw: false });
  const detected = detectHeaderRow(matrix);
  const headerRowIndex = headerRowIndexOverride ?? detected.index;
  const { headers, rows } = rowsFromMatrix(matrix, headerRowIndex);
  return {
    headers,
    rows,
    headerRowIndex,
    headerConfidence: headerRowIndexOverride !== undefined ? "high" : detected.confidence,
    previewRows: matrix.slice(0, 15),
  };
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
