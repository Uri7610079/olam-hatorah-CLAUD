import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";

interface OrgOption {
  id: string;
  legal_name: string;
}

interface StudentOption {
  id: string;
  external_id: string;
  full_name: string;
}

interface RetroRow {
  id: string;
  student_id: string | null;
  source_month: string;
  received_month: string;
  calculation_type: string | null;
  calculation_date: string;
  prior_eligible_count: number | null;
  current_eligible_count: number | null;
  prior_amount: number | null;
  current_amount: number | null;
  difference: number | null;
  current_period_offset: number | null;
  cumulative_offset: number | null;
  transferred_to_advances: number | null;
  notes: string | null;
  created_at: string;
  student: { external_id: string; full_name: string } | null;
}

async function fetchOrgs(): Promise<OrgOption[]> {
  const { data, error } = await supabase.from("organizations").select("id, legal_name").eq("status", "active").order("legal_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchStudents(orgId: string): Promise<StudentOption[]> {
  const { data, error } = await supabase
    .from("student_assignments")
    .select("students!inner(id, external_id, full_name)")
    .eq("organization_id", orgId)
    .eq("is_active", true);
  if (error) throw error;
  return (data ?? []).map((r: any) => r.students);
}

async function fetchRetro(orgId: string): Promise<RetroRow[]> {
  const { data, error } = await supabase
    .from("payment_calculation_versions")
    .select(
      "id, student_id, source_month, received_month, calculation_type, calculation_date, prior_eligible_count, current_eligible_count, prior_amount, current_amount, difference, current_period_offset, cumulative_offset, transferred_to_advances, notes, created_at, student:students(external_id, full_name)",
    )
    .eq("organization_id", orgId)
    .order("student_id", { ascending: true, nullsFirst: false })
    .order("source_month", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, student: Array.isArray(r.student) ? (r.student[0] ?? null) : r.student }));
}

const EMPTY_FORM = {
  studentId: "",
  sourceMonth: "",
  receivedMonth: new Date().toISOString().slice(0, 7) + "-01",
  calculationType: "",
  priorEligibleCount: "",
  currentEligibleCount: "",
  priorAmount: "",
  currentAmount: "",
  currentPeriodOffset: "",
  cumulativeOffset: "",
  transferredToAdvances: "",
  notes: "",
};

