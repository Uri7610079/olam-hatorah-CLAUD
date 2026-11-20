// פתיחה והורדה של קבצים שמגיעים מהמסד בבסיס 64.
//
// קובץ שנפתח בלשונית מתוך blob רץ באותה כתובת של המערכת. אם הוא נפתח כ-HTML או
// SVG, הקוד שבתוכו רץ בהרשאות של העובד המחובר. לכן הסוג שנשמר עם הקובץ (מה
// שהדפדפן של מי שהעלה הצהיר עליו) לא קובע כלום: הסוג נקבע לפי הבתים עצמם, ורק
// תמונה או PDF נפתחים. כל השאר יורד למחשב ולא נפתח.

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export type ViewableType = "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "application/pdf";

const startsWith = (b: Uint8Array, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);

// הסוג לפי תוכן הקובץ. null = לא תמונה שהדפדפן מציג ולא PDF.
export function sniffViewableType(bytes: Uint8Array): ViewableType | null {
  if (bytes.length < 12) return null;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  return null;
}

// הורדה למחשב, תמיד כקובץ בינארי. הדפדפן לא מנסה להציג אותו.
export function downloadBytes(bytes: Uint8Array<ArrayBuffer>, fileName: string | null | undefined) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName || "קובץ";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadBase64(b64: string, fileName: string | null | undefined) {
  downloadBytes(base64ToBytes(b64), fileName);
}
