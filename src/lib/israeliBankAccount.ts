// בדיקת ספרת ביקורת למספר חשבון בנק ישראלי.
//
// למה זה קיים: אימות ידני של חשבון בנק בוטל (מיגרציה 114). במקומו המערכת בודקת
// בעצמה שמספר החשבון "אפשרי" - לפי נוסחת ספרת הביקורת שכל בנק מפרסם דרך מס"ב.
// הבדיקה תופסת טעות הקלדה (ספרה שגויה, ספרות שהתחלפו), אבל לא יכולה לדעת אם
// החשבון באמת קיים או שייך לתלמיד. זה רק בנק יודע.
//
// אותה נוסחה בדיוק קיימת בשרת - bank_account_check_result() במיגרציה 114. כל
// שינוי כאן חייב להיעשות גם שם, אחרת המסך יגיד "תקין" והשרת "שגוי".
//
// מקור: il-bank-account-validator (soryy708, MIT), מאומת מול israeli-bank-validation
// (ElishaMayer, MIT). בשני מקומות השני טועה ותוקן כאן לפי הראשון: בלאומי שתי ספרות
// הביקורת מתווספות כמספר דו-ספרתי (לא ספרה-ספרה), ובבינלאומי הבדיקה השנייה היא
// mod 11.

export type BankAccountCheck = "valid" | "invalid" | "unknown";

/** ספרות מימין לשמאל: [אחדות, עשרות, ...], באורך קבוע עם אפסים. */
function digitsFromRight(value: string, length: number): number[] {
  const digits = value.split("").reverse().map(Number);
  return Array.from({ length }, (_, i) => digits[i] ?? 0);
}

function dot(digits: number[], weights: number[]): number {
  return weights.reduce((sum, w, i) => sum + w * (digits[i] ?? 0), 0);
}

const W6 = [1, 2, 3, 4, 5, 6];
const W9 = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const BRANCH_W = [7, 8, 9];

/**
 * תוצאת הבדיקה:
 * - valid: ספרת הביקורת מתאימה.
 * - invalid: המספר בוודאות שגוי (או חסר).
 * - unknown: אין נוסחה ידועה לבנק הזה, אז אי אפשר לבדוק. לא חוסם.
 */
export function checkIsraeliBankAccount(
  bankCode: string | null | undefined,
  branch: string | null | undefined,
  account: string | null | undefined,
): BankAccountCheck {
  const bankDigits = String(bankCode ?? "").replace(/\D/g, "");
  const branchDigits = String(branch ?? "").replace(/\D/g, "").replace(/^0+/, "");
  const accountDigits = String(account ?? "").replace(/\D/g, "").replace(/^0+/, "");

  if (!bankDigits) return "unknown";
  const bank = Number(bankDigits);
  if (!accountDigits) return "invalid";

  const SUPPORTED = [4, 9, 10, 11, 12, 13, 14, 17, 20, 22, 31, 34, 46, 52];
  if (!SUPPORTED.includes(bank)) return "unknown";

  // אף בנק נתמך לא מנפיק חשבון של יותר מתשע ספרות, וסניף הוא עד שלוש.
  if (accountDigits.length > 9 || branchDigits.length > 3) return "invalid";

  let branchNumber = Number(branchDigits || "0");
  // מזרחי טפחות: סניפים 401 ומעלה הם סניפי טפחות לשעבר - הנוסחה עובדת על המספר פחות 400.
  if (bank === 20 && branchNumber > 400) branchNumber -= 400;

  const acc = digitsFromRight(accountDigits, 9);
  const br = digitsFromRight(String(branchNumber), 3);
  const branchSum = dot(br, BRANCH_W);
  const ok = (b: boolean): BankAccountCheck => (b ? "valid" : "invalid");

  switch (bank) {
    case 10: // לאומי
    case 13: // אגוד
    case 34: { // ערבי ישראלי
      // שתי הספרות האחרונות הן ספרות הביקורת ונספרות כמספר דו-ספרתי (משקלות 1 ו-10).
      const sum = dot(acc, [1, 10, 2, 3, 4, 5, 6, 7]) + dot(br, [8, 9, 10]);
      return ok([90, 72, 70, 60, 20].includes(sum % 100));
    }
    case 4: // יהב
    case 12: // הפועלים
    case 20: { // מזרחי טפחות
      const r = (dot(acc, W6) + branchSum) % 11;
      if (bank === 4) return ok([0, 2].includes(r));
      if (bank === 20) return ok([0, 2, 4].includes(r));
      return ok([0, 2, 4, 6].includes(r));
    }
    case 11: // דיסקונט
    case 17: // מרכנתיל
      return ok([0, 2, 4].includes(dot(acc, W9) % 11));
    case 31: // הבינלאומי
    case 52: // פאג"י
      if ([0, 6].includes(dot(acc, W9) % 11)) return "valid";
      return ok([0, 6].includes(dot(acc, W6) % 11));
    case 9: // הדואר
      return ok(dot(acc, W9) % 10 === 0);
    case 22: { // סיטיבנק - הספרה האחרונה היא ספרת הביקורת
      const sum = dot(acc.slice(1), [2, 3, 4, 5, 6, 7, 2, 3]);
      return ok(11 - (sum % 11) === acc[0]);
    }
    case 14: // אוצר החייל
    case 46: { // מסד
      const r = (dot(acc, W6) + branchSum) % 11;
      if (r === 0) return "valid";
      if (bank === 46 && r === 2 && [154, 166, 178, 181, 183, 191, 192, 503, 505, 507, 515, 516, 527, 539].includes(branchNumber)) {
        return "valid";
      }
      if (bank === 14) {
        if (r === 2 && [385, 384, 365, 347, 363, 362, 361].includes(branchNumber)) return "valid";
        if (r === 4 && [363, 362, 361].includes(branchNumber)) return "valid";
      }
      if (dot(acc, W9) % 11 === 0) return "valid";
      return ok(dot(acc, W6) % 11 === 0);
    }
  }
  return "unknown";
}

export const BANK_ACCOUNT_CHECK_LABEL: Record<BankAccountCheck, string> = {
  valid: "מספר החשבון תקין",
  invalid: "מספר החשבון שגוי",
  unknown: "אין בדיקה לבנק הזה",
};
