// Supabase מחזיר לכל היותר 1,000 שורות לבקשה, ולא מסמן שהרשימה נחתכה.
// בעמותה של 1,187 תלמידים המשמעות היא 187 תלמידים שפשוט לא קיימים במסך -
// לא ביצוא לתלמוד, לא בבדיקת "מי לא הופיע בדוח", ולא בקובץ מס"ב.
//
// fetchAll מביאה את כל השורות בחלקים של 1,000. הפונקציה שמקבלים בונה את
// השאילתה מחדש בכל חלק (שאילתה של supabase-js היא חד-פעמית).
//
// הסדר חייב להיות יציב, אחרת שורה יכולה להופיע בשני חלקים או באף אחד:
// מי שממיין לפי עמודה לא ייחודית (תאריך, שם) מוסיף אחריה .order("id").

const PAGE = 1000;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

interface Rangeable<T> {
  range(from: number, to: number): PromiseLike<PageResult<T>>;
}

export async function fetchAll<T>(build: () => Rangeable<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

// סינון לפי רשימת מזהים (.in) נשלח בכתובת הבקשה. 1,187 מזהים הם כתובת של
// עשרות אלפי תווים, ושרת יכול לדחות אותה. לכן מחלקים ל-200 בכל בקשה.
const IN_CHUNK = 200;

export async function fetchAllIn<T>(ids: string[], build: (chunk: string[]) => Rangeable<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    rows.push(...(await fetchAll(() => build(chunk))));
  }
  return rows;
}
