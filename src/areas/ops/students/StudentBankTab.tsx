import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { SensitiveValue } from "@/components/SensitiveValue";
import { ErrorState } from "@/components/ErrorState";
import { RELATIONSHIP_LABEL, VERIFICATION_LABEL, type StudentBankAccount } from "./types";

interface StudentBankTabProps {
  studentId: string;
}

async function fetchBankAccounts(studentId: string): Promise<StudentBankAccount[]> {
  const { data, error } = await supabase
    .from("student_bank_accounts_view")
    .select(
      "id, student_id, bank_name, bank_branch_code, account_number_masked, account_holder_name, student_relationship, supporting_document_path, verification_status, is_active, opened_at, closed_at",
    )
    .eq("student_id", studentId)
    .order("opened_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

const EMPTY_FORM = {
  bank_name: "",
  bank_branch_code: "",
  account_number: "",
  account_holder_name: "",
  student_relationship: "self" as const,
};

export function StudentBankTab({ studentId }: StudentBankTabProps) {
  const queryClient = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("students", "manage");
  const { hasPermission: canReveal } = useHasPermission("bank_accounts", "view_sensitive");
  const query = useQuery({ queryKey: ["student-bank-accounts", studentId], queryFn: () => fetchBankAccounts(studentId) });

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["student-bank-accounts", studentId] });

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    let documentPath: string | null = null;
    if (file) {
      const path = `${studentId}/${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from("student-documents").upload(path, file);
      if (uploadError) {
        setSubmitting(false);
        setError(`העלאת המסמך נכשלה: ${uploadError.message}`);
        return;
      }
      documentPath = path;
    }

    // add_student_bank_account סוגר אטומית כל חשבון פעיל קודם לפני פתיחת החדש - "שינוי
    // חשבון בנק סוגר את הישן ופותח חדש" (דרישת אפיון). אין עוד insert ישיר על הטבלה.
    const { error } = await supabase.rpc("add_student_bank_account", {
      p_student_id: studentId,
      p_bank_name: form.bank_name || null,
      p_bank_branch_code: form.bank_branch_code || null,
      p_account_number: form.account_number || null,
      p_account_holder_name: form.account_holder_name || null,
      p_student_relationship: form.student_relationship,
      p_supporting_document_path: documentPath,
      p_opened_at: new Date().toISOString().slice(0, 10),
    });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setForm(EMPTY_FORM);
    setFile(null);
    setShowAdd(false);
    refresh();
  };

  const setVerification = async (id: string, status: "verified" | "rejected") => {
    const { error } = await supabase.rpc("set_student_bank_account_verification", { p_account_id: id, p_status: status });
    if (!error) refresh();
  };

  const openDocument = async (path: string) => {
    const { data, error } = await supabase.storage.from("student-documents").createSignedUrl(path, 60);
    if (!error && data) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const columns: DataTableColumn<StudentBankAccount>[] = [
    { key: "bank", header: "בנק", render: (r) => r.bank_name ?? "—" },
    {
      key: "account_number",
      header: "מספר חשבון",
      render: (r) => (
        <SensitiveValue
          masked={r.account_number_masked ?? "—"}
          canReveal={canReveal}
          onReveal={async () => {
            const { data, error } = await supabase.rpc("reveal_student_bank_account_number", { p_account_id: r.id });
            if (error) throw error;
            return data ?? "";
          }}
        />
      ),
    },
    { key: "holder", header: "בעל החשבון", render: (r) => r.account_holder_name ?? "—" },
    { key: "relationship", header: "קשר לתלמיד", render: (r) => (r.student_relationship ? RELATIONSHIP_LABEL[r.student_relationship] : "—") },
    {
      key: "document",
      header: "מסמך אסמכתה",
      render: (r) =>
        r.supporting_document_path ? (
          <button onClick={() => openDocument(r.supporting_document_path!)} className="link-action text-xs">
            פתיחת מסמך
          </button>
        ) : (
          "—"
        ),
    },
    {
      key: "verification",
      header: "אימות",
      render: (r) => (
        <StatusBadge
          severity={r.verification_status === "verified" ? "ok" : r.verification_status === "rejected" ? "critical" : "medium"}
          label={VERIFICATION_LABEL[r.verification_status]}
        />
      ),
    },
    {
      key: "actions",
      header: "",
      render: (r) =>
        canManage && r.verification_status === "pending" ? (
          <div className="flex gap-3">
            <button onClick={() => setVerification(r.id, "verified")} className="link-action text-xs">
              אימות
            </button>
            <button onClick={() => setVerification(r.id, "rejected")} className="text-xs text-red-600 underline hover:text-red-800">
              דחייה
            </button>
          </div>
        ) : null,
    },
  ];

  return (
    <div>
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
              <label className="field-label">קשר לתלמיד</label>
              <select
                value={form.student_relationship}
                onChange={(e) => setForm((f) => ({ ...f, student_relationship: e.target.value as typeof f.student_relationship }))}
                className="input-field"
              >
                {Object.entries(RELATIONSHIP_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">מסמך אסמכתה (לא חובה)</label>
              <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="input-field" />
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
        emptyTitle="אין חשבון בנק רשום"
        emptyIcon={Wallet}
      />
    </div>
  );
}
