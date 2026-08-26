// נרמול ואימות של מספרי טלפון ישראליים.
//
// למה זה קיים: הנרמול שהיה במערכת הוא raw.replace(/\D/g, "") - ספרות
// בלבד - והוא משוכפל בשני קבצים. הוא אינו מטפל בקידומת בינלאומית, ולכן
//
//     052-1234567     →  0521234567
//     +972-52-1234567 →  972521234567
//
// אותו אדם, שתי מחרוזות שונות. ההתאמה בין תלמידים לרשימות טלפון
// (043_stage13_phone_lists) נשענת בדיוק על השוואת המחרוזות האלה, ולכן
// טלפון שהוקלד בצורה הבינלאומית פשוט לא יימצא. זו אותה משפחת כשל של
// באג האפס המוביל בת.ז: שני ייצוגים של אותו ערך שהמערכת רואה כשונים.
//
// מבוסס על הכלי israeli-phone-formatter (MIT) שבתיקיית כלי הבנייה.

// 07X: כל המחלקה 071-079 מוקצית. regex ישן בסגנון 07[2-7] דוחה את 071,
// 078 ו-079 שהן קידומות VoIP/לא-גיאוגרפיות תקפות לחלוטין.
const MOBILE_PREFIXES = ["050", "051", "052", "053", "054", "055", "056", "058", "059"];
const VOIP_PREFIXES = ["071", "072", "073", "074", "076", "077", "078", "079"];
const LANDLINE_PREFIXES = ["02", "03", "04", "08", "09"];

export type PhoneKind = "mobile" | "landline" | "voip" | "tollfree" | "premium" | "star" | "unknown";

/**
 * הצורה הקנונית לאחסון ולהשוואה: מקומית, ספרות בלבד, עם האפס המוביל.
 *
 * המרת +972 ו-972 ל-0 היא כל העניין כאן. מחרוזת ריקה מוחזרת כשאין מה
 * לנרמל, כדי שהקוראים יוכלו להבדיל בין "אין טלפון" לבין טלפון תקין.
 */
export function normalizeIsraeliPhone(raw: string | null | undefined): string {
  let s = String(raw ?? "").trim();
  if (!s) return "";

  // שירות כוכבית נשמר כפי שהוא: *2421 אינו מספר לחיוג רגיל, ואין לו
  // צורה מקומית או בינלאומית.
  if (s.startsWith("*")) {
    const digits = s.slice(1).replace(/[^0-9]/g, "");
    return digits ? `*${digits}` : "";
  }

  const hadPlus = s.startsWith("+");
  s = s.replace(/[^0-9]/g, "");
  if (!s) return "";

  // 972 בהתחלה הוא קידומת המדינה - אבל רק כשהמספר שאחריה סביר. בלי
  // הסייג הזה מספר מקומי שבמקרה מתחיל ב-972 (למשל 0972...) היה נחתך.
  if ((hadPlus || s.length >= 11) && s.startsWith("972")) {
    s = "0" + s.slice(3);
  }

  // 00972 - צורת חיוג בינלאומי נפוצה בישראל
  if (s.startsWith("00972")) s = "0" + s.slice(5);

  return s;
}

/** זיהוי סוג המספר לפי הקידומת, על הצורה הקנונית. */
export function israeliPhoneKind(raw: string | null | undefined): PhoneKind {
  const s = normalizeIsraeliPhone(raw);
  if (!s) return "unknown";
  if (s.startsWith("*")) return "star";
  if (s.startsWith("1800")) return "tollfree";
  if (s.startsWith("1700")) return "premium";
  if (MOBILE_PREFIXES.includes(s.slice(0, 3))) return "mobile";
  if (VOIP_PREFIXES.includes(s.slice(0, 3))) return "voip";
  if (LANDLINE_PREFIXES.includes(s.slice(0, 2))) return "landline";
  return "unknown";
}

/** האם המספר תקין - קידומת מוכרת ומספר הספרות הנכון לסוג. */
export function isValidIsraeliPhone(raw: string | null | undefined): boolean {
  const s = normalizeIsraeliPhone(raw);
  if (!s) return false;
  const kind = israeliPhoneKind(raw);
  switch (kind) {
    case "star":
      return s.length >= 4 && s.length <= 8;   // כולל הכוכבית עצמה
    case "mobile":
    case "voip":
      return s.length === 10;
    case "landline":
      return s.length === 9;
    case "tollfree":
    case "premium":
      return s.length === 10;
    default:
      return false;
  }
}

/** תצוגה לבני אדם: 052-1234567, 02-6251111. */
export function formatIsraeliPhone(raw: string | null | undefined): string {
  const s = normalizeIsraeliPhone(raw);
  if (!s) return "";
  if (s.startsWith("*")) return s;
  if (!isValidIsraeliPhone(s)) return s;   // לא תקין - מוצג כפי שהוא, בלי לייפות
  const kind = israeliPhoneKind(s);
  if (kind === "tollfree" || kind === "premium") return `${s.slice(0, 1)}-${s.slice(1, 4)}-${s.slice(4)}`;
  if (kind === "landline") return `${s.slice(0, 2)}-${s.slice(2)}`;
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

/**
 * E.164 מחמיר לוואטסאפ / SMS: ספרות בלבד עם +972, בלי מפרידים.
 *
 * הצורה עם המקפים היא לתצוגה בלבד - parser מחמיר דוחה אותה. מספרי
 * חינם, פרימיום וכוכבית אינם ניתנים לחיוג בינלאומי ולכן מוחזר null.
 */
export function toE164(raw: string | null | undefined): string | null {
  const s = normalizeIsraeliPhone(raw);
  if (!s || !isValidIsraeliPhone(s)) return null;
  const kind = israeliPhoneKind(s);
  if (kind === "star" || kind === "tollfree" || kind === "premium") return null;
  return `+972${s.slice(1)}`;
}

/** הודעת אזהרה בעברית, או null כשאין מה לומר. */
export function israeliPhoneWarning(raw: string | null | undefined): string | null {
  const input = String(raw ?? "").trim();
  if (!input) return null;
  const s = normalizeIsraeliPhone(input);
  if (!s) return "הטלפון אינו מכיל ספרות.";
  if (isValidIsraeliPhone(s)) return null;

  if (!s.startsWith("0") && !s.startsWith("*") && !s.startsWith("1")) {
    return "מספר טלפון בישראל מתחיל ב-0. אם זה מספר מחו\"ל, יש לרשום אותו עם קידומת המדינה.";
  }
  const kind = israeliPhoneKind(s);
  if (kind === "mobile" || kind === "voip") {
    return `מספר נייד הוא עשר ספרות; כאן יש ${s.length}.`;
  }
  if (kind === "landline") {
    return `מספר קווי הוא תשע ספרות; כאן יש ${s.length}.`;
  }
  return "הקידומת אינה מוכרת כקידומת ישראלית. כדאי לוודא.";
}
