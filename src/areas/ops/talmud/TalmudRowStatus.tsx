import { useState } from "react";
import { TALMUD_HEADERS, cellText, type TalmudRow } from "@/lib/talmudFile";

// מצב שורה בקובץ לתלמוד: אדום - חסר נתון, תלמוד ידחה את השורה. צהוב - לבדיקה.
// ירוק - תקין. "הצגת השורה" מראה בדיוק מה ייכתב בקובץ.
export function TalmudRowStatus({ row }: { row: TalmudRow | null }) {
  const [open, setOpen] = useState(false);
  if (!row) return <span className="text-sm text-danger-ink">התלמיד לא נמצא</span>;
  return (
    <div className="space-y-1 text-sm">
      {row.missing.map((m) => <p key={m} className="text-danger-ink">● {m}</p>)}
      {row.notes.map((n) => <p key={n} className="text-warn-ink">● {n}</p>)}
      {!row.missing.length && !row.notes.length && <p className="text-ok-ink">✓ תקין</p>}
      <button type="button" onClick={() => setOpen(!open)} className="link-action text-xs">
        {open ? "הסתרת השורה" : "הצגת השורה"}
      </button>
      {open && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-control bg-surface-muted p-2 text-xs">
          {TALMUD_HEADERS.map((h, i) => (
            <div key={h} className="contents">
              <dt className="text-ink-muted">{h}</dt>
              <dd className="tabular">{cellText(row.cells[i]) || "—"}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
