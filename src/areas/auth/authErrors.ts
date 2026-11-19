// הודעות השגיאה של Supabase Auth מגיעות באנגלית. כאן - תרגום לעברית של המקרים
// המוכרים; הודעה שלא מוכרת מוצגת כפי שהיא, בסוגריים אחרי פתיח בעברית, כדי שלא
// יאבד מידע שיעזור לתמיכה.
export function hebrewAuthError(message: string, fallbackPrefix: string): string {
  const m = message.toLowerCase();
  if (m.includes("already registered") || m.includes("already been registered") || m.includes("already exists")) {
    return "כבר קיים חשבון עם האימייל הזה. אפשר להיכנס, או לבחור \"שכחתי סיסמה\".";
  }
  if (m.includes("invalid format") || m.includes("invalid email") || (m.includes("email address") && m.includes("invalid"))) {
    return "כתובת האימייל אינה תקינה.";
  }
  if (m.includes("password should be at least") || m.includes("password is too short")) return "הסיסמה קצרה מדי.";
  if (m.includes("weak")) return "הסיסמה חלשה מדי. כדאי לשלב אותיות, מספרים וסימנים.";
  if (m.includes("rate limit") || m.includes("too many") || m.includes("for security purposes")) {
    return "נשלחו יותר מדי בקשות בזמן קצר. צריך לחכות כמה דקות ולנסות שוב.";
  }
  if (m.includes("signups not allowed") || m.includes("signup is disabled")) return "ההרשמה למערכת סגורה כרגע. יש לפנות למנהל המערכת.";
  if (m.includes("failed to fetch") || m.includes("network")) return "אין חיבור לשרת. כדאי לבדוק את החיבור לאינטרנט ולנסות שוב.";
  return `${fallbackPrefix} (${message}).`;
}
