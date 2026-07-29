import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { exportRowsToExcel } from "@/lib/reportExport";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ErrorState } from "@/components/ErrorState";
import { StudyCodesImportPanel } from "./StudyCodesImportPanel";

interface StudyCode {
  id: string;
  code: string;
  description: string;
  category: string | null;
  is_active: boolean;
}

async function fetchStudyCodes(): Promise<StudyCode[]> {
  const { data, error } = await supabase.from("study_codes").select("id, code, description, category, is_active").order("code");
  if (error) throw error;
  return data ?? [];
}

const EMPTY_FORM = { code: "", description: "", category: "" };

export function StudyCodesScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("study_codes", "manage");
  const query = useQuery({ queryKey: ["study-codes"], queryFn: fetchStudyCodes });

  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["study-codes"] });

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error } = await supabase.from("study_codes").insert({
      code: form.code,
      description: form.description,
      category: form.category || null,
    });
    setSubmitting(false);
    if (error) {
      setError(error.message.includes("duplicate") ? "קוד לימוד זה כבר קיים." : error.message);
      return;
    }
    setForm(EMPTY_FORM);
    setShowAdd(false);
    refresh();
  };

  const toggleActive = async (row: StudyCode) => {
    await supabase.from("study_codes").update({ is_active: !row.is_active }).eq("id", row.id);
    refresh();
  };

  const exportCodes = () => {
    const rows = (query.data ?? []).map((r) => ({
      קוד: r.code,
      תיאור: r.description,
      קטגוריה: r.category ?? "",
      סטטוס: r.is_active ? "פעיל" : "לא פעיל",
    }));
    exportRowsToExcel(rows, "קודי לימוד", `study-codes-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const columns: DataTableColumn<StudyCode>[] = [
    { key: "code", header: "קוד", className: "tabular", render: (r) => r.code },
    { key: "description", header: "תיאור", render: (r) => r.description },
    { key: "category", header: "קטגוריה", render: (r) => r.category ?? "—" },
    {
      key: "status",
      header: "סטטוס",
      render: (r) => <StatusBadge severity={r.is_active ? "ok" : "neutral"} label={r.is_active ? "פעיל" : "לא פעיל"} />,
    },
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
        title="קודי לימוד"
        description="קטלוג קודי הלימוד שהתקבלו מהמשרד. קודים בעלי תיאור זהה (למשל 600/605) נשמרים בנפרד - אין לאחד אותם ללא אישור."
        primaryAction={
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={exportCodes} className="btn-secondary">
              ייצוא לאקסל
            </button>
            {canManage && (
              <button onClick={() => setShowImport((v) => !v)} className="btn-secondary">
                {showImport ? "סגירת יבוא" : "יבוא מאקסל"}
              </button>
            )}
            {canManage && (
              <button onClick={() => setShowAdd((v) => !v)} className="btn-primary">
                {showAdd ? "סגירה" : "קוד חדש"}
              </button>
            )}
          </div>
        }
      />

      {showImport && canManage && <StudyCodesImportPanel />}

      {showAdd && (
        <form onSubmit={submitCode} className="card mb-4 max-w-lg space-y-3 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label">קוד</label>
              <input required value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} className="input-field tabular" />
            </div>
            <div>
              <label className="field-label">קטגוריה (לא חובה)</label>
              <input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="input-field" />
            </div>
          </div>
          <div>
            <label className="field-label">תיאור</label>
            <input required value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="input-field" />
          </div>
          {error && <ErrorState message={error} />}
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? "שומרת…" : "הוספה"}
          </button>
        </form>
      )}

      <DataTable columns={columns} rows={query.data ?? []} rowKey={(r) => r.id} loading={query.isLoading} emptyTitle="אין קודי לימוד" emptyIcon={BookOpen} />
    </div>
  );
}
