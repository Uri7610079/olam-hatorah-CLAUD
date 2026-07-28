// Vercel Serverless Function - פירוק טקסט חופשי למשימות מסודרות באמצעות OpenAI.
//
// למה כאן ולא כמו במדריך שקיבלת: מפתח ה-API חייב לחיות בצד שרת בלבד (משתנה סביבה ב-
// Vercel), לא מוטבע בקוד - קוד עם מפתח מוטבע שמגיע ל-git הופך את המפתח לגלוי לכל מי
// שרואה את המאגר, כולל תשלום שיכול להתבצע בשמך. הפונקציה הזו רצה על השרתים של Vercel
// (לא על מחשב אישי שצריך להישאר דלוק) - בדיוק כמו שאר האתר.
//
// הגדרה נדרשת (פעם אחת, ע"י מי שיפעיל את המערכת):
// Vercel → הפרויקט → Settings → Environment Variables → מוסיפים
//   OPENAI_API_KEY = (המפתח שהתקבל מ-platform.openai.com)
// ואז Redeploy (או git push חדש - Vercel יעשה את זה אוטומטית).
// כל עוד המפתח לא הוגדר, ה-endpoint מחזיר שגיאה ברורה, והאתר חוזר אוטומטית לפיצול
// הפשוט המובנה (בלי AI) - הפיצ'ר "יצירה מטקסט חופשי" עובד גם בלי זה, רק פחות "חכם".

// בדיקה שהקורא הוא משתמש מחובר אמיתי של המערכת (לא כל מי שמצא את כתובת ה-endpoint
// באינטרנט) - בלי זה, כל אחד שמזהה את הכתובת הציבורית הזו יכול לגרום לחיובי OpenAI
// אמיתיים על חשבון הלקוח, בלי להתחבר בכלל לאתר. נבדק ידנית ("תבדוק שאין באגים") - זה
// היה חור פתוח שנתפס ותוקן, לא היה קיים בגרסה הקודמת של הקובץ.
async function isAuthenticatedUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length);
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey || !token) return false;

  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  if (!(await isAuthenticatedUser(req))) {
    res.status(401).json({ error: "authentication required" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "OPENAI_API_KEY not configured" });
    return;
  }

  let { text } = req.body ?? {};
  if (!text || typeof text !== "string" || !text.trim()) {
    res.status(400).json({ error: "missing text" });
    return;
  }
  // הגבלת אורך - בלי זה, משתמש מחובר (אבל לא בהכרח בכוונה טובה) יכול לשלוח טקסט ענק
  // ולצרוך שימוש AI יקר בבקשה אחת. 5000 תווים הרבה מעבר לכל הודעת עבודה סבירה.
  text = text.slice(0, 5000);

  const prompt = `אתה עוזר למשרד לחלץ משימות עבודה מטקסט חופשי בעברית (הודעה מוקלטת/כתובה).
חלץ מהטקסט משימות נפרדות. החזר אך ורק אובייקט JSON עם מערך בשם "tasks".
לכל משימה: "title" (כותרת קצרה וברורה), "category" (תחום כללי במילה אחת-שתיים, או null אם לא ברור), "suggested_date" (תאריך יעד בפורמט YYYY-MM-DD אם צוין או ניתן להסיק במפורש מהטקסט, אחרת null - אל תמציא תאריך).
היום: ${new Date().toISOString().slice(0, 10)}.
הטקסט: "${text}"`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      // הפרטים המלאים (עלולים לכלול שבר של המפתח על שגיאת auth) רק ללוג של Vercel,
      // לא חוזרים ללקוח - נתפס בביקורת ייעודית: תשובת שגיאה מ-OpenAI הייתה מוצגת
      // כמעט כמו-שהיא בדפדפן של כל משתמש מחובר.
      console.error("openai request failed:", await response.text());
      res.status(502).json({ error: "openai request failed" });
      return;
    }

    const data = await response.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
    const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    res.status(200).json({ tasks });
  } catch (err) {
    console.error("parse-tasks internal error:", err);
    res.status(500).json({ error: "internal error" });
  }
}
