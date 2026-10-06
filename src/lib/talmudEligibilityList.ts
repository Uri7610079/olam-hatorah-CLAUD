// קליטת "דוח זכאים" מתלמוד - "רשימת תלמידים לפי חודש דיווח" (rptStudentsCountByMonth).
//
// זה לא "דוח דרישת תשלום" (talmudPaymentReport.ts): אין בו סכומים בכלל. יש בו, לכל
// תלמיד בעמותה, האם הוא "זכאי" או "אינו זכאי" בחודש הדיווח. משמש בעיקר כדי לדעת
// למי לשלוח התראה טלפונית לפני ביקורת - רק לזכאים.
//
// מבנה הקובץ (נבדק על קובץ אמיתי - ברכת אלימלך, 09/2026, 1,573 תלמידים):
//   * בראש הקובץ: שם העמותה וח.פ. באותה שורה ("ח.פ. עמותה:"), וחודש הדיווח בשורה
//     שבה כתוב "חודש" ולידו "09/2026".
//   * אחר כך חלק נפרד לכל סניף: שורה "סניף" + קוד ("00"), שורת כותרות שמתחילה
//     ב"מצב זכאות", שורות התלמידים, ושורת "סה"כ לסניף" עם מספר התלמידים.
//   * בסוף: "סה"כ לחודש" עם מספר התלמידים בכל העמותה.
// המספרים שהקובץ מצהיר עליהם נבדקים מול מה שנקרא בפועל, כדי ששורה שלא נקראה לא
// תיעלם בשקט.

export interface EligibilityListRow {
  branchCode: string;
  eligible: boolean;
  statusText: string;
  externalId: string;
  idType: string;
  firstName: string;
  lastName: string;
  studyCode: string;
  startDate: string | null; // ISO
  endDate: string | null; // הטקסט כפי שהוא - לפעמים עם שעה
  birthDate: string | null; // ISO
  maritalStatus: string;
  gender: string;
  origin: string;
}

export interface EligibilityListParseResult {
  orgNumber: string | null;
  orgName: string | null;
  month: string | null; // "2026-09-01"
  rows: EligibilityListRow[];
  branches: { code: string; eligible: number; notEligible: number; declared: number | null }[];
  declaredTotal: number | null;
  problems: string[];
}

const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const norm = (v: unknown) => clean(v).replace(/[״”“]/g, '"').replace(/\s*\/\s*/g, "/");

const HEADER = {
  status: ["מצב זכאות"],
  endDate: ["תאריך סיום"],
  startDate: ["תאריך התחלה"],
  studyCode: ["סוג לימוד"],
  maritalStatus: ["מצב משפחתי"],
  gender: ["מגדר"],
  birthDate: ["תאריך לידה"],
  firstName: ["שם פרטי"],
  lastName: ["שם משפחה"],
  origin: ["מוצא"],
  externalId: ["ת.ז./דרכון", "ת.ז/דרכון", "תעודת זהות/דרכון"],
  idType: ["סוג זיהוי"],
} as const;

type HeaderKey = keyof typeof HEADER;

/** האם זה דוח זכאים: יש שורת כותרות עם "מצב זכאות", ת.ז/דרכון ו"סוג זיהוי". */
export function isTalmudEligibilityList(matrix: string[][]): boolean {
  return matrix.some((row) => {
    const cells = row.map(norm);
    return cells.includes("מצב זכאות") && cells.includes("סוג זיהוי") && HEADER.externalId.some((h) => cells.includes(h));
  });
}

