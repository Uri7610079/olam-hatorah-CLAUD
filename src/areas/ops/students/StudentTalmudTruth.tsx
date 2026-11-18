import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";

// כרטיס התלמיד: תלמוד = מערכת האמת (מיגרציה 122).
//  * "חסר נתון" - מה שתלמוד לא יודע ונחוץ לעבודה (student_missing_data).
//  * מה תלמוד שינה בכרטיס, ומתי (student_talmud_changes).

const FIELD_LABEL: Record<string, string> = {
  created: "נוצר",
  status: "סטטוס",
  first_name: "שם פרטי",
  last_name: "שם משפחה",
  full_name: "שם מלא",
  birth_date: "תאריך לידה",
  marital_status: "מצב משפחתי",
  gender: "מגדר",
  study_code: "קוד לימוד",
  passport_country: "מדינת דרכון",
  talmud_start_date: "תחילת לימודים בתלמוד",
  talmud_end_date: "סיום לימודים בתלמוד",
  id_type: "סוג זיהוי",
  external_id: "ת.ז./דרכון",
};

const VALUE_LABEL: Record<string, string> = {
  single: "בחור", married: "נשוי", divorced: "גרוש", widowed: "אלמן",
  israeli_id: "תעודת זהות", passport: "דרכון",
  draft: "טיוטה", ready_for_talmud: "מוכן לתלמוד", sent_to_talmud: "נשלח לתלמוד", active: "פעיל",
};

const show = (v: string | null) => (v == null || v === "" ? "—" : VALUE_LABEL[v] ?? (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split("-").reverse().join("/") : v));
const monthText = (iso: string | null) => (iso ? iso.slice(0, 7).split("-").reverse().join("/") : "");

export function useStudentMissingData(studentId: string) {
  return useQuery({
    queryKey: ["student-missing-data", studentId],
    queryFn: async () => {
      const { data, error } = await supabase.from("student_missing_data").select("missing").eq("student_id", studentId).maybeSingle();
      if (error) throw error;
      return (data?.missing as string[] | undefined) ?? [];
    },
  });
}

export function StudentTalmudTruth({ studentId, createdFromTalmud }: { studentId: string; createdFromTalmud?: boolean | null }) {
  const missing = useStudentMissingData(studentId);
  const changes = useQuery({
    queryKey: ["student-talmud-changes", studentId],
    queryFn: async () => {
      const { data, error } = await supabase.from("student_talmud_changes")
        .select("id, field, old_value, new_value, month, created_at")
        .eq("student_id", studentId).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
  const list = missing.data ?? [];
  const log = changes.data ?? [];

  return (
    <>
      {list.length > 0 && (
        <p className="mb-4 flex items-start gap-2 rounded-control bg-danger-soft p-3 text-sm text-danger-ink" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-semibold">חסר נתון: </span>
            {list.join(", ")}
            {list.includes("ראש קבוצה") && " · השיוך נעשה בלשונית \"שיוך\" או במסך השיוך המרוכז"}
          </span>
        </p>
      )}
      {log.length > 0 && (
        <details className="mb-4 rounded-control border border-line p-3 text-sm">
          <summary className="cursor-pointer text-ink-muted">
            {createdFromTalmud ? "נוצר אוטומטית מדוח תלמוד · " : ""}
            עודכן לפי תלמוד ({log.filter((c) => c.field !== "created").length} שינויים)
          </summary>
          <table className="mt-2 w-full text-right">
            <thead className="text-xs text-ink-subtle">
              <tr><th className="py-1 font-medium">חודש הדוח</th><th className="font-medium">שדה</th><th className="font-medium">היה</th><th className="font-medium">נהיה</th></tr>
            </thead>
            <tbody>
              {log.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="py-1 tabular">{monthText(c.month)}</td>
                  <td>{FIELD_LABEL[c.field] ?? c.field}</td>
                  <td className="tabular text-ink-muted">{c.field === "created" ? "" : show(c.old_value)}</td>
                  <td className="tabular">{c.field === "created" ? "נוצר מדוח תלמוד" : show(c.new_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </>
  );
}
