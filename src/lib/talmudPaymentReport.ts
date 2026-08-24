// קליטת "דוח דרישת תשלום" מתלמוד.
//
// זהו הדוח החודשי שמתקבל מתלמוד בפועל, וזו הצורה שבה הוא יורד משם - לא
// פורמט שהומצא כאן. שלושה דברים בו אינם מובנים מאליהם, וכל אחד מהם היה
// גורם לנתונים שגויים אילו נקלט כפשוטו:
//
// 1. ‎ReasonLevelName‎ הוא *הסכום של התלמיד*, למרות שהשם נשמע כמו תיאור.
//    ‎PaymentSum‎ ו-‎PaymentSum1‎ הם סיכומי סניף ועמותה שחוזרים בכל שורה.
//    אומת בחשבון על קובץ אמיתי: 22,005 + 8,100 = 30,105, בדיוק כמו
//    הסיכומים שבקובץ. קליטת PaymentSum כסכום לתלמיד הייתה מכפילה את
//    הסכומים פי עשרות.
//
// 2. מספר העמותה והסניף אינם עמודות. הם קבורים בשדה טקסט אחד:
//        עמותה: 580148757   תכלת מרדכי סניף 00
//
// 3. חודש התשלום אינו בשורות כלל - הוא בכותרת קטנה בראש הקובץ.
//
// ובנוסף: אותו תלמיד יכול להופיע פעמיים תחת שני קודי לימוד, אחד זכאי
// ואחד לא. זו התנהגות תקינה ולא כפילות.

export interface TalmudReportRow {
  orgNumber: string;
  orgName: string;
  branchCode: string;
  studentId: string;
  identityType: string;
  firstName: string;
  familyName: string;
  studyCode: string;
  eligible: boolean;
  amount: number;
  points: number;
  dateFrom: string;
  dateTo: string;
}

export interface TalmudReportSummary {
  month: string | null;
  orgNumbers: string[];
  branches: string[];
  rowCount: number;
  eligibleCount: number;
  totalAmount: number;
  // סכומים שהקובץ עצמו מצהיר עליהם, לאימות מול מה שחושב
  declaredOrgTotal: number | null;
  problems: string[];
}

export interface TalmudReportParseResult {
  rows: TalmudReportRow[];
  summary: TalmudReportSummary;
}

// שמות העמודות בשתי השפות. תלמוד מייצאת באנגלית, אבל דוחות שעברו עריכה
// ידנית או תרגום מגיעים בעברית - ושניהם צריכים להיקלט.
const FIELDS: Record<keyof Omit<TalmudReportRow, 'orgNumber' | 'orgName' | 'branchCode'>, string[]> = {
  studentId: ['StudentIdentity', 'ת.ז/דרכון', 'תעודת זהות', 'מזהה תלמיד'],
  identityType: ['IdentityTypeName', 'סוג מזהה'],
  firstName: ['StudentName1', 'שם תלמיד', 'שם פרטי'],
  familyName: ['StudentFamilyName1', 'שם משפחה'],
  studyCode: ['StudyTypeNumber1', 'קוד סוג לימוד', 'קוד לימוד'],
  eligible: ['EntitlementStatusName', 'סטטוס זכאות'],
  amount: ['ReasonLevelName', 'סכום', 'סכום ברוטו'],
  points: ['Points', 'ניקוד'],
  dateFrom: ['DateFrom', 'מתאריך'],
  dateTo: ['DateTo', 'עד תאריך'],
};

const ORG_FIELD = ['Textbox145', 'עמותה'];

function pick(row: Record<string, string>, names: string[]): string {
  for (const n of names) {
    // התאמה מדויקת קודם, ורק אחריה התאמה חלקית - אחרת 'סכום' היה תופס
    // גם 'סכום ברוטו' וגם 'סכום נטו', והתוצאה תלויה בסדר המקרי של המפתחות.
    if (row[n] !== undefined) return String(row[n] ?? '').trim();
  }
  const keys = Object.keys(row);
  for (const n of names) {
    const hit = keys.find((k) => k.trim() === n);
    if (hit) return String(row[hit] ?? '').trim();
  }
  return '';
}

