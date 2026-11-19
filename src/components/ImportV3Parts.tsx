import { CalmNotice } from "@/areas/finance/BankV3Parts";
import { ErrorState } from "./ErrorState";
import { Stepper } from "./Stepper";
import { useIsV3 } from "@/lib/uiTheme";
import { formatNumber } from "@/lib/format";

// חלקי תצוגה משותפים למסכי יבוא שעובדים עם אצוות (זכאות, שגויים, ביקורות,
// מסמכים, רשימות טלפוניות) - ערכה v3, שדרוג 2026-11.
// כל רכיב כאן מחזיר את התצוגה הקודמת (או כלום) כשהערכה אינה v3, כך שמסך שמשתמש
// בהם נראה בדיוק כמו קודם בעיצוב הקיים. תצוגה בלבד - אין כאן שום קריאה או כתיבה.

/** שלבי היבוא כפי שהם קיימים בפועל במסכי האצוות: קובץ ← תצוגה מקדימה (לא נשמר)
 *  ← אצווה שמורה לבדיקה ← קליטה. */
export const BATCH_IMPORT_STEPS = [
  { key: "file", label: "בחירת קובץ" },
  { key: "preview", label: "תצוגה מקדימה" },
  { key: "review", label: "בדיקה והחלטות" },
  { key: "done", label: "נקלט" },
];

export type BatchImportStep = "file" | "preview" | "review" | "done";

export function batchImportStep(s: { reviewing: boolean; committed: boolean; previewing: boolean }): BatchImportStep {
  if (s.reviewing) return s.committed ? "done" : "review";
  return s.previewing ? "preview" : "file";
}

/** מחוון השלבים - רק ב-v3. */
export function ImportSteps({ current }: { current: BatchImportStep }) {
  const isV3 = useIsV3();
  if (!isV3) return null;
  return <Stepper steps={BATCH_IMPORT_STEPS} currentStep={current} />;
}

/** "תצוגה מקדימה - עוד לא נשמר דבר" + הספירות במילים. רק ב-v3. */
export function PreviewSummary({ valid, needs, invalid, next }: { valid: number; needs: number; invalid: number; next?: string }) {
  const isV3 = useIsV3();
  if (!isV3) return null;
  return (
    <p className="text-sm text-ink">
      <span className="font-semibold text-primary">תצוגה מקדימה - עוד לא נשמר דבר.</span> בקובץ{" "}
      <span className="font-semibold text-ok-ink">{formatNumber(valid)} שורות תקינות</span>
      {needs > 0 && <> · <span className="font-semibold text-warn-ink">{formatNumber(needs)} דורשות החלטה</span></>}
      {invalid > 0 && <> · <span className="font-semibold text-danger-ink">{formatNumber(invalid)} שגויות</span></>}
      . {next ?? "האישור שומר את השורות לבדיקה, והקליטה עצמה היא בשלב הבא."}
    </p>
  );
}

/** הודעה מעל סקירת אצווה פתוחה: נשמר לבדיקה, עוד לא נקלט. רק ב-v3. */
export function SavedForReviewNote({ what }: { what: string }) {
  const isV3 = useIsV3();
  if (!isV3) return null;
  return <p className="text-sm font-semibold text-primary">האצווה נשמרה לבדיקה - {what} עוד לא נקלט.</p>;
}

/** קובץ שכבר יובא: ב-v3 הודעה רגועה (זה זיהוי תקין, לא תקלה); אחרת השגיאה כפי שהייתה. */
export function DuplicateFileNotice({ message = "הקובץ הזה כבר יובא בעבר." }: { message?: string }) {
  const isV3 = useIsV3();
  if (!isV3) return <ErrorState message={message} />;
  return <CalmNotice>{message} אין צורך לייבא אותו שוב - הנתונים שבו כבר במערכת.</CalmNotice>;
}

/** ספירות אצווה במילים (v3) במקום "12 / 0 / 3". */
export function batchCountsText(b: { status: string; valid_count: number; needs_decision_count: number; invalid_count: number }): string {
  return [
    `${formatNumber(b.valid_count)} תקינות`,
    b.needs_decision_count > 0 ? `${formatNumber(b.needs_decision_count)} דורשות החלטה` : null,
    b.invalid_count > 0 ? `${formatNumber(b.invalid_count)} ${b.status === "committed" ? "נדחו" : "שגויות"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
