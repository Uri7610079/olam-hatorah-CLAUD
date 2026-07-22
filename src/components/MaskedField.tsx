import { useState } from "react";

interface MaskedFieldProps {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  id?: string;
}

// שדה קלט לערך רגיש (למשל מספר חשבון בנק): מוסתר כברירת מחדל, עם toggle מקומי בצד הלקוח.
// שונה מ-SensitiveValue: זהו שדה טופס (קריאה/עריכה), לא חשיפה בבקשת שרת נפרדת.
export function MaskedField({ label, value, onChange, readOnly, id }: MaskedFieldProps) {
  const [visible, setVisible] = useState(false);
  const fieldId = id ?? `masked-${label}`;

  return (
    <div>
      <label htmlFor={fieldId} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={fieldId}
          type={visible ? "text" : "password"}
          autoComplete="off"
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange?.(e.target.value)}
          className="tabular w-full max-w-xs rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          className="text-xs text-blue-600 underline hover:text-blue-800"
        >
          {visible ? "הסתר" : "הצג"}
        </button>
      </div>
    </div>
  );
}
