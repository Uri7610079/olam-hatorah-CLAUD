// אימות ספרת ביקורת של מספרי זהות ישראליים.
//
// אותו אלגוריתם משמש לתעודת זהות אישית ולמספרי ישויות רשומות - עמותה
// (58), חברה (51), שותפות (55) וכל שאר בלוק ה-5XX. לכן פונקציה אחת.
//
// למה זה כאן: הנתונים שמגיעים מ"תלמוד" נקיים - נבדקו 2,559 מזהים בדוחות
// של אוגוסט 2026 ואף אחד לא נכשל, כי תלמוד מקבל אותם ממשרד הפנים. הסיכון
// כולו בהזנה ידנית ובייבוא מאקסל של הלקוח, ושם ספרה שהוקלדה הפוך יוצרת
// תלמיד שלעולם לא יותאם לדוח - והכסף שלו פשוט לא ייכנס, בלי שאיש ידע.
//
// מבוסס על הכלי israeli-id-validator (MIT) שבתיקיית כלי הבנייה.

/** האם הערך הוא מזהה ישראלי תקין לפי ספרת הביקורת. */
export function isValidIsraeliId(value: string | null | undefined): boolean {
  // הסרת כל תו שאינו ספרה *אסקי*, ואז ריפוד לתשע.
  //
  // אין להסתמך על בדיקת "האם זו ספרה" של השפה: היא מחזירה אמת גם לספרות
  // ערביות-הודיות ולספרות עיליות, שאחר כך מתפרשות כמספר אחר לגמרי או
  // מפילות את ההמרה. ת.ז נשמרת לא פעם בלי אפסים מובילים, ולכן הריפוד
  // הכרחי - בלעדיו 66107285 ייחשב שגוי אף שהוא תקין לחלוטין.
  const digits = String(value ?? "").replace(/[^0-9]/g, "");
  if (digits.length === 0 || digits.length > 9) return false;
  const s = digits.padStart(9, "0");

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let product = Number(s[i]) * ((i % 2) + 1);
    if (product > 9) product -= 9;
    sum += product;
  }
  return sum % 10 === 0;
}

/** האם הערך נראה כמו מספר זהות ספרתי בכלל (להבדיל מדרכון). */
export function looksLikeIsraeliId(value: string | null | undefined): boolean {
  return /^[0-9]+$/.test(String(value ?? "").trim());
}

export type IdKind = "israeli_id" | "passport" | "other";

/**
 * הודעת אזהרה בעברית, או null כשאין מה לומר.
 *
 * דרכון מוחזר תמיד null: הוא אלפאנומרי, אין בו ספרת ביקורת, וכל "אימות"
 * שלו יהיה המצאה. אזהרת שווא מאמנת להתעלם מאזהרות אמיתיות.
 */
export function israeliIdWarning(value: string | null | undefined, kind: IdKind): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (kind !== "israeli_id") return null;

  if (!looksLikeIsraeliId(raw)) {
    return "תעודת זהות מכילה ספרות בלבד. אם זה דרכון, יש לשנות את סוג המזהה.";
  }
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.replace(/^0+/, "").length > 9) {
    return "תעודת זהות ישראלית היא עד תשע ספרות.";
  }
  if (!isValidIsraeliId(raw)) {
    return "ספרת הביקורת אינה מתאימה — כנראה טעות הקלדה. מספר כזה לא יותאם לדוח של תלמוד, והזכאות לא תיכנס.";
  }
  return null;
}

/**
 * אזהרה למספר ישות רשומה - עמותה, חברה, שותפות.
 *
 * הבדיקה לקידומת היא היוריסטיקה בלבד (מספרי תאגיד מוקצים מבלוק 5XX),
 * ולכן היא מנוסחת כשאלה ולא כקביעה. ספרת הביקורת, לעומת זאת, ודאית.
 */
export function entityNumberWarning(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!looksLikeIsraeliId(raw)) return "מספר עמותה מכיל ספרות בלבד.";
  if (!isValidIsraeliId(raw)) {
    return "ספרת הביקורת אינה מתאימה — כנראה טעות הקלדה.";
  }
  if (!raw.replace(/[^0-9]/g, "").padStart(9, "0").startsWith("58")) {
    return "מספר עמותה מתחיל בדרך כלל ב-58. כדאי לוודא.";
  }
  return null;
}

/**
 * סימון שורות יבוא תלמידים שבהן ת.ז אינה עוברת את ספרת הביקורת.
 *
 * needs_decision ולא invalid: השורה אינה נדחית, אלא מוצגת לאישור לפני
 * הקליטה. ת.ז שגויה היא כמעט תמיד טעות הקלדה, אבל ההכרעה מה לעשות איתה
 * היא של אדם - יש מקרים שבהם עדיף לקלוט ולתקן אחר כך מאשר לאבד את השורה.
 *
 * מכוון ליבוא התלמידים בלבד. הדוחות של "תלמוד" מגיעים ממשרד הפנים ואינם
 * עוברים כאן: 2,559 מזהים בדוחות של אוגוסט 2026 נבדקו ואף אחד לא נכשל,
 * וחסימת שורה שם על סמך ספרת ביקורת הייתה מונעת כסף בלי סיבה.
 *
 * שורה שכבר סומנה כבעייתית נשארת כפי שהיא - ההודעה הראשונה היא הבעיה
 * שהתגלתה קודם, ואין טעם לדרוס אותה.
 */
export function flagInvalidIdentities<
  T extends { raw: Record<string, string>; status: string; errorMessage: string | null },
>(rows: T[]): T[] {
  return rows.map((row) => {
    if (row.status !== "valid") return row;

    const rawType = (row.raw["סוג מזהה"] ?? "").trim();
    const isPassport = rawType === "דרכון" || rawType.toLowerCase() === "passport";
    const isOther = rawType === "אחר" || rawType.toLowerCase() === "other";
    if (isPassport || isOther) return row;

    const value = (row.raw["מזהה חיצוני"] ?? row.raw["ת.ז/דרכון"] ?? "").trim();
    if (!value) return row;
    if (isValidIsraeliId(value)) return row;

    return {
      ...row,
      status: "needs_decision",
      errorMessage: `תעודת הזהות ${value} אינה עוברת את ספרת הביקורת — כנראה טעות הקלדה. תלמיד כזה לא יותאם לדוח של תלמוד.`,
    };
  });
}
