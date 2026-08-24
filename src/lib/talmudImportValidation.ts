import { supabase } from "./supabase";
import type { TalmudImportInfo } from "./importBatches";

// בדיקת תקינות של דוח תלמוד מול הנתונים שכבר במערכת, *לפני* הקליטה.
//
// למה זה קיים: פונקציית הקליטה שבמסד דוחה שורה בשקט יחסי - היא מסמנת
// אותה כ-invalid עם הודעה, וסופרת. כלומר אפשר לקלוט אצווה של 1,948
// שורות ולגלות רק אחר כך ש-300 מהן לא נכנסו, ולמה.
//
// הבדיקה כאן מריצה מראש בדיוק את אותן שאלות שהקליטה תשאל, ומראה את
// התשובה לפני שנוגעים בנתונים. אין כאן ניחוש: כל בדיקה מכוונת לתנאי
// שקיים בפועל ב-commit_eligibility_batch.
//
// ארבע רמות, כפי שהן בנויות במערכת: עמותה → סניף → קבוצה → תלמיד.

export interface MissingStudent {
  externalId: string;
  name: string;
  branchCode: string;
  amount: number;
}

export interface BranchMismatch {
  externalId: string;
  name: string;
  fileBranch: string;
  systemBranch: string;
}

export interface TalmudValidationReport {
  // עמותה
  orgId: string | null;
  orgName: string | null;
  orgNumber: string | null;

  // סניפים
  fileBranches: string[];
  missingBranches: string[];

  // תלמידים
  totalRows: number;
  matchedStudents: number;
  missingStudents: MissingStudent[];
  withoutAssignment: MissingStudent[];
  branchMismatches: BranchMismatch[];

  // סיכום כספי: כמה מהכסף באמת ייכנס
  totalAmount: number;
  amountThatWillCommit: number;

  blocked: boolean;
  blockReason: string | null;
}

// שאילתת ‎in‎ עם אלפי ערכים חורגת מאורך כתובת מותר. הפיצול אינו אופטימיזציה
// אלא תנאי לעבודה: קובץ של ברכת אלימלך מכיל 1,935 תלמידים.
const CHUNK = 200;

async function inChunks<T>(values: string[], run: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < values.length; i += CHUNK) {
    out.push(...(await run(values.slice(i, i + CHUNK))));
  }
  return out;
}

export async function validateTalmudImport(
  info: TalmudImportInfo,
  rows: Record<string, string>[]
): Promise<TalmudValidationReport> {
  const report: TalmudValidationReport = {
    orgId: null,
    orgName: null,
    orgNumber: info.orgNumber,
    fileBranches: [],
    missingBranches: [],
    totalRows: rows.length,
    matchedStudents: 0,
    missingStudents: [],
    withoutAssignment: [],
    branchMismatches: [],
    totalAmount: info.totalAmount,
    amountThatWillCommit: 0,
    blocked: false,
    blockReason: null,
  };

  // ===== 1. עמותה =====
  if (!info.orgNumber) {
    report.blocked = true;
    report.blockReason = "לא זוהה מספר עמותה בקובץ";
    return report;
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("id, legal_name")
    .eq("org_number", info.orgNumber)
    .maybeSingle();

  if (!org) {
    report.blocked = true;
    report.blockReason = `עמותה ${info.orgNumber} אינה קיימת במערכת. יש להוסיף אותה לפני הקליטה.`;
    return report;
  }
  report.orgId = org.id;
  report.orgName = org.legal_name;

  // ===== 2. סניפים =====
  const fileBranches = [...new Set(rows.map((r) => r["סניף"]).filter(Boolean))].sort();
  report.fileBranches = fileBranches;

  const { data: branches } = await supabase
    .from("branches")
    .select("id, talmud_branch_code")
    .eq("organization_id", org.id);

  const knownBranches = new Set((branches ?? []).map((b) => b.talmud_branch_code));
  report.missingBranches = fileBranches.filter((b) => !knownBranches.has(b));

  // ===== 3. תלמידים =====
  const ids = [...new Set(rows.map((r) => r["מזהה תלמיד"]).filter(Boolean))];

  const students = await inChunks(ids, async (chunk) => {
    const { data } = await supabase.from("students").select("id, external_id, full_name").in("external_id", chunk);
    return data ?? [];
  });
  const byExternalId = new Map(students.map((s) => [s.external_id, s]));

  // ===== 4. שיוך פעיל (קבוצה וסניף) =====
  //
  // זה התנאי שדוחה הכי הרבה שורות בפועל: הקליטה קוראת את הסניף והקבוצה
  // מהשיוך הפעיל, ותלמיד בלי שיוך נדחה - גם אם הוא קיים במערכת.
  const studentIds = students.map((s) => s.id);
  const assignments = await inChunks(studentIds, async (chunk) => {
    const { data } = await supabase
      .from("student_assignments")
      .select("student_id, branch_id, group_id, branch:branches(talmud_branch_code)")
      .eq("is_active", true)
      .in("student_id", chunk);
    return data ?? [];
  });
  const assignmentByStudent = new Map(
    assignments.map((a) => {
      const branch = Array.isArray(a.branch) ? a.branch[0] : a.branch;
      return [a.student_id as string, { branchCode: branch?.talmud_branch_code ?? null }];
    })
  );

  // ===== סיכום =====
  for (const row of rows) {
    const externalId = row["מזהה תלמיד"];
    const amount = Number(row["סכום ברוטו"]) || 0;
    const entry: MissingStudent = {
      externalId,
      name: row["שם"] ?? "",
      branchCode: row["סניף"] ?? "",
      amount,
    };

    const student = byExternalId.get(externalId);
    if (!student) {
      report.missingStudents.push(entry);
      continue;
    }

    const assignment = assignmentByStudent.get(student.id);
    if (!assignment) {
      report.withoutAssignment.push(entry);
      continue;
    }

    report.matchedStudents++;
    report.amountThatWillCommit += amount;

    // הסניף שבקובץ מול הסניף שבמערכת. אינו חוסם - הקליטה משתמשת בשיוך
    // שבמערכת - אבל פער כאן פירושו שהשיוך אצלנו לא עודכן אחרי מעבר,
    // והזכאות תיזקף לסניף הלא נכון בדוחות.
    if (assignment.branchCode && entry.branchCode && assignment.branchCode !== entry.branchCode) {
      report.branchMismatches.push({
        externalId,
        name: entry.name,
        fileBranch: entry.branchCode,
        systemBranch: assignment.branchCode,
      });
    }
  }

  return report;
}
