// Vercel Serverless Function - מתאם ל-Meta WhatsApp Cloud API (הספק הרשמי הישיר של
// מטא, בלי מנוי חודשי אצל ספק-ביניים כמו Twilio). קובץ נפרד מ-whatsapp-webhook.js
// (Twilio) כי הפורמט שונה לגמרי: JSON מקונן (לא form-urlencoded), ומטא דורשת גם "לחיצת
// יד" לאימות ה-Webhook (בקשת GET) לפני שהיא שולחת אירועים אמיתיים בכלל.
//
// הגדרה נדרשת (פעם אחת, אחרי הקמת אפליקציית Meta Business + WhatsApp Business Account
// ב-developers.facebook.com):
// 1. Vercel → הפרויקט → Settings → Environment Variables → מוסיפים:
//      META_WEBHOOK_VERIFY_TOKEN = (ערך שבוחרים בעצמכם, לא מגיע ממטא)
//      WHATSAPP_WEBHOOK_SECRET = (אותו ערך בדיוק שהוזן ב-whatsapp_webhook_config בשלב
//      חיבור Twilio, אם כבר נעשה - אפשר לשתף בין שני הספקים, זה סוד פנימי שלנו בלבד)
// 2. במסך ה-Webhook של האפליקציה ב-Meta for Developers, מכניסים Callback URL:
//      https://<כתובת-האתר-שלך>/api/whatsapp-webhook-meta
//    ו-Verify Token עם אותו ערך מ-META_WEBHOOK_VERIFY_TOKEN.
// 3. במסך "חיבור קבוצות" באתר, מזינים כ"מזהה חיצוני" את ה-Phone Number ID שמטא הציגה
//    (מספר, לא מספר טלפון) - זה מה שמגיע בכל הודעה נכנסת בשדה metadata.phone_number_id.
//
// מדיה (תמונות/קבצים) לא ממומשת כאן - Meta Cloud API דורשת הורדה מאומתת נפרדת דרך
// Graph API, לא ממומש כרגע - לא מומצא, פשוט לא נתמך עדיין בנתיב הזה.

export default async function handler(req, res) {
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (mode === "subscribe" && expectedToken && token === expectedToken) {
      res.status(200).send(challenge);
    } else {
      res.status(403).send("verification failed");
    }
    return;
  }

  if (req.method !== "POST") {
    res.status(405).send("method not allowed");
    return;
  }

  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!secret || !supabaseUrl || !anonKey) {
    res.status(200).send("webhook not configured");
    return;
  }

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    // Array.isArray + הגבלת כמות - בלי זה, POST זדוני (הכתובת ציבורית, כל אחד יכול
    // לשלוח אליה) עם עשרות אלפי "הודעות" מזויפות היה גורם לאלפי קריאות RPC רצופות
    // (כולן יידחו ע"י בדיקת ה-secret, אבל עדיין timeout/עומס על הפונקציה עצמה) - וגם
    // contacts לא-מערך היה מפיל את .find בלי אזהרה. נתפס בביקורת ייעודית לפני commit.
    const messages = Array.isArray(value?.messages) ? value.messages.slice(0, 50) : [];
    const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
    const phoneNumberId = value?.metadata?.phone_number_id;

    for (const msg of messages) {
      if (!phoneNumberId || !msg?.id) continue;
      const contact = contacts.find((c) => c.wa_id === msg.from);
      const senderName = contact?.profile?.name || msg.from || null;
      const bodyText = msg.text?.body ?? (msg.type ? `[${msg.type}]` : null);

      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/ingest_whatsapp_message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({
          p_secret: secret,
          p_external_group_id: phoneNumberId,
          p_source_message_id: msg.id,
          p_sender_name: senderName,
          p_body: bodyText,
          p_attachment_url: null,
        }),
      });
      if (!response.ok) {
        console.error("ingest_whatsapp_message failed:", await response.text());
      }
    }
  } catch (err) {
    console.error("whatsapp-webhook-meta error:", err);
  }

  // Meta דורשת 200 מהיר על כל אירוע, אחרת היא תנסה שוב ותחשיב את ה-Webhook כלא אמין.
  res.status(200).send("EVENT_RECEIVED");
}
