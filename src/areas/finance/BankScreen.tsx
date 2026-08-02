import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useLastSelected } from "@/lib/useLastSelected";
import { PageHeader } from "@/components/PageHeader";
import { Tabs } from "@/components/Tabs";
import { BankTransactionsPanel } from "./BankTransactionsScreen";
import { BankMatchingPanel } from "./BankMatchingScreen";
import { BankAutoSyncPanel } from "./BankAutoSyncScreen";

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

type BankTab = "transactions" | "matching" | "auto-sync";

// מחליף את שלושת המסכים הנפרדים שהיו (תנועות בנק / התאמות בנק / משיכה אוטומטית) -
// שלושתם עסקו באותו חשבון בנק ממש, וכל אחד דרש בחירת עמותה+חשבון בנפרד. כאן הבחירה
// היא פעם אחת, ומשותפת (וגם נזכרת בין ביקורים - useLastSelected) לשלושת הטאבים.
// אף לוגיקה/RPC לא השתנו - כל טאב הוא בדיוק אותו גוף מסך שהיה קודם, רק ללא בורר
// עמותה/חשבון עצמאי משלו.
export function BankScreen({ initialTab = "transactions" }: { initialTab?: BankTab }) {
  const [searchParams] = useSearchParams();
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });
  const [orgId, setOrgId] = useLastSelected<string>("last-org", "");
  const [accountId, setAccountId] = useLastSelected<string>("last-bank-account", "");
  const [tab, setTab] = useState<BankTab>(initialTab);

  // קישור מכרטיס חריגה בדשבורד הכספי מגיע עם ?org=<id> - עדיף על "הבחירה האחרונה"
  // הכללית, כי כאן המשתמשת בחרה במפורש איזו עמותה לבדוק.
  useEffect(() => {
    const fromUrl = searchParams.get("org");
    if (fromUrl) setOrgId(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bankAccountsQuery = useQuery({ queryKey: ["bank-org-accounts", orgId], queryFn: () => fetchOrgBankAccounts(orgId), enabled: !!orgId });

  return (
    <div>
      <PageHeader title="בנק" description="תנועות, התאמות, ומשיכה אוטומטית - הכל עבור אותו חשבון בנק." />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 max-w-2xl mb-4">
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

      <div className="mb-4">
        <Tabs
          tabs={[
            { key: "transactions", label: "תנועות" },
            { key: "matching", label: "התאמות" },
            { key: "auto-sync", label: "משיכה אוטומטית" },
          ]}
          activeTab={tab}
          onChange={(k) => setTab(k as BankTab)}
          ariaLabel="בנק"
        />
      </div>

      {!accountId && <p className="text-sm text-ink-subtle">בחרי עמותה וחשבון כדי להציג נתונים.</p>}

      {accountId && tab === "transactions" && <BankTransactionsPanel accountId={accountId} />}
      {accountId && tab === "matching" && <BankMatchingPanel orgId={orgId} accountId={accountId} />}
      {accountId && tab === "auto-sync" && <BankAutoSyncPanel accountId={accountId} />}
    </div>
  );
}
