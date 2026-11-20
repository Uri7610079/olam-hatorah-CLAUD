import { todayLocalIso } from "@/lib/today";
import { fetchAll } from "@/lib/fetchAll";
import { useEffect, useState, type FormEvent } from "react";
import { fromMonthInput, toMonthInput } from "@/components/MonthField";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { useLastSelected } from "@/lib/useLastSelected";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { TalmudReportRowsView } from "./TalmudReportRowsView";
import { ErrorState } from "@/components/ErrorState";
import { useIsV3 } from "@/lib/uiTheme";
import { formatDate, formatMoney, formatMonth } from "@/lib/format";

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
  const data = await fetchAll(() => supabase
    .from("student_assignments")
    .select("students!inner(id, external_id, full_name)")
    .eq("organization_id", orgId)
    .eq("is_active", true).order("id"));
  return (data ?? []).map((r: any) => r.students);
}

async function fetchRetro(orgId: string): Promise<RetroRow[]> {
  // fetchAll: מעבר ל-1,000 שורות הרשימה נחתכה בשקט. id בסוף - לחלוקה יציבה לחלקים.
  const data = await fetchAll(() =>
    supabase
      .from("payment_calculation_versions")
      .select(
        "id, student_id, source_month, received_month, calculation_type, calculation_date, prior_eligible_count, current_eligible_count, prior_amount, current_amount, difference, current_period_offset, cumulative_offset, transferred_to_advances, notes, created_at, student:students(external_id, full_name)",
      )
      .eq("organization_id", orgId)
      .order("student_id", { ascending: true, nullsFirst: false })
      .order("source_month", { ascending: false })
      .order("created_at", { ascending: true })
      .order("id"),
  );
  return (data ?? []).map((r: any) => ({ ...r, student: Array.isArray(r.student) ? (r.student[0] ?? null) : r.student }));
}

// מוצאת את רשומת הרטרו ה"קודמת" הרלוונטית ביותר לתלמיד (או ברמת עמותה/סניף אם
// studentId הוא null) - הגרסה עם חודש המקור הגבוה ביותר שעדיין קודם ל-beforeMonth
// (אם לא נבחר עדיין חודש מקור לרשומה החדשה, מתעלמים מהגבלת החודש ומחזירים את
// הרשומה העדכנית ביותר בסך הכול). "current" של אותה רשומה קודמת = "prior" של החדשה.
function findPriorRetroRecord(rows: RetroRow[], studentId: string | null, beforeMonth: string): RetroRow | null {
  const candidates = rows.filter((r) => r.student_id === studentId && (!beforeMonth || r.source_month < beforeMonth));
  if (candidates.length === 0) return null;
  let best = candidates[0];
  for (const r of candidates) {
    if (r.source_month > best.source_month || (r.source_month === best.source_month && r.created_at > best.created_at)) {
      best = r;
    }
  }
  return best;
}

