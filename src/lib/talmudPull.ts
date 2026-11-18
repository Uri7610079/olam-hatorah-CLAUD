// משיכה מתלמוד (מיגרציה 118): הצפנת סיסמת תלמוד בדפדפן, לפני שהיא יוצאת מהמחשב.
//
// המפתח הציבורי כאן; המפתח הפרטי רק אצל העובד (משתנה סביבה TALMUD_PRIVATE_KEY ב-Vercel).
// במסד נשמר רק הטקסט המוצפן, ואף מסך לא מקבל אותו בחזרה. החלפת המפתחות = כל
// הסיסמאות צריכות להיות מוקלדות מחדש.

const PUBLIC_KEY_SPKI_BASE64 =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmPwvlv3RbTPjWf4LvJrJKMvbja7EbkC3O9I0HLhks1bOhrWcWCV3c2hdYvc7rS8TIEx93AL1C9n3OMAUyg/MLwAUJR/q2BZ0My0hxFioaEy+vmUzyw3evQhgTPre8NPt9DW8BXh/QbjPI8yeCT2We/8JN8I1lefGFsqnVPE3VuOfCpiAIOjY4gVKHMe/QsLZTKnYGMsy5fO8BE3aeh37X7avezGTqWB7xjkW+ScbLZWfQ+crtlOLwLlRaTN4b57zgXWhhpOLPQKIKeybnHjNCibhNpgVkm8gfVBcMAJthRZgXw8CZimQRzAa8Z6eRwVrcy9LLZIx3fF8d2ygxcuT2wIDAQAB";

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s);
}

/** RSA-OAEP עם SHA-256. התוצאה: base64 (344 תווים). */
export async function encryptTalmudPassword(password: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "spki", base64ToBytes(PUBLIC_KEY_SPKI_BASE64), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"],
  );
  const cipher = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, new TextEncoder().encode(password));
  return bytesToBase64(new Uint8Array(cipher));
}

export type PullOrgStatus = "queued" | "logging_in" | "waiting_sms" | "downloading" | "done" | "failed" | "cancelled";

export const PULL_STATUS_LABEL: Record<PullOrgStatus, string> = {
  queued: "בתור",
  logging_in: "מתחבר לתלמוד…",
  waiting_sms: "נשלח SMS - יש להקליד את הקוד",
  downloading: "מוריד קבצים…",
  done: "הסתיים",
  failed: "נכשל",
  cancelled: "בוטל",
};

/** החודש האחרון שהסתיים, כ-YYYY-MM-01 */
export function lastClosedMonth(today = new Date()): string {
  const d = new Date(Date.UTC(today.getFullYear(), today.getMonth() - 1, 1));
  return d.toISOString().slice(0, 10);
}