// מספר עם מפרידי אלפים ומרכאות: "22,005.00" -> 22005
export function parseAmount(raw: string): number {
  const clean = String(raw ?? '').replace(/[^0-9.\-]/g, '');
  const n = Number(clean);
  return Number.isFinite(n) ? n : 0;
}

// חילוץ מספר העמותה, שמה ומספר הסניף מתוך שדה הטקסט.
//     "עמותה: 580148757   תכלת מרדכי סניף 00"
// מספר העמותה הוא רצף של 9 ספרות; מספר הסניף מגיע אחרי המילה "סניף".
export function parseOrgField(raw: string): { orgNumber: string; orgName: string; branchCode: string } {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  const orgNumber = (text.match(/\b(\d{9})\b/) || [])[1] || '';
  const branchCode = (text.match(/סניף\s*(\d+)/) || [])[1] || '';
  let orgName = text;
  if (orgNumber) orgName = orgName.replace(new RegExp(`.*${orgNumber}\\s*`), '');
  orgName = orgName.replace(/סניף\s*\d+\s*$/, '').trim();
  return { orgNumber, orgName, branchCode };
}

// חודש התשלום מהכותרת שבראש הקובץ: "07/2026" -> "2026-07-01".
// המערכת שומרת חודש כתאריך של ה-1 בחודש (ר' monthly_eligibility).
export function parsePaymentMonth(matrix: string[][]): string | null {
  for (let i = 0; i < Math.min(6, matrix.length); i++) {
    for (const cell of matrix[i] || []) {
      const m = String(cell ?? '').trim().match(/^(\d{1,2})\/(\d{4})$/);
      if (m) {
        const month = Number(m[1]);
        if (month >= 1 && month <= 12) return `${m[2]}-${String(month).padStart(2, '0')}-01`;
      }
    }
  }
  return null;
}

export function isTalmudPaymentReport(headers: string[]): boolean {
  const set = new Set(headers.map((h) => h.trim()));
  const hasOrg = ORG_FIELD.some((n) => set.has(n));
  const hasId = FIELDS.studentId.some((n) => set.has(n));
  const hasAmount = FIELDS.amount.some((n) => set.has(n));
  return hasOrg && hasId && hasAmount;
}

// ‎headers‎ אינו פרמטר: השדות נמצאים לפי שם מתוך השורות עצמן, בשתי השפות.
// כך קובץ שבו סדר העמודות שונה נקלט בדיוק אותו דבר.
export function parseTalmudPaymentReport(
  rows: Record<string, string>[],
  preview: string[][]
): TalmudReportParseResult {
  const problems: string[] = [];
  const parsed: TalmudReportRow[] = [];
  const orgNumbers = new Set<string>();
  const branches = new Set<string>();
  let declaredOrgTotal: number | null = null;

  for (const row of rows) {
    const orgRaw = pick(row, ORG_FIELD);
    if (!orgRaw) continue;
    const { orgNumber, orgName, branchCode } = parseOrgField(orgRaw);
    if (!orgNumber) { problems.push(`לא זוהה מספר עמותה בשורה: ${orgRaw.slice(0, 40)}`); continue; }

    orgNumbers.add(orgNumber);
    if (branchCode) branches.add(branchCode);

    // הסכום המוצהר של העמותה, לאימות בהמשך. זהה בכל השורות.
    const declared = parseAmount(pick(row, ['PaymentSum1', 'סה"כ עמותה']));
    if (declared) declaredOrgTotal = declared;

    parsed.push({
      orgNumber,
      orgName,
      branchCode,
      studentId: pick(row, FIELDS.studentId),
      identityType: pick(row, FIELDS.identityType),
      firstName: pick(row, FIELDS.firstName),
      familyName: pick(row, FIELDS.familyName),
      studyCode: pick(row, FIELDS.studyCode),
      eligible: pick(row, FIELDS.eligible).includes('זכאי') && !pick(row, FIELDS.eligible).includes('אינו'),
      amount: parseAmount(pick(row, FIELDS.amount)),
      points: parseAmount(pick(row, FIELDS.points)),
      dateFrom: pick(row, FIELDS.dateFrom),
      dateTo: pick(row, FIELDS.dateTo),
    });
  }

  const withoutId = parsed.filter((r) => !r.studentId).length;
  if (withoutId) problems.push(`${withoutId} שורות בלי מספר זהות`);
  if (orgNumbers.size > 1) {
    problems.push(`הקובץ מכיל ${orgNumbers.size} עמותות שונות: ${[...orgNumbers].join(', ')}`);
  }

  const totalAmount = parsed.reduce((s, r) => s + r.amount, 0);
  if (declaredOrgTotal !== null && Math.abs(totalAmount - declaredOrgTotal) > 0.5) {
    // אי-התאמה בין הסכום המחושב למוצהר פירושה שקראנו את העמודה הלא נכונה
    // או שהקובץ חלקי. זו בדיוק הבדיקה שמונעת קליטה שקטה של סכומים שגויים.
    problems.push(
      `סכום השורות (${totalAmount.toLocaleString('he-IL')}) אינו תואם לסכום שהקובץ מצהיר עליו (${declaredOrgTotal.toLocaleString('he-IL')})`
    );
  }

  return {
    rows: parsed,
    summary: {
      month: parsePaymentMonth(preview),
      orgNumbers: [...orgNumbers],
      branches: [...branches].sort(),
      rowCount: parsed.length,
      eligibleCount: parsed.filter((r) => r.eligible).length,
      totalAmount,
      declaredOrgTotal,
      problems,
    },
  };
}

