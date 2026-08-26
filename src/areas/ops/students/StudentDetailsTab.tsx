import { useState, type FormEvent } from "react";
import { normalizeIsraeliPhone } from "@/lib/israeliPhone";
import { PhoneField } from "@/components/PhoneField";
import { israeliIdWarning } from "@/lib/israeliId";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { ErrorState } from "@/components/ErrorState";
import { formatStudentAddress, ID_TYPE_LABEL, type Student, type StudentIdType } from "./types";

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
    address_street: student.address_street ?? "",
    address_house_number: student.address_house_number ?? "",
    address_city: student.address_city ?? "",
    student_type: student.student_type ?? "",
    study_code: student.study_code ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idWarning = israeliIdWarning(values.external_id, values.id_type as "israeli_id" | "passport" | "other");

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    // הצורה הקנונית ולא ספרות-בלבד: phone_normalized הוא מה שההתאמה
    // לרשימות הטלפון משווה, ו-"+972521234567" מול "0521234567" הם אותו
    // אדם ששתי מחרוזות שונות מייצגות.
    const phoneDigits = normalizeIsraeliPhone(values.phone);
    const { error } = await supabase
      .from("students")
      .update({
        id_type: values.id_type,
        external_id: values.external_id,
        full_name: values.full_name,
        birth_date: values.birth_date || null,
        phone_raw: values.phone || null,
        phone_normalized: phoneDigits || null,
        address_street: values.address_street || null,
        address_house_number: values.address_house_number || null,
        address_city: values.address_city || null,
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
      <div className="card max-w-xl space-y-2 p-5 text-sm text-ink-muted">
        <p>
          <span className="font-medium text-ink">מזהה:</span> {ID_TYPE_LABEL[student.id_type]}{" "}
          <span className="ltr-num">{student.external_id}</span>
        </p>
        <p>
          <span className="font-medium text-ink">שם מלא:</span> {student.full_name}
        </p>
        <p>
          <span className="font-medium text-ink">טלפון:</span> <span className="ltr-num">{student.phone_raw ?? "—"}</span>
        </p>
        <p>
          <span className="font-medium text-ink">כתובת:</span> {formatStudentAddress(student)}
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
            aria-describedby={idWarning ? "external-id-warning" : undefined}
          />
          {/* אזהרה ולא חסימה: ספרת ביקורת שגויה היא כמעט תמיד טעות הקלדה,
              אבל היא לא אמורה לעצור עבודה. ההסבר אומר מה יקרה בפועל -
              תלמיד כזה לא יותאם לדוח של תלמוד והכסף שלו לא ייכנס - כי
              "מספר לא תקין" לבדו לא מסביר למה זה משנה. */}
          {idWarning && (
            <p id="external-id-warning" className="mt-1 text-xs text-warn-ink">
              {idWarning}
            </p>
          )}
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
        <PhoneField
          id="student-phone"
          value={values.phone}
          onChange={(v) => setValues((prev) => ({ ...prev, phone: v }))}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className="field-label">רחוב</label>
          <input value={values.address_street} onChange={(e) => setValues((v) => ({ ...v, address_street: e.target.value }))} className="input-field" />
        </div>
        <div>
          <label className="field-label">מספר בית</label>
          <input value={values.address_house_number} onChange={(e) => setValues((v) => ({ ...v, address_house_number: e.target.value }))} className="input-field" />
        </div>
        <div>
          <label className="field-label">עיר</label>
          <input value={values.address_city} onChange={(e) => setValues((v) => ({ ...v, address_city: e.target.value }))} className="input-field" />
        </div>
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
      <p className="text-xs text-ink-subtle">
        סוג תלמיד וקוד לימוד הם טקסט חופשי כרגע — יהפכו לרשימות סגורות משלב 5 (הגדרות מערכת וקודי לימוד).
      </p>
      {error && <ErrorState message={error} />}
      <button type="submit" disabled={saving} className="btn-primary">
        {saving ? "שומרת…" : "שמירה"}
      </button>
    </form>
  );
}
