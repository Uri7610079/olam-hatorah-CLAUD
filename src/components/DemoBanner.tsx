// דרישת אפיון מפורשת: כאשר מוצגים נתוני דמו, יופיע באנר קטן וברור.
// כרגע מוצג תמיד (כל הנתונים בשלב 1 הם דמו מקומי) — יתחבר לדגל is_demo אמיתי בשלב 15.
export function DemoBanner() {
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-xs font-medium text-amber-800">
      סביבת דמו — הנתונים המוצגים סינתטיים ואינם נתוני אמת
    </div>
  );
}