/** "10/11/2024" -> "2024-11-10". כל צורה אחרת -> null. */
export function dmyToIso(value: string): string | null {
  const m = clean(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function firstNumber(row: string[]): number | null {
  for (const c of row) {
    const t = clean(c);
    if (/^\d+$/.test(t)) return Number(t);
  }
  return null;
}

export function parseTalmudEligibilityList(matrix: string[][]): EligibilityListParseResult {
  const problems: string[] = [];
  let orgNumber: string | null = null;
  let orgName: string | null = null;
  let month: string | null = null;
  let declaredTotal: number | null = null;

  const rows: EligibilityListRow[] = [];
  const declaredByBranch = new Map<string, number>();
  let branch = "";
  let cols: Partial<Record<HeaderKey, number>> | null = null;

  for (const raw of matrix) {
    const cells = raw.map(norm);
    const nonEmpty = cells.filter(Boolean);
    if (nonEmpty.length === 0) continue;

    // ח.פ. ושם העמותה - באותה שורה עם "ח.פ. עמותה:"
    if (!orgNumber && cells.some((c) => c.includes("ח.פ"))) {
      const num = nonEmpty.find((c) => /^\d{9}$/.test(c));
      if (num) {
        orgNumber = num;
        orgName = nonEmpty.find((c) => !/\d/.test(c) && !c.includes("ח.פ") && c !== "שם:") ?? null;
        continue;
      }
    }

    // חודש הדיווח: "חודש" ולידו MM/YYYY
    if (cells.includes("חודש")) {
      const mm = nonEmpty.find((c) => /^\d{2}\/\d{4}$/.test(c));
      if (mm) {
        const [m, y] = mm.split("/");
        const iso = `${y}-${m}-01`;
        if (month && month !== iso) problems.push(`בקובץ מופיעים שני חודשים שונים (${month.slice(0, 7)} ו-${iso.slice(0, 7)}).`);
        month ??= iso;
        continue;
      }
    }

    // תחילת חלק של סניף: "סניף" + קוד
    if (cells.includes("סניף")) {
      const code = nonEmpty.find((c) => /^\d{1,3}$/.test(c));
      if (code) {
        branch = code.padStart(2, "0");
        cols = null;
        continue;
      }
    }

    // שורת כותרות של הסניף
    if (cells.includes("מצב זכאות")) {
      cols = {};
      for (const key of Object.keys(HEADER) as HeaderKey[]) {
        const idx = cells.findIndex((c) => (HEADER[key] as readonly string[]).includes(c));
        if (idx >= 0) cols[key] = idx;
      }
      if (cols.status === undefined || cols.externalId === undefined) {
        problems.push(`בסניף ${branch || "?"} לא נמצאו העמודות "מצב זכאות" ו"ת.ז. / דרכון".`);
        cols = null;
      }
      continue;
    }

    // סיכומים שהקובץ מצהיר עליהם
    // "36 | 00 | סה"כ לסניף": מספר התלמידים וקוד הסניף באותה שורה. מוציאים את קוד
    // הסניף הנוכחי, ומה שנשאר הוא המספר.
    if (cells.some((c) => c.startsWith('סה"כ לסניף'))) {
      const nums = cells.filter((c) => /^\d+$/.test(c));
      const codeIdx = nums.lastIndexOf(nums.find((c) => c.padStart(2, "0") === branch && c.length <= 3) ?? "\u0000");
      if (codeIdx >= 0) nums.splice(codeIdx, 1);
      if (branch && nums.length > 0) declaredByBranch.set(branch, Number(nums[0]));
      cols = null;
      continue;
    }
    if (cells.some((c) => c.startsWith('סה"כ לחודש'))) {
      declaredTotal = firstNumber(cells.filter((c) => !/\//.test(c)));
      continue;
    }

    if (!cols) continue;
    const get = (k: HeaderKey) => (cols![k] === undefined ? "" : clean(raw[cols![k]!]));
    const status = get("status");
    const externalId = get("externalId");
    if (!status || !externalId) continue;
    if (status !== "זכאי" && status !== "אינו זכאי") continue;

    rows.push({
      branchCode: branch,
      eligible: status === "זכאי",
      statusText: status,
      externalId: externalId.toUpperCase(),
      idType: get("idType"),
      firstName: get("firstName"),
      lastName: get("lastName"),
      studyCode: get("studyCode"),
      startDate: dmyToIso(get("startDate")),
      endDate: get("endDate") || null,
      birthDate: dmyToIso(get("birthDate")),
      maritalStatus: get("maritalStatus"),
      gender: get("gender"),
      origin: get("origin"),
    });
  }

  if (!orgNumber) problems.push("לא נמצא בקובץ מספר העמותה (ח.פ.).");
  if (!month) problems.push("לא נמצא בקובץ חודש הדיווח.");
  if (rows.length === 0) problems.push("לא נמצאו בקובץ שורות תלמידים.");

  const byBranch = new Map<string, { eligible: number; notEligible: number }>();
  for (const r of rows) {
    const b = byBranch.get(r.branchCode) ?? { eligible: 0, notEligible: 0 };
    if (r.eligible) b.eligible++;
    else b.notEligible++;
    byBranch.set(r.branchCode, b);
  }
  const branches = [...byBranch.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, c]) => ({ code, ...c, declared: declaredByBranch.get(code) ?? null }));

  for (const b of branches) {
    if (b.declared !== null && b.declared !== b.eligible + b.notEligible) {
      problems.push(`בסניף ${b.code} הקובץ מצהיר על ${b.declared} תלמידים, ונקראו ${b.eligible + b.notEligible}.`);
    }
  }
  if (declaredTotal !== null && declaredTotal !== rows.length) {
    problems.push(`הקובץ מצהיר על ${declaredTotal} תלמידים בסך הכול, ונקראו ${rows.length}.`);
  }

  return { orgNumber, orgName, month, rows, branches, declaredTotal, problems };
}
