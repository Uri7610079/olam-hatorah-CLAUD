import { useEffect } from "react";

// כל דיאלוג/מגירה עם role="dialog" aria-modal="true" מבטיח לטכנולוגיה מסייעת "אני לוכד
// פוקוס" - ה-hook הזה סוגר לפחות את הפער של Escape (נתפס בביקורת נגישות שלב 16: אף
// דיאלוג במערכת לא תמך ב-Escape עד עכשיו).
export function useEscapeToClose(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);
}