export function RetroScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("retro", "manage");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });

  const [orgId, setOrgId] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const studentsQuery = useQuery({ queryKey: ["retro-students", orgId], queryFn: () => fetchStudents(orgId), enabled: !!orgId });
  const retroQuery = useQuery({ queryKey: ["retro", orgId], queryFn: () => fetchRetro(orgId), enabled: !!orgId });

  const toNum = (v: string) => (v.trim() === "" ? null : Number(v));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const priorAmount = toNum(form.priorAmount);
    const currentAmount = toNum(form.currentAmount);
    const { error } = await supabase.from("payment_calculation_versions").insert({
      organization_id: orgId,
      student_id: form.studentId || null,
      source_month: form.sourceMonth,
      received_month: form.receivedMonth,
      calculation_type: form.calculationType || null,
      prior_eligible_count: toNum(form.priorEligibleCount),
      current_eligible_count: toNum(form.currentEligibleCount),
      prior_amount: priorAmount,
      current_amount: currentAmount,
      difference: priorAmount !== null && currentAmount !== null ? currentAmount - priorAmount : null,
      current_period_offset: toNum(form.currentPeriodOffset),
      cumulative_offset: toNum(form.cumulativeOffset),
      transferred_to_advances: toNum(form.transferredToAdvances),
      notes: form.notes || null,
    });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setForm(EMPTY_FORM);
    setShowAdd(false);
    queryClient.invalidateQueries({ queryKey: ["retro", orgId] });
  };

  const columns: DataTableColumn<RetroRow>[] = [
    { key: "student", header: "תלמיד", render: (r) => (r.student ? `${r.student.full_name} (${r.student.external_id})` : "כללי / ברמת סניף") },
    { key: "source", header: "חודש מקור", className: "tabular", render: (r) => r.source_month },
    { key: "received", header: "חודש קבלה", className: "tabular", render: (r) => r.received_month },
    { key: "type", header: "סוג חישוב", render: (r) => r.calculation_type ?? "—" },
    { key: "prior", header: "סכום קודם", className: "tabular", render: (r) => r.prior_amount?.toLocaleString("he-IL") ?? "—" },
    { key: "current", header: "סכום נוכחי", className: "tabular", render: (r) => r.current_amount?.toLocaleString("he-IL") ?? "—" },
    {
      key: "diff",
      header: "הפרש",
      className: "tabular",
      render: (r) => (r.difference != null ? <span className={r.difference < 0 ? "text-red-600" : "text-green-700"}>{r.difference.toLocaleString("he-IL")}</span> : "—"),
    },
    { key: "offset", header: "קיזוז נוכחי", className: "tabular", render: (r) => r.current_period_offset?.toLocaleString("he-IL") ?? "—" },
    { key: "cumulative", header: "קיזוז מצטבר", className: "tabular", render: (r) => r.cumulative_offset?.toLocaleString("he-IL") ?? "—" },
    { key: "date", header: "נרשם", className: "tabular", render: (r) => new Date(r.created_at).toLocaleDateString("he-IL") },
  ];

  return (
    <div>
      <PageHeader
        title="רטרו והפרשים"
        description="כל חישוב נשמר כגרסה נפרדת - שורות מוצגות לפי סדר יצירה (הישנה ביותר ראשונה) לכל תלמיד/חודש מקור. אין דריסה."
        primaryAction={
          orgId &&
          canManage && (
            <button onClick={() => setShowAdd((v) => !v)} className="btn-primary">
              {showAdd ? "סגירה" : "רטרו חדש"}
            </button>
          )
        }
      />

      <div className="mb-4 max-w-sm">
        <label className="field-label">עמותה</label>
        <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className="input-field">
          <option value="">— בחרי —</option>
          {(orgsQuery.data ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.legal_name}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        <span>
          רטרו נשמר כנתון היסטורי בלבד ואינו מעדכן את יתרת הקבוצה אוטומטית. אם הרטרו אמור להשפיע בפועל על היתרה, יש
          להזין תנועת תיקון ידנית במסך "יתרות קבוצות". אין נוסחת ניקוד קבועה: אם התקבל ניקוד במקור, יש להזין אותו
          כהערה בלבד.
        </span>
      </div>

      {showAdd && orgId && (
        <form onSubmit={submit} className="card mb-6 max-w-3xl space-y-3 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="field-label">תלמיד (לא חובה - ריק = ברמת סניף/כללי)</label>
              <select value={form.studentId} onChange={(e) => setForm((f) => ({ ...f, studentId: e.target.value }))} className="input-field">
                <option value="">— ללא —</option>
                {(studentsQuery.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name} ({s.external_id})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">חודש מקור</label>
              <input required type="date" value={form.sourceMonth} onChange={(e) => setForm((f) => ({ ...f, sourceMonth: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="field-label">חודש קבלה</label>
              <input required type="date" value={form.receivedMonth} onChange={(e) => setForm((f) => ({ ...f, receivedMonth: e.target.value }))} className="input-field" />
            </div>
          </div>

          <div>
            <label className="field-label">סוג חישוב (טקסט חופשי)</label>
            <input value={form.calculationType} onChange={(e) => setForm((f) => ({ ...f, calculationType: e.target.value }))} className="input-field" />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <label className="field-label">מס' זכאים קודם</label>
              <input type="number" value={form.priorEligibleCount} onChange={(e) => setForm((f) => ({ ...f, priorEligibleCount: e.target.value }))} className="input-field tabular" />
            </div>
            <div>
              <label className="field-label">מס' זכאים נוכחי</label>
              <input type="number" value={form.currentEligibleCount} onChange={(e) => setForm((f) => ({ ...f, currentEligibleCount: e.target.value }))} className="input-field tabular" />
            </div>
            <div>
              <label className="field-label">סכום קודם</label>
              <input type="number" step="0.01" value={form.priorAmount} onChange={(e) => setForm((f) => ({ ...f, priorAmount: e.target.value }))} className="input-field tabular" />
            </div>
            <div>
              <label className="field-label">סכום נוכחי</label>
              <input type="number" step="0.01" value={form.currentAmount} onChange={(e) => setForm((f) => ({ ...f, currentAmount: e.target.value }))} className="input-field tabular" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="field-label">קיזוז בתשלום הנוכחי</label>
              <input type="number" step="0.01" value={form.currentPeriodOffset} onChange={(e) => setForm((f) => ({ ...f, currentPeriodOffset: e.target.value }))} className="input-field tabular" />
            </div>
            <div>
              <label className="field-label">קיזוז מצטבר</label>
              <input type="number" step="0.01" value={form.cumulativeOffset} onChange={(e) => setForm((f) => ({ ...f, cumulativeOffset: e.target.value }))} className="input-field tabular" />
            </div>
            <div>
              <label className="field-label">הועבר למקדמות</label>
              <input type="number" step="0.01" value={form.transferredToAdvances} onChange={(e) => setForm((f) => ({ ...f, transferredToAdvances: e.target.value }))} className="input-field tabular" />
            </div>
          </div>

          <div>
            <label className="field-label">הערות</label>
            <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="input-field" />
          </div>

          {error && <ErrorState message={error} />}
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? "שומרת…" : "שמירת גרסת רטרו"}
          </button>
        </form>
      )}

      {orgId && (
        <DataTable columns={columns} rows={retroQuery.data ?? []} rowKey={(r) => r.id} loading={retroQuery.isLoading} emptyTitle="אין רטרו רשום" emptyIcon={RotateCcw} />
      )}
    </div>
  );
}