const EMPTY_FORM = {
  studentId: "",
  sourceMonth: "",
  receivedMonth: todayLocalIso().slice(0, 7) + "-01",
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

  const [orgId, setOrgId] = useLastSelected<string>("last-org", "");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isV3 = useIsV3();

  const studentsQuery = useQuery({ queryKey: ["retro-students", orgId], queryFn: () => fetchStudents(orgId), enabled: !!orgId });
  const retroQuery = useQuery({ queryKey: ["retro", orgId], queryFn: () => fetchRetro(orgId), enabled: !!orgId });

  // מילוי ברירת מחדל של "מס' זכאים קודם" ו"סכום קודם" מתוך הרשומה הקיימת האחרונה
  // הרלוונטית (לפי תלמיד/עמותה/חודש שנבחרו) - לא דורס ערך שכבר קיים בשדה (בין אם
  // הוזן ידנית ובין אם מולא ע"י ריצה קודמת של האפקט עצמו); השדות נשארים לגמרי
  // ניתנים לעריכה ידנית.
  useEffect(() => {
    if (!showAdd || !retroQuery.data) return;
    if (form.priorEligibleCount !== "" || form.priorAmount !== "") return;
    const prior = findPriorRetroRecord(retroQuery.data, form.studentId || null, form.sourceMonth);
    if (!prior) return;
    setForm((f) => ({
      ...f,
      priorEligibleCount: prior.current_eligible_count != null ? String(prior.current_eligible_count) : "",
      priorAmount: prior.current_amount != null ? String(prior.current_amount) : "",
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAdd, form.studentId, form.sourceMonth, retroQuery.data]);

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

  // v3: שם ומזהה בעמודות נפרדות, סכומים ב-₪ וחודשים במילים. הסינון והמיון לפי הערך הגולמי.
  const money = (v: number | null) => (v == null ? "—" : formatMoney(v));
  const columnsV3: DataTableColumn<RetroRow>[] = [
    { key: "student", header: "תלמיד", render: (r) => r.student?.full_name ?? <span className="text-ink-subtle">כללי / ברמת סניף</span>, filterValue: (r) => r.student?.full_name ?? "כללי / ברמת סניף" },
    { key: "student_id", header: "מזהה", kind: "ltr", render: (r) => r.student?.external_id ?? "—" },
    { key: "source", header: "חודש מקור", sortValue: (r) => r.source_month, render: (r) => formatMonth(r.source_month) },
    { key: "received", header: "חודש קבלה", sortValue: (r) => r.received_month, render: (r) => formatMonth(r.received_month) },
    { key: "type", header: "סוג חישוב", truncate: true, render: (r) => r.calculation_type ?? "—" },
    { key: "prior", header: "סכום קודם", kind: "money", sortValue: (r) => r.prior_amount, render: (r) => money(r.prior_amount) },
    { key: "current", header: "סכום נוכחי", kind: "money", sortValue: (r) => r.current_amount, render: (r) => money(r.current_amount) },
    {
      key: "diff",
      header: "הפרש",
      kind: "money",
      sortValue: (r) => r.difference,
      render: (r) => (r.difference != null ? <span className={r.difference < 0 ? "text-danger-ink" : "text-ok-ink"}>{formatMoney(r.difference, { sign: true })}</span> : "—"),
    },
    { key: "offset", header: "קיזוז נוכחי", kind: "money", sortValue: (r) => r.current_period_offset, render: (r) => money(r.current_period_offset) },
    { key: "cumulative", header: "קיזוז מצטבר", kind: "money", sortValue: (r) => r.cumulative_offset, render: (r) => money(r.cumulative_offset) },
    { key: "date", header: "נרשם", className: "tabular", sortValue: (r) => r.created_at, render: (r) => formatDate(r.created_at) },
  ];

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
      render: (r) => (r.difference != null ? <span className={r.difference < 0 ? "text-danger" : "text-ok-ink"}>{r.difference.toLocaleString("he-IL")}</span> : "—"),
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
        <label htmlFor="retro-org" className="field-label">עמותה</label>
        <select id="retro-org" value={orgId} onChange={(e) => setOrgId(e.target.value)} className="input-field">
          <option value="">— בחרי —</option>
          {(orgsQuery.data ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.legal_name}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-md border border-line bg-surface-muted p-3 text-sm text-ink-muted">
        <span>
          רטרו נשמר כנתון היסטורי בלבד ואינו מעדכן את יתרת הקבוצה אוטומטית. אם הרטרו אמור להשפיע בפועל על היתרה, יש
          להזין תנועת תיקון ידנית במסך "יתרות קבוצות". אין נוסחת ניקוד קבועה: אם התקבל ניקוד במקור, יש להזין אותו
          כהערה בלבד.
        </span>
      </div>

      {showAdd && orgId && (() => {
        // שדות הטופס מוגדרים פעם אחת; העיצוב הקיים מציג את כולם ברצף, ו-v3 מציג את
        // העיקר (תלמיד, חודשים, סכומים) ומקפל את השאר תחת "פרטים נוספים".
        const fStudent = (
          <div>
            <label htmlFor="retro-student" className="field-label">תלמיד (לא חובה - ריק = ברמת סניף/כללי)</label>
            <select
              id="retro-student"
              value={form.studentId}
              onChange={(e) => setForm((f) => ({ ...f, studentId: e.target.value, priorEligibleCount: "", priorAmount: "" }))}
              className="input-field"
            >
              <option value="">— ללא —</option>
              {(studentsQuery.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name} ({s.external_id})
                </option>
              ))}
            </select>
          </div>
        );
        const fSource = (
          <div>
            <label htmlFor="retro-source" className="field-label">חודש מקור</label>
            <input
              id="retro-source"
              required
              type="month"
              value={toMonthInput(form.sourceMonth)}
              onChange={(e) => setForm((f) => ({ ...f, sourceMonth: fromMonthInput(e.target.value), priorEligibleCount: "", priorAmount: "" }))}
              className="input-field"
            />
          </div>
        );
        const fReceived = (
          <div>
            <label htmlFor="retro-received" className="field-label">חודש קבלה</label>
            <input id="retro-received" required type="month" value={toMonthInput(form.receivedMonth)} onChange={(e) => setForm((f) => ({ ...f, receivedMonth: fromMonthInput(e.target.value) }))} className="input-field" />
          </div>
        );
        const fType = (
          <div>
            <label htmlFor="retro-type" className="field-label">סוג חישוב (טקסט חופשי)</label>
            <input id="retro-type" value={form.calculationType} onChange={(e) => setForm((f) => ({ ...f, calculationType: e.target.value }))} className="input-field" />
          </div>
        );
        const fPriorCount = (
          <div>
            <label htmlFor="retro-prior-count" className="field-label">מס' זכאים קודם</label>
            <input id="retro-prior-count" type="number" value={form.priorEligibleCount} onChange={(e) => setForm((f) => ({ ...f, priorEligibleCount: e.target.value }))} className="input-field tabular" />
          </div>
        );
        const fCurrentCount = (
          <div>
            <label htmlFor="retro-current-count" className="field-label">מס' זכאים נוכחי</label>
            <input id="retro-current-count" type="number" value={form.currentEligibleCount} onChange={(e) => setForm((f) => ({ ...f, currentEligibleCount: e.target.value }))} className="input-field tabular" />
          </div>
        );
        const fPriorAmount = (
          <div>
            <label htmlFor="retro-prior-amount" className="field-label">סכום קודם</label>
            <input id="retro-prior-amount" type="number" step="0.01" value={form.priorAmount} onChange={(e) => setForm((f) => ({ ...f, priorAmount: e.target.value }))} className="input-field tabular" />
          </div>
        );
        const fCurrentAmount = (
          <div>
            <label htmlFor="retro-current-amount" className="field-label">סכום נוכחי</label>
            <input id="retro-current-amount" type="number" step="0.01" value={form.currentAmount} onChange={(e) => setForm((f) => ({ ...f, currentAmount: e.target.value }))} className="input-field tabular" />
          </div>
        );
        const fOffset = (
          <div>
            <label htmlFor="retro-offset" className="field-label">קיזוז בתשלום הנוכחי</label>
            <input id="retro-offset" type="number" step="0.01" value={form.currentPeriodOffset} onChange={(e) => setForm((f) => ({ ...f, currentPeriodOffset: e.target.value }))} className="input-field tabular" />
          </div>
        );
        const fCumulative = (
          <div>
            <label htmlFor="retro-cumulative" className="field-label">קיזוז מצטבר</label>
            <input id="retro-cumulative" type="number" step="0.01" value={form.cumulativeOffset} onChange={(e) => setForm((f) => ({ ...f, cumulativeOffset: e.target.value }))} className="input-field tabular" />
          </div>
        );
        const fTransferred = (
          <div>
            <label htmlFor="retro-transferred" className="field-label">הועבר למקדמות</label>
            <input id="retro-transferred" type="number" step="0.01" value={form.transferredToAdvances} onChange={(e) => setForm((f) => ({ ...f, transferredToAdvances: e.target.value }))} className="input-field tabular" />
          </div>
        );
        const fNotes = (
          <div>
            <label htmlFor="retro-notes" className="field-label">הערות</label>
            <input id="retro-notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="input-field" />
          </div>
        );
        const submitRow = (
          <>
            {error && <ErrorState message={error} />}
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? "שומרת…" : "שמירת גרסת רטרו"}
            </button>
          </>
        );

        if (!isV3) {
          return (
            <form onSubmit={submit} className="card mb-6 max-w-3xl space-y-3 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {fStudent}
                {fSource}
                {fReceived}
              </div>

              {fType}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                {fPriorCount}
                {fCurrentCount}
                {fPriorAmount}
                {fCurrentAmount}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {fOffset}
                {fCumulative}
                {fTransferred}
              </div>

              {fNotes}

              {submitRow}
            </form>
          );
        }

        const priorNum = toNum(form.priorAmount);
        const currentNum = toNum(form.currentAmount);
        const hasExtra = !!(form.calculationType || form.priorEligibleCount || form.currentEligibleCount || form.currentPeriodOffset || form.cumulativeOffset || form.transferredToAdvances || form.notes);
        return (
          <form onSubmit={submit} className="card mb-6 max-w-3xl space-y-4 p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {fStudent}
              {fSource}
              {fReceived}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {fPriorAmount}
              {fCurrentAmount}
              {/* ההפרש עצמו מחושב בשמירה (נוכחי פחות קודם) - כאן רק מראים אותו מראש */}
              <div>
                <span className="field-label">הפרש</span>
                <p className="tabular py-2 text-sm font-semibold text-primary">
                  {priorNum !== null && currentNum !== null ? formatMoney(currentNum - priorNum, { sign: true }) : "—"}
                </p>
              </div>
            </div>
            <details className="rounded-control border border-line px-3 py-2" open={hasExtra || undefined}>
              <summary className="cursor-pointer text-sm font-medium text-ink-muted">פרטים נוספים: סוג חישוב, מספר זכאים, קיזוזים והערות</summary>
              <div className="mt-3 space-y-3">
                {fType}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {fPriorCount}
                  {fCurrentCount}
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {fOffset}
                  {fCumulative}
                  {fTransferred}
                </div>
                {fNotes}
              </div>
            </details>
            {submitRow}
          </form>
        );
      })()}

      {orgId && (
        <DataTable columns={isV3 ? columnsV3 : columns} rows={retroQuery.data ?? []} rowKey={(r) => r.id} loading={retroQuery.isLoading} error={retroQuery.error} onRetry={() => retroQuery.refetch()} emptyTitle="אין רטרו רשום" emptyIcon={RotateCcw} />
      )}

      {/* מתלמוד (משיכה מתלמוד → קליטה, מיגרציה 121): מה תלמוד שילם, ואיך הוא הסביר הפרשים וקיזוזים */}
      {orgId && (
        <>
          <h2 className="mb-2 mt-8 text-sm font-semibold text-ink-muted v3:text-base v3:text-primary">תשלומים מתלמוד לפי סניף</h2>
          <TalmudReportRowsView reportKey="institute_payments" organizationId={orgId} />
          <h2 className="mb-2 mt-8 text-sm font-semibold text-ink-muted v3:text-base v3:text-primary">הסבר תשלומים וקיזוזים מתלמוד</h2>
          <TalmudReportRowsView reportKey="payment_explanation" organizationId={orgId} />
        </>
      )}
    </div>
  );
}
