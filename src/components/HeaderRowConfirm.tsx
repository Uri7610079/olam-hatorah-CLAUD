import { useState } from "react";
import { AlertTriangle } from "lucide-react";

interface HeaderRowConfirmProps {
  previewRows: string[][];
  detectedIndex: number;
  onConfirm: (headerRowIndex: number) => void;
  onCancel: () => void;
}

// מוצג רק כשזוהה (importParsing.ts, detectHeaderRow) שצריך לדלג על שורה אחת או יותר
// לפני שורת הכותרות האמיתית - למשל דוח בנק עם שורות "שם חשבון"/"טווח תאריכים" לפני
// הטבלה עצמה, או דוח ממשלתי עם כותרת מוסדית. לא מדלגים בשקט אף פעם - המשתמשת תמיד
// רואה את הניחוש ומאשרת אותו, או לוחצת על השורה הנכונה בעצמה אם הניחוש שגוי.
export function HeaderRowConfirm({ previewRows, detectedIndex, onConfirm, onCancel }: HeaderRowConfirmProps) {
  const [selected, setSelected] = useState(detectedIndex);

  return (
    <div className="card max-w-3xl space-y-3 border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
        <p className="text-sm font-medium text-slate-800">
          נראה שיש בקובץ שורות לפני שורת הכותרות האמיתית (למשל פרטי חשבון או כותרת מוסדית). השורה המסומנת למטה היא הניחוש שלנו - אשרי אותה, או לחצי על השורה הנכונה אם הניחוש שגוי.
        </p>
      </div>
      <div className="max-h-64 overflow-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <tbody>
            {previewRows.map((row, i) => (
              <tr
                key={i}
                onClick={() => setSelected(i)}
                className={`cursor-pointer border-b border-slate-100 last:border-0 ${
                  selected === i ? "bg-amber-100 font-medium" : "hover:bg-slate-50"
                }`}
              >
                <td className="w-8 px-2 py-1 tabular text-slate-400">{i + 1}</td>
                {row.slice(0, 8).map((cell, j) => (
                  <td key={j} className="max-w-[10rem] truncate px-2 py-1">
                    {String(cell ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <button onClick={() => onConfirm(selected)} className="btn-primary text-xs">
          אישור - זו שורת הכותרות
        </button>
        <button onClick={onCancel} className="text-xs text-slate-500 underline">
          ביטול
        </button>
      </div>
    </div>
  );
}
