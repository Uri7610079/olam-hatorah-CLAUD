// התאריך של היום לפי שעון המחשב (ישראל), בצורה YYYY-MM-DD.
//
// עד היום ברירת המחדל של שדות תאריך וחודש נלקחה מ-new Date().toISOString(),
// שהוא שעון עולמי (UTC). בין חצות ל-03:00 בלילה זה עוד "אתמול" - ולכן תאריך
// יציאה, תאריך שיוך או תאריך החזרה נרשמו יום אחד אחורה, וב-1 לחודש נבחר
// כברירת מחדל החודש הקודם.
export function todayLocalIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
