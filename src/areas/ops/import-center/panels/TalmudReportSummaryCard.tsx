import { AlertTriangle, ArrowLeftRight, CheckCircle2, Copy, Info } from "lucide-react";
import type { TalmudImportInfo } from "@/lib/importBatches";

// סיכום מה שזוהה בדוח דרישת תשלום מתלמוד, לפני הקליטה.
//
// הכרטיס הזה קיים כדי שהקליטה לא תהיה "לחצתי ומשהו קרה". הדוח הזה מגיע
// עם כותרות באנגלית ועם עמותה, סניף וחודש שקבורים בתוך טקסט - והמערכת
// מחלצת אותם. כל דבר שהיא הסיקה בעצמה חייב להיות מוצג לאישור, כי טעות
// באחד מהם פירושה זכאות שנרשמת לעמותה או לחודש הלא נכונים, וזה מתגלה
// רק בדוח הכספי חודש אחר כך.

const money = (n: number) => n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// "2026-07-01" -> "07/2026"
function monthLabel(iso: string | null): string {
  if (!iso) return "לא זוהה";
  const [y, m] = iso.split("-");
  return `${m}/${y}`;
}

export function TalmudReportSummaryCard({ info, orgNotFound }: { info: TalmudImportInfo; orgNotFound: string | null }) {
  // אי-התאמה בין מה שחושב למה שהקובץ מצהיר עליו היא הבדיקה החשובה ביותר
  // כאן: היא תופסת קריאה של העמודה הלא נכונה, וקובץ חלקי.
  const balanced =
    info.declaredTotal === null || Math.abs(info.totalAmount - info.declaredTotal) < 0.5;

  return (
    <div className="rounded-control border border-line bg-surface-muted p-4 text-sm">
      <div className="mb-3 flex items-center gap-2 font-medium text-ink">
        <Info className="h-4 w-4 shrink-0 text-brand-500" aria-hidden="true" />
        זוהה: דוח דרישת תשלום מתלמוד
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-ink-subtle">עמותה</dt>
          <dd className="text-ink ltr-num">{info.orgNumber ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-subtle">חודש תשלום</dt>
          <dd className="text-ink ltr-num">{monthLabel(info.month)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-subtle">סניפים</dt>
          <dd className="text-ink ltr-num">{info.branchCount}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-subtle">זכאים</dt>
          <dd className="text-ink ltr-num">
            {info.eligibleCount} מתוך {info.sourceRowCount}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex items-start gap-2 border-t border-line pt-3">
        {balanced ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
        )}
        <div>
          <div className="text-ink">
            סך הזכאות בקובץ: <span className="ltr-num font-medium">{money(info.totalAmount)} ₪</span>
          </div>
          <div className="text-xs text-ink-muted">
            {balanced
              ? "תואם לסכום שהקובץ עצמו מצהיר עליו."
              : `הקובץ מצהיר על ${money(info.declaredTotal ?? 0)} ₪ — יש פער. לא לקלוט לפני בירור.`}
          </div>
        </div>
      </div>

      {info.mergedRowCount !== info.sourceRowCount && (
        <div className="mt-2 flex items-start gap-2 text-xs text-ink-muted">
          <ArrowLeftRight className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {info.sourceRowCount} שורות אוחדו ל-{info.mergedRowCount} תלמידים. תלמיד שמופיע בכמה קודי
            לימוד או שעבר סניף נרשם פעם אחת, והסכומים חוברו.
          </span>
        </div>
      )}

      {info.transfers.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-ink-muted">
            {info.transfers.length} תלמידים עברו סניף החודש
          </summary>
          <ul className="mt-1 space-y-0.5 pr-4 text-ink-subtle">
            {info.transfers.slice(0, 20).map((t) => (
              <li key={t}>{t}</li>
            ))}
            {info.transfers.length > 20 && <li>ועוד {info.transfers.length - 20}…</li>}
          </ul>
        </details>
      )}

      {/* אלה לא מוסתרים בתוך details: הם דורשים הכרעה אנושית */}
      {info.ambiguousBranch.length > 0 && (
        <div className="mt-2 flex items-start gap-2 text-xs text-danger">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <div>
            <div className="font-medium">שיוך סניף שאינו חד-משמעי ({info.ambiguousBranch.length}):</div>
            <ul className="mt-0.5 space-y-0.5">
              {info.ambiguousBranch.slice(0, 5).map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {info.exactDuplicates.length > 0 && (
        <div className="mt-2 flex items-start gap-2 text-xs text-warn">
          <Copy className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <div>
            <div className="font-medium">שורות כפולות בקובץ ({info.exactDuplicates.length}), נספרו פעם אחת:</div>
            <ul className="mt-0.5 space-y-0.5">
              {info.exactDuplicates.slice(0, 5).map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {orgNotFound && (
        <div className="mt-3 flex items-start gap-2 rounded border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            עמותה <span className="ltr-num font-medium">{orgNotFound}</span> אינה קיימת במערכת. יש להוסיף
            אותה, או לבחור ידנית את העמותה הנכונה למטה.
          </span>
        </div>
      )}

      {info.problems.map((p) => (
        <div key={p} className="mt-2 flex items-start gap-2 text-xs text-danger">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{p}</span>
        </div>
      ))}
    </div>
  );
}
