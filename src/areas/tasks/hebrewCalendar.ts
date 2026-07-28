import { HDate, HebrewCalendar } from "@hebcal/core";

// לוח שנה עברי - נשען על @hebcal/core (חישוב תאריכים עבריים הוא אלגוריתם לוחני
// מורכב עם חוקים לא טריוויאליים - לא ממציאים את זה בעצמנו, בדיוק כמו שלא ממציאים
// ספריית תאריכים/timezone). לוח ישראל (il=true) - העמותה פועלת בישראל (מס"ב, משרד
// החינוך וכו' - כל ההקשר של המערכת הוא ישראלי).
export function hebrewDateLabel(date: Date): string {
  return new HDate(date).renderGematriya(true, true);
}

export interface HolidayInfo {
  name: string;
  emoji: string | null;
}

// "חגים" במובן המקובל בלבד. נבדק ידנית (הרצת @hebcal/core על שנה מלאה, ר' הערת commit) -
// גם flags.CHAG/MINOR_HOLIDAY/MAJOR_FAST/MINOR_FAST וגם getCategories() מחזירים הרבה
// יותר מדי ימים "מינוריים" שאף אחד לא באמת קורא להם "חג" (יום כיפור קטן חודשי, תעניות
// בה"ב, סליחות, ט"ו באב, תענית בכורות, "ראש השנה לבהמות" וכו') - לכן רשימת basename()
// מפורשת (השם היציב, לא-מתורגם, בלי כשירויות כמו "ערב"/"חוה״מ"/מספר יום) היא היחידה
// שנותנת תוצאה נקייה וצפויה. הרשימה: 2 ימי ר"ה, יוה"כ, סוכות+שמח"ת, פסח, שבועות, חנוכה,
// פורים+שושן פורים, וארבעת הצומות המרכזיים (גדליה, עשרה בטבת, י"ז בתמוז, ט' באב) + תענית
// אסתר, ט"ו בשבט, ל"ג בעומר.
const RELEVANT_BASENAMES = new Set([
  "Rosh Hashana",
  "Yom Kippur",
  "Sukkot",
  "Shmini Atzeret",
  "Pesach",
  "Shavuot",
  "Chanukah",
  "Purim",
  "Shushan Purim",
  "Ta'anit Esther",
  "Tzom Gedaliah",
  "Asara B'Tevet",
  "Tzom Tammuz",
  "Tish'a B'Av",
  "Tu BiShvat",
  "Lag BaOmer",
]);

export function getHolidayInfo(date: Date): HolidayInfo | null {
  const events = HebrewCalendar.getHolidaysOnDate(date, true);
  if (!events || events.length === 0) return null;
  const holidayEvents = events.filter((ev) => RELEVANT_BASENAMES.has(ev.basename()));
  if (holidayEvents.length === 0) return null;
  const ev = holidayEvents[0];
  return { name: ev.render("he"), emoji: ev.getEmoji() };
}
