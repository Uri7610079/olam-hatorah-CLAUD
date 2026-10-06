import { TALMUD_COUNTRIES } from "./talmudCodes";

// שם מדינה (כפי שהוקלד בפורטל או בכרטיס) לקוד המדינה של תלמוד. בקובץ נפרד בלי
// ספריית האקסל, כי גם רשימת המדינות של הטופס משתמשת בו.

const norm = (s: string) => s.replace(/[\s"'״׳.\-()]/g, "").toLowerCase();
// שמות שמשתמשים בהם בפועל ואינם הנוסח שבתבנית
const COUNTRY_ALIASES: Record<string, string> = {
  [norm("בריטניה")]: "הממלכה המאוחדת", [norm("אנגליה")]: "הממלכה המאוחדת",
  [norm("ארה\"ב")]: "ארצות הברית", [norm("ארהב")]: "ארצות הברית",
  [norm("שווייץ")]: "שוויץ", [norm("אורוגוואי")]: "אורגוואי", [norm("טורקיה")]: "תורכיה",
};
const COUNTRY_BY_NAME = new Map<string, number>();
for (const c of TALMUD_COUNTRIES) {
  COUNTRY_BY_NAME.set(norm(c.he), c.code);
  if (c.en && c.en !== "NULL") COUNTRY_BY_NAME.set(norm(c.en), c.code);
}

/** קוד המדינה של המשרד לפי שם (עברית או אנגלית), או null. */
export function talmudCountryCode(name: string | null | undefined): number | null {
  const raw = String(name ?? "").trim();
  if (!raw) return null;
  if (/^\d{1,4}$/.test(raw)) return Number(raw);
  const key = norm(raw);
  const alias = COUNTRY_ALIASES[key];
  return COUNTRY_BY_NAME.get(alias ? norm(alias) : key) ?? null;
}
