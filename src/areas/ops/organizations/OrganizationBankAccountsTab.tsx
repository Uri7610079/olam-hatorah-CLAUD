import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { StatusBadge } from "@/components/StatusBadge";
import { SensitiveValue } from "@/components/SensitiveValue";
import type { OrganizationBankAccount } from "./types";

interface OrganizationBankAccountsTabProps {
  organizationId: string;
}

async function fetchBankAccounts(organizationId: string): Promise<OrganizationBankAccount[]> {
  const { data, error } = await supabase
    .from("organization_bank_accounts_view")
    .select(
      "id, organization_id, bank_name, bank_branch_code, account_number_masked, account_holder_name, currency, is_active, opened_at, closed_at",
    )
    .eq("organization_id", organizationId)
    .order("opened_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

const EMPTY_FORM = { bank_name: "", bank_branch_code: "", account_number: "", account_holder_name: "", opened_at: "" };

export function OrganizationBankAccountsTab({ organizationId }: OrganizationBankAccountsTabProps) {
  const queryClient = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("organizations", "manage");
  const { hasPermission: canReveal } = useHasPermission("bank_accounts", "view_sensitive");
  const query = useQuery({
    queryKey: ["organization-bank-accounts", organizationId],
    queryFn: () => fetchBankAccounts(organizationId),
  });

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["organization-bank-accounts", organizationId] });

  const activeCount = (query.data ?? []).filter((a) => a.is_active).length;

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error } = await supabase.from("organization_bank_accounts").insert({
      organization_id: organizationId,
      bank_name: form.bank_name || null,
      bank_branch_code: form.bank_branch_code || null,
      account_number: form.account_number || null,
      account_holder_name: form.account_holder_name || null,
      opened_at: form.opened_at || null,
    });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setForm(EMPTY_FORM);
    setShowAdd(false);
    refresh();
  };

  const closeAccount = async (id: string) => {
    const { error } = await supabase
      .from("organization_bank_accounts")
      .update({ is_active: false, closed_at: new Date().toISOString().slice(0, 10) })
      .eq("id", id);
    if (!error) refresh();
  };

  const columns: DataTableColumn<OrganizationBankAccount>[] = [
    { key: "bank", header: "בנק", render: (r) => r.bank_name ?? "—" },
    { key: "branch", header: "סניף", className: "tabular", render: (r) => r.bank_branch_code ?? "—" },
    {
      key: "account_number",
      header: "מספר חשבון",
      render: (r) => (
        <SensitiveValue
          masked={r.account_number_masked ?? "—"}
          canReveal={canReveal}
          onReveal={async () => {
            const { data, error } = await supabase.rpc("reveal_bank_account_number", { p_account_id: r.id });
            if (error) throw error;
            return data ?? "";
          }}
        />
      ),
    },
    { key: "holder", header: "בעל החשבון", render: (r) => r.account_holder_name ?? "—" },
    {
      key: "status",
      header: "סטטוס",
      render: (r) => <StatusBadge severity={r.is_active ? "ok" : "neutral"} label={r.is_active ? "פעיל" : "סגור"} />,
    },
    {
      key: "actions",
      header: "",
      render: (r) =>
        canManage && r.is_active ? (
          <button onClick={() => closeAccount(r.id)} className="text-xs text-red-600 underline hover:text-red-800">
            סגירת חשבון
          </button>
        ) : null,
    },
  ];

  return (
    <div>
      {activeCount > 1 && (
        <div className="mb-3">
          <StatusBadge severity="medium" label={`יש ${activeCount} חשבונות פעילים בו-זמנית — ודאי שזה מכוון`} />
        </div>
      )}

      {canManage && (
        <button onClick={() => setShowAdd((v) => !v)} className="btn-secondary mb-3 text-sm">
          {showAdd ? "סגירה" : "הוספת חשבון"}
        </button>
      )}

      {showAdd && (
        <form onSubmit={handleAdd} className="card mb-4 max-w-xl space-y-3 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label">בנק</label>
              <input value={form.bank_name} onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="field-label">סניף</label>
              <input value={form.bank_branch_code} onChange={(e) => setForm((f) => ({ ...f, bank_branch_code: e.target.value }))} className="input-field tabular" />
            </div>
            <div>
              <label className="field-label">מספר חשבון</label>
              <input value={form.account_number} onChange={(e) => setForm((f) => ({ ...f, account_number: e.target.value }))} className="input-field tabular" />
            </div>
            <div>
              <label className="field-label">בעל החשבון</label>
              <input value={form.account_holder_name} onChange={(e) => setForm((f) => ({ ...f, account_holder_name: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="field-label">תאריך פתיחה</label>
              <input type="date" value={form.opened_at} onChange={(e) => setForm((f) => ({ ...f, opened_at: e.target.value }))} className="input-field" />
            </div>
          </div>
          {error && <ErrorState message={error} />}
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? "שומרת…" : "הוספה"}
          </button>
        </form>
      )}

      <DataTable
        columns={columns}
        rows={query.data ?? []}
        rowKey={(r) => r.id}
        loading={query.isLoading}
        emptyTitle="אין חשבונות בנק רשומים"
        emptyIcon={Wallet}
      />
    </div>
  );
}
