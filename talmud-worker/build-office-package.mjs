// בונה את חבילת ההתקנה של "משיכה מתלמוד" למחשב המשרד.
//
//   node talmud-worker/build-office-package.mjs
//
// התוצר - מחוץ לתיקיית הקוד, כי יש בו את מפתח העובד (config.json):
//   ..\משיכה מתלמוד - למחשב המשרד\        תיקייה מוכנה
//   ..\משיכה מתלמוד - למחשב המשרד.zip     אותה תיקייה כקובץ אחד, להעברה
// במחשב המשרד: מחלצים, ולחיצה כפולה על "התקנה.bat".

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const ROOT = path.resolve(APP, "..");
const OUT = path.join(ROOT, "משיכה מתלמוד - למחשב המשרד");
const ZIP = `${OUT}.zip`;

// ---- הגדרות: כתובת המסד והמפתח הציבורי שלו (מהאתר), ומפתח העובד (מחוץ לקוד) ----
const env = {};
for (const name of [".env.local", ".env"]) {
  const file = path.join(APP, name);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY)\s*=\s*(.+?)\s*$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const keyFile = path.join(ROOT, "secrets", "talmud-worker.txt");
const key = fs.existsSync(keyFile) ? fs.readFileSync(keyFile, "utf8").match(/^([A-Za-z0-9+/=]{1000,})$/m)?.[1] : null;
if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY || !key) {
  console.error("חסר: כתובת המסד / המפתח הציבורי (app/.env.local) או מפתח העובד (secrets/talmud-worker.txt)");
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// ---- התוכנית: קובץ אחד, בלי תלויות (רק Node) ----
await build({
  entryPoints: [path.join(HERE, "run.mjs")],
  outfile: path.join(OUT, "talmud-worker.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  legalComments: "none",
  logLevel: "warning",
});

fs.writeFileSync(path.join(OUT, "config.json"), JSON.stringify({
  supabaseUrl: env.VITE_SUPABASE_URL,
  supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY,
  talmudPrivateKey: key,
}, null, 2));

// PowerShell 5.1 קורא עברית נכון רק מקובץ UTF-8 עם BOM
const BOM = "\uFEFF";
for (const f of ["install.ps1", "start-worker.ps1", "uninstall.ps1"]) {
  fs.writeFileSync(path.join(OUT, f), BOM + fs.readFileSync(path.join(HERE, "office", f), "utf8").replace(/\r?\n/g, "\r\n"));
}

// קבצי bat - בלי עברית בתוכם (cmd), רק בשם הקובץ
const bat = (script, pause) => `@echo off\r\nchcp 65001 >nul\r\npowershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0${script}"\r\n${pause ? "pause\r\n" : ""}`;
fs.writeFileSync(path.join(OUT, "התקנה.bat"), bat("install.ps1", true));
fs.writeFileSync(path.join(OUT, "הסרה.bat"), bat("uninstall.ps1", true));

fs.writeFileSync(path.join(OUT, "קרא אותי.txt"), BOM + [
  "משיכה מתלמוד - התקנה במחשב המשרד",
  "",
  "למה צריך את זה: תלמוד חוסם שרתי ענן, אבל עונה למחשבים רגילים. התוכנית הקטנה הזו",
  "עושה את הכניסה לתלמוד ואת ההורדות מהמחשב הזה. הכפתור והקוד נשארים במערכת, מכל מחשב.",
  "",
  "התקנה (פעם אחת):",
  "  1. להעתיק את כל התיקייה למחשב המשרד, למשל ל- C:\\משיכה מתלמוד",
  "     (לא לתיקייה שמסונכרנת לענן כמו OneDrive / Google Drive).",
  "  2. לחיצה כפולה על \"התקנה.bat\". בפעם הראשונה צריך אינטרנט (אם אין Node במחשב - יורד לבד).",
  "  3. בסוף צריך להופיע: ההתקנה הסתיימה.",
  "",
  "אחרי ההתקנה התוכנית עולה לבד בכל הדלקה של המחשב (בדיקה כל 5 דקות), רצה ברקע בלי חלון.",
  "המחשב צריך להיות דלוק ומחובר כשלוחצים \"משיכה\" במערכת.",
  "",
  "יומן: worker.log בתיקייה הזו. הסרה: \"הסרה.bat\".",
  "",
  "חשוב: config.json מכיל מפתח סודי. לא לשלוח את התיקייה לאף אחד ולא להעלות אותה לשום מקום.",
].join("\r\n"));

// ---- ZIP להעברה ----
fs.rmSync(ZIP, { force: true });
execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${OUT}\\*' -DestinationPath '${ZIP}' -Force`]);

console.log(`נבנתה החבילה: ${OUT}`);
console.log(`וגם: ${ZIP}`);
