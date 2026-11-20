import { useCallback, useEffect, useState } from "react";

// סדר המפתחות כאן הוא סדר ההצגה במסך "עיצוב ותצוגה". ערכה חדשה חייבת
// להתווסף גם לסקריפט public/theme-init.js, אחרת היא מתאפסת בכל רענון.
export type UiTheme = "classic" | "v2" | "v3";

export const UI_THEME_STORAGE_KEY = "olam-ui-theme";

export const UI_THEME_LABEL: Record<UiTheme, string> = {
  classic: "העיצוב הקיים",
  v2: "העיצוב החדש",
  v3: "בהירות מודרנית (v3)",
};

export const UI_THEME_DESCRIPTION: Record<UiTheme, string> = {
  classic: "המראה שהמערכת עבדה איתו עד היום - סגול-כחול, כרטיסים מעוגלים עם צל.",
  v2: "מראה מעודכן ורגוע יותר: כחול עמוק, רקע אפור-כחלחל, גבול דק במקום צל, וסימון ברור של האזור שבו נמצאים.",
  v3: "כחול עמוק לכותרות, טורקיז לפעולות וזהב להדגשה. טקסט גדול וקריא יותר, סכומים ותאריכים אחידים, וצבע מובחן לכל אזור.",
};

export const UI_THEMES = Object.keys(UI_THEME_LABEL) as UiTheme[];

function isUiTheme(value: string | null): value is UiTheme {
  return value !== null && (UI_THEMES as string[]).includes(value);
}

export function readStoredUiTheme(): UiTheme {
  try {
    const stored = localStorage.getItem(UI_THEME_STORAGE_KEY);
    return isUiTheme(stored) ? stored : "classic";
  } catch {
    // גלישה פרטית / אחסון חסום - נופלים לברירת המחדל במקום להפיל את האפליקציה.
    return "classic";
  }
}

export function applyUiTheme(theme: UiTheme) {
  document.documentElement.setAttribute("data-ui", theme);
}

/** האם ערכה v3 פעילה עכשיו. למסכים שיש להם מבנה חדש ב-v3 ומבנה קודם בשאר
 *  הערכות - כדי שהחזרה לעיצוב הקודם תחזיר גם את המבנה, לא רק את הצבעים. */
export function useIsV3(): boolean {
  const read = () => typeof document !== "undefined" && document.documentElement.getAttribute("data-ui") === "v3";
  const [isV3, setIsV3] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setIsV3(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-ui"] });
    return () => obs.disconnect();
  }, []);
  return isV3;
}

// ההעדפה נשמרת מקומית בדפדפן (לא ב-DB) בכוונה: היא נקראת ומוחלת עוד לפני
// שהאפליקציה נטענת (ר' public/theme-init.js), כדי שלא תהיה הבזקה של הערכה
// הלא-נכונה בכל טעינה. המחיר: ההעדפה לא עוברת בין מחשבים - סביר לחלוטין
// להעדפת תצוגה אישית, ובפרט בזמן שמשווים בין שתי הערכות.
export function useUiTheme() {
  const [theme, setTheme] = useState<UiTheme>(() => readStoredUiTheme());

  useEffect(() => {
    applyUiTheme(theme);
  }, [theme]);

  const changeTheme = useCallback((next: UiTheme) => {
    try {
      localStorage.setItem(UI_THEME_STORAGE_KEY, next);
    } catch {
      // ר' הערה למעלה - נכשלת השמירה, אבל המראה עדיין מתחלף לסשן הנוכחי.
    }
    setTheme(next);
  }, []);

  return { theme, changeTheme };
}
