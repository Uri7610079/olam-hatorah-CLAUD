import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tags } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ErrorState } from "@/components/ErrorState";

interface TransactionType {
  id: string;
  code: string;
  label_he: string;
  is_active: boolean;
}

async function fetchTypes(): Promise<TransactionType[]> {
  const { data, error } = await supabase.from("bank_transaction_types").select("id, code, label_he, is_active").order("label_he");
  if (error) throw error;
  return data ?? [];
}

const EMPTY_FORM = { code: "", label_he: "" };

export function TransactionTypesScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("transaction_classification", "perform");
  const query = useQuery({ queryKey: ["bank-transaction-types"], queryFn: fetchTypes });

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["bank-transaction-types"] });

  const submitType = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error: err } = await supabase.from("bank_transaction_types").insert({ code: form.code, label_he: form.label_he });
    setSubmitting(false);
    if (err) {
      setError(err.message.includes("duplicate") ? "קוד זה כבר קיים." : err.message);
      return;
    }
    setForm(EMPTY_FORM);
    setShowAdd(false);
    refresh();
  };

  const toggleActive = async (row: TransactionType) => {
    await supabase.from("bank_transaction_types").update({ is_active: !row.is_active }).eq("id", row.id);
    refresh();
  };

  const columns: DataTableColumn<TransactionType>[] = [
    { key: "code", header: "קוד", className: "tabular", render: (r) => r.code },
    { key: "label", header: "תיאור", render: (r) => r.label_he },
    { key: "status", header: "סטטוס", render: (r) => <StatusBadge severity={r.is_active ? "ok" : "neutral"} label={r.is_active ? "פעיל" : "לא פעיל"} /> },
    {
      key: "actions",
      header: "",
      render: (r) =>
        canManage ? (
          <button onClick={() => toggleActive(r)} className="link-action text-xs">
            {r.is_active ? "השבתה" : "הפעלה"}
          </button>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="סוגי תנועות בנק"
        description="קטלוג סוגי התנועה לצורך סיווג. 13 הסוגים הבסיסיים לפי האפיון כבר קיימים - הוספה כאן היא להרחבה עתידית בלבד."
        primaryAction={
          canManage && (
            <button onClick={() => setShowAdd((v) => !v)} className="btn-primary">
              {showAdd ? "סגירה" : "סוג חדש"}
            </button>
          )
        }
      />

      {showAdd && (
        <form onSubmit={submitType} className="card mb-4 max-w-lg space-y-3 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label">קוד</label>
              <input required value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} className="input-field tabular" />
            </div>
            <div>
              <label className="field-label">תיאור</label>
              <input required value={form.label_he} onChange={(e) => setForm((f) => ({ ...f, label_he: e.target.value }))} className="input-field" />
            </div>
          </div>
          {error && <ErrorState message={error} />}
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? "שומרת…" : "הוספה"}
          </button>
        </form>
      )}

      <DataTable columns={columns} rows={query.data ?? []} rowKey={(r) => r.id} loading={query.isLoading} emptyTitle="אין סוגי תנועה" emptyIcon={Tags} />
    </div>
  );
}
