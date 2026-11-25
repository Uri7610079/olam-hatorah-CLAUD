import { useCallback, useEffect, useState } from "react";

// סדר המפתחות כאן הוא סדר ההצגה במסך "עיצוב ותצוגה". ערכה חדשה חייבת
// להתווסף גם לסקריפט public/theme-init.js, אחרת היא מתאפסת בכל רענון.
export type UiTheme = "v3" | "v2" | "classic";

// ברירת המחדל לכולם (25.11.2026): העיצוב החדש, v3. מופיעה גם ב-public/theme-init.js
// וב-index.html - שלושת המקומות חייבים להיות זהים.
export const DEFAULT_UI_THEME: UiTheme = "v3";

// מפתח חדש בכוונה: עם החלפת ברירת המחדל גם מי שבחר בעבר ערכה אחרת (מפתח
// "olam-ui-theme") מקבל את העיצוב החדש. בחירה שנעשית מעכשיו נשמרת כרגיל.
export const UI_THEME_STORAGE_KEY = "olam-ui-theme-2";

export const UI_THEME_LABEL: Record<UiTheme, string> = {
  v3: "העיצוב החדש (ברירת המחדל)",
  v2: "עיצוב ביניים",
  classic: "העיצוב הקודם",
};

export const UI_THEME_DESCRIPTION: Record<UiTheme, string> = {
  v3: "כחול עמוק לכותרות, טורקיז לפעולות וזהב להדגשה. טקסט גדול וקריא יותר, סכומים ותאריכים אחידים, וצבע מובחן לכל אזור.",
  v2: "כחול עמוק, רקע אפור-כחלחל, גבול דק במקום צל, וסימון ברור של האזור שבו נמצאים.",
  classic: "המראה שהמערכת עבדה איתו עד נובמבר 2026 - סגול-כחול, כרטיסים מעוגלים עם צל.",
};

export const UI_THEMES = Object.keys(UI_THEME_LABEL) as UiTheme[];

function isUiTheme(value: string | null): value is UiTheme {
  return value !== null && (UI_THEMES as string[]).includes(value);
}

export function readStoredUiTheme(): UiTheme {
  try {
    const stored = localStorage.getItem(UI_THEME_STORAGE_KEY);
    return isUiTheme(stored) ? stored : DEFAULT_UI_THEME;
  } catch {
    // גלישה פרטית / אחסון חסום - נופלים לברירת המחדל במקום להפיל את האפליקציה.
    return DEFAULT_UI_THEME;
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
