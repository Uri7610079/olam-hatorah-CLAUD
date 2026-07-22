import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { ErrorState } from "@/components/ErrorState";
import { ID_TYPE_LABEL, type Student, type StudentIdType } from "./types";

interface StudentDetailsTabProps {
  student: Student;
}

export function StudentDetailsTab({ student }: StudentDetailsTabProps) {
  const queryClient = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("students", "manage");
  const [values, setValues] = useState({
    id_type: student.id_type,
    external_id: student.external_id,
    full_name: student.full_name,
    birth_date: student.birth_date ?? "",
    phone: student.phone_raw ?? "",
    address: student.address ?? "",
    student_type: student.student_type ?? "",
    study_code: student.study_code ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const phoneDigits = values.phone.replace(/\D/g, "");
    const { error } = await supabase
      .from("students")
      .update({
        id_type: values.id_type,
        external_id: values.external_id,
        full_name: values.full_name,
        birth_date: values.birth_date || null,
        phone_raw: values.phone || null,
        phone_normalized: phoneDigits || null,
        address: values.address || null,
        student_type: values.student_type || null,
        study_code: values.study_code || null,
      })
      .eq("id", student.id);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["student", student.id] });
    queryClient.invalidateQueries({ queryKey: ["students"] });
  };

  if (!canManage) {
    return (
      <div className="card max-w-xl space-y-2 p-5 text-sm text-slate-600">
        <p>
          <span className="font-medium text-slate-800">מזהה:</span> {ID_TYPE_LABEL[student.id_type]} {student.external_id}
        </p>
        <p>
          <span className="font-medium text-slate-800">שם מלא:</span> {student.full_name}
        </p>
        <p>
          <span className="font-medium text-slate-800">טלפון:</span> {student.phone_raw ?? "—"}
        </p>
        <p>
          <span className="font-medium text-slate-800">כתובת:</span> {student.address ?? "—"}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="max-w-xl space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="field-label">סוג מזהה</label>
          <select
            value={values.id_type}
            onChange={(e) => setValues((v) => ({ ...v, id_type: e.target.value as StudentIdType }))}
            className="input-field"
          >
            {Object.entries(ID_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">מספר מזהה</label>
          <input
            required
            value={values.external_id}
            onChange={(e) => setValues((v) => ({ ...v, external_id: e.target.value }))}
            className="input-field tabular"
          />
        </div>
      </div>
      <div>
        <label className="field-label">שם מלא</label>
        <input required value={values.full_name} onChange={(e) => setValues((v) => ({ ...v, full_name: e.target.value }))} className="input-field" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="field-label">תאריך לידה</label>
          <input type="date" value={values.birth_date} onChange={(e) => setValues((v) => ({ ...v, birth_date: e.target.value }))} className="input-field" />
        </div>
        <div>
          <label className="field-label">טלפון</label>
          <input value={values.phone} onChange={(e) => setValues((v) => ({ ...v, phone: e.target.value }))} className="input-field" />
        </div>
      </div>
      <div>
        <label className="field-label">כתובת</label>
        <input value={values.address} onChange={(e) => setValues((v) => ({ ...v, address: e.target.value }))} className="input-field" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="field-label">סוג תלמיד</label>
          <input value={values.student_type} onChange={(e) => setValues((v) => ({ ...v, student_type: e.target.value }))} className="input-field" />
        </div>
        <div>
          <label className="field-label">קוד לימוד</label>
          <input value={values.study_code} onChange={(e) => setValues((v) => ({ ...v, study_code: e.target.value }))} className="input-field tabular" />
        </div>
      </div>
      <p className="text-xs text-slate-400">
        סוג תלמיד וקוד לימוד הם טקסט חופשי כרגע — יהפכו לרשימות סגורות משלב 5 (הגדרות מערכת וקודי לימוד).
      </p>
      {error && <ErrorState message={error} />}
      <button type="submit" disabled={saving} className="btn-primary">
        {saving ? "שומרת…" : "שמירה"}
      </button>
    </form>
  );
}
