// התאמת עמודות: כשקובץ מגיע עם כותרת שהמערכת לא מכירה, במקום לפסול את כל השורות
// שואלים את המשתמשת "האם 'מזהה חיצוני' הוא 'תעודת זהות'?" ומציעים את התשובה מראש.
//
// למה זה עדיף על רשימת שמות נרדפים קבועה: רשימה כזו מכסה רק מה שכבר ראינו. קובץ
// אמיתי של הלקוח הגיע עם "תעודת זהות", "שם" ו"קוד סוג לימודים" - שלוש כותרות
// שנשמעות מובנות מאליהן לאדם, ופסלו 1583 שורות בלי שאף אחד הבין למה. שאלה אחת
// פותרת גם את הקובץ הבא, שיגיע עם ניסוח אחר.
//
// הכלל שנשמר: המערכת מציעה, המשתמשת מאשרת. אין התאמה אוטומטית שקטה - זו בדיוק
// הדרך שבה נתון נוחת בשדה הלא נכון בלי שאיש שם לב.

export interface TargetField {
  key: string;
  label: string;
  required?: boolean;
  // מילים שמרמזות על השדה. משמשות לניקוד ההצעה בלבד, לא להתאמה אוטומטית.
  hints?: string[];
  // שיוך נושאי. בעלי קבצים מסדרים עמודות בבלוקים - "קוד בנק / קוד סניף / מספר
  // חשבון" צמודות זו לזו, ו"מספר סניף / קוד סוג לימודים / סמל מוסד" בבלוק אחר.
  // הסמיכות הזו מלמדת על המשמעות: "קוד סניף" ליד "מספר חשבון" הוא סניף בנק,
  // ואותה כותרת בדיוק בבלוק העמותה הייתה סניף עמותה. ר' scoreWithContext.
  group?: "bank" | "org" | "student";
}

