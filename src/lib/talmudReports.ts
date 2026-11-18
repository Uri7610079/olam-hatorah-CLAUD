import { parseImportFile } from "./importParsing";

// הדוחות שיורדים במשיכה מתלמוד (talmud-worker/TALMUD-REPORTS.md) - המרה לצורה שהמערכת
// קולטת. כל מה שתלוי במבנה של קובץ מתלמוד נמצא כאן, במקום אחד.

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const toCsv = (headers: string[], rows: string[][]) =>
  "﻿" + [headers, ...rows].map((r) => r.map((c) => csvCell(String(c ?? ""))).join(",")).join("\r\n");

/**
 * "פירוט סיבות אי זכאות" → קובץ בצורה של "שגיאות תלמוד" (מזהה תלמיד, קוד שגיאה, תיאור
 * שגיאה). כך הסיבות נכנסות למרכז השגיאות בקליטה הקיימת, עם התצוגה המקדימה והאישור שלה,
 * ומשם מופיעות בכרטיס התלמיד ובפורטל ראשי הקבוצות. תלמיד עם כמה סיבות = כמה שורות.
 */
export async function nonEntitlementToErrorsFile(file: File): Promise<File> {
  const parsed = await parseImportFile(file);
  const rows = parsed.rows
    .filter((r) => (r.StudentIdentity ?? "").trim() && (r.ReasonID ?? "").trim())
    .map((r) => [r.StudentIdentity.trim(), r.ReasonID.trim(), (r.ReasonName ?? "").trim()]);
  const name = file.name.replace(/\.\w+$/, "") + " - לקליטת שגיאות.csv";
  return new File([toCsv(["מזהה תלמיד", "קוד שגיאה", "תיאור שגיאה"], rows)], name, { type: "text/csv" });
}

// ===== תשלומים למוסד / בג"ץ / הסבר תשלומים (מיגרציה 121) =====

export type StoredReportKey = "institute_payments" | "bagatz" | "payment_explanation";

export const STORED_REPORT_LABEL: Record<StoredReportKey, string> = {
  institute_payments: "תשלומים למוסד",
  bagatz: 'זכאות בעקבות בג"ץ',
  payment_explanation: "הסבר תשלומים וקיזוזים",
};

export interface StoredReportRow {
  branch_code: string | null;
  external_id: string | null;
  data: Record<string, string | number | null>;
}

/** "1,234.50" / "-504.00" → מספר. ריק → null */
export function talmudNumber(v: string | undefined | null): number | null {
  const t = String(v ?? "").replace(/[,\s₪]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const text = (v: string | undefined | null) => (String(v ?? "").trim() || null);
/** "סניף: 00" / "580076511 - 00" / "00" → "00" */
const branchOf = (v: string | undefined | null) => {
  const m = String(v ?? "").match(/(\d{1,3})\s*$/);
  return m ? m[1].padStart(2, "0") : null;
};

export function storedReportRows(key: StoredReportKey, rows: Record<string, string>[]): StoredReportRow[] {
  if (key === "institute_payments") {
    // שורה לכל סניף וסוג תשלום (שוטף, רטרו...). שורה בלי סניף היא סיכום - לא נשמרת.
    return rows.filter((r) => branchOf(r["סניף"])).map((r) => ({
      branch_code: branchOf(r["סניף"]),
      external_id: null,
      data: {
        report_month: text(r["חודש_דיווח"]),
        payment_type: text(r["סוג_תשלום"]),
        eligible: talmudNumber(r["מספר_תלמידים_זכאים"]),
        amount: talmudNumber(r["סכום_לתשלום1"]),
        calculated: talmudNumber(r["סכום_מחושב"]),
        calc_date: text(r["תאריך_חישוב"]),
        reference: text(r["ID"]),
      },
    }));
  }
  if (key === "bagatz") {
    return rows.filter((r) => text(r["מספר_זהות_דרכון"])).map((r) => ({
      branch_code: branchOf(r["Textbox336"]),
      external_id: text(r["מספר_זהות_דרכון"]),
      data: {
        first_name: text(r["שם_פרטי"]),
        last_name: text(r["שם_משפחה"]),
        study_type: text(r["StudyTypeID1"]),
        start: text(r["תחילה"]),
        end: text(r["סיום"]),
        suspended: text(r["השעיית_בג_ץ"]),
        entitlement: text(r["EntitlementStatusID"]),
        personally_entitled: text(r["PersonallyEntitled"]),
        would_be_entitled: text(r["היה_זכאי_אלמלא_השעייה"]),
        exceptional_payment: text(r["תשלום_חריג"]),
      },
    }));
  }
  // הסבר תשלומים: שורה לכל חודש דיווח וסוג תשלום, עם החישוב הקודם, הנוכחי וההפרש
  return rows.filter((r) => text(r["חודש_דיווח1"])).map((r) => ({
    branch_code: branchOf(r["Textbox186"]),
    external_id: null,
    data: {
      report_month: text(r["חודש_דיווח1"]),
      payment_type: text(r["סוג_תשלום1"]),
      prev_calc_date: text(r["תאריך_חישוב_קודם"]),
      prev_eligible: talmudNumber(r["מספר_תלמידים_זכאים_קודם"]),
      prev_amount: talmudNumber(r["סכום_מחושב_קודם"]),
      calc_date: text(r["תאריך_חישוב1"]),
      eligible: talmudNumber(r["מספר_תלמידים_זכאים"]),
      amount: talmudNumber(r["סכום_לתשלום3"]),
      diff: talmudNumber(r["הפרש"]),
      paid_diff: talmudNumber(r["הפרש2"]),
      to_advances: talmudNumber(r["הועבר_למקדמות"]),
      offset_this: talmudNumber(r["קיזוז_בתשלום_זה"]),
      offset_total: talmudNumber(r["קיזוז_מצטבר"]),
    },
  }));
}

export const STORED_REPORT_KEYS: StoredReportKey[] = ["institute_payments", "bagatz", "payment_explanation"];