// ===== איחוד שורות של אותו תלמיד =====
//
// אותו תלמיד יכול להופיע פעמיים תחת שני קודי לימוד - למשל 0.00 בקוד 600
// (אינו זכאי) ו-375.00 בקוד 300 (זכאי). זו התנהגות תקינה של תלמוד ולא
// כפילות.
//
// ‎monthly_eligibility‎ מחזיקה זכאות אחת לתלמיד לחודש, ופונקציית הקליטה
// מסמנת כל רשומה קודמת כ-superseded. כלומר קליטה של שתי השורות בנפרד
// הייתה מוחקת את הראשונה - ומשאירה את הסכום של השנייה בלבד, לפי סדר
// מקרי. לכן מאחדים כאן, לפני הקליטה, וסוכמים.
//
// שורות זהות לגמרי (אותו קוד לימוד) *כן* מדווחות ככפילות אמיתית.
export interface MergedRow extends TalmudReportRow {
  studyCodes: string[];
  branchCodes: string[];
  mergedFrom: number;
}

export interface MergeResult {
  merged: MergedRow[];
  exactDuplicates: string[];
  // מעבר סניף רגיל: התלמיד מופיע בסניף הישן כלא-זכאי ובחדש כזכאי.
  // מידע, לא אזהרה - זו ההתנהגות התקינה של תלמוד.
  transfers: string[];
  // שני סניפים *זכאים* לאותו תלמיד. כאן באמת לא ברור לאן לזקוף, וזו
  // החלטה עסקית שאסור שתיפול בשקט בתוך יבוא.
  ambiguousBranch: string[];
}

