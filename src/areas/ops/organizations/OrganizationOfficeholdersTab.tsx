import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { OFFICEHOLDER_ROLE_LABEL, type OrganizationOfficeholder } from "./types";

interface OrganizationOfficeholdersTabProps {
  organizationId: string;
}

async function fetchOfficeholders(organizationId: string): Promise<OrganizationOfficeholder[]> {
  const { data, error } = await supabase
    .from("organization_officeholders")
    .select("id, organization_id, full_name, role_type, role_title, id_number, phone, tenure_start, tenure_end")
    .eq("organization_id", organizationId)
    .order("tenure_start", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

interface OfficeholderFormState {
  full_name: string;
  role_type: OrganizationOfficeholder["role_type"];
  role_title: string;
  id_number: string;
  phone: string;
  tenure_start: string;
}

const EMPTY_FORM: OfficeholderFormState = {
  full_name: "",
  role_type: "committee_member",
  role_title: "",
  id_number: "",
  phone: "",
  tenure_start: "",
};

export function OrganizationOfficeholdersTab({ organizationId }: OrganizationOfficeholdersTabProps) {
  const queryClient = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("organizations", "manage");
  const query = useQuery({
    queryKey: ["organization-officeholders", organizationId],
    queryFn: () => fetchOfficeholders(organizationId),
  });

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["organization-officeholders", organizationId] });

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error } = await supabase.from("organization_officeholders").insert({
      organization_id: organizationId,
      full_name: form.full_name,
      role_type: form.role_type,
      role_title: form.role_title || null,
      id_number: form.id_number || null,
      phone: form.phone || null,
      tenure_start: form.tenure_start || null,
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

  const endTenure = async (id: string) => {
    const { error } = await supabase
      .from("organization_officeholders")
      .update({ tenure_end: new Date().toISOString().slice(0, 10) })
      .eq("id", id);
    if (!error) refresh();
  };

  const columns: DataTableColumn<OrganizationOfficeholder>[] = [
    { key: "full_name", header: "שם", render: (r) => r.full_name },
    { key: "role", header: "תפקיד", render: (r) => `${OFFICEHOLDER_ROLE_LABEL[r.role_type]}${r.role_title ? ` — ${r.role_title}` : ""}` },
    { key: "id_number", header: 'ת"ז', className: "tabular", render: (r) => r.id_number ?? "—" },
    { key: "phone", header: "טלפון", render: (r) => r.phone ?? "—" },
    { key: "tenure_start", header: "תחילת כהונה", className: "tabular", render: (r) => r.tenure_start ?? "—" },
    {
      key: "actions",
      header: "",
      render: (r) =>
        canManage && !r.tenure_end ? (
          <button onClick={() => endTenure(r.id)} className="text-xs text-red-600 underline hover:text-red-800">
            סיום כהונה
          </button>
        ) : r.tenure_end ? (
          <span className="text-xs text-slate-400">הסתיים {r.tenure_end}</span>
        ) : null,
    },
  ];

  return (
    <div>
      {canManage && (
        <button onClick={() => setShowAdd((v) => !v)} className="btn-secondary mb-3 text-sm">
          {showAdd ? "סגירה" : "הוספת בעל תפקיד"}
        </button>
      )}

      {showAdd && (
        <form onSubmit={handleAdd} className="card mb-4 max-w-xl space-y-3 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label">שם מלא</label>
              <input required value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="field-label">סוג תפקיד</label>
              <select
                value={form.role_type}
                onChange={(e) => setForm((f) => ({ ...f, role_type: e.target.value as OrganizationOfficeholder["role_type"] }))}
                className="input-field"
              >
                {Object.entries(OFFICEHOLDER_ROLE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">תיאור תפקיד (לא חובה)</label>
              <input value={form.role_title} onChange={(e) => setForm((f) => ({ ...f, role_title: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="field-label">ת"ז</label>
              <input value={form.id_number} onChange={(e) => setForm((f) => ({ ...f, id_number: e.target.value }))} className="input-field tabular" />
            </div>
            <div>
              <label className="field-label">טלפון</label>
              <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="field-label">תחילת כהונה</label>
              <input type="date" value={form.tenure_start} onChange={(e) => setForm((f) => ({ ...f, tenure_start: e.target.value }))} className="input-field" />
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
        emptyTitle="אין בעלי תפקידים רשומים"
        emptyIcon={Users}
      />
    </div>
  );
}
