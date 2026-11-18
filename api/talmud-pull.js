// Vercel Serverless Function - צעד אחד של משיכה מתלמוד (מיגרציה 118).
//
// המסך "משיכה מתלמוד" קורא לכאן כל כמה שניות כל עוד יש משיכה פעילה. כל קריאה
// עושה צעד אחד קצר, כדי להישאר בתוך מגבלת הזמן של הפונקציה:
//   מתחבר   → כניסה עם שם המשתמש והסיסמה של העמותה → תלמוד שולח SMS
//   ממתין לקוד → (המזכיר הקליד) שליחת הקוד
//   מוריד   → דוח אחד בכל צעד, עד שכל הדוחות ירדו
// החיבור לתלמוד (עוגיות ודף הקוד) נשמר בין צעד לצעד מוצפן, ונמחק בסוף.
// אף צעד לא מנסה שוב כניסה שנכשלה - כדי שהמשתמש בתלמוד לא יינעל.
//
// הגדרה (פעם אחת), לפי הקובץ secrets/talmud-worker.txt שמחוץ לקוד:
//   Vercel → Environment Variables: TALMUD_PRIVATE_KEY (זה הכל).
//   הסוד מול המסד נגזר מהמפתח (workerSecret), ובמסד רק הטביעה שלו (מיגרציה 120).

import crypto from "node:crypto";
import { STUDY_APPROVAL, TALMUD_REPORTS, createSession, downloadCertificate, downloadReport, login, submitSmsCode } from "./_talmud/client.js";

// אישורי לימודים: כמה תלמידים בכל צעד (כ-4 שניות לתלמיד), כדי להישאר בתוך מגבלת הזמן
const CERTIFICATES_PER_STEP = 5;

// המפתח כפי שהודבק ב-Vercel: בלי רווחים ושורות שנכנסו בהעתקה
const keyText = () => String(process.env.TALMUD_PRIVATE_KEY ?? "").replace(/\s+/g, "");

function privateKey() {
  const b64 = keyText();
  if (!b64) throw new Error("חסר TALMUD_PRIVATE_KEY בהגדרות השרת");
  return crypto.createPrivateKey({ key: Buffer.from(b64, "base64"), format: "der", type: "pkcs8" });
}

