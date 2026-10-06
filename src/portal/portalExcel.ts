import * as XLSX from "xlsx";
import { PASSPORT_COUNTRIES } from "@/lib/passportCountries";
import { ELIGIBILITY } from "@/lib/portalRequests";
import {
  EMPTY_NEW_STUDENT, ID_TYPE_OPTIONS, MARITAL_LABEL, SCOPE_LABEL, bankLabel, validateNewStudent,
  type Bank, type Errors, type IdType, type MaritalStatus, type NewStudentInput, type StudyCodeMap, type StudyScope,
} from "./newStudentForm";
import type { PortalGroup, PortalStudent } from "./portalApi";

// אקסל בפורטל: ייצוא רשימת התלמידים, ותבנית להוספת תלמידים שממלאים ומעלים
// בחזרה. התבנית והקריאה שלה משתמשות באותה רשימת עמודות, כך שאי אפשר
// שאחת תשתנה בלי השנייה.

// ===== ייצוא =====
export function exportStudents(rows: PortalStudent[], monthText: string) {
  const data = rows.map((s) => ({
    "שם קבוצה": s.group_name,
    "סניף": s.branch_name ?? "",
    "עמותה": s.organization_name,
    "שם": s.full_name,
    "סוג מזהה": s.id_type === "passport" ? "דרכון" : "תעודת זהות",
    "מספר מזהה": s.external_id,
    "ארץ הדרכון": s.passport_country ?? "",
    "תאריך לידה": s.birth_date ? s.birth_date.split("-").reverse().join("/") : "",
    "טלפון": s.phone ?? "",
    "כתובת": [s.address_street, s.address_house_number, s.address_city].filter(Boolean).join(" "),
    "מצב משפחתי": s.marital_status ? MARITAL_LABEL[s.marital_status] : "",
    "היקף לימוד": s.study_scope ? SCOPE_LABEL[s.study_scope] : "",
    "קוד לימוד": s.study_code ?? "",
    [`זכאות - ${monthText}`]: ELIGIBILITY[s.eligibility].label,
    "סיבה": s.eligibility === "not_eligible" ? s.reasons.join(" · ") || "טרם התקבלה מתלמוד" : "",
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = Object.keys(data[0] ?? { a: 1 }).map((k) => ({ wch: Math.max(10, k.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "התלמידים שלי");
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.writeFile(wb, `התלמידים שלי - ${monthText}.xlsx`);
}

// ===== תבנית =====
interface Column { key: keyof NewStudentInput; header: string; required: boolean; width: number; list?: string; text?: boolean; date?: boolean; hint: string }

export const TEMPLATE_COLUMNS: Column[] = [
  { key: "groupId", header: "קבוצה", required: true, width: 22, list: "groups", hint: "בחירה מהרשימה" },
  { key: "fullName", header: "שם מלא", required: true, width: 22, hint: "שם פרטי ושם משפחה" },
  { key: "idType", header: "סוג מזהה", required: true, width: 14, list: "idTypes", hint: "תעודת זהות או דרכון" },
  { key: "externalId", header: "מספר ת.ז / דרכון", required: true, width: 16, text: true, hint: "ת.ז נבדקת לפי ספרת הביקורת" },
  { key: "passportCountry", header: "ארץ הדרכון", required: false, width: 18, list: "countries", hint: "חובה רק לדרכון" },
  { key: "birthDate", header: "תאריך לידה", required: true, width: 14, date: true, hint: "גיל 16 עד 67" },
  { key: "phone", header: "טלפון", required: true, width: 14, text: true, hint: "למשל 052-1234567" },
  { key: "maritalStatus", header: "מצב משפחתי", required: true, width: 12, list: "marital", hint: "בחור או נשוי" },
  { key: "studyScope", header: "היקף לימוד", required: false, width: 16, list: "scopes", hint: "חובה רק לנשוי" },
  { key: "bankCode", header: "בנק", required: true, width: 24, list: "banks", hint: "בחירה מהרשימה" },
  { key: "bankBranch", header: "מספר סניף", required: true, width: 11, text: true, hint: "ספרות בלבד" },
  { key: "accountNumber", header: "מספר חשבון", required: true, width: 14, text: true, hint: "ספרות בלבד" },
  { key: "accountHolder", header: "שם בעל החשבון", required: true, width: 20, hint: "כפי שרשום בבנק" },
  { key: "street", header: "רחוב", required: false, width: 16, hint: "" },
  { key: "houseNumber", header: "מספר בית", required: false, width: 10, text: true, hint: "" },
  { key: "city", header: "עיר", required: false, width: 14, hint: "" },
];

const headerText = (c: Column) => (c.required ? `${c.header} *` : c.header);
const TEMPLATE_SHEET = "תלמידים חדשים";
const ROWS = 300;

/** תווית ייחודית לכל קבוצה. שם זהה בשני סניפים - נוסף שם הסניף. */
export function groupLabels(groups: PortalGroup[]): Map<string, string> {
  const count = new Map<string, number>();
  groups.forEach((g) => count.set(g.name, (count.get(g.name) ?? 0) + 1));
  return new Map(groups.map((g) => [g.id, count.get(g.name)! > 1 ? `${g.name} · ${g.branch ?? g.organization}` : g.name]));
}

/** בונה את קובץ התבנית. נפרד מההורדה, כדי שאפשר יהיה לבדוק אותו. */
export async function buildTemplate(groups: PortalGroup[], banks: Bank[], codes: StudyCodeMap) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(TEMPLATE_SHEET, { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  const lists = wb.addWorksheet("רשימות", { views: [{ rightToLeft: true }] });
  const help = wb.addWorksheet("איך למלא", { views: [{ rightToLeft: true }] });

  // הרשימות הנפתחות יושבות בגיליון נפרד. רשימה ארוכה (בנקים, ארצות) לא
  // נכנסת בתוך הגדרת התא עצמו - אקסל מגביל אותה ל-255 תווים.
  const sources: Record<string, string[]> = {
    groups: [...groupLabels(groups).values()],
    idTypes: Object.values(ID_TYPE_OPTIONS),
    countries: [...PASSPORT_COUNTRIES],
    marital: Object.values(MARITAL_LABEL),
    scopes: Object.values(SCOPE_LABEL),
    banks: banks.map(bankLabel),
  };
  const ranges: Record<string, string> = {};
  Object.entries(sources).forEach(([name, values], i) => {
    const col = lists.getColumn(i + 1);
    col.width = 26;
    lists.getCell(1, i + 1).value = name;
    values.forEach((v, r) => { lists.getCell(r + 2, i + 1).value = v; });
    const letter = col.letter;
    ranges[name] = `'רשימות'!$${letter}$2:$${letter}$${values.length + 1}`;
  });
  lists.state = "hidden";

  ws.columns = TEMPLATE_COLUMNS.map((c) => ({ header: headerText(c), key: c.key, width: c.width }));
  const head = ws.getRow(1);
  head.height = 30;
  TEMPLATE_COLUMNS.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.required ? "FF4F46E5" : "FF94A3B8" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    if (c.hint) cell.note = c.hint;
  });

  for (let r = 2; r <= ROWS + 1; r++) {
    TEMPLATE_COLUMNS.forEach((c, i) => {
      const cell = ws.getCell(r, i + 1);
      // טקסט ולא מספר: אחרת אקסל מוחק את האפס בתחילת ת.ז, טלפון ומספר חשבון
      if (c.text) cell.numFmt = "@";
      if (c.date) {
        cell.numFmt = "dd/mm/yyyy";
        cell.dataValidation = { type: "date", operator: "greaterThan", allowBlank: true, formulae: [new Date(1900, 0, 1)],
          showErrorMessage: true, errorTitle: "תאריך לא תקין", error: "יש להקליד תאריך, למשל 15/03/2001" };
      }
      if (c.list) {
        // ארץ הדרכון: הרשימה היא הצעה, ואפשר להקליד ארץ אחרת. בשאר העמודות -
        // רק מהרשימה, כי המערכת מזהה את הערך לפי הנוסח המדויק.
        const strict = c.list !== "countries";
        cell.dataValidation = { type: "list", allowBlank: true, formulae: [ranges[c.list]],
          showErrorMessage: strict, errorTitle: "ערך לא מהרשימה", error: "יש לבחור מהרשימה הנפתחת" };
      }
    });
  }

  help.getColumn(1).width = 26;
  help.getColumn(2).width = 70;
  const codeText = (k: keyof StudyCodeMap) => (codes[k]?.code ? ` (קוד ${codes[k]!.code})` : "");
  const rows: [string, string][] = [
    ["איך ממלאים", "שורה לכל תלמיד בגיליון \"תלמידים חדשים\". עמודות בכחול הן חובה. בעמודות עם רשימה - בוחרים מהחץ שבתא."],
    ["אחרי המילוי", "שומרים את הקובץ, ובפורטל לוחצים \"העלאת קובץ\". המערכת מראה מה תקין ומה חסר לפני השליחה."],
    ["תעודת זהות", "9 ספרות. המערכת בודקת את ספרת הביקורת - מספר עם טעות הקלדה לא יתקבל."],
    ["דרכון", "בוחרים \"דרכון\" בסוג המזהה, וממלאים גם את ארץ הדרכון."],
    ["תאריך לידה", "גיל התלמיד צריך להיות בין 16 ל-67."],
    ["מצב משפחתי", `בחור${codeText("single")}, או נשוי.`],
    ["היקף לימוד (לנשוי)", `יום שלם${codeText("full_day")}, חצי יום בוקר${codeText("half_day_morning")}, חצי יום אחה"צ${codeText("half_day_afternoon")}.`],
    ["חשבון בנק", "בנק מהרשימה, מספר סניף, מספר חשבון ושם בעל החשבון - כפי שרשום בבנק."],
    ["צילום תעודת זהות", "בקבוצות שבהן הוא חובה - מצרפים אותו בפורטל אחרי העלאת הקובץ, לכל תלמיד."],
  ];
  rows.forEach(([a, b], i) => {
    help.getCell(i + 1, 1).value = a;
    help.getCell(i + 1, 1).font = { bold: true };
    help.getCell(i + 1, 2).value = b;
    help.getCell(i + 1, 2).alignment = { wrapText: true, vertical: "top" };
  });

  return wb.xlsx.writeBuffer();
}

export async function downloadTemplate(groups: PortalGroup[], banks: Bank[], codes: StudyCodeMap) {
  const buf = await buildTemplate(groups, banks, codes);
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "תבנית להוספת תלמידים.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}

// ===== קריאת קובץ שמולא =====
export interface ParsedRow { rowNumber: number; input: NewStudentInput; errors: Errors; requirePhoto: boolean }

const pad = (n: number) => String(n).padStart(2, "0");

function toIsoDate(v: unknown): string {
  // אקסל שומר תאריך כמספר ימים מ-30/12/1899. ההמרה כאן חשבונית, ב-UTC ובעיגול
  // ליום שלם - המרה דרך Date מקומי הזיזה תאריך ביום אחורה (שעון ישראל), וזה
  // מספיק כדי להוציא תלמיד מטווח הגילים.
  if (typeof v === "number" && Number.isFinite(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) return `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return s; // משהו אחר - הבדיקה תסביר שהתאריך אינו תקין
}

const reverse = <K extends string>(labels: Record<K, string>) =>
  new Map(Object.entries(labels).map(([k, v]) => [String(v).trim(), k as K]));

export async function parseTemplate(
  file: File,
  ctx: { groups: PortalGroup[]; banks: Bank[]; hasPhoto: (row: number) => boolean },
): Promise<ParsedRow[]> {
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: false });
  const ws = wb.Sheets[TEMPLATE_SHEET] ?? wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("הקובץ ריק");
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true });
  const headers = (matrix[0] ?? []).map((h) => String(h).replace("*", "").trim());
  const colOf = new Map(TEMPLATE_COLUMNS.map((c) => [c.key, headers.indexOf(c.header)]));
  const missing = TEMPLATE_COLUMNS.filter((c) => c.required && colOf.get(c.key)! < 0).map((c) => c.header);
  if (missing.length) throw new Error(`זה לא קובץ התבנית - חסרות העמודות: ${missing.join(", ")}. יש להוריד את התבנית מהפורטל ולמלא אותה.`);

  const groupByLabel = new Map([...groupLabels(ctx.groups)].map(([id, label]) => [label, id]));
  const groupById = new Map(ctx.groups.map((g) => [g.id, g]));
  const idTypes = reverse(ID_TYPE_OPTIONS);
  const marital = reverse(MARITAL_LABEL);
  const scopes = reverse(SCOPE_LABEL);

  const out: ParsedRow[] = [];
  matrix.slice(1).forEach((cells, i) => {
    const get = (k: keyof NewStudentInput) => {
      const idx = colOf.get(k)!;
      return idx < 0 ? "" : cells[idx];
    };
    const str = (k: keyof NewStudentInput) => String(get(k) ?? "").trim();
    if (TEMPLATE_COLUMNS.every((c) => !str(c.key))) return; // שורה ריקה

    const bankText = str("bankCode");
    const bank = ctx.banks.find((b) => bankLabel(b) === bankText || b.code === bankText.replace(/\D/g, "") && /\d/.test(bankText) || b.name === bankText);
    let phone = str("phone");
    if (/^[5-9]\d{7,8}$/.test(phone.replace(/\D/g, ""))) phone = "0" + phone.replace(/\D/g, ""); // אקסל מחק את האפס
    const groupId = groupByLabel.get(str("groupId")) ?? "";

    const input: NewStudentInput = {
      ...EMPTY_NEW_STUDENT,
      groupId,
      fullName: str("fullName"),
      idType: (idTypes.get(str("idType")) ?? "") as IdType | "",
      externalId: str("externalId"),
      passportCountry: str("passportCountry"),
      birthDate: toIsoDate(get("birthDate")),
      phone,
      maritalStatus: (marital.get(str("maritalStatus")) ?? "") as MaritalStatus | "",
      studyScope: (scopes.get(str("studyScope")) ?? "") as StudyScope | "",
      bankCode: bank?.code ?? "",
      bankBranch: str("bankBranch"),
      accountNumber: str("accountNumber"),
      accountHolder: str("accountHolder"),
      street: str("street"),
      houseNumber: str("houseNumber"),
      city: str("city"),
    };
    const rowNumber = i + 2;
    const requirePhoto = !!groupById.get(groupId)?.require_id_photo;
    out.push({
      rowNumber, input, requirePhoto,
      errors: validateNewStudent(input, {
        banks: ctx.banks, groupIds: ctx.groups.map((g) => g.id), requirePhoto, hasPhoto: ctx.hasPhoto(rowNumber),
      }),
    });
  });
  return out;
}
