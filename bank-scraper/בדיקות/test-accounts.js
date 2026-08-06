// הבאג השני: חיבור בנק אחד שמחזיר שני חשבונות.
const crypto = require('crypto');
const { toPacket, parseArgs } = require('./testable.js');

function pgFingerprint(accountId, r) {
  if (r.bank_transaction_id != null && r.bank_transaction_id !== '') return 'bankid:' + r.bank_transaction_id;
  const raw = [accountId, r.execution_date, r.value_date ?? '', r.direction,
    r.amount.toFixed(2), r.reference ?? '', r.description ?? ''].join('|');
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

let failures = 0;
const check = (name, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   -> ' + extra));
  if (!cond) failures++;
};

// שני חשבונות תחת אותו לוגין. שימו לב: identifier=1 קיים בשניהם - זה תקין לחלוטין,
// המזהה של הבנק ייחודי לכל חשבון בנפרד.
const accounts = [
  { accountNumber: '12-345-111111', balance: 5000, txns: [
    { identifier: 1, date: '2026-07-10T00:00:00.000Z', chargedAmount: -300, chargedCurrency: 'ILS', description: 'חשבון א - חיוב', status: 'completed' },
    { identifier: 2, date: '2026-07-11T00:00:00.000Z', chargedAmount: 1200, chargedCurrency: 'ILS', description: 'חשבון א - זיכוי', status: 'completed' },
  ] },
  { accountNumber: '12-345-222222', balance: 9000, txns: [
    { identifier: 1, date: '2026-07-10T00:00:00.000Z', chargedAmount: -750, chargedCurrency: 'ILS', description: 'חשבון ב - חיוב', status: 'completed' },
  ] },
];

const packet = toPacket('Bank Hapoalim', accounts);
const rows = packet.bank_transactions;

console.log('--- שיוך לחשבון ---');
check('3 תנועות נקלטו', rows.length === 3, String(rows.length));
check('לכל שורה יש account_number', rows.every((r) => r.account_number), JSON.stringify(rows.map((r) => r.account_number)));
check('התנועה של חשבון ב משויכת לחשבון ב',
  rows.find((r) => r.description === 'חשבון ב - חיוב').account_number === '12-345-222222', '');
check('by_account מדווח על שני חשבונות', packet.by_account.length === 2, JSON.stringify(packet.by_account));
check('הספירה לכל חשבון נכונה',
  packet.by_account[0].imported === 2 && packet.by_account[1].imported === 1, JSON.stringify(packet.by_account));

console.log('--- אבידת הנתונים שנמנעה ---');
// לפני התיקון: הכל היה נכנס לחשבון אחד, ושתי התנועות עם identifier=1 היו מקבלות
// טביעת אצבע זהה - unique (account_id, fingerprint) היה דוחה את השנייה בשקט.
const ACC_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ACC_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const merged = rows.map((r) => pgFingerprint(ACC_A, r)); // התנהגות הבאג: הכל לחשבון אחד
check('שחזור הבאג: מיזוג לחשבון אחד אכן יוצר התנגשות',
  new Set(merged).size < merged.length, 'לא שוחזר - ' + merged.join(', '));

// אחרי התיקון: מפצלים לפי account_number, כל קבוצה לחשבון שלה בדאטהבייס
const idFor = { '12-345-111111': ACC_A, '12-345-222222': ACC_B };
const split = rows.map((r) => idFor[r.account_number] + ' :: ' + pgFingerprint(idFor[r.account_number], r));
check('אחרי הפיצול אין שום התנגשות', new Set(split).size === split.length, split.join('\n        '));
check('שתי התנועות עם identifier=1 שורדות שתיהן',
  split.filter((s) => s.endsWith('bankid:1')).length === 2, split.join('\n        '));

console.log('--- ‎--out ---');
const a = parseArgs(['node', 'x', '--out', 'C:\\Projects-CRM\\Torah-World\\bank-XL']);
check('נתיב הפלט נקלט', /bank-XL$/.test(a.out), a.out);

// החוזה החדש: ערך שגוי ל---days הוא שגיאה עוצרת, לא נפילה שקטה ל-45.
// parseArgs קורא process.exit - בודקים זאת בתהליך-בן כדי לא להפיל את הבדיקות.
const { execFileSync } = require('child_process');
function argsExitCode(extra) {
  try {
    execFileSync(process.execPath, ['-e',
      'const {parseArgs}=require(' + JSON.stringify(require.resolve('./testable.js')) + ');' +
      'parseArgs(["node","x"].concat(' + JSON.stringify(extra) + '));'],
      { stdio: 'pipe' });
    return 0;
  } catch (e) { return e.status; }
}
check('--days 0 נעצר בשגיאה', argsExitCode(['--days', '0']) === 1, '');
check('--days abc נעצר בשגיאה', argsExitCode(['--days', 'abc']) === 1, '');
check('--bank בלי ערך נעצר בשגיאה', argsExitCode(['--bank']) === 1, '');
check('דגל לא מוכר נעצר בשגיאה', argsExitCode(['--nope']) === 1, '');
check('--days 60 נקלט', parseArgs(['node', 'x', '--days', '60']).days === 60, '');

console.log(failures === 0 ? '\nכל הבדיקות עברו.' : '\n' + failures + ' נכשלו.');
process.exitCode = failures === 0 ? 0 : 1;
