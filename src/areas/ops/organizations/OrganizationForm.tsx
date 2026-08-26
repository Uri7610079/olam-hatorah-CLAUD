import { useState, type FormEvent } from "react";
import { PhoneField } from "@/components/PhoneField";
import { entityNumberWarning } from "@/lib/israeliId";
import { ErrorState } from "@/components/ErrorState";

export interface OrganizationFormValues {
  legal_name: string;
  org_number: string;
  contact_phone: string;
  contact_email: string;
  contact_address: string;
  notes: string;
}

export const EMPTY_ORGANIZATION_FORM: OrganizationFormValues = {
  legal_name: "",
  org_number: "",
  contact_phone: "",
  contact_email: "",
  contact_address: "",
  notes: "",
};

interface OrganizationFormProps {
  initialValues: OrganizationFormValues;
  onSubmit: (values: OrganizationFormValues) => Promise<void>;
  submitLabel: string;
  submitting: boolean;
  error: string | null;
}

export function OrganizationForm({ initialValues, onSubmit, submitLabel, submitting, error }: OrganizationFormProps) {
  const [values, setValues] = useState(initialValues);

  const set = (field: keyof OrganizationFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [field]: e.target.value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await onSubmit(values);
  };

  const orgNumberWarning = entityNumberWarning(values.org_number);


  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="field-label">שם משפטי</label>
        <input required value={values.legal_name} onChange={set("legal_name")} className="input-field" />
      </div>
      <div>
        <label className="field-label">מספר עמותה</label>
        <input
          value={values.org_number}
          onChange={set("org_number")}
          className="input-field tabular"
          aria-describedby={orgNumberWarning ? "org-number-warning" : undefined}
        />
        {/* אזהרה ולא חסימה. ספרת הביקורת ודאית, אבל בדיקת הקידומת (58)
            היא היוריסטיקה - רק הרשם הוא מקור סמכא - ולכן שתיהן מנוסחות
            כהמלצה לבדוק ולא כקביעה שהמספר פסול. */}
        {orgNumberWarning && (
          <p id="org-number-warning" className="mt-1 text-xs text-warn-ink">
            {orgNumberWarning}
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <PhoneField
          id="org-contact-phone"
          value={values.contact_phone}
          onChange={(v) => setValues((prev) => ({ ...prev, contact_phone: v }))}
        />
        <div>
          <label className="field-label">אימייל</label>
          <input type="email" dir="ltr" value={values.contact_email} onChange={set("contact_email")} className="input-field text-right" />
        </div>
      </div>
      <div>
        <label className="field-label">כתובת</label>
        <input value={values.contact_address} onChange={set("contact_address")} className="input-field" />
      </div>
      <div>
        <label className="field-label">הערות</label>
        <textarea rows={2} value={values.notes} onChange={set("notes")} className="input-field" />
      </div>
      {error && <ErrorState message={error} />}
      <button type="submit" disabled={submitting} className="btn-primary w-full">
        {submitting ? "שומרת…" : submitLabel}
      </button>
    </form>
  );
}
