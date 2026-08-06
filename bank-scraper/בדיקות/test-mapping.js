// בדיקה שהמיפוי מייצר בדיוק את מה ש-ingest_bank_transactions_batch מצפה לו,
// ושטביעת האצבע יוצאת זהה לזו של compute_bank_fingerprint ב-Postgres.
const crypto = require('crypto');
const { toPacket, toDateOnly } = require('./testable.js');

// שכפול מדויק של compute_bank_fingerprint (מיגרציה 074, שורה 104)
function pgFingerprint(accountId, r) {
  if (r.bank_transaction_id != null && r.bank_transaction_id !== '') {
    return 'bankid:' + r.bank_transaction_id;
  }
  const raw = [accountId, r.execution_date, r.value_date ?? '', r.direction,
    r.amount.toFixed(2), r.reference ?? '', r.description ?? ''].join('|');
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

const ACC = '11111111-2222-3333-4444-555555555555';

// תנועות בפורמט האמיתי של israeli-bank-scrapers
const accounts = [{
  accountNumber: '12-345-678901',
  balance: 15230.55,
  txns: [
    { type: 'normal', identifier: 998877, date: '2026-07-14T00:00:00.000Z', processedDate: '2026-07-15T00:00:00.000Z',
      originalAmount: -1250.5, originalCurrency: 'ILS', chargedAmount: -1250.5, chargedCurrency: 'ILS',
      description: 'העברה לספק', memo: 'חשבונית 4471', status: 'completed' },
    { type: 'normal', identifier: 998878, date: '2026-07-16T00:00:00.000Z', processedDate: null,
      originalAmount: 8000, originalCurrency: 'ILS', chargedAmount: 8000, chargedCurrency: 'ILS',
      description: 'זיכוי תרומה', memo: null, status: 'completed' },
    // ללא מזהה בנק - חייב ליפול לגיבוב
    { type: 'normal', date: '2026-07-17T00:00:00.000Z', originalAmount: -99.9, originalCurrency: 'ILS',
      chargedAmount: -99.9, chargedCurrency: 'ILS', description: 'עמלת ניהול', status: 'completed' },
    // ממתינה - חייבת להיפסל
    { type: 'normal', identifier: 998879, date: '2026-07-18T00:00:00.000Z', originalAmount: -500,
      chargedAmount: -500, chargedCurrency: 'ILS', description: 'הוראת קבע', status: 'pending' },
    // מט"ח - חייבת להיפסל (אין עמודת מטבע ביעד)
    { type: 'normal', identifier: 998880, date: '2026-07-18T00:00:00.000Z', originalAmount: -100,
      originalCurrency: 'USD', chargedAmount: -370, chargedCurrency: 'USD', description: 'חיוב דולרי', status: 'completed' },
    // תנועה בחצות בשעון ישראל - מבחן הסטת אזור-זמן
    { type: 'normal', identifier: 998881, date: new Date(2026, 6, 19, 0, 30), originalAmount: -20,
      chargedAmount: -20, chargedCurrency: 'ILS', description: 'משיכת מזומן', status: 'completed' },
  ],
}];

const packet = toPacket('Bank Hapoalim', accounts);
const rows = packet.bank_transactions;

let failures = 0;
const check = (name, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   -> ' + extra));
  if (!cond) failures++;
};

console.log('--- סינון ---');
check('4 תנועות נקלטו (2 נפסלו)', rows.length === 4, 'קיבלתי ' + rows.length);
check('ממתינה נפסלה', packet.skipped.pending === 1, JSON.stringify(packet.skipped));
check('מט"ח נפסל', packet.skipped.foreignCurrency === 1, JSON.stringify(packet.skipped));

console.log('--- חוזה השדות ---');
const REQUIRED = ['execution_date', 'value_date', 'direction', 'amount', 'description',
  'reference', 'operation_type', 'bank_balance_after', 'bank_transaction_id'];
check('כל השדות הנדרשים קיימים בכל שורה',
  rows.every((r) => REQUIRED.every((f) => f in r)),
  'חסר שדה');
check('execution_date תמיד קיים (עמודת not null)',
  rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.execution_date)), '');
check('direction תמיד debit/credit', rows.every((r) => r.direction === 'debit' || r.direction === 'credit'), '');
check('amount תמיד חיובי (check amount > 0)', rows.every((r) => r.amount > 0), '');
check('amount מעוגל ל-2 ספרות (numeric(12,2))',
  rows.every((r) => Math.round(r.amount * 100) === r.amount * 100), '');

console.log('--- הבאג שדווח ---');
const t0 = rows[0];
check('המזהה הרשמי נמצא ב-bank_transaction_id', t0.bank_transaction_id === '998877', String(t0.bank_transaction_id));
check('המזהה כבר לא ב-reference', t0.reference === null, String(t0.reference));
check('חיוב זוהה נכון ככיוון debit', t0.direction === 'debit' && t0.amount === 1250.5, JSON.stringify(t0));
check('זיכוי זוהה נכון ככיוון credit', rows[1].direction === 'credit' && rows[1].amount === 8000, JSON.stringify(rows[1]));

console.log('--- טביעת אצבע ---');
const fps = rows.map((r) => pgFingerprint(ACC, r));
check('3 שורות מקבלות דדופ חזק', fps.filter((f) => f.startsWith('bankid:')).length === 3, fps.join('\n        '));
check('שורה בלי מזהה נופלת לגיבוב', fps.filter((f) => !f.startsWith('bankid:')).length === 1, '');
check('הדיווח בפלט תואם', packet.dedup.strong_bank_id === 3 && packet.dedup.weak_hash_fallback === 1, JSON.stringify(packet.dedup));
check('אין התנגשות בין טביעות אצבע', new Set(fps).size === fps.length, '');

console.log('--- יציבות בין משיכות (לב הבאג) ---');
// הבנק שינה את התיאור בין משיכה למשיכה - תרחיש אמיתי לגמרי
const changed = JSON.parse(JSON.stringify(accounts));
changed[0].txns[0].description = 'העברה לספק בע"מ';
changed[0].txns[0].memo = 'חשבונית 4471 - סופי';
changed[0].txns[2].description = 'עמלת ניהול חשבון';
const rows2 = toPacket('Bank Hapoalim', changed).bank_transactions;
check('תנועה עם מזהה בנק שומרת על אותה טביעת אצבע למרות שינוי התיאור',
  pgFingerprint(ACC, rows2[0]) === fps[0], pgFingerprint(ACC, rows2[0]) + ' != ' + fps[0]);
check('תנועה בלי מזהה אכן מקבלת טביעת אצבע חדשה (מגבלת המנגנון החלש, מדווחת בפלט)',
  pgFingerprint(ACC, rows2[2]) !== fps[2], '');

console.log('--- אזור זמן ---');
check('תנועה ב-00:30 בשעון ישראל נשארת ב-19 בחודש ולא זולגת ל-18',
  rows[3].execution_date === '2026-07-19', rows[3].execution_date);
check('toDateOnly שומר על מחרוזת ISO כפי שהיא', toDateOnly('2026-07-14T00:00:00.000Z') === '2026-07-14', '');
check('value_date ריק מתורגם ל-null ולא למחרוזת', rows[1].value_date === null, String(rows[1].value_date));

console.log(failures === 0 ? '\nכל הבדיקות עברו.' : '\n' + failures + ' בדיקות נכשלו.');
process.exitCode = failures === 0 ? 0 : 1;
