import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { SearchAndFilters } from "@/components/SearchAndFilters";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge, type Severity } from "@/components/StatusBadge";
import { ErrorState } from "@/components/ErrorState";
import { ID_TYPE_LABEL, STATUS_LABEL, type Student, type StudentIdType } from "./types";

async function fetchStudents(): Promise<Student[]> {
  const { data, error } = await supabase
    .from("students")
    .select(
      "id, id_type, external_id, full_name, birth_date, phone_raw, phone_normalized, address, student_type, study_code, status, exit_date, exit_reason, created_at",
    )
    .order("full_name");
  if (error) throw error;
  return data ?? [];
}

const STATUS_SEVERITY: Record<Student["status"], Severity> = {
  draft: "neutral",
  ready_for_talmud: "medium",
  active: "ok",
  inactive: "neutral",
};

const EMPTY_FORM = { id_type: "israeli_id" as StudentIdType, external_id: "", full_name: "", phone: "" };

export function StudentsListScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("students", "manage");
  const query = useQuery({ queryKey: ["students"], queryFn: fetchStudents });

  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const filtered = (query.data ?? []).filter((s) => {
    if (!search) return true;
    const needle = search.trim();
    return s.full_name.includes(needle) || s.external_id.includes(needle);
  });

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    const phoneDigits = form.phone.replace(/\D/g, "");
    const { data, error } = await supabase
      .from("students")
      .insert({
        id_type: form.id_type,
        external_id: form.external_id,
        full_name: form.full_name,
        phone_raw: form.phone || null,
        phone_normalized: phoneDigits || null,
      })
      .select("id")
      .single();
    setCreating(false);
    if (error) {
      setCreateError(error.message.includes("duplicate") ? "כבר קיים תלמיד עם אותו סוג מזהה ומספר מזהה." : error.message);
      return;
    }
    setShowCreate(false);
    setForm(EMPTY_FORM);
    queryClient.invalidateQueries({ queryKey: ["students"] });
    if (data) navigate(`/ops/students/${data.id}`);
  };

  const columns: DataTableColumn<Student>[] = [
    { key: "id", header: "מזהה", className: "tabular", render: (s) => `${ID_TYPE_LABEL[s.id_type]} ${s.external_id}` },
    {
      key: "name",
      header: "שם",
      render: (s) => (
        <button onClick={() => navigate(`/ops/students/${s.id}`)} className="link-action font-medium">
          {s.full_name}
        </button>
      ),
    },
    { key: "phone", header: "טלפון", render: (s) => s.phone_raw ?? "—" },
    { key: "status", header: "סטטוס", render: (s) => <StatusBadge severity={STATUS_SEVERITY[s.status]} label={STATUS_LABEL[s.status]} /> },
  ];

  return (
    <div>
      <PageHeader
        title="תלמידים"
        description="ניהול תלמידים, שיוכים וחשבונות בנק."
        primaryAction={
          canManage && (
            <button onClick={() => setShowCreate(true)} className="btn-primary">
              תלמיד חדש
            </button>
          )
        }
      />
      <SearchAndFilters searchValue={search} onSearchChange={setSearch} searchPlaceholder="חיפוש לפי שם או מספר מזהה…" />
      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(s) => s.id}
        loading={query.isLoading}
        emptyTitle="אין תלמידים עדיין"
        emptyIcon={Users}
      />

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="card w-full max-w-md p-6">
            <h2 className="mb-1 text-base font-semibold text-slate-900">תלמיד חדש</h2>
            <p className="mb-4 text-xs text-slate-500">נוצר כטיוטה. שיוך, חשבון בנק והפעלה מתבצעים בכרטיס התלמיד.</p>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="field-label">סוג מזהה</label>
                  <select
                    value={form.id_type}
                    onChange={(e) => setForm((f) => ({ ...f, id_type: e.target.value as StudentIdType }))}
                    className="input-field"
                  >
                    {Object.entries(ID_TYPE_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label">מספר מזהה</label>
                  <input required value={form.external_id} onChange={(e) => setForm((f) => ({ ...f, external_id: e.target.value }))} className="input-field tabular" />
                </div>
              </div>
              <div>
                <label className="field-label">שם מלא</label>
                <input required value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} className="input-field" />
              </div>
              <div>
                <label className="field-label">טלפון</label>
                <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="input-field" />
              </div>
              {createError && <ErrorState message={createError} />}
              <button type="submit" disabled={creating} className="btn-primary w-full">
                {creating ? "יוצרת…" : "יצירה"}
              </button>
            </form>
            <button onClick={() => setShowCreate(false)} className="link-action mt-3 text-xs">
              ביטול
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
