// מוחל את ערכת העיצוב לפני שה-CSS והאפליקציה נטענים, כדי שלא תהיה הבזקה של
// הערכה הלא-נכונה בכל טעינת עמוד. ר' src/lib/uiTheme.ts.
// קובץ נפרד ולא סקריפט בתוך index.html: מדיניות האבטחה (CSP ב-vercel.json) מרשה
// רק סקריפטים מקבצים של האתר עצמו, וחוסמת כל סקריפט שכתוב בתוך הדף.
(function () {
  try {
    var t = localStorage.getItem("olam-ui-theme-2");
    // ברירת המחדל לכולם היא v3. חייב להכיר כל ערכה שמוגדרת ב-uiTheme.ts - ערכה שלא
    // מופיעה כאן חוזרת לברירת המחדל בכל רענון.
    document.documentElement.setAttribute("data-ui", t === "v2" || t === "classic" ? t : "v3");
  } catch (e) {
    document.documentElement.setAttribute("data-ui", "v3");
  }
})();
