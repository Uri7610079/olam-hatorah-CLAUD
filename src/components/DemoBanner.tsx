import { useQuery } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { supabase } from "@/lib/supabase";

// דרישת אפיון מפורשת: כאשר מוצגים נתוני דמו, יופיע באנר קטן וברור - לא נדרש להיות
// "עדין" או קטן-בקושי-נראה: המטרה היא שאי אפשר יהיה להתבלבל בין דמו לנתון אמיתי.
//
// עד לתיקון הזה הבאנר הופיע *תמיד*, מקודד קשיח. זו הייתה החלטה נכונה בשלב 1-2,
// כשכל הנתונים במערכת אכן היו דמו, עם הערה שיתחבר לדגל האמיתי בשלב 15 - וזה לא
// נעשה. התוצאה: אחרי קליטת 1583 תלמידים אמיתיים, חשבונות בנק וסכומים, המערכת
// הכריזה עליהם "סינתטיים ואינם נתוני אמת".
//
// זו לא אי-דיוק קוסמטי. באנר שקרי בשני הכיוונים מסוכן: הוא גורם להתייחס לנתון
// אמיתי כאל משחק, ובמערכת שמוציאה כסף זו בדיוק הטעות שלא רוצים.
//
// עכשיו הוא נגזר ממה שקיים בפועל: אצוות דמו. אין אצווה - אין באנר.
async function fetchDemoBatchCount(): Promise<number> {
  const { count, error } = await supabase.from("demo_batches").select("id", { count: "exact", head: true });
  // שגיאה (למשל היעדר הרשאה) לא אמורה להסתיר את האזהרה אם כן יש דמו, אבל גם לא
  // להמציא אזהרה משלה. במקרה כזה לא מוצג באנר, ומסך נתוני הדמו נשאר המקור המוסמך.
  if (error) return 0;
  return count ?? 0;
}

export function DemoBanner() {
  const { data: demoBatches } = useQuery({
    queryKey: ["demo-batch-count"],
    queryFn: fetchDemoBatchCount,
    staleTime: 60_000,
  });

  if (!demoBatches) return null;

  return (
    <div className="flex items-center justify-center gap-1.5 border-b border-warn bg-warn-soft px-4 py-2 text-center text-xs font-medium text-warn-ink">
      <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
      יש במערכת נתוני דמו — חלק מהנתונים המוצגים אינם אמיתיים
    </div>
  );
}
