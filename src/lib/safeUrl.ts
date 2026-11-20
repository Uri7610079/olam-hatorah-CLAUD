// קישור חיצוני שנשמר במסד (מסמך, קובץ מצורף מוואטסאפ) נפתח רק אם הוא http או https.
// ביקורת אבטחה 20.11 (ממצא 11): קישור כמו javascript:... היה מריץ קוד בהרשאות של מי
// שלחץ עליו. כל דבר אחר - מוצג כטקסט ולא כקישור.
export function safeHttpUrl(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
