import { TALMUD_COUNTRIES } from "./talmudCodes";
import { talmudCountryCode } from "./talmudCountry";

// רשימת מדינות בעברית. לא רשימת כל מדינות העולם - אלה המדינות שמהן מגיעים בפועל
// תלמידים עם דרכון זר בקהילה הזו, ובראשן הנפוצות. תמיד אפשר להקליד מדינה אחרת.
// כל שם כאן מתורגם לקוד המדינה של תלמוד (נבדק ב-test-talmud-file).
export const PASSPORT_COUNTRIES = [
  "ארצות הברית",
  "בריטניה",
  "צרפת",
  "בלגיה",
  "קנדה",
  "שווייץ",
  "ארגנטינה",
  "ברזיל",
  "מקסיקו",
  "אוסטרליה",
  "דרום אפריקה",
  "רוסיה",
  "אוקראינה",
  "הולנד",
  "גרמניה",
  "אוסטריה",
  "איטליה",
  "ספרד",
  "שוודיה",
  "פנמה",
  "ונצואלה",
  "צ'ילה",
  "אורוגוואי",
  "הונגריה",
  "פולין",
  "רומניה",
  "טורקיה",
  "מרוקו",
];


// הנפוצות קודם, ואחריהן כל שאר המדינות שברשימה של תלמוד (משרד החינוך) -
// כך שכל מדינה שנבחרת מהרשימה מקבלת קוד בקובץ לתלמוד.
const COMMON_CODES = new Set(PASSPORT_COUNTRIES.map((c) => talmudCountryCode(c)));
export const ALL_PASSPORT_COUNTRIES: string[] = [
  ...PASSPORT_COUNTRIES,
  ...TALMUD_COUNTRIES.filter((c) => !COMMON_CODES.has(c.code) && c.he.trim()).map((c) => c.he.trim())
    .sort((a, b) => a.localeCompare(b, "he")),
];
