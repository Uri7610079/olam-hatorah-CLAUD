// Vercel Serverless Function - מופעלת אוטומטית פעם ביום ע"י Vercel Cron (ר' vercel.json),
// בודקת אילו חשבונות בנק "אמורים לרוץ היום" (לפי bank_auto_sync_settings בכל עמותה),
// מושכת מכל אחד מהם את התנועות האחרונות מה-API הרשמי של הבנק שלו (בהתאם ל-provider
// שנבחר בהגדרות - לאומי/מרכנתיל/פאג"י, ר' מיגרציה 083), ומעבירה אותן ל-
// ingest_bank_transactions_batch() ב-Supabase שמבצע דדופ/סיווג/הצלבה - בדיוק כמו יבוא
// קובץ ידני, רק בלי שאף אחד צריך להעלות קובץ.
//
// המקום היחיד שדורש עדכון כשיתקבלו פרטי החיבור בפועל מכל בנק הוא הפונקציה הייעודית
// שלו למטה (fetchFromLeumi/fetchFromMercantile/fetchFromPagi) - כל שאר הקובץ כבר מוכן
// ורץ, לא משנה כמה בנקים מחוברים בפועל.
//
// הגדרה נדרשת (פעם אחת):
// 1. Vercel → הפרויקט → Settings → Environment Variables → מוסיפים:
//      BANK_SYNC_SECRET = (ערך אקראי וסודי שתבחרי - לא סיסמה קיימת, לא זהה לשל הווצאפ)
//      LEUMI_API_KEY/LEUMI_API_BASE_URL, MERCANTILE_API_KEY/MERCANTILE_API_BASE_URL,
//      PAGI_API_KEY/PAGI_API_BASE_URL - רק לבנקים שבפועל מחוברים, ר' TODO בכל פונקציה
// 2. אותו ערך של BANK_SYNC_SECRET מוזן גם ב-Supabase (SQL Editor, פעם אחת):
//      insert into bank_sync_config (secret) values ('...')
//      on conflict (id) do update set secret = excluded.secret;
// 3. ב-Vercel → Settings → Cron Jobs, ודאו שהג'וב מוגדר לפי vercel.json (נוצר אוטומטית
//    בפריסה - אין צורך בהגדרה ידנית נוספת, פרט להפעלת Cron Jobs בתוכנית Vercel שלכם
//    אם עדיין לא מופעל).
//
// למה בדיקת תדירות נעשית כאן ולא רק ב-SQL: ל-Vercel Cron (בתוכנית הבסיסית) יש רק
// טריגר יומי אחד אפשרי - "כל שבוע/חודש" נבדק בפועל בכל הרצה יומית ע"י
// is_bank_sync_due() (ב-SQL, מיגרציה 074), לא ע"י הגדרת תזמון נפרדת כאן.

// TODO לאומי: יש אישור ודאי לגישת API רשמית (פורטל Open Banking מאושר) - למלא אחרי
// קבלת תיעוד/הרשאה בפועל.
async function fetchFromLeumi(account, sinceDate) {
  throw new Error(
    `חיבור ה-API של לאומי טרם הוגדר - יש למלא את fetchFromLeumi() בקובץ api/bank-sync.js אחרי קבלת פרטי Open Banking מלאומי (חשבון: ${account.bank_name ?? "לא ידוע"} ${account.account_number ?? ""})`,
  );
}

// TODO מרכנתיל: אימות חזק - יש פורטל מפתחים ייעודי עם קטלוג API אמיתי
// (mercantile.co.il/openbanking), תואם PSD2, כולל Sandbox. למלא אחרי הרשמה לפורטל
// וקבלת מפתח API.
async function fetchFromMercantile(account, sinceDate) {
  throw new Error(
    `חיבור ה-API של מרכנתיל טרם הוגדר - יש למלא את fetchFromMercantile() בקובץ api/bank-sync.js אחרי הרשמה לפורטל המפתחים של מרכנתיל וקבלת מפתח API (חשבון: ${account.bank_name ?? "לא ידוע"} ${account.account_number ?? ""})`,
  );
}

// TODO פאג"י: פחות ודאי - פאג"י הוא מותג/חטיבה של הבנק הבינלאומי הראשון (לא רישיון
// בנקאי נפרד). לבנק הבינלאומי יש API עסקי אמיתי משלו, אבל לא אומת מול הבנק אם הוא חל
// גם על חשבונות פאג"י ספציפית - יש לברר זאת ישירות מול הבנק/הבינלאומי לפני שממלאים כאן.
async function fetchFromPagi(account, sinceDate) {
  throw new Error(
    `חיבור ה-API של פאג"י טרם הוגדר - יש לוודא קודם מול הבנק הבינלאומי הראשון (הבעלים של פאג"י) האם ה-API העסקי שלו חל על חשבונות פאג"י, ואז למלא את fetchFromPagi() (חשבון: ${account.bank_name ?? "לא ידוע"} ${account.account_number ?? ""})`,
  );
}

