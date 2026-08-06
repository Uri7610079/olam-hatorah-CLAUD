// שולף את קוד ה-JS שמוטמע בתוך bank-scraper-portable.ps1 והופך אותו למודול שאפשר
// לבדוק - מחליף את הספרייה האמיתית של הבנקים בבדל, ואת הקריאה ל-main() ביצוא פונקציות.
// כך הבדיקות רצות מול הקוד האמיתי שירוץ מול הבנק, ולא מול עותק שעלול להתיישן.
'use strict';
const fs = require('fs');
const path = require('path');

const PS1 = path.resolve(__dirname, '..', 'bank-scraper-portable.ps1');
const OUT = path.resolve(__dirname, 'testable.js');

if (!fs.existsSync(PS1)) {
  console.error('לא נמצא ' + PS1);
  console.error('הקובץ הזה חייב לשבת בתיקיית "בדיקות" שלצד bank-scraper-portable.ps1.');
  process.exit(1);
}

// הקובץ נשמר עם BOM (נדרש כדי ש-PowerShell יקרא נכון עברית) - מסירים אותו לפני הפרסור.
const src = fs.readFileSync(PS1, 'utf8').replace(/^﻿/, '');

const marker = "$js = @'";
const start = src.indexOf(marker);
if (start === -1) {
  console.error("לא נמצא הבלוק \"$js = @'\" בתוך ה-PS1 - כנראה מבנה הקובץ השתנה.");
  process.exit(1);
}
const bodyStart = src.indexOf('\n', start) + 1;
const bodyEnd = src.indexOf("\n'@", bodyStart);
if (bodyEnd === -1) {
  console.error("לא נמצא סוף הבלוק (\"'@\") - כנראה מבנה הקובץ השתנה.");
  process.exit(1);
}

const js = src.slice(bodyStart, bodyEnd);

const requireLine = /^const \{ createScraper, CompanyTypes \} = require\('israeli-bank-scrapers'\);$/m;
// בלוק הארכת ה-redirect מייבא מודול פנימי של הספרייה - בבדיקות מחליפים אותו בבדל.
const navRequireLine = /^const _nav = require\('israeli-bank-scrapers\/lib\/helpers\/navigation'\);$/m;
const mainLine = /^main\(\)\.catch.*$/m;
if (!requireLine.test(js) || !navRequireLine.test(js) || !mainLine.test(js)) {
  console.error('מבנה ה-JS השתנה - שורת ה-require, בלוק ה-navigation או הקריאה ל-main() לא נמצאו כצפוי.');
  process.exit(1);
}

const testable = js
  .replace(requireLine, 'const CompanyTypes = new Proxy({}, { get: (_, p) => String(p) }); const createScraper = () => {};')
  .replace(navRequireLine, 'const _nav = { waitForRedirect: async () => {} };')
  .replace(mainLine, 'module.exports = { toPacket, toRows, toDateOnly, parseArgs };');

fs.writeFileSync(OUT, testable, 'utf8');
console.log('נבנה ' + path.basename(OUT) + ' מתוך ' + path.basename(PS1) + ' (' + js.split('\n').length + ' שורות)');
