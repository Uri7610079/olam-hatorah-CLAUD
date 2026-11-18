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
//   Vercel → Environment Variables: TALMUD_PRIVATE_KEY, TALMUD_WORKER_SECRET
//   Supabase → SQL Editor: insert into talmud_worker_config (secret) ...

import crypto from "node:crypto";
import { TALMUD_REPORTS, createSession, downloadReport, login, submitSmsCode } from "./_talmud/client.js";

function privateKey() {
  const b64 = process.env.TALMUD_PRIVATE_KEY;
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
const stateKey = () => crypto.createHash("sha256").update("talmud-state:" + process.env.TALMUD_PRIVATE_KEY).digest();

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

async function rpc(name, args) {
  const res = await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${process.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ p_secret: process.env.TALMUD_WORKER_SECRET, ...args }),
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
      await update(job.job_org_id, "downloading", { filesTotal: TALMUD_REPORTS.length, state: keep() });
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
      await update(job.job_org_id, "downloading", { message: "נכנס לתלמוד", filesTotal: TALMUD_REPORTS.length, state: keep() });
      return { loggedIn: true };
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
  if (req.method !== "POST") return res.status(405).json({ error: "POST בלבד" });
  if (!process.env.TALMUD_WORKER_SECRET || !process.env.TALMUD_PRIVATE_KEY) {
    return res.status(500).json({ error: "המשיכה מתלמוד עוד לא הוגדרה בשרת" });
  }
  try {
    return res.status(200).json(await step());
  } catch (e) {
    return res.status(500).json({ error: String(e?.message ?? e).slice(0, 300) });
  }
}
