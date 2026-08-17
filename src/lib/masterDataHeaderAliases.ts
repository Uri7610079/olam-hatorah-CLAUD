import { normalizeHeader } from "./importDetection";

// שמות עמודות בעברית לקובץ האב (עמותות/סניפים/קבוצות).
//
// למה זה נחוץ: הקבצים שמגיעים מהלקוח ומהמשרד כתובים בעברית ("שם עמותה", "מספר
// סניף"), בעוד היבוא נבנה סביב שמות שדות באנגלית. עד לתוספת הזו קובץ כזה נדחה
// שורה-שורה בהודעה "חסר שם עמותה (legal_name)" - למרות שהנתון היה שם, רק תחת
// כותרת אחרת. אין שום סיבה שהמשתמשת תשכתב כותרות ביד לפני כל יבוא.
//
// מה שמכוון להיעדר כאן: כותרות דו-משמעיות. "סניף" לבדו יכול להיות קוד או שם;
// "טלפון" לבדו יכול להיות של העמותה או של ראש הקבוצה; "כתובת" - של העמותה או של
// הסניף. מיפוי שגוי כזה לא היה נכשל אלא נקלט בשקט לשדה הלא נכון, וזו בדיוק סוג
// התקלה שקשה לגלות אחר כך. כותרת דו-משמעית פשוט לא תזוהה, והמשתמשת תראה שהשדה
// חסר - מצב גלוי ובר-תיקון.
const ALIASES: Record<string, string> = {
  // עמותה
  "סמל מוסד": "org_number",
  "סמל המוסד": "org_number",
  "מספר עמותה": "org_number",
  "מספר העמותה": "org_number",
  'ח"פ': "org_number",
  "שם עמותה": "legal_name",
  "שם העמותה": "legal_name",
  "טלפון עמותה": "contact_phone",
  "אימייל עמותה": "contact_email",
  'דוא"ל עמותה': "contact_email",
  "כתובת עמותה": "contact_address",

  // סניף
  "מספר סניף": "talmud_branch_code",
  "מספר הסניף": "talmud_branch_code",
  "קוד סניף": "talmud_branch_code",
  "קוד הסניף": "talmud_branch_code",
  "שם סניף": "branch_internal_name",
  "שם הסניף": "branch_internal_name",
  "כתובת סניף": "branch_address",
  "כתובת הסניף": "branch_address",

  // קבוצה וראש קבוצה
  "שם קבוצה": "group_name",
  "שם הקבוצה": "group_name",
  "ראש קבוצה": "group_leader_name",
  "ראש הקבוצה": "group_leader_name",
  "שם ראש קבוצה": "group_leader_name",
  "מנהל קבוצה": "group_leader_name",
  "טלפון ראש קבוצה": "group_leader_phone",
  "טלפון מנהל קבוצה": "group_leader_phone",

  // חשבון הבנק של העמותה. שמות מפורשים ולא "בנק"/"חשבון" לבדם, כי בקובץ אב
  // הכולל גם קבוצות אפשר בקלות להתבלבל בין חשבון העמותה לחשבון אחר.
  "בנק עמותה": "בנק עמותה",
  "בנק העמותה": "בנק עמותה",
  "סניף בנק עמותה": "סניף בנק עמותה",
  "חשבון עמותה": "חשבון עמותה",
  "מספר חשבון עמותה": "חשבון עמותה",
  "פלאפון": "group_leader_phone",
  "פאלפון": "group_leader_phone",
  "מייל": "group_leader_email",
  "מייל ראש קבוצה": "group_leader_email",
  "אימייל ראש קבוצה": "group_leader_email",
  'דוא"ל ראש קבוצה': "group_leader_email",
};

// קוד סניף מנורמל למספר בן שתי ספרות. הלקוח ביקש ש"1" ו-"01" ייחשבו לאותו סניף,
// והם לא היו: הקוד נשמר כטקסט (בכוונה, כדי לשמר אפסים מובילים כמו "00"), וההתאמה
// בקליטה היא השוואת מחרוזות - כך ש"4" ו-"04" היו יוצרים שני סניפים נפרדים באותה
// עמותה. בקובץ אמיתי של הלקוח שני הכתיבים מופיעים זה לצד זה.
//
// שתי ספרות ולא הסרת אפסים: זה הפורמט שכבר קיים בנתונים ("00", "01", "02"), וגם
// הפורמט שבו הקודים מגיעים ממשרד החינוך. קוד ארוך יותר ("100") נשאר כמות שהוא,
// וקוד שאינו מספרי כלל לא נוגעים בו - לא מנחשים על נתון שלא הבנו.
export function normalizeBranchCode(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!/^\d+$/.test(value)) return value;
  return value.padStart(2, "0");
}

const NORMALIZED: Record<string, string> = Object.fromEntries(
  Object.entries(ALIASES).map(([he, en]) => [normalizeHeader(he), en]),
);

// שם השדה באנגלית עבור כותרת נתונה, או null אם היא לא מוכרת.
export function masterDataFieldFor(header: string): string | null {
  return NORMALIZED[normalizeHeader(header)] ?? null;
}

// תרגום שורה גולמית לשמות השדות שהיבוא והפונקציה בשרת מכירים.
//
// הכותרת העברית מוחלפת ולא נשמרת לצידה. זה נראה כמו ויתור על "להראות למשתמשת
// את הקובץ שלה", אבל התצוגה המקדימה מציגה את השורה כ-JSON גולמי - ושמירת שתי
// הכותרות הייתה מציגה כל ערך פעמיים ("סמל מוסד" ו-org_number זה לצד זה), מה
// שנראה כאילו הנתון נכפל בקליטה. שדה אחד לכל נתון ברור יותר.
//
// מפתח שכבר באנגלית נשאר כפי שהוא, וקובץ מעורב (חלק עברית חלק אנגלית) עובד.
// ערך אנגלי קיים ולא ריק לעולם לא נדרס ע"י כותרת עברית שממופה לאותו שדה -
// אחרת קובץ שמכיל גם "legal_name" וגם "שם עמותה" היה תלוי בסדר העמודות, וזה
// מצב שאסור שתהיה בו תלות.
export function translateMasterDataRow(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const fromHebrew: Record<string, string> = {};

  for (const [key, value] of Object.entries(raw)) {
    const field = masterDataFieldFor(key);
    if (field) {
      if (fromHebrew[field] === undefined || fromHebrew[field] === "") fromHebrew[field] = value;
    } else {
      out[key] = value;
    }
  }

  for (const [field, value] of Object.entries(fromHebrew)) {
    if (out[field] === undefined || out[field] === "") out[field] = value;
  }

  // הנרמול נעשה כאן ולא בקליטה בשרת, כדי שהתצוגה המקדימה כבר תראה את הקוד כפי
  // שייווצר בפועל. אחרת המשתמשת הייתה מאשרת "4" ומקבלת סניף "04".
  if (out.talmud_branch_code) out.talmud_branch_code = normalizeBranchCode(out.talmud_branch_code);
  return out;
}

export function translateMasterDataHeaders(headers: string[]): string[] {
  return headers.map((h) => masterDataFieldFor(h) ?? h);
}