/** הסיסמה שהוצפנה בדפדפן (RSA-OAEP, SHA-256) */
export function decryptPassword(encryptedB64) {
  return crypto.privateDecrypt(
    { key: privateKey(), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(encryptedB64, "base64"),
  ).toString("utf8");
}

// החיבור בין צעד לצעד: AES-256-GCM, במפתח שנגזר מהמפתח הפרטי (אין סוד נוסף לנהל)
const stateKey = () => crypto.createHash("sha256").update("talmud-state:" + keyText()).digest();

export function sealState(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", stateKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

export function openState(sealed) {
  const buf = Buffer.from(sealed, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", stateKey(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8"));
}

/** הסוד מול המסד - נגזר מהמפתח הפרטי, כדי שלא יהיה עוד סוד לנהל */
export const workerSecret = () =>
  crypto.createHash("sha256").update("talmud-worker:" + keyText()).digest("hex");

async function rpc(name, args) {
  const res = await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${process.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ p_secret: workerSecret(), ...args }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const update = (jobOrgId, status, extra = {}) =>
  rpc("talmud_worker_update", {
    p_job_org_id: jobOrgId, p_status: status,
    p_message: extra.message ?? null, p_files_total: extra.filesTotal ?? null, p_state: extra.state ?? null,
  });

/** צעד אחד. מחזיר תיאור קצר של מה שנעשה (לבדיקה). */
export async function step() {
  const rows = await rpc("talmud_worker_next", {});
  const job = Array.isArray(rows) ? rows[0] : rows;
  if (!job) return { idle: true };

  const state = job.worker_state ? openState(job.worker_state) : null;
  const session = createSession({ manualCookies: true, cookies: state?.cookies ?? {} });
  const keep = (extra = {}) => sealState({ cookies: session.cookies(), ...extra });
  const certificates = job.kind === "certificates";
  const items = Array.isArray(job.items) ? job.items : [];
  const total = certificates ? items.length : TALMUD_REPORTS.length;

  try {
    if (job.status === "logging_in") {
      if (!job.username || !job.password_encrypted) {
        await update(job.job_org_id, "failed", { message: "אין משתמש תלמוד שמור לעמותה" });
        return { failed: "no credentials" };
      }
      const result = await login(session, job.username, decryptPassword(job.password_encrypted));
      if (result.step === "error") {
        await update(job.job_org_id, "failed", { message: result.message });
        return { failed: result.message };
      }
      if (result.step === "sms") {
        await update(job.job_org_id, "waiting_sms", { message: "נשלח SMS", state: keep({ smsPage: result.page }) });
        return { waiting: "sms" };
      }
      await update(job.job_org_id, "downloading", { filesTotal: total, state: keep() });
      return { loggedIn: true };
    }

    if (job.status === "waiting_sms") {
      const code = await rpc("talmud_worker_take_sms", { p_job_org_id: job.job_org_id });
      if (!code) return { waiting: "sms" };
      const result = await submitSmsCode(session, state.smsPage, code);
      if (!result.ok) {
        await update(job.job_org_id, "failed", { message: `${result.message}. אפשר להתחיל משיכה חדשה ולקבל קוד חדש.` });
        return { failed: result.message };
      }
      await update(job.job_org_id, "downloading", { message: "נכנס לתלמוד", filesTotal: total, state: keep() });
      return { loggedIn: true };
    }

    if (job.status === "downloading" && certificates) {
      let done = job.files_done;
      for (const item of items.slice(done, done + CERTIFICATES_PER_STEP)) {
        const cert = await downloadCertificate(session, item.external_id, item.name);
        if (cert.found) {
          await rpc("talmud_worker_add_file", {
            p_job_org_id: job.job_org_id, p_report_key: STUDY_APPROVAL.key, p_report_label: STUDY_APPROVAL.label,
            p_file_name: cert.fileName, p_file_type: cert.contentType, p_file_base64: Buffer.from(cert.bytes).toString("base64"),
            p_student_external_id: item.external_id,
          });
        } else {
          await rpc("talmud_worker_item_failed", {
            p_job_org_id: job.job_org_id, p_external_id: item.external_id, p_reason: "לא נמצא בתלמוד בעמותה הזו",
          });
        }
        done++;
      }
      const last = done >= items.length;
      await update(job.job_org_id, last ? "done" : "downloading", {
        message: last ? "הסתיים" : `${done} מתוך ${items.length}`,
        state: last ? null : keep(),
      });
      return { certificates: done };
    }

    if (job.status === "downloading") {
      const report = TALMUD_REPORTS[job.files_done];
      if (!report) {
        await update(job.job_org_id, "done", { message: `ירדו ${TALMUD_REPORTS.length} קבצים` });
        return { done: true };
      }
      const file = await downloadReport(session, report, job.month);
      await rpc("talmud_worker_add_file", {
        p_job_org_id: job.job_org_id, p_report_key: report.key, p_report_label: report.label,
        p_file_name: file.fileName, p_file_type: file.contentType, p_file_base64: Buffer.from(file.bytes).toString("base64"),
      });
      const last = job.files_done + 1 >= TALMUD_REPORTS.length;
      await update(job.job_org_id, last ? "done" : "downloading", {
        message: last ? `ירדו ${TALMUD_REPORTS.length} קבצים` : `ירד: ${report.label}`,
        state: last ? null : keep(),
      });
      return { downloaded: report.key };
    }

    return { idle: true };
  } catch (e) {
    const offline = /fetch failed|ENOTFOUND|ECONNRE|ETIMEDOUT|UND_ERR/i.test(String(e?.cause?.code ?? e?.message));
    const message = offline ? "השרת לא מצליח להתחבר לאתר תלמוד" : String(e?.message ?? e).slice(0, 300);
    await update(job.job_org_id, "failed", { message }).catch(() => {});
    return { failed: message };
  }
}

export default async function handler(req, res) {
  // בדיקת הגדרה: אורך המפתח וטביעה קצרה של הסוד (לא המפתח ולא הסוד) - להשוואה מול מיגרציה 120
  if (req.method === "GET" && req.query?.check !== undefined) {
    const k = keyText();
    // האם השרת מגיע לתלמוד, ואם לא - למה (חסימה, תעודת אבטחה, זמן)
    let talmud;
    try {
      const t0 = Date.now();
      const r = await fetch("https://talmud.edu.gov.il/Login.aspx", { redirect: "manual", signal: AbortSignal.timeout(15000) });
      talmud = { ok: true, status: r.status, ms: Date.now() - t0 };
    } catch (e) {
      talmud = { ok: false, error: String(e?.message ?? e).slice(0, 120), cause: String(e?.cause?.code ?? e?.cause?.message ?? "").slice(0, 120) };
    }
    return res.status(200).json({
      configured: Boolean(k), keyLength: k.length,
      fingerprint: k ? crypto.createHash("sha256").update(workerSecret()).digest("hex").slice(0, 8) : null,
      region: process.env.VERCEL_REGION ?? null,
      talmud,
    });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST בלבד" });
  if (!keyText()) {
    return res.status(500).json({ error: "המשיכה מתלמוד עוד לא הוגדרה בשרת" });
  }
  try {
    return res.status(200).json(await step());
  } catch (e) {
    return res.status(500).json({ error: String(e?.message ?? e).slice(0, 300) });
  }
}
