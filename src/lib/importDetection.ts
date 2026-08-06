// זיהוי אוטומטי של סוג קובץ יבוא לפי כותרות העמודות שלו.
//
// הרקע: קובץ יובא בטעות כסוג לא נכון, ואיש לא ראה זאת עד שהנתונים כבר נכנסו. המסקנה
// לא הייתה "לנחש טוב יותר" אלא "לעולם לא לנחש בשקט": המנוע כאן מדרג מועמדים ומחזיר
// גם את רמת הוודאות וגם מה חסר בקובץ, והמסך חייב להציג את זה לאישור לפני כל קליטה -
// גם כשהזיהוי חד-משמעי (החלטת Chani).
//
// למה זה מבוסס על כותרות ולא על שם הקובץ: שמות קבצים אצל המשתמשים הם "AAAAA.xls",
// "דוגמה ליהודה.csv" וכד' - חסרי משמעות. הכותרות הן הדבר היחיד שמעיד באמת על התוכן.

export type DetectionConfidence = "single" | "ambiguous" | "unknown";

export interface ImportVariant {
  // תיאור הפורמט כשיש כמה צורות לאותו סוג (למשל תלמידים: הפורמט הפשוט שלנו מול
  // הדוח הרשמי של תלמוד, שכותרותיו שונות לגמרי).
  name?: string;
  required: string[];
  optional?: string[];
}

export interface ImportSignature {
  key: string;
  label: string;
  area: string;
  // לאן לשלוח את המשתמשת אחרי אישור - טאב במרכז היבוא, או מסך אחר.
  target: { kind: "import-center-tab"; tab: string } | { kind: "route"; path: string; hint: string };
  variants: ImportVariant[];
}

export interface DetectionCandidate {
  signature: ImportSignature;
  variant: ImportVariant;
  score: number;
  matchedRequired: string[];
  matchedOptional: string[];
  missingOptional: string[];
}

export interface DetectionResult {
  confidence: DetectionConfidence;
  candidates: DetectionCandidate[];
  headers: string[];
  rowCount: number;
}

