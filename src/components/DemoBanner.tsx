import { FlaskConical } from "lucide-react";

// דרישת אפיון מפורשת: כאשר מוצגים נתוני דמו, יופיע באנר קטן וברור - לא נדרש להיות
// "עדין" או קטן-בקושי-נראה: המטרה היא שאי אפשר יהיה להתבלבל בין דמו לנתון אמיתי.
// כרגע מוצג תמיד (כל הנתונים בשלב 1-2 הם דמו מקומי) — יתחבר לדגל is_demo אמיתי בשלב 15.
export function DemoBanner() {
  return (
    <div className="flex items-center justify-center gap-1.5 border-b border-warn bg-warn-soft px-4 py-2 text-center text-xs font-medium text-warn-ink">
      <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
      סביבת דמו — הנתונים המוצגים סינתטיים ואינם נתוני אמת
    </div>
  );
}
