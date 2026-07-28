// יום "מקומי" בפורמט YYYY-MM-DD - לא דרך toISOString() (ממיר ל-UTC ומזיז תאריך אחורה
// בכל אזור זמן חיובי, כולל ישראל - נתפס בביקורת תקינות ייעודית: לוח השנה הציג כל
// משימה יום אחד מוזז, ומסך הבית שיבץ משימות ל"קרוב"/"באיחור" הפוך בין 00:00-03:00).
export function localDateIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayIso(): string {
  return localDateIso(new Date());
}

export function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDateIso(d);
}

const WEEKDAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

// ניחוש תאריך יעד מטקסט חופשי - היוריסטי בלבד, לא AI (לפי הנחיית Chani לדלג על כל
// דבר שדורש קריאה חיצונית ל-API). מזהה רק תבניות מפורשות: יום בשבוע בעברית ("יום חמישי"),
// DD/MM או DD/MM/YYYY, "היום"/"מחר". טקסט שלא תואם אף תבנית - פשוט אין תאריך מוצע,
// לא מומצא ניחוש שגוי.
export function guessDueDateFromText(text: string): string | null {
  if (/\bהיום\b/.test(text)) return todayIso();
  if (/\bמחר\b/.test(text)) return addDaysIso(1);

  const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return isoMatch[0];

  const dmyMatch = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const dmMatch = text.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (dmMatch) {
    const [, d, m] = dmMatch;
    return `${new Date().getFullYear()}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  for (let dow = 0; dow < 7; dow++) {
    if (text.includes(`יום ${WEEKDAY_NAMES[dow]}`)) {
      const today = new Date();
      const diff = (dow - today.getDay() + 7) % 7;
      today.setDate(today.getDate() + diff);
      return localDateIso(today);
    }
  }
  return null;
}

// פיצול היוריסטי של טקסט חופשי למשימות מועמדות - שורות קודם (הכי אמין), ואז בתוך כל
// שורה: פסיקים, וגם "ו" שמתחיל פועל-מקור (ל+אות) בלי פסיק לפניו (התבנית הנפוצה בעברית
// לסיום רשימה, למשל "לצלם את הדגם ולשלוח הצעה" -> שתי משימות). לא NLP אמיתי - זה בכוונה,
// יש מסך אישור עם עריכה אחרי, אז פיצול לא-מושלם ניתן לתיקון ידני ולא באג.
export function splitFreeTextIntoTasks(text: string): string[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const fragments: string[] = [];
  for (const line of lines) {
    const byComma = line.split(",").map((s) => s.trim()).filter(Boolean);
    for (const part of byComma) {
      const byVav = part.split(/\sו(?=ל[א-ת])/).map((s) => s.trim()).filter(Boolean);
      fragments.push(...byVav);
    }
  }
  return fragments;
}
