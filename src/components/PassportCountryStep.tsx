import { useMemo, useState } from "react";
import { Globe, AlertTriangle } from "lucide-react";

// רשימת מדינות בעברית. לא רשימת כל מדינות העולם - אלה המדינות שמהן מגיעים בפועל
// תלמידים עם דרכון זר בקהילה הזו, ובראשן הנפוצות. תמיד אפשר להקליד מדינה אחרת.
export const PASSPORT_COUNTRIES = [
  "ארצות הברית",
  "בריטניה",
  "צרפת",
  "בלגיה",
  "קנדה",
  "שווייץ",
  "ארגנטינה",
  "ברזיל",
  "מקסיקו",
  "אוסטרליה",
  "דרום אפריקה",
  "רוסיה",
  "אוקראינה",
  "הולנד",
  "גרמניה",
  "אוסטריה",
  "איטליה",
  "ספרד",
  "שוודיה",
  "פנמה",
  "ונצואלה",
  "צ'ילה",
  "אורוגוואי",
  "הונגריה",
  "פולין",
  "רומניה",
  "טורקיה",
  "מרוקו",
];

export interface PassportRow {
  rowNumber: number;
  name: string;
  passportNumber: string;
}

interface PassportCountryStepProps {
  rows: PassportRow[];
  onConfirm: (countryByRow: Record<number, string>) => void;
  onCancel: () => void;
}

// מוצג כשיש בקובץ תלמידים שמזוהים בדרכון. מספר דרכון אינו ייחודי בעולם - שתי
// מדינות יכולות להנפיק את אותו מספר - ולכן בלי המדינה המספר לבדו אינו מזהה.
//
// יש בחירה אחת לכולם ובחירה פרטנית, ובכוונה בסדר הזה: ברוב הקבצים כל הדרכונים
// מאותה מדינה, ואז זו בחירה אחת; אבל אסור שזו תהיה האפשרות היחידה, כי קובץ מעורב
// היה מקבל מדינה שגויה לכל מי שאינו ברוב.
export function PassportCountryStep({ rows, onConfirm, onCancel }: PassportCountryStepProps) {
  const [bulk, setBulk] = useState("");
  const [perRow, setPerRow] = useState<Record<number, string>>({});
  const [custom, setCustom] = useState("");

  const effective = useMemo(() => {
    const out: Record<number, string> = {};
    for (const r of rows) out[r.rowNumber] = perRow[r.rowNumber] ?? bulk;
    return out;
  }, [rows, perRow, bulk]);

  const missing = rows.filter((r) => !effective[r.rowNumber]);
  const options = custom.trim() ? [custom.trim(), ...PASSPORT_COUNTRIES] : PASSPORT_COUNTRIES;

  return (
    <div className="card max-w-3xl space-y-4 border-warn bg-warn-soft p-4">
      <div className="flex items-start gap-2">
        <Globe className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
        <div className="text-sm text-ink">
          <p className="font-medium">
            נמצאו {rows.length} תלמידים עם דרכון. מאיזו מדינה הדרכון?
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            מספר דרכון אינו ייחודי בעולם - שתי מדינות יכולות להנפיק את אותו מספר. בלי המדינה אי אפשר לדעת שמדובר
            באותו אדם.
          </p>
        </div>
      </div>

      <div className="rounded-control border border-line bg-surface p-3">
        <label className="field-label" htmlFor="bulk-country">
          מדינה לכל הדרכונים
        </label>
        <select id="bulk-country" value={bulk} onChange={(e) => setBulk(e.target.value)} className="input-field mt-1">
          <option value="">— בחרי מדינה —</option>
          {options.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <div className="mt-2">
          <label className="field-label" htmlFor="custom-country">
            מדינה שאינה ברשימה
          </label>
          <input
            id="custom-country"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="להקליד שם מדינה…"
            className="input-field mt-1"
          />
        </div>
      </div>

      <details className="rounded-control border border-line bg-surface p-3">
        <summary className="cursor-pointer text-sm text-ink">
          מדינה שונה לחלק מהתלמידים ({rows.length} ברשימה)
        </summary>
        <div className="mt-2 max-h-72 overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line text-ink-subtle">
                <th className="px-2 py-1.5 text-right font-medium">שורה</th>
                <th className="px-2 py-1.5 text-right font-medium">שם</th>
                <th className="px-2 py-1.5 text-right font-medium">מספר דרכון</th>
                <th className="px-2 py-1.5 text-right font-medium">מדינה</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rowNumber} className="border-b border-line last:border-0">
                  <td className="px-2 py-1.5 text-ink-subtle tabular">{r.rowNumber}</td>
                  <td className="px-2 py-1.5 text-ink">{r.name}</td>
                  <td className="px-2 py-1.5 text-ink-muted ltr-num">{r.passportNumber}</td>
                  <td className="px-2 py-1.5">
                    <select
                      aria-label={`מדינת דרכון עבור ${r.name}`}
                      value={perRow[r.rowNumber] ?? ""}
                      onChange={(e) => setPerRow((p) => ({ ...p, [r.rowNumber]: e.target.value }))}
                      className="input-field py-1 text-xs"
                    >
                      <option value="">{bulk ? `כמו כולם (${bulk})` : "— בחרי —"}</option>
                      {options.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {missing.length > 0 && (
        <div className="flex items-start gap-2 rounded-control border border-warn bg-warn-soft p-2.5 text-xs text-warn-ink">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{missing.length} תלמידים עדיין בלי מדינה.</span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onConfirm(effective)} disabled={missing.length > 0} className="btn-primary text-xs">
          אישור והמשך
        </button>
        <button type="button" onClick={() => onConfirm({})} className="btn-secondary text-xs">
          המשך בלי מדינה
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary text-xs">
          ביטול
        </button>
      </div>
    </div>
  );
}
