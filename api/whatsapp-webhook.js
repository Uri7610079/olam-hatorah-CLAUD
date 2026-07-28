// Vercel Serverless Function - מתאם (adapter) בין ה-Webhook של Twilio (פורמט משלו,
// form-urlencoded) לבין ingest_whatsapp_message() ב-Supabase (מיגרציה 069/072).
// לכן צריך את הקובץ הזה בכלל: Twilio שולח שדות משלו (From/To/Body/MessageSid...),
// לא את השמות שה-RPC מצפה להם - מישהו צריך "לתרגם" ביניהם. זה רץ על Vercel (כמו שאר
// האתר), לא דורש שרת/מחשב שנשאר דלוק - בדיוק כמו api/parse-tasks.js.
//
// הגדרה נדרשת (פעם אחת):
// 1. Vercel → הפרויקט → Settings → Environment Variables → מוסיפים:
//      WHATSAPP_WEBHOOK_SECRET = (ערך אקראי וסודי שתבחרי - לא סיסמה קיימת)
// 2. אותו ערך בדיוק מוזן גם ב-Supabase (SQL Editor, פעם אחת):
//      insert into whatsapp_webhook_config (secret) values ('...')
//      on conflict (id) do update set secret = excluded.secret;
// 3. בקונסולת Twilio (WhatsApp Sandbox) מגדירים את ה-Webhook URL ל:
//      https://<כתובת-האתר-שלך>/api/whatsapp-webhook
//
// למה בלי אימות חתימת Twilio: ההגנה האמיתית היא ה-secret שנבדק בתוך Supabase עצמו
// (whatsapp_webhook_config, בלי אף policy - deny-all) - זה מספיק לשלב הבדיקה הראשוני
// עם Sandbox. אפשר להוסיף בהמשך אימות חתימה רשמי של Twilio (X-Twilio-Signature) אם
// עוברים מ-Sandbox לחיבור קבוע.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("method not allowed");
    return;
  }

  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!secret || !supabaseUrl || !anonKey) {
    res.status(503).send("webhook not configured");
    return;
  }

  const body = req.body ?? {};
  const externalGroupId = body.To; // מספר ה-WhatsApp של Twilio - קבוע לכל ההודעות, כי
  // אין "קבוצה" אמיתית ב-WhatsApp Business API - כולם שולחים לאותו מספר (ר' ההסבר
  // שניתן ל-Chani על ההבדל בין קבוצה למספר ייעודי).
  const sourceMessageId = body.MessageSid;
  const senderName = body.ProfileName || body.From || null;
  const messageText = body.Body || null;
  const attachmentUrl = body.NumMedia && Number(body.NumMedia) > 0 ? body.MediaUrl0 : null;

  if (!externalGroupId || !sourceMessageId) {
    // בקשה לא תקינה - מגיבים 200 בכל זאת כדי ש-Twilio לא ינסה שוב ושוב לשווא.
    res.status(200).send("ignored: missing fields");
    return;
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/ingest_whatsapp_message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({
        p_secret: secret,
        p_external_group_id: externalGroupId,
        p_source_message_id: sourceMessageId,
        p_sender_name: senderName,
        p_body: messageText,
        p_attachment_url: attachmentUrl,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error("ingest_whatsapp_message failed:", detail);
    }
  } catch (err) {
    console.error("whatsapp-webhook error:", err);
  }

  // Twilio מצפה לתשובה מהירה; TwiML ריק = לא שולחים תגובה אוטומטית חזרה לשולח
  // (בכוונה, לפי האפיון - "אין לשלוח הודעות אוטומטיות חזרה בשלב הראשון").
  res.setHeader("Content-Type", "text/xml");
  res.status(200).send("<Response></Response>");
}