// נרמול כותרת לפני השוואה: רווחים כפולים, רווחי קצה, וגרשיים בכל צורותיהם. בקובץ
// אמיתי מתלמוד ראינו כותרת עם עשרות רווחים נגררים, ו-ת"ז נכתב גם עם " וגם עם ״.
export function normalizeHeader(raw: string): string {
  return String(raw ?? "")
    .replace(/[״”“]/g, '"')
    .replace(/[׳’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export const IMPORT_SIGNATURES: ImportSignature[] = [
  {
    key: "students",
    label: "רשימת תלמידים",
    area: "תפעול שוטף",
    target: { kind: "route", path: "/ops/students", hint: 'לחצי על "יבוא מאקסל" במסך תלמידים' },
    variants: [
      {
        name: "פורמט המערכת",
        required: ["מזהה חיצוני", "שם מלא"],
        optional: ["סוג מזהה", "טלפון", "תאריך לידה", "כתובת", "מס בית", "עיר", "קוד לימוד"],
      },
      {
        name: "דוח שאילתת תלמיד מתלמוד",
        required: ["ת.ז/דרכון", "שם תלמיד", "שם משפחה"],
        optional: ["מזהה תלמיד", "ישוב מגורים", "קוד סוג לימוד", "שם עמותה", "טלפון"],
      },
    ],
  },
  {
    key: "talmud_eligibility",
    label: "זכאות חודשית",
    area: "תפעול שוטף",
    target: { kind: "import-center-tab", tab: "eligibility" },
    variants: [{ required: ["מזהה תלמיד", "סכום ברוטו"], optional: ["ניקוד/סוג תשלום"] }],
  },
  {
    key: "talmud_errors",
    label: "שגיאות תלמוד",
    area: "תפעול שוטף",
    target: { kind: "import-center-tab", tab: "errors" },
    variants: [{ required: ["מזהה תלמיד", "קוד שגיאה"], optional: ["תיאור שגיאה"] }],
  },
  {
    key: "master_data",
    label: "עמותות, סניפים וקבוצות",
    area: "תפעול שוטף",
    target: { kind: "import-center-tab", tab: "master" },
    variants: [
      {
        required: ["legal_name"],
        optional: [
          "org_number",
          "talmud_branch_code",
          "branch_internal_name",
          "branch_address",
          "group_name",
          "group_leader_name",
          "group_leader_phone",
          "contact_phone",
          "contact_email",
          "contact_address",
        ],
      },
    ],
  },
  {
    key: "audits_container",
    label: "אירועי ביקורת",
    area: "תפעול שוטף",
    target: { kind: "route", path: "/ops/audits", hint: 'לחצי על "יבוא אירועי ביקורת מאקסל"' },
    variants: [{ required: ["תאריך ביקורת"], optional: ["סניף"] }],
  },
  {
    key: "audit_attendance",
    label: "נוכחות בביקורת",
    area: "תפעול שוטף",
    target: { kind: "import-center-tab", tab: "audits" },
    variants: [{ required: ["מזהה תלמיד"] }],
  },
  {
    key: "phone_lists",
    label: "רשימה טלפונית",
    area: "תפעול שוטף",
    target: { kind: "import-center-tab", tab: "phone" },
    variants: [
      { name: "משפחה ושם נפרדים", required: ["משפחה", "פלאפון"], optional: ["שם"] },
      { name: "שם מלא", required: ["שם", "מספר טלפון"], optional: ["סטטוס", "מידע נוסף"] },
    ],
  },
  {
    key: "documents_metadata",
    label: "מסמכים (מטא-דאטה)",
    area: "תפעול שוטף",
    target: { kind: "route", path: "/ops/documents", hint: 'לחצי על "יבוא מסמכים מאקסל"' },
    variants: [{ required: ["סוג מסמך", "כותרת", "קישור חיצוני"], optional: ["תאריך הנפקה", "תאריך תפוגה", "רגיש"] }],
  },
  {
    key: "bank_transactions",
    label: "תנועות בנק",
    area: "כספים ובקרה",
    target: { kind: "import-center-tab", tab: "bank" },
    variants: [
      {
        name: "פורמט המערכת",
        required: ["תאריך ביצוע", "סכום", "חובה/זכות"],
        optional: ["תאריך ערך", "תיאור", "אסמכתה", "סוג פעולה", "יתרה", "מזהה בנק"],
      },
      {
        name: "דף חשבון מהבנק",
        required: ["זכות", "חובה", "תאריך"],
        optional: ["יתרה", "תאריך ערך", "תיאור", "אסמכתא", "סוג פעולה"],
      },
    ],
  },
  {
    key: "donations",
    label: "תרומות",
    area: "כספים ובקרה",
    target: { kind: "route", path: "/finance/donations", hint: 'לחצי על "יבוא מאקסל" במסך תרומות' },
    variants: [{ required: ["תאריך תרומה", "סכום"], optional: ["שם קבוצה", "אסמכתת תורם", "אסמכתה", "הערות"] }],
  },
  {
    key: "commission_rules",
    label: "כללי עמלה",
    area: "כספים ובקרה",
    target: { kind: "route", path: "/finance/commission-rules", hint: 'לחצי על "יבוא מאקסל" במסך כללי עמלה' },
    variants: [
      {
        required: ["סוג חישוב"],
        optional: ["אחוז", "סכום קבוע", "כלל עיגול", "עדיפות", "שם קבוצה", "קוד לימוד", "מזהה תלמיד חיצוני", "תקף מתאריך", "תקף עד תאריך"],
      },
    ],
  },
  {
    key: "recognition_rules",
    label: "כללי זיהוי בנק",
    area: "ניהול",
    target: { kind: "route", path: "/admin/bank-classification", hint: 'בלשונית "כללי זיהוי בנק"' },
    variants: [
      {
        required: ["קוד סוג תנועה מוצע", "רמת ביטחון"],
        optional: ["חשבון בנק", "כיוון", "סוג התאמת טקסט", "ערך התאמת טקסט", "שם צד שכנגד", "סכום מינימום", "סכום מקסימום", "התאמת אסמכתה", "עדיפות"],
      },
    ],
  },
  {
    key: "bank_transaction_types",
    label: "סוגי תנועה בנקאית",
    area: "ניהול",
    target: { kind: "route", path: "/admin/bank-classification", hint: 'בלשונית "סוגי תנועה"' },
    variants: [{ required: ["קוד", "תווית"] }],
  },
  {
    key: "study_codes",
    label: "קודי לימוד",
    area: "ניהול",
    target: { kind: "route", path: "/admin/study-codes", hint: 'לחצי על "יבוא מאקסל" במסך קודי לימוד' },
    variants: [{ required: ["קוד", "תיאור"], optional: ["קטגוריה"] }],
  },
];

function scoreVariant(variant: ImportVariant, headerSet: Set<string>) {
  const matchedRequired = variant.required.filter((h) => headerSet.has(normalizeHeader(h)));
  // כל עמודות החובה חייבות להופיע - חוסר אחת פוסל את הצורה הזו לגמרי. עדיף "לא
  // זוהה" מאשר שיוך חלקי שנראה סביר.
  if (matchedRequired.length < variant.required.length) return null;

  const optional = variant.optional ?? [];
  const matchedOptional = optional.filter((h) => headerSet.has(normalizeHeader(h)));
  const missingOptional = optional.filter((h) => !headerSet.has(normalizeHeader(h)));

  // ככל שחתימה ספציפית יותר (יותר עמודות חובה) כך היא גוברת על חתימה רופפת שגם היא
  // מתאימה - למשל "קוד+תיאור" של קודי לימוד מול חתימה עשירה יותר שמכילה אותן.
  return {
    variant,
    score: variant.required.length * 10 + matchedOptional.length,
    matchedRequired,
    matchedOptional,
    missingOptional,
  };
}

export function detectImportType(headers: string[], rowCount: number): DetectionResult {
  const normalized = headers.map(normalizeHeader).filter((h) => h.length > 0);
  const headerSet = new Set(normalized);

  const candidates: DetectionCandidate[] = [];
  for (const signature of IMPORT_SIGNATURES) {
    let best: ReturnType<typeof scoreVariant> = null;
    for (const variant of signature.variants) {
      const scored = scoreVariant(variant, headerSet);
      if (scored && (!best || scored.score > best.score)) best = scored;
    }
    if (best) candidates.push({ signature, ...best });
  }

  candidates.sort((a, b) => b.score - a.score);

  let confidence: DetectionConfidence = "unknown";
  if (candidates.length === 1) confidence = "single";
  else if (candidates.length > 1) {
    // פער ברור בציון = מועמד אחד באמת עדיף. פער קטן = שתי אפשרויות סבירות, ואז
    // מציגים את שתיהן ונותנים למשתמשת להכריע במקום לבחור בשבילה.
    confidence = candidates[0].score > candidates[1].score ? "single" : "ambiguous";
  }

  return { confidence, candidates, headers: normalized, rowCount };
}
