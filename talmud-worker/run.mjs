// משיכה מתלמוד - העובד במחשב רגיל.
//
// תלמוד חוסם שרתי ענן (גם את Vercel), אבל עונה למחשבים רגילים. לכן הצעדים
// עצמם - כניסה, קוד SMS, הורדת הדוחות - רצים כאן, באותו קוד בדיוק כמו
// api/talmud-pull.js. המסך במערכת לא משתנה: המזכיר לוחץ ומקליד את הקוד מכל
// מחשב, והתוכנית הזו (במחשב אחד שדלוק) רואה את הבקשה במסד ומבצעת אותה.
//
// הרצה:   node talmud-worker/run.mjs [נתיב לקובץ המפתח]
// ברירת מחדל לקובץ המפתח: ..\secrets\talmud-worker.txt (מחוץ לקוד, לא בגיט).
// כתובת המסד והמפתח הציבורי שלו - מ-app/.env (אותם ערכים שבאתר).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");

function loadEnv() {
  const envFile = path.join(APP, ".env");
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY)\s*=\s*(.+?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  const keyFile = process.argv[2] ?? path.resolve(APP, "..", "secrets", "talmud-worker.txt");
  if (!process.env.TALMUD_PRIVATE_KEY && fs.existsSync(keyFile)) {
    const key = fs.readFileSync(keyFile, "utf8").match(/^([A-Za-z0-9+/=]{1000,})$/m)?.[1];
    if (key) process.env.TALMUD_PRIVATE_KEY = key;
  }
  const missing = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "TALMUD_PRIVATE_KEY"].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`חסר: ${missing.join(", ")} (קובץ המפתח: ${keyFile})`);
    process.exit(1);
  }
}

loadEnv();
const { step, canReachTalmud } = await import("../api/talmud-pull.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toLocaleTimeString("he-IL");

console.log(`[${stamp()}] העובד של משיכה מתלמוד פועל. תלמוד ${(await canReachTalmud(8000)) ? "זמין" : "לא זמין כרגע"}.`);

let idleSince = Date.now();
for (;;) {
  try {
    const result = await step();
    if (result.idle) {
      // בלי עבודה: בדיקה כל 3 שניות (המזכיר מחכה לתגובה אחרי לחיצה)
      if (result.unreachable && Date.now() - idleSince > 60_000) {
        console.log(`[${stamp()}] תלמוד לא זמין מהמחשב הזה`);
        idleSince = Date.now();
      }
      await sleep(3000);
      continue;
    }
    idleSince = Date.now();
    // בלי פרטים אישיים ביומן - רק מה קרה
    console.log(`[${stamp()}] ${JSON.stringify(result).slice(0, 160)}`);
    if (result.waiting) await sleep(2000);
  } catch (e) {
    console.log(`[${stamp()}] שגיאה: ${String(e?.message ?? e).slice(0, 200)}`);
    await sleep(5000);
  }
}
