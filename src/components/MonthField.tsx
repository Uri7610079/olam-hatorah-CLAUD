// שדה בחירת חודש.
//
// המערכת שומרת חודש כתאריך היום הראשון בו - "2026-07-01" - כי זו העמודה
// במסד (period_month, month). אבל השדה שהוצג היה בורר תאריך מלא, ולכן
// נפתח לוח ימים שלם ואפשר היה לבחור בו את ה-27 בחודש. יום הוא בחירה
// חסרת משמעות כאן, והוא גם מזמין ערך שלא יתאים לשום שורה במסד.
//
// input type="month" מציג חודש ושנה בלבד. ההמרה בין שתי הצורות נעשית
// כאן, כדי שכל מסך ימשיך לעבוד עם "2026-07-01" בדיוק כמו קודם.

interface MonthFieldProps {
  /** בצורת "YYYY-MM-DD" - היום הראשון בחודש. */
  value: string;
  onChange: (value: string) => void;
  label?: string;
  id?: string;
  required?: boolean;
  className?: string;
}

/** "2026-07-01" → "2026-07" */
export function toMonthInput(value: string | null | undefined): string {
  const s = String(value ?? "").trim();
  return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : "";
}

/** "2026-07" → "2026-07-01". ריק נשאר ריק, כדי שאפשר יהיה לנקות שדה. */
export function fromMonthInput(value: string): string {
  const s = String(value ?? "").trim();
  return /^\d{4}-\d{2}$/.test(s) ? `${s}-01` : "";
}

export function MonthField({ value, onChange, label = "חודש", id, required, className }: MonthFieldProps) {
  const fieldId = id ?? `month-${label}`;
  return (
    <div className={className}>
      <label className="field-label" htmlFor={fieldId}>
        {label}
      </label>
      <input
        id={fieldId}
        type="month"
        required={required}
        value={toMonthInput(value)}
        onChange={(e) => onChange(fromMonthInput(e.target.value))}
        className="input-field"
      />
    </div>
  );
}
