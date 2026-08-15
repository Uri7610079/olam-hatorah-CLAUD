import crypto from "node:crypto";

// Vercel Serverless Function - מתאם ל-HookMyApp (hookmyapp.com), ספק-ביניים שמחבר
// WhatsApp/Instagram בלי לעבור את תהליך האישור הארוך של Meta. קובץ שלישי לצד
// whatsapp-webhook.js (Twilio) ו-whatsapp-webhook-meta.js (Meta ישיר).
//
// מבנה ההודעה הנכנסת זהה לזה של Meta (entry[0].changes[0].value.messages[0]), ולכן
// לוגיקת הפירסור כאן כמעט זהה לזו שבמתאם של Meta. מה שכן שונה, ובגללו נדרש קובץ
// נפרד ולא עוד ענף באותו קובץ:
//
//   1. אימות חתימה. HookMyApp חותם כל בקשה ב-HMAC-SHA256 מעל גוף הבקשה הגולמי
//      ושולח אותה בכותרת X-HookMyApp-Signature-256 בפורמט "sha256=<hex>".
//      זו הגנה אמיתית שאין לשני המתאמים האחרים, והיא מחייבת לקרוא את הגוף הגולמי -
//      ר' ההערה על bodyParser למטה.
//   2. "בדיקת נוכחות" (probe). בהקמת ה-Webhook נשלחת בקשת POST ריקה ובלי חתימה עם
//      הכותרת X-HookMyApp-Probe: webhook-verification. חייבים להחזיר לה 2xx *לפני*
//      בדיקת החתימה, אחרת ההקמה נכשלת.
//   3. לחיצת יד ב-GET שמחזירה את ה-VERIFY_TOKEN (ולא את ה-challenge כמו אצל Meta).
//
// הגדרה נדרשת (פעם אחת):
// 1. Vercel → Settings → Environment Variables:
//      HOOKMYAPP_WEBHOOK_HMAC_SECRET = הסוד ש-HookMyApp מציג בהגדרת ה-Webhook
//      HOOKMYAPP_VERIFY_TOKEN        = ערך שבוחרים, ומוזן גם אצלם
//      WHATSAPP_WEBHOOK_SECRET       = אותו סוד פנימי שכבר שימש את Twilio/Meta
// 2. אצל HookMyApp מגדירים את כתובת ה-Webhook:
//      https://<כתובת-האתר>/api/whatsapp-webhook-hookmyapp
// 3. במסך "חיבור WhatsApp" באתר: ספק = HookMyApp, ומזהה חיצוני לפי מה שמופיע
//    בלוג של ההודעה הראשונה (ר' ההערה על resolveChannelId).

// Vercel מפרסר JSON אוטומטית ל-req.body, וזה הורס את הבייטים המקוריים. חתימת HMAC
// מחושבת מעל הבייטים בדיוק כפי שנשלחו, ולכן חייבים לכבות את הפירסור ולקרוא את
// הזרם בעצמנו. ריסריאליזציה של האובייקט המפורסר לא תיתן את אותה מחרוזת (סדר
// מפתחות, רווחים, escaping) והאימות היה נכשל תמיד.
export const config = { api: { bodyParser: false } };

const MAX_BODY_BYTES = 1_000_000;

async function readRawBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    // הכתובת ציבורית. בלי תקרה, בקשה עם גוף ענק הייתה מנפחת זיכרון עד קריסה.
    if (total > MAX_BODY_BYTES) throw new Error("body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function signatureMatches(rawBody, headerValue, secret) {
  if (!headerValue) return false;
  const received = String(headerValue).trim();
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  // timingSafeEqual זורק כששני הבאפרים באורך שונה, ולכן בודקים אורך תחילה. השוואה
  // רגילה עם === הייתה מדליפה מידע דרך זמן התגובה.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// מזהה הערוץ שאליו ההודעה שייכת - זה מה שמוזן במסך כ"מזהה חיצוני".
// המבנה תואם ל-Meta, אבל לא אומת מול חשבון HookMyApp אמיתי, ולכן נבדקים כמה
// מקומות סבירים ולא מנחשים אחד. אם אף אחד לא נמצא - נרשם לוג עם המפתחות שהגיעו
// בפועל, כך שההודעה הראשונה תגלה בדיוק מה להזין במסך, במקום לנחש מראש.
function resolveChannelId(value, body) {
  return (
    value?.metadata?.phone_number_id ??
    value?.metadata?.display_phone_number ??
    value?.channel_id ??
    body?.channel_id ??
    body?.channel ??
    null
  );
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const token = process.env.HOOKMYAPP_VERIFY_TOKEN;
    if (!token) {
      res.status(503).send("verify token not configured");
      return;
    }
    res.status(200).send(token);
    return;
  }

  if (req.method !== "POST") {
    res.status(405).send("method not allowed");
    return;
  }

  // הבדיקה הזו חייבת להישאר לפני כל בדיקת חתימה - ה-probe מגיע בלי חתימה בכוונה.
  if (req.headers["x-hookmyapp-probe"] === "webhook-verification") {
    res.status(200).send("ok");
    return;
  }

  const hmacSecret = process.env.HOOKMYAPP_WEBHOOK_HMAC_SECRET;
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!hmacSecret || !secret || !supabaseUrl || !anonKey) {
    res.status(503).send("webhook not configured");
    return;
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch {
    res.status(413).send("body too large");
    return;
  }

  if (!signatureMatches(rawBody, req.headers["x-hookmyapp-signature-256"], hmacSecret)) {
    // 401 ולא 200: בקשה לא חתומה אינה מ-HookMyApp, ואין סיבה להעמיד פנים שנקלטה.
    res.status(401).send("invalid signature");
    return;
  }

  try {
    const body = JSON.parse(rawBody.toString("utf8"));
    const value = body?.entry?.[0]?.changes?.[0]?.value;
    // אותה הגנה כמו במתאם של Meta: הגבלת כמות ובדיקת מערך, כדי ש-payload חריג לא
    // ייצור אלפי קריאות RPC רצופות.
    const messages = Array.isArray(value?.messages) ? value.messages.slice(0, 50) : [];
    const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
    const channelId = resolveChannelId(value, body);

    if (!channelId && messages.length > 0) {
      console.error(
        "hookmyapp: לא נמצא מזהה ערוץ. מפתחות ב-value:",
        Object.keys(value ?? {}).join(","),
        "| metadata:",
        JSON.stringify(value?.metadata ?? null),
      );
    }

    for (const msg of messages) {
      if (!channelId || !msg?.id) continue;
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
          p_external_group_id: String(channelId),
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
    console.error("whatsapp-webhook-hookmyapp error:", err);
  }

  // 200 מהיר על כל אירוע שעבר אימות, אחרת הספק ינסה שוב ויחשיב את ה-Webhook כלא אמין.
  res.status(200).send("EVENT_RECEIVED");
}
