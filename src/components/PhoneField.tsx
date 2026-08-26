import { useState } from "react";
import { formatIsraeliPhone, israeliPhoneWarning, normalizeIsraeliPhone } from "@/lib/israeliPhone";

// שדה טלפון אחד לכל המערכת.
//
// הוא קיים כרכיב ולא כפונקציה כי הנרמול לבדו לא מספיק: צריך גם להחליט
// *מתי* לנרמל. נרמול בכל הקלדה קופץ לאדם מתחת לאצבעות - הוא מקליד 05
// והשדה כבר מסדר לו את המספר. לכן הנרמול קורה ביציאה מהשדה בלבד, וזה
// גם הרגע שבו האזהרה מופיעה: אין טעם לומר "חסרות ספרות" למי שעדיין
// באמצע ההקלדה.
//
// מה נשמר הוא הצורה הקנונית (0521234567) ולא מה שהוקלד. ההתאמה בין
// תלמידים לרשימות טלפון משווה מחרוזות ישירות, ושמירה של "052-1234567"
// לצד "+972521234567" פירושה שאותו אדם לא יימצא.

interface PhoneFieldProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  id?: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
}

export function PhoneField({
  value,
  onChange,
  label = "טלפון",
  id,
  required,
  placeholder = "050-1234567",
  className,
}: PhoneFieldProps) {
  const [touched, setTouched] = useState(false);
  const fieldId = id ?? `phone-${label}`;
  const warning = touched ? israeliPhoneWarning(value) : null;
  const pretty = formatIsraeliPhone(value);

  return (
    <div className={className}>
      <label className="field-label" htmlFor={fieldId}>
        {label}
      </label>
      <input
        id={fieldId}
        dir="ltr"
        required={required}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          setTouched(true);
          const normalized = normalizeIsraeliPhone(value);
          if (normalized !== value) onChange(normalized);
        }}
        className="input-field text-right tabular"
        aria-describedby={warning ? `${fieldId}-warning` : undefined}
      />
      {warning ? (
        <p id={`${fieldId}-warning`} className="mt-1 text-xs text-warn-ink">
          {warning}
        </p>
      ) : (
        // הצורה הקריאה מוצגת רק כשהיא באמת שונה ממה שנשמר, אחרת זו
        // שורה שחוזרת על עצמה ומוסיפה רעש לכל טופס במערכת.
        pretty && pretty !== value && (
          <p className="mt-1 text-xs text-ink-subtle ltr-num">{pretty}</p>
        )
      )}
    </div>
  );
}
