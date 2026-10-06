import { supabase } from "./supabase";
import { fetchAllIn } from "./fetchAll";
import type { TalmudSource } from "./talmudFile";

// הנתונים לשורות של קובץ תלמוד: פרטי התלמיד, ותאריכי הכניסה והעזיבה מהשיוך.

export interface TalmudTarget {
  studentId: string;
  /** הקבוצה שבה נקלט - תאריך הכניסה נלקח מהשיוך אליה */
  groupId?: string | null;
  /** תלמיד שעזב: תאריך העזיבה */
  exitDate?: string | null;
}

interface StudentRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  id_type: string;
  external_id: string;
  passport_country: string | null;
  birth_date: string | null;
  marital_status: string | null;
  study_code: string | null;
  visa_number: string | null;
  visa_type: number | null;
  visa_expiry: string | null;
}
interface AssignmentRow {
  student_id: string;
  group_id: string | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
}

function pickAssignment(rows: AssignmentRow[], t: TalmudTarget): AssignmentRow | undefined {
  const latest = (list: AssignmentRow[]) =>
    [...list].sort((a, b) => Number(b.is_active) - Number(a.is_active) || String(b.start_date ?? "").localeCompare(String(a.start_date ?? "")))[0];
  if (t.groupId) {
    const inGroup = rows.filter((a) => a.group_id === t.groupId);
    if (inGroup.length) return latest(inGroup);
  }
  if (t.exitDate) {
    const ended = rows.filter((a) => a.end_date === t.exitDate);
    if (ended.length) return latest(ended);
  }
  return latest(rows);
}

export interface LoadedSource {
  source: TalmudSource;
  /** הקבוצה של השיוך שממנו נלקחו התאריכים - קובעת עמותה וסניף */
  groupId: string | null;
}

/** מקור לכל יעד, באותו סדר. יעד שהתלמיד שלו לא נמצא - null. */
export async function loadTalmudSources(targets: TalmudTarget[]): Promise<(LoadedSource | null)[]> {
  const ids = [...new Set(targets.map((t) => t.studentId))];
  if (!ids.length) return [];

  const [students, assignments, talmudNames] = await Promise.all([
    fetchAllIn<StudentRow>(ids, (chunk) => supabase.from("students")
      .select("id, first_name, last_name, full_name, id_type, external_id, passport_country, birth_date, marital_status, study_code, visa_number, visa_type, visa_expiry")
      .in("id", chunk).order("id")),
    fetchAllIn<AssignmentRow>(ids, (chunk) => supabase.from("student_assignments")
      .select("student_id, group_id, start_date, end_date, is_active")
      .in("student_id", chunk).order("id")),
    // שם פרטי ושם משפחה כפי שהם רשומים בתלמוד (דוח הזכאים, מיגרציה 116) - המקור
    // הכי טוב לתלמיד שאין לו שדות נפרדים בכרטיס. אם הדוח לא זמין - פשוט בלי.
    fetchAllIn<{ student_id: string; first_name: string | null; last_name: string | null }>(ids, (chunk) =>
      supabase.from("talmud_eligibility_list_rows").select("student_id, first_name, last_name")
        .in("student_id", chunk).not("first_name", "is", null).not("last_name", "is", null).order("id"))
      .catch(() => []),
  ]);

  const byId = new Map(students.map((s) => [s.id, s]));
  const assignmentsOf = new Map<string, AssignmentRow[]>();
  for (const a of assignments) {
    const list = assignmentsOf.get(a.student_id) ?? [];
    list.push(a);
    assignmentsOf.set(a.student_id, list);
  }
  const namesOf = new Map<string, { first: string; last: string }>();
  for (const n of talmudNames) {
    if (n.first_name?.trim() && n.last_name?.trim()) namesOf.set(n.student_id, { first: n.first_name.trim(), last: n.last_name.trim() });
  }

  return targets.map((t) => {
    const s = byId.get(t.studentId);
    if (!s) return null;
    const a = pickAssignment(assignmentsOf.get(t.studentId) ?? [], t);
    const hasOwn = Boolean(s.first_name?.trim() && s.last_name?.trim());
    const fromTalmud = hasOwn ? undefined : namesOf.get(s.id);
    const source: TalmudSource = {
      first_name: hasOwn ? s.first_name : fromTalmud?.first ?? null,
      last_name: hasOwn ? s.last_name : fromTalmud?.last ?? null,
      full_name: s.full_name,
      id_type: s.id_type,
      external_id: s.external_id,
      passport_country: s.passport_country,
      birth_date: s.birth_date,
      marital_status: s.marital_status,
      study_code: s.study_code,
      entry_date: a?.start_date ?? null,
      exit_date: t.exitDate ?? null,
      visa_number: s.visa_number,
      visa_type: s.visa_type,
      visa_expiry: s.visa_expiry,
    };
    return { source, groupId: a?.group_id ?? t.groupId ?? null };
  });
}

/** הורדת קובץ xls לדפדפן */
export function downloadXls(data: ArrayBuffer, fileName: string) {
  const url = URL.createObjectURL(new Blob([data], { type: "application/vnd.ms-excel" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
