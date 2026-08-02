import { Check, Palette } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { useUiTheme, UI_THEME_DESCRIPTION, UI_THEME_LABEL, type UiTheme } from "@/lib/uiTheme";

const OPTIONS: UiTheme[] = ["classic", "v2"];

// תצוגה מקדימה קטנה של הרכיבים המרכזיים - כרטיס, כפתורים, שדה וסטטוסים. היא
// מושפעת מהערכה הפעילה בפועל, ולכן משתנה מיד עם ההחלפה ומראה את ההבדל האמיתי
// במקום לתאר אותו במילים.
function ThemePreview() {
  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-ink">כך ייראו המסכים</span>
        <StatusBadge severity="ok" label="תקין" />
      </div>
      <div className="flex flex-wrap gap-2">
        <StatusBadge severity="critical" label="חריגה" />
        <StatusBadge severity="medium" label="ממתין" />
        <StatusBadge severity="neutral" label="טיוטה" />
      </div>
      <div>
        <label className="field-label">שדה לדוגמה</label>
        <input className="input-field" defaultValue="טקסט לדוגמה" readOnly />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary text-xs">
          פעולה ראשית
        </button>
        <button type="button" className="btn-secondary text-xs">
          פעולה משנית
        </button>
      </div>
    </div>
  );
}

export function AppearanceScreen() {
  const { theme, changeTheme } = useUiTheme();

  return (
    <div>
      <PageHeader
        title="עיצוב ותצוגה"
        description="בחירה בין המראה הקיים של המערכת לבין המראה המעודכן. ההחלפה מיידית, לא משנה שום נתון, וניתן לחזור אחורה בכל רגע."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-3">
          {OPTIONS.map((option) => {
            const isActive = theme === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => changeTheme(option)}
                aria-pressed={isActive}
                className={`card flex w-full items-start gap-3 p-4 text-right transition ${
                  isActive ? "border-brand-500 ring-2 ring-brand-100" : "hover:border-line-strong"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${
                    isActive ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong"
                  }`}
                  aria-hidden="true"
                >
                  {isActive && <Check className="h-3 w-3" />}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{UI_THEME_LABEL[option]}</span>
                    {isActive && (
                      <span className="rounded-full bg-ok-soft px-2 py-0.5 text-xs font-medium text-ok-ink">פעיל כעת</span>
                    )}
                  </span>
                  <span className="mt-1 block text-sm text-ink-muted">{UI_THEME_DESCRIPTION[option]}</span>
                </span>
              </button>
            );
          })}

          <div className="flex items-start gap-2 rounded-card border border-line bg-surface-muted p-3 text-xs text-ink-muted">
            <Palette className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              הבחירה נשמרת בדפדפן הזה בלבד - כך המראה נטען מיד בפתיחת המערכת בלי הבהוב. במחשב או בדפדפן אחר תופיע שוב
              ברירת המחדל, וניתן לבחור שם מחדש.
            </span>
          </div>
        </div>

        <ThemePreview />
      </div>
    </div>
  );
}
