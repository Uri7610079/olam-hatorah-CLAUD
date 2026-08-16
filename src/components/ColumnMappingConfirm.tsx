import { useState } from "react";
import { HelpCircle, AlertTriangle } from "lucide-react";
import type { MappingPlan } from "@/lib/columnMapping";

interface ColumnMappingConfirmProps {
  plan: MappingPlan;
  // כל הכותרות שבקובץ - כדי שאפשר יהיה לבחור גם משהו שלא הוצע.
  headers: string[];
  // דוגמה מהשורה הראשונה לכל כותרת, כדי שההחלטה תתבסס על הנתון ולא רק על השם.
  sample: Record<string, string>;
  onConfirm: (mapping: Record<string, string>) => void;
  onCancel: () => void;
}

// מוצג כשכותרות הקובץ אינן זהות לשמות השדות, אבל נראות מוכרות. במקום לפסול את כל
// השורות בהודעה "חסר מזהה חיצוני" - שאלה ישירה, עם הניחוש כבר ממולא.
//
// הרקע: קובץ אמיתי של 1583 תלמידים נדחה במלואו כי הכותרות היו "תעודת זהות", "שם"
// ו"קוד סוג לימודים" במקום "מזהה חיצוני", "שם מלא" ו"קוד לימוד". לאדם שקורא את
// הקובץ ההתאמה מובנת מאליה, ולמערכת לא הייתה דרך לשאול.
//
// מוצגת גם דוגמת ערך מהשורה הראשונה: השם לבדו יכול להטעות ("קוד סניף" בקובץ ההוא
// הוא סניף הבנק ולא סניף העמותה), והערך מכריע מיד.
export function ColumnMappingConfirm({ plan, headers, sample, onConfirm, onCancel }: ColumnMappingConfirmProps) {
  const [choices, setChoices] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const q of plan.questions) if (q.suggestedHeader) initial[q.field.key] = q.suggestedHeader;
    return initial;
  });

  const chosenElsewhere = (header: string, exceptField: string) =>
    Object.entries(choices).some(([k, v]) => v === header && k !== exceptField);

  const missingRequired = plan.questions.filter((q) => q.field.required && !choices[q.field.key]);
  const duplicateUse = Object.values(choices).filter(Boolean).some((h, i, arr) => arr.indexOf(h) !== i);

  return (
    <div className="card max-w-3xl space-y-4 border-warn bg-warn-soft p-4">
      <div className="flex items-start gap-2">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
        <p className="text-sm font-medium text-ink">
          חלק מהעמודות בקובץ נקראות אחרת ממה שהמערכת מכירה. אשרי את ההתאמה - או שני אותה אם היא לא נכונה.
        </p>
      </div>

      <div className="space-y-2.5">
        {plan.questions.map((q) => {
          const value = choices[q.field.key] ?? "";
          return (
            <div key={q.field.key} className="rounded-control border border-line bg-surface p-3">
              <label className="block text-sm text-ink" htmlFor={`map-${q.field.key}`}>
                האם <span className="font-semibold">{q.field.label}</span> הוא:
                {q.field.required && <span className="mr-1 text-xs text-danger">(שדה חובה)</span>}
              </label>
              <select
                id={`map-${q.field.key}`}
                value={value}
                onChange={(e) => setChoices((prev) => ({ ...prev, [q.field.key]: e.target.value }))}
                className="input-field mt-1.5"
              >
                <option value="">— אין עמודה כזו בקובץ —</option>
                {headers
                  .filter(Boolean)
                  .map((h) => (
                    <option key={h} value={h} disabled={chosenElsewhere(h, q.field.key)}>
                      {h}
                      {chosenElsewhere(h, q.field.key) ? " (כבר בשימוש)" : ""}
                    </option>
                  ))}
              </select>
              {value && sample[value] !== undefined && (
                <p className="mt-1.5 text-xs text-ink-subtle">
                  דוגמה מהקובץ: <span className="font-medium text-ink-muted">{sample[value] || "(ריק)"}</span>
                </p>
              )}
              {/* ההנמקה מוצגת רק כשההצעה נשענה על מיקום העמודה. שם עמודה דו-משמעי
                  ("קוד סניף") מקבל משמעות מהשכנות שלו, וכדאי שהמשתמשת תדע שזה מה
                  שהנחה את ההצעה - כדי שתוכל לחלוק עליה ביודעין. */}
              {value === q.suggestedHeader && q.contextNote && (
                <p className="mt-1 text-xs text-ink-subtle">{q.contextNote}</p>
              )}
            </div>
          );
        })}
      </div>

      {missingRequired.length > 0 && (
        <div className="flex items-start gap-2 rounded-control border border-warn bg-warn-soft p-2.5 text-xs text-warn-ink">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>חובה לבחור עמודה עבור: {missingRequired.map((q) => q.field.label).join(", ")}</span>
        </div>
      )}

      {duplicateUse && (
        <div className="flex items-start gap-2 rounded-control border border-warn bg-warn-soft p-2.5 text-xs text-warn-ink">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>אותה עמודה נבחרה ליותר משדה אחד.</span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onConfirm(choices)}
          disabled={missingRequired.length > 0 || duplicateUse}
          className="btn-primary text-xs"
        >
          אישור והמשך
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary text-xs">
          ביטול
        </button>
      </div>
    </div>
  );
}
