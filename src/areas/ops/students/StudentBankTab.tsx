import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { safeStorageKey } from "@/lib/storagePath";
import { useHasPermission } from "@/lib/permissions";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { SensitiveValue } from "@/components/SensitiveValue";
import { ErrorState } from "@/components/ErrorState";
import { checkIsraeliBankAccount } from "@/lib/israeliBankAccount";
import { RELATIONSHIP_LABEL, bankAccountStateLabel, type StudentBankAccount } from "./types";

interface StudentBankTabProps {
  studentId: string;
}

async function fetchBankAccounts(studentId: string): Promise<StudentBankAccount[]> {
  const { data, error } = await supabase
    .from("student_bank_accounts_view")
    .select(
      "id, student_id, bank_name, bank_branch_code, account_number_masked, account_holder_name, student_relationship, supporting_document_path, verification_status, check_digit_result, is_active, opened_at, closed_at",
    )
    .eq("student_id", studentId)
    .order("opened_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

interface BankOption {
  code: string;
  name: string;
}

// בחירה מרשימה ולא הקלדה חופשית - כמו בחשבון עמותה. בלי קוד בנק אין בדיקת ספרת
// ביקורת, וקובץ מס"ב יוצא בלי קוד.
async function fetchBanks(): Promise<BankOption[]> {
  const { data, error } = await supabase.from("banks").select("code, name").eq("is_active", true).order("code");
  if (error) throw error;
  return data ?? [];
}

const EMPTY_FORM = {
  bank_code: "",
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
  const banksQuery = useQuery({ queryKey: ["banks"], queryFn: fetchBanks });

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // חשבון תקין יכול להעביר את התלמיד ל"מוכן לתלמוד" אוטומטית (מיגרציה 114), ולכן
  // מרעננים גם את התלמיד עצמו ואת הרשימה - לא רק את טבלת החשבונות.
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["student-bank-accounts", studentId] });
    queryClient.invalidateQueries({ queryKey: ["student-has-verified-account", studentId] });
    queryClient.invalidateQueries({ queryKey: ["student", studentId] });
    queryClient.invalidateQueries({ queryKey: ["students"] });
  };

  // אותה בדיקה שהשרת יריץ בשמירה - כדי שטעות הקלדה תיראה לפני השמירה ולא אחריה.
  const formCheck = form.bank_code && form.account_number.trim()
    ? checkIsraeliBankAccount(form.bank_code, form.bank_branch_code, form.account_number)
    : null;

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    let documentPath: string | null = null;
    if (file) {
      const path = `${studentId}/${safeStorageKey(file.name)}`;
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

  // עקיפה בלבד: חשבון שהבדיקה פסלה, ומישהו במשרד יודע שהוא נכון.
  const approveAnyway = async (id: string) => {
    if (!window.confirm("הבדיקה מצאה שמספר החשבון שגוי. לאשר אותו בכל זאת? העברה לחשבון שגוי תחזור מהבנק.")) return;
    const { error } = await supabase.rpc("set_student_bank_account_verification", { p_account_id: id, p_status: "verified" });
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
      className: "ltr-num",
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
      header: "בדיקת מספר",
      render: (r) => {
        const state = bankAccountStateLabel(r);
        return <StatusBadge severity={state.severity} label={state.label} />;
      },
    },
    {
      key: "actions",
      header: "",
      render: (r) =>
        canManage && r.is_active && r.verification_status === "rejected" ? (
          <button onClick={() => approveAnyway(r.id)} className="link-action text-xs">
            אישור למרות זאת
          </button>
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
              <label className="field-label" htmlFor="student-bank-select">בנק</label>
              <select
                id="student-bank-select"
                value={form.bank_code}
                onChange={(e) => {
                  const code = e.target.value;
                  const bank = (banksQuery.data ?? []).find((b) => b.code === code);
                  setForm((f) => ({ ...f, bank_code: code, bank_name: bank?.name ?? "" }));
                }}
                className="input-field"
              >
                <option value="">— בחרי בנק —</option>
                {(banksQuery.data ?? []).map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.code} · {b.name}
                  </option>
                ))}
              </select>
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
          {formCheck === "invalid" && (
            <p className="rounded-md border border-danger/30 bg-danger-soft p-2 text-xs text-danger-ink">
              מספר החשבון לא עובר את בדיקת ספרת הביקורת של הבנק - כנראה טעות הקלדה. כדאי לבדוק את המספר ואת הסניף.
              אפשר לשמור בכל זאת, אבל החשבון יסומן כשגוי ולא יקבל תשלום.
            </p>
          )}
          {formCheck === "valid" && <p className="text-xs text-ok-ink">מספר החשבון עובר את בדיקת ספרת הביקורת.</p>}
          {formCheck === "unknown" && <p className="text-xs text-ink-subtle">לבנק הזה אין בדיקת ספרת ביקורת ידועה - החשבון יישמר כתקין.</p>}
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