export function mergeStudentRows(rows: TalmudReportRow[]): MergeResult {
  const byStudent = new Map<string, MergedRow>();
  const seenExact = new Set<string>();
  const exactDuplicates: string[] = [];
  // הסכום הזכאי הגבוה ביותר שנראה לכל תלמיד, לבחירת הסניף
  const bestBranch = new Map<string, number>();

  for (const r of rows) {
    // כפילות אמיתית = אותה שורה בדיוק, כולל סניף וקוד. שונות בסניף או
    // בקוד היא רישום נפרד ולא טעות.
    const exactKey = `${r.orgNumber}|${r.studentId}|${r.studyCode}|${r.branchCode}|${r.amount}`;
    if (seenExact.has(exactKey)) {
      exactDuplicates.push(`${r.firstName} ${r.familyName} (${r.studentId}), קוד ${r.studyCode}, סניף ${r.branchCode}`);
      continue;
    }
    seenExact.add(exactKey);

    const key = `${r.orgNumber}|${r.studentId}`;
    const existing = byStudent.get(key);
    if (!existing) {
      byStudent.set(key, {
        ...r,
        studyCodes: r.studyCode ? [r.studyCode] : [],
        branchCodes: r.branchCode ? [r.branchCode] : [],
        mergedFrom: 1,
      });
      bestBranch.set(key, r.eligible ? r.amount : -1);
      continue;
    }

    existing.amount += r.amount;
    existing.points += r.points;
    existing.eligible = existing.eligible || r.eligible;
    existing.mergedFrom++;
    if (r.studyCode && !existing.studyCodes.includes(r.studyCode)) existing.studyCodes.push(r.studyCode);
    if (r.branchCode && !existing.branchCodes.includes(r.branchCode)) existing.branchCodes.push(r.branchCode);

    // בחירת הסניף: השורה הזכאית מנצחת.
    //
    // זה אינו כלל אצבע אלא מודל של מה שקורה בפועל. תלמיד שעבר מסניף 01
    // לסניף 02 באותו קוד לימוד מופיע פעמיים: בסניף הישן כלא-זכאי (0.00)
    // ובחדש כזכאי. כלומר *השורה הזכאית היא הסניף הנוכחי*, והלא-זכאית היא
    // איפה שהיה קודם. בחירה לפי "השורה האחרונה שנקראה" הייתה תלויה בסדר
    // מקרי בקובץ ויכולה לזקוף את התלמיד לסניף שעזב.
    const score = r.eligible ? Math.max(r.amount, 0) : -1;
    if (score > (bestBranch.get(key) ?? -1)) {
      bestBranch.set(key, score);
      if (r.branchCode) existing.branchCode = r.branchCode;
    }
  }

  const transfers: string[] = [];
  const ambiguousBranch: string[] = [];
  for (const m of byStudent.values()) {
    if (m.branchCodes.length < 2) continue;
    const eligibleBranches = rows
      .filter((r) => r.orgNumber === m.orgNumber && r.studentId === m.studentId && r.eligible && r.branchCode)
      .map((r) => r.branchCode);
    const distinctEligible = [...new Set(eligibleBranches)];
    const who = `${m.firstName} ${m.familyName} (${m.studentId})`;

    if (distinctEligible.length > 1) {
      ambiguousBranch.push(`${who}: זכאי בשני סניפים (${distinctEligible.join(', ')}) - נזקף ל-${m.branchCode}`);
    } else if (distinctEligible.length === 1) {
      transfers.push(`${who}: ${m.branchCodes.filter((b) => b !== m.branchCode).join(', ')} ← ${m.branchCode}`);
    } else {
      // אף שורה אינה זכאית, ולכן אין סימן לאן הוא שייך היום. הסכום 0
      // בכל מקרה, אבל השיוך שרירותי וצריך להיראות.
      ambiguousBranch.push(`${who}: מופיע בסניפים ${m.branchCodes.join(', ')} ואינו זכאי באף אחד`);
    }
  }

  return { merged: [...byStudent.values()], exactDuplicates, transfers, ambiguousBranch };
}

// המרה לצורה ש-commit_eligibility_batch מצפה לה.
//
// המפתחות בעברית במכוון: זו המוסכמה שכל צינור היבוא במערכת בנוי עליה,
// ופונקציית הקליטה שבמסד קוראת אותם. תרגום כאן פירושו שאין צורך לגעת
// בפונקציה שכבר עובדת בייצור.
export function toImportRow(r: MergedRow): Record<string, string> {
  return {
    'מזהה תלמיד': r.studentId,
    'סכום ברוטו': String(r.amount),
    'ניקוד/סוג תשלום': r.studyCodes.join('+') || r.studyCode,
    // שדות נוספים לתצוגה ולבקרה. אינם נקראים בקליטה, אבל הם מה שמאפשר
    // להסתכל בשורה שנדחתה ולהבין למה.
    'שם': `${r.firstName} ${r.familyName}`.trim(),
    'סוג מזהה': r.identityType,
    'מספר עמותה': r.orgNumber,
    'סניף': r.branchCode,
    'זכאי': r.eligible ? 'כן' : 'לא',
    'ניקוד': String(r.points),
  };
}
