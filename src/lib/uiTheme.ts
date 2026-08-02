import { useCallback, useEffect, useState } from "react";

export type UiTheme = "classic" | "v2";

export const UI_THEME_STORAGE_KEY = "olam-ui-theme";

export const UI_THEME_LABEL: Record<UiTheme, string> = {
  classic: "העיצוב הקיים",
  v2: "העיצוב החדש",
};

export const UI_THEME_DESCRIPTION: Record<UiTheme, string> = {
  classic: "המראה שהמערכת עבדה איתו עד היום - סגול-כחול, כרטיסים מעוגלים עם צל.",
  v2: "מראה מעודכן ורגוע יותר: כחול עמוק, רקע אפור-כחלחל, גבול דק במקום צל, וסימון ברור של האזור שבו נמצאים.",
};

function isUiTheme(value: string | null): value is UiTheme {
  return value === "classic" || value === "v2";
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

// ההעדפה נשמרת מקומית בדפדפן (לא ב-DB) בכוונה: היא נקראת ומוחלת עוד לפני
// שהאפליקציה נטענת (ר' הסקריפט ב-index.html), כדי שלא תהיה הבזקה של הערכה
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
