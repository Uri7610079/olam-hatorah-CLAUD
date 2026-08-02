import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useLastSelected } from "@/lib/useLastSelected";
import { BankTransactionsPanel } from "@/areas/finance/BankTransactionsScreen";

interface OrgOption {
  id: string;
  legal_name: string;
}

interface BankAccountOption {
  id: string;
  bank_name: string | null;
  account_number_masked: string | null;
}

async function fetchOrgs(): Promise<OrgOption[]> {
  const { data, error } = await supabase.from("organizations").select("id, legal_name").eq("status", "active").order("legal_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchOrgBankAccounts(orgId: string): Promise<BankAccountOption[]> {
  const { data, error } = await supabase
    .from("organization_bank_accounts_view")
    .select("id, bank_name, account_number_masked")
    .eq("organization_id", orgId)
    .eq("is_active", true);
  if (error) throw error;
  return data ?? [];
}

// פאנל יבוא תנועות בנק עבור מרכז היבוא - עוטף את BankTransactionsPanel הקיים (מסך הבנק
// המאוחד, BankScreen.tsx) בבורר עמותה/חשבון עצמאי משלו, בלי לגעת בקובץ המקורי או
// בלוגיקת ה-fingerprint/commit_bank_import_batch שבתוכו. אין כפילות קוד יבוא - נעשה
// שימוש חוזר ישיר ברכיב עצמו, כולל היסטוריית יבוא, סיווג תנועות, וכל מה שבפאנל.
export function BankImportPanel() {
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });
  const [orgId, setOrgId] = useLastSelected<string>("last-org", "");
  const [accountId, setAccountId] = useLastSelected<string>("last-bank-account", "");

  const bankAccountsQuery = useQuery({ queryKey: ["bank-org-accounts", orgId], queryFn: () => fetchOrgBankAccounts(orgId), enabled: !!orgId });

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">יבוא תנועות בנק לחשבון עמותה. סיווג תנועה הוא הצעה/קטגוריה בלבד.</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 max-w-2xl">
        <div>
          <label className="field-label">עמותה</label>
          <select
            value={orgId}
            onChange={(e) => {
              setOrgId(e.target.value);
              setAccountId("");
            }}
            className="input-field"
          >
            <option value="">— בחרי —</option>
            {(orgsQuery.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.legal_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">חשבון עמותה</label>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="input-field" disabled={!orgId}>
            <option value="">— בחרי —</option>
            {(bankAccountsQuery.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.bank_name ?? "בנק"} · {a.account_number_masked}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!accountId && <p className="text-sm text-ink-subtle">בחרי עמותה וחשבון כדי להציג נתונים.</p>}
      {accountId && <BankTransactionsPanel accountId={accountId} />}
    </div>
  );
}