export function normalizeForMatch(raw: string): string {
  return String(raw ?? "")
    .replace(/[״”“]/g, '"')
    .replace(/[׳’‘`]/g, "'")
    .replace(/["'.\-_/]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ניקוד קרבה בין כותרת בקובץ לשדה יעד. גבוה = סביר יותר.
// מכוון להיות שמרני: מחזיר 0 כשאין שום קשר, כדי שלא תוצע התאמה מופרכת.
function score(header: string, field: TargetField): number {
  const h = normalizeForMatch(header);
  const candidates = [field.label, ...(field.hints ?? [])].map(normalizeForMatch);
  let best = 0;

  for (const c of candidates) {
    if (!c || !h) continue;
    if (h === c) return 100;
    if (h.includes(c) || c.includes(h)) best = Math.max(best, 70);

    // חפיפת מילים - תופס "קוד סוג לימודים" מול "קוד לימוד" (שתי מילים משותפות).
    //
    // התאמת תחילית מוגבלת למילים בנות 3 תווים ומעלה, וזה לא פרט טכני: בלי הסייג
    // הזה "מס" נחשב תחילית של "מספר", והמערכת הציעה "מס בית" = "מספר חשבון" -
    // כלומר מספר חשבון בנק היה נוחת בשדה מספר הבית. נתפס בבדיקה מול קובץ אמיתי.
    const hw = h.split(" ").filter(Boolean);
    const cw = c.split(" ").filter(Boolean);
    const shared = hw.filter((w) =>
      cw.some((x) => x === w || (w.length >= 3 && x.startsWith(w)) || (x.length >= 3 && w.startsWith(x))),
    );
    if (shared.length > 0) {
      best = Math.max(best, Math.round((shared.length / Math.max(hw.length, cw.length)) * 60));
    }
  }
  return best;
}

export interface FieldSuggestion {
  field: TargetField;
  // הכותרת בקובץ שכבר תואמת בדיוק לשם השדה - אז אין מה לשאול.
  exactHeader: string | null;
  // ההצעה הטובה ביותר מבין הכותרות שלא נוצלו, אם יש.
  suggestedHeader: string | null;
  confidence: number;
  // הוסבר למשתמשת כשההצעה נשענה על מיקום העמודה ולא רק על שמה.
  contextNote?: string;
}

const GROUP_LABEL: Record<string, string> = {
  bank: "עמודות הבנק",
  org: "עמודות העמותה",
  student: "פרטי התלמיד",
};

// בונוס סמיכות: כותרת ששכנתה כבר שויכה בוודאות לשדה מאותו נושא מקבלת חיזוק.
// חלון של שתי עמודות לכל צד - מספיק כדי לתפוס בלוק, וצר מספיק כדי לא לקשר בין
// בלוקים שכנים.
function adjacencyBonus(headerIndex: number, field: TargetField, anchors: Map<number, string>): number {
  if (!field.group) return 0;
  for (let d = 1; d <= 2; d++) {
    for (const idx of [headerIndex - d, headerIndex + d]) {
      if (anchors.get(idx) === field.group) return d === 1 ? 25 : 12;
    }
  }
  return 0;
}

export interface MappingPlan {
  // שדות שצריך לשאול עליהם - אין להם התאמה מדויקת בקובץ.
  questions: FieldSuggestion[];
  // כותרות בקובץ שלא שויכו לשום שדה.
  unusedHeaders: string[];
  // האם חסר שדה חובה שגם אין לו הצעה - אז אין טעם להמשיך.
  missingRequired: TargetField[];
}

export function buildMappingPlan(headers: string[], fields: TargetField[]): MappingPlan {
  const normalizedHeaders = new Map(headers.filter(Boolean).map((h) => [normalizeForMatch(h), h]));
  const taken = new Set<string>();
  const questions: FieldSuggestion[] = [];
  const missingRequired: TargetField[] = [];

  // סיבוב ראשון: התאמות מדויקות. הן תופסות את הכותרת שלהן לפני שמישהו אחר יציע
  // עליה, אחרת שדה אחר היה עלול "לגנוב" כותרת ששייכת בבירור למישהו.
  const exact = new Map<string, string>();
  // עוגנים: אינדקס העמודה -> הנושא שלה. נבנים מהתאמות המדויקות בלבד, כי רק הן
  // ודאיות מספיק כדי לשמש בסיס להסקה על השכנות.
  const anchors = new Map<number, string>();
  for (const field of fields) {
    const hit = normalizedHeaders.get(normalizeForMatch(field.label));
    if (hit) {
      exact.set(field.key, hit);
      taken.add(hit);
      if (field.group) anchors.set(headers.indexOf(hit), field.group);
    }
  }

  for (const field of fields) {
    const exactHeader = exact.get(field.key) ?? null;
    if (exactHeader) continue;

    let suggestedHeader: string | null = null;
    let confidence = 0;
    let contextNote: string | undefined;
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      if (!header || taken.has(header)) continue;
      const base = score(header, field);
      if (base === 0) continue;
      const bonus = adjacencyBonus(i, field, anchors);
      const s = Math.min(99, base + bonus);
      if (s > confidence) {
        confidence = s;
        suggestedHeader = header;
        contextNote = bonus > 0 && field.group ? `לפי הסמיכות ל${GROUP_LABEL[field.group]}` : undefined;
      }
    }

    // סף גבוה בכוונה. הצעה חלשה גרועה מהיעדר הצעה: המשתמשת נוטה לאשר את מה
    // שמוצע לה, ולכן ניחוש בינוני הופך לנתון שגוי שנקלט באישור מלא. מתחת לסף
    // השדה מוצג ריק, והיא בוחרת בעצמה מרשימת העמודות.
    if (confidence < 50) {
      suggestedHeader = null;
      confidence = 0;
    }

    if (suggestedHeader || field.required) {
      questions.push({ field, exactHeader: null, suggestedHeader, confidence, contextNote });
      if (suggestedHeader) taken.add(suggestedHeader);
    }
    if (field.required && !suggestedHeader) missingRequired.push(field);
  }

  return {
    questions,
    unusedHeaders: headers.filter((h) => h && !taken.has(h)),
    missingRequired,
  };
}

// החלת המיפוי שהמשתמשת אישרה: הכותרת שנבחרה מקבלת גם את שם השדה, כך שכל מה
// שבהמשך השרשרת (אימות, שמירה, פונקציית הקליטה) מוצא את מה שהוא מחפש.
// הכותרת המקורית נמחקת כדי שהתצוגה המקדימה לא תראה כל ערך פעמיים.
export function applyColumnMapping(
  row: Record<string, string>,
  mapping: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...row };
  for (const [fieldKey, header] of Object.entries(mapping)) {
    if (!header || fieldKey === header) continue;
    if (out[header] === undefined) continue;
    if (out[fieldKey] === undefined || out[fieldKey] === "") out[fieldKey] = out[header];
    delete out[header];
  }
  return out;
}

// שדות היעד של יבוא תלמידים, לפי מה שפונקציית הקליטה קוראת בפועל
// (commit_students_import_batch, מיגרציות 076 ו-086).
export const STUDENT_IMPORT_FIELDS: TargetField[] = [
  { key: "מזהה חיצוני", label: "מזהה חיצוני", group: "student", required: true, hints: ["תעודת זהות", "ת.ז", "תז", "ת.ז/דרכון", "מספר זהות", "דרכון"] },
  { key: "שם מלא", label: "שם מלא", group: "student", required: true, hints: ["שם", "שם התלמיד", "שם תלמיד", "שם ושם משפחה"] },
  { key: "סוג מזהה", label: "סוג מזהה", group: "student", hints: ["מזהה תלמיד", "סוג תעודה", "סוג זיהוי"] },
  { key: "טלפון", label: "טלפון", group: "student", hints: ["פלאפון", "פאלפון", "נייד", "טלפון נייד"] },
  { key: "קוד לימוד", label: "קוד לימוד", group: "student", hints: ["קוד סוג לימוד", "קוד סוג לימודים", "סוג לימודים", "קוד לימודים"] },
  { key: "תאריך לידה", label: "תאריך לידה", group: "student", hints: ["ת. לידה", "תאריך הלידה"] },
  { key: "כתובת", label: "כתובת", group: "student", hints: ["רחוב", "כתובת מגורים"] },
  { key: "מס בית", label: "מס בית", group: "student", hints: ["מספר בית", "בית"] },
  { key: "עיר", label: "עיר", group: "student", hints: ["ישוב מגורים", "יישוב", "ישוב"] },

  // שיוך לקבוצה. שלושת השדות עובדים יחד - הקבוצה מזוהה דרך השרשרת עמותה -> סניף
  // -> קבוצה, כי אותו שם קבוצה חוזר בכמה סניפים ובכמה עמותות.
  { key: "שם קבוצה", label: "שם קבוצה", group: "org", hints: ["קבוצה", "שם הקבוצה"] },
  { key: "סמל מוסד", label: "סמל מוסד", group: "org", hints: ["מספר עמותה", "סמל המוסד", "מספר מוסד"] },
  { key: "מספר סניף", label: "מספר סניף", group: "org", hints: ["סניף עמותה", "מספר הסניף"] },

  // חשבון בנק. "סניף בנק" נפרד מ"מספר סניף" בכוונה ובשם מפורש: בקובץ של הלקוח
  // מופיעות שתי עמודות שנקראות כמעט אותו דבר - "מספר סניף" הוא סניף העמותה
  // ו"קוד סניף" הוא סניף הבנק. ערבוב ביניהן היה שולח כסף לסניף בנק שגוי.
  { key: "בנק", label: "בנק", group: "bank", hints: ["קוד בנק", "שם בנק", "מספר בנק"] },
  { key: "סניף בנק", label: "סניף בנק", group: "bank", hints: ["קוד סניף", "מספר סניף בנק"] },
  { key: "מספר חשבון", label: "מספר חשבון", group: "bank", hints: ["חשבון", "מס חשבון", "מספר החשבון"] },
];
