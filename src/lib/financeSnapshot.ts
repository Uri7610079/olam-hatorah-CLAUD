import { supabase } from "./supabase";
import { fetchAll, fetchAllIn } from "./fetchAll";

// תמונת מצב חודשית לעמותה: יתרה בבנק, נכנס/יצא החודש ומה שולם לקבוצות.
// עונה במקום אחד על מה שאיש הכספים חיפש בארבעה-חמישה מסכים. קריאה בלבד.

export interface AccountBalance {
  accountId: string;
  label: string;
  balance: number | null;
  asOf: string | null; // תאריך (YYYY-MM-DD) שהיתרה נכונה אליו
  source: "bank_report" | "last_transaction" | null;
}

export interface FinanceSnapshot {
  accounts: AccountBalance[];
  totalBalance: number | null; // סכום החשבונות שיש להם יתרה ידועה
  balanceMissing: number; // כמה חשבונות בלי יתרה ידועה
  moneyIn: number;
  moneyOut: number;
  inCount: number;
  outCount: number;
  paidCompleted: number; // מס"ב שבוצע בבנק, עבור החודש
  paidTransmitted: number; // מס"ב ששודר ועוד לא סומן כבוצע
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** סכומי כניסה ויציאה מתנועות בנק. credit = נכנס, debit = יצא. */
export function sumBankMovements(rows: { direction: string; amount: number | string }[]) {
  let moneyIn = 0, moneyOut = 0, inCount = 0, outCount = 0;
  for (const r of rows) {
    const amount = Number(r.amount) || 0;
    if (r.direction === "credit") { moneyIn += amount; inCount++; }
    else if (r.direction === "debit") { moneyOut += amount; outCount++; }
  }
  return { moneyIn: round2(moneyIn), moneyOut: round2(moneyOut), inCount, outCount };
}

/** סכומי מס"ב לחודש: מה בוצע בבנק ומה שודר ומחכה. אצוות בטיוטה/בוטלו לא נספרות. */
export function sumMasavPaid(batches: { status: string; total_amount: number | string }[]) {
  let paidCompleted = 0, paidTransmitted = 0;
  for (const b of batches) {
    const amount = Number(b.total_amount) || 0;
    if (b.status === "bank_completed") paidCompleted += amount;
    else if (b.status === "transmitted") paidTransmitted += amount;
  }
  return { paidCompleted: round2(paidCompleted), paidTransmitted: round2(paidTransmitted) };
}

/**
 * היתרה של כל חשבון: קודם היתרה שהבנק עצמו דיווח בריצת המשיכה האחרונה (המדויקת ביותר),
 * ואם אין - היתרה שבתנועה האחרונה שנקלטה. כשאין אף אחת - "לא ידועה", לא אפס.
 */
export function pickBalances(
  accounts: { id: string; label: string }[],
  bankReports: { accountId: string; balance: number | string; at: string }[],
  lastTransactions: { accountId: string; balance: number | string; date: string }[],
): { accounts: AccountBalance[]; totalBalance: number | null; balanceMissing: number } {
  const latestReport = new Map<string, { balance: number; at: string }>();
  for (const r of bankReports) {
    const prev = latestReport.get(r.accountId);
    if (!prev || r.at > prev.at) latestReport.set(r.accountId, { balance: Number(r.balance), at: r.at });
  }
  const latestTx = new Map<string, { balance: number; date: string }>();
  for (const t of lastTransactions) {
    const prev = latestTx.get(t.accountId);
    if (!prev || t.date > prev.date) latestTx.set(t.accountId, { balance: Number(t.balance), date: t.date });
  }
  const result: AccountBalance[] = accounts.map((a) => {
    const rep = latestReport.get(a.id);
    const tx = latestTx.get(a.id);
    // דיווח בנק ישן מהתנועה האחרונה - התנועה עדכנית יותר
    if (rep && (!tx || rep.at.slice(0, 10) >= tx.date)) {
      return { accountId: a.id, label: a.label, balance: round2(rep.balance), asOf: rep.at.slice(0, 10), source: "bank_report" };
    }
    if (tx) return { accountId: a.id, label: a.label, balance: round2(tx.balance), asOf: tx.date, source: "last_transaction" };
    return { accountId: a.id, label: a.label, balance: null, asOf: null, source: null };
  });
  const known = result.filter((r) => r.balance !== null);
  return {
    accounts: result,
    totalBalance: known.length ? round2(known.reduce((s, r) => s + (r.balance ?? 0), 0)) : null,
    balanceMissing: result.length - known.length,
  };
}

function nextMonth(start: string): string {
  const y = Number(start.slice(0, 4));
  const m = Number(start.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

export async function fetchFinanceSnapshot(orgId: string, month: string): Promise<FinanceSnapshot> {
  const start = month.slice(0, 7) + "-01";
  const end = nextMonth(start);

  const { data: accountRows, error: accErr } = await supabase
    .from("organization_bank_accounts_view")
    .select("id, bank_name, account_number_masked, is_active")
    .eq("organization_id", orgId)
    .eq("is_active", true);
  if (accErr) throw accErr;
  const accounts = (accountRows ?? []).map((a) => ({
    id: a.id as string,
    label: [a.bank_name, a.account_number_masked].filter(Boolean).join(" "),
  }));
  const ids = accounts.map((a) => a.id);

  const [movements, masav, reports, lastTx] = await Promise.all([
    ids.length
      ? fetchAllIn(ids, (chunk) => supabase.from("bank_transactions").select("id, direction, amount")
          .in("organization_bank_account_id", chunk).gte("execution_date", start).lt("execution_date", end).order("id"))
      : Promise.resolve([]),
    fetchAll(() => supabase.from("masav_batches").select("id, status, total_amount")
      .eq("organization_id", orgId).eq("period_month", start).in("status", ["transmitted", "bank_completed"]).order("id")),
    // היתרה שהבנק דיווח - רק בחשבונות שמשיכה אוטומטית מחוברת אליהם
    ids.length
      ? supabase.from("bank_auto_sync_runs")
          .select("bank_reported_balance, finished_at, setting:bank_auto_sync_settings!inner(organization_bank_account_id)")
          .in("setting.organization_bank_account_id", ids)
          .not("bank_reported_balance", "is", null)
          .not("finished_at", "is", null)
          .order("finished_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [], error: null }),
    // התנועה האחרונה עם יתרה, לכל חשבון בנפרד
    Promise.all(ids.map((id) => supabase.from("bank_transactions")
      .select("execution_date, bank_balance_after, created_at")
      .eq("organization_bank_account_id", id)
      .not("bank_balance_after", "is", null)
      .order("execution_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .then((r) => {
        if (r.error) throw r.error;
        const row = r.data?.[0];
        return row ? { accountId: id, balance: row.bank_balance_after as number, date: row.execution_date as string } : null;
      }))),
  ]);

  // דיווחי הבנק אינם חובה: חשבון בלי משיכה אוטומטית, או שגיאה בקריאתם - נופלים לתנועה האחרונה
  const reportRows = "error" in reports && reports.error ? [] : ((reports as { data: any[] | null }).data ?? []);
  const bankReports = reportRows.map((r: any) => {
    const setting = Array.isArray(r.setting) ? r.setting[0] : r.setting;
    return { accountId: setting?.organization_bank_account_id as string, balance: r.bank_reported_balance, at: r.finished_at as string };
  }).filter((r) => !!r.accountId);

  const balances = pickBalances(accounts, bankReports, lastTx.filter((t): t is NonNullable<typeof t> => t !== null));
  return {
    ...balances,
    ...sumBankMovements(movements as { direction: string; amount: number }[]),
    ...sumMasavPaid((masav ?? []) as { status: string; total_amount: number }[]),
  };
}