// @param {{ provider: string, bank_name: string, bank_branch_code: string, account_number: string }} account
// @param {string | null} sinceDate - תאריך ביצוע (YYYY-MM-DD) של התנועה האחרונה שכבר נקלטה, או null בהרצה ראשונה
// @returns {Promise<Array<{execution_date: string, value_date: string|null, direction: "debit"|"credit", amount: number, description: string|null, reference: string|null, operation_type: string|null, bank_balance_after: number|null, bank_transaction_id: string|null}>>}
async function fetchTransactionsFromBank(account, sinceDate) {
  switch (account.provider) {
    case "leumi_open_banking":
      return fetchFromLeumi(account, sinceDate);
    case "mercantile_open_banking":
      return fetchFromMercantile(account, sinceDate);
    case "pagi_open_banking":
      return fetchFromPagi(account, sinceDate);
    default:
      throw new Error(`ספק בנק לא מוכר: ${account.provider ?? "(ריק)"}`);
  }
}

// בהרצה ראשונה (sinceDate=null) לא הגיוני לבקש "הכל מאז ומתמיד" - נבקש טווח סביר
// (3 חודשים אחורה) שהמשתמשת יכולה להרחיב בעצמה ע"י יבוא ידני נוסף אם צריך.
const FIRST_RUN_LOOKBACK_DAYS = 90;

function defaultSinceDate() {
  const d = new Date();
  d.setDate(d.getDate() - FIRST_RUN_LOOKBACK_DAYS);
  return d.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  const secret = process.env.BANK_SYNC_SECRET;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!secret || !supabaseUrl || !anonKey) {
    res.status(503).json({ error: "bank sync not configured" });
    return;
  }

  // Vercel Cron שולח בקשת GET; מאפשרים גם POST ידני לבדיקה, אבל תמיד מוגנים ע"י
  // secret ה-Cron של Vercel עצמו (CRON_SECRET, נבדק אוטומטית ע"י Vercel) - כאן רק
  // ודאות נוספת שלא קוראים בטעות בלי הכתובת הנכונה.
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const results = [];

  try {
    const dueResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/list_due_bank_sync_accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({ p_secret: secret }),
    });
    if (!dueResponse.ok) {
      console.error("list_due_bank_sync_accounts failed:", await dueResponse.text());
      res.status(502).json({ error: "failed to list due accounts" });
      return;
    }
    const dueAccounts = await dueResponse.json();

    for (const account of dueAccounts) {
      const sinceDate = account.since_execution_date ?? defaultSinceDate();
      try {
        const transactions = await fetchTransactionsFromBank(account, sinceDate);
        const ingestResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/ingest_bank_transactions_batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${anonKey}` },
          body: JSON.stringify({
            p_secret: secret,
            p_setting_id: account.setting_id,
            p_transactions: transactions,
          }),
        });
        if (!ingestResponse.ok) {
          console.error("ingest_bank_transactions_batch failed:", await ingestResponse.text());
          results.push({ setting_id: account.setting_id, ok: false });
          continue;
        }
        results.push({ setting_id: account.setting_id, ok: true });
      } catch (err) {
        // כשלון משיכה מהבנק לחשבון בודד לא אמור לעצור את שאר החשבונות שבתור - כל
        // חשבון נכשל/מצליח בנפרד, ורשום בהיסטוריית ההרצות שלו. בלי הקריאה הזו, כישלון
        // כאן (למשל fetchTransactionsFromBank שעדיין לא הוגדר) לא היה משאיר שום עקבות
        // במסך "משיכה אוטומטית מהבנק" - הכישלון היה קורה "בשקט" מבחינת המשתמשת.
        console.error(`bank-sync failed for setting ${account.setting_id}:`, err);
        try {
          await fetch(`${supabaseUrl}/rest/v1/rpc/log_failed_bank_sync_run`, {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${anonKey}` },
            body: JSON.stringify({ p_secret: secret, p_setting_id: account.setting_id, p_error_message: String(err?.message ?? err) }),
          });
        } catch (logErr) {
          console.error("log_failed_bank_sync_run also failed:", logErr);
        }
        results.push({ setting_id: account.setting_id, ok: false, error: String(err?.message ?? err) });
      }
    }
  } catch (err) {
    console.error("bank-sync internal error:", err);
    res.status(500).json({ error: "internal error" });
    return;
  }

  res.status(200).json({ processed: results.length, results });
}
