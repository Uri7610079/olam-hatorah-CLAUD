import { useState, type FormEvent } from "react";
import { normalizeIsraeliPhone } from "@/lib/israeliPhone";
import { PhoneField } from "@/components/PhoneField";
import { israeliIdWarning } from "@/lib/israeliId";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { ErrorState } from "@/components/ErrorState";
import { ALL_PASSPORT_COUNTRIES } from "@/lib/passportCountries";
import { TALMUD_VISA_TYPES } from "@/lib/talmudCodes";
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
    marital_status: student.marital_status ?? "",
    study_scope: student.study_scope ?? "",
    first_name: student.first_name ?? "",
    last_name: student.last_name ?? "",
    passport_country: student.passport_country ?? "",
    visa_number: student.visa_number ?? "",
    visa_type: student.visa_type != null ? String(student.visa_type) : "",
    visa_expiry: student.visa_expiry ?? "",
  });
  const passport = values.id_type === "passport";
  // שם פרטי/משפחה: כששניהם מלאים - השם המלא נבנה מהם ("משפחה פרטי")
  const setNamePart = (k: "first_name" | "last_name", val: string) => setValues((v) => {
    const next = { ...v, [k]: val };
    if (next.first_name.trim() && next.last_name.trim()) next.full_name = `${next.last_name.trim()} ${next.first_name.trim()}`;
    return next;
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
        marital_status: values.marital_status || null,
        study_scope: values.marital_status === "married" ? values.study_scope || null : null,
        first_name: values.first_name.trim() || null,
        last_name: values.last_name.trim() || null,
        passport_country: passport ? values.passport_country.trim() || null : null,
        visa_number: passport ? values.visa_number.trim() || null : null,
        visa_type: passport && values.visa_type ? Number(values.visa_type) : null,
        visa_expiry: passport ? values.visa_expiry || null : null,
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
          <label htmlFor="student-last" className="field-label">שם משפחה</label>
          <input id="student-last" value={values.last_name} onChange={(e) => setNamePart("last_name", e.target.value)} className="input-field" />
        </div>
        <div>
          <label htmlFor="student-first" className="field-label">שם פרטי</label>
          <input id="student-first" value={values.first_name} onChange={(e) => setNamePart("first_name", e.target.value)} className="input-field" />
        </div>
      </div>
      {!values.first_name.trim() && !values.last_name.trim() && (
        <p className="-mt-2 text-xs text-ink-subtle">בקובץ לתלמוד השם נכתב בשתי עמודות. כל עוד אלה ריקים, השם המלא מפוצל אוטומטית: המילה הראשונה - שם משפחה.</p>
      )}
      {passport && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="student-country" className="field-label">ארץ הדרכון</label>
            <input id="student-country" list="student-countries" value={values.passport_country}
              onChange={(e) => setValues((v) => ({ ...v, passport_country: e.target.value }))} className="input-field" />
            <datalist id="student-countries">{ALL_PASSPORT_COUNTRIES.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="student-visa-type" className="field-label">סוג אשרה</label>
            <select id="student-visa-type" value={values.visa_type} onChange={(e) => setValues((v) => ({ ...v, visa_type: e.target.value }))} className="input-field">
              <option value="">—</option>
              {TALMUD_VISA_TYPES.map((t) => <option key={t.code} value={String(t.code)}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="student-visa-number" className="field-label">מספר אשרה</label>
            <input id="student-visa-number" dir="ltr" value={values.visa_number} onChange={(e) => setValues((v) => ({ ...v, visa_number: e.target.value }))} className="input-field tabular text-right" />
          </div>
          <div>
            <label htmlFor="student-visa-expiry" className="field-label">תוקף אשרה</label>
            <input id="student-visa-expiry" type="date" value={values.visa_expiry} onChange={(e) => setValues((v) => ({ ...v, visa_expiry: e.target.value }))} className="input-field" />
          </div>
        </div>
      )}
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
      {/* מצב משפחתי והיקף לימוד - נקבעים בפורטל ראשי הקבוצות בהוספת תלמיד, וקובעים את קוד הלימוד */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="student-marital" className="field-label">מצב משפחתי</label>
          <select id="student-marital" value={values.marital_status}
            onChange={(e) => setValues((v) => ({ ...v, marital_status: e.target.value, study_scope: e.target.value === "married" ? v.study_scope : "" }))}
            className="input-field">
            <option value="">—</option>
            <option value="single">בחור</option>
            <option value="married">נשוי</option>
          </select>
        </div>
        {values.marital_status === "married" && (
          <div>
            <label htmlFor="student-scope" className="field-label">היקף לימוד</label>
            <select id="student-scope" value={values.study_scope} onChange={(e) => setValues((v) => ({ ...v, study_scope: e.target.value }))} className="input-field">
              <option value="">—</option>
              <option value="full_day">יום שלם</option>
              <option value="half_day_morning">חצי יום בוקר</option>
              <option value="half_day_afternoon">חצי יום אחה"צ</option>
            </select>
          </div>
        )}
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
