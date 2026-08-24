import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Percent, FlaskConical } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useLastSelected } from "@/lib/useLastSelected";
import { useHasPermission } from "@/lib/permissions";
import { exportRowsToExcel } from "@/lib/reportExport";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ErrorState } from "@/components/ErrorState";
import { CommissionRulesImportPanel } from "./CommissionRulesImportPanel";

interface OrgOption {
  id: string;
  legal_name: string;
}

interface GroupOption {
  id: string;
  name: string;
}

interface StudyCodeOption {
  code: string;
  description: string;
}

interface StudentOption {
  id: string;
  external_id: string;
  full_name: string;
}

type CalculationType = "percentage" | "fixed" | "combined";
type RoundingRule = "none" | "round_int" | "ceil_int" | "floor_int";

interface CommissionRule {
  id: string;
  group_id: string | null;
  study_code: string | null;
  student_id: string | null;
  calculation_type: CalculationType;
  percentage: number | null;
  fixed_amount: number | null;
  rounding_rule: RoundingRule;
  rounding_step: number;
  rounding_target: RoundingTarget;
  priority: number;
  effective_from: string;
  effective_until: string | null;
  is_active: boolean;
  notes: string | null;
  group: { name: string } | null;
  student: { external_id: string; full_name: string } | null;
}

const TYPE_LABEL: Record<CalculationType, string> = { percentage: "אחוז", fixed: "קבוע", combined: "משולב" };
// rounding_rule מציין מעתה *כיוון* בלבד; לאיזו כפולה מעגלים נקבע ב-rounding_step
// (מיגרציה 105). הערכים לא שונו כדי שכללים קיימים ימשיכו לעבוד.
const ROUNDING_LABEL: Record<RoundingRule, string> = { none: "ללא עיגול", round_int: "לקרוב", ceil_int: "כלפי מעלה", floor_int: "כלפי מטה" };

type RoundingTarget = "commission" | "net";

// "כלפי מטה לכפולות של 10, על הסכום לתלמיד" - קריא יותר משלוש עמודות נפרדות
function roundingText(r: { rounding_rule: RoundingRule; rounding_step: number; rounding_target: RoundingTarget }): string {
  if (r.rounding_rule === "none") return "ללא עיגול";
  const step = Number(r.rounding_step) || 1;
  const unit = step === 1 ? "לשקל שלם" : `לכפולות של ${step.toLocaleString("he-IL")}`;
  return `${ROUNDING_LABEL[r.rounding_rule]} ${unit}, ${TARGET_LABEL[r.rounding_target ?? "commission"]}`;
}
const TARGET_LABEL: Record<RoundingTarget, string> = {
  commission: "על העמלה",
  net: "על הסכום לתלמיד",
};

async function fetchOrgs(): Promise<OrgOption[]> {
  const { data, error } = await supabase.from("organizations").select("id, legal_name").eq("status", "active").order("legal_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchOrgGroups(orgId: string): Promise<GroupOption[]> {
  const { data, error } = await supabase
    .from("groups")
    .select("id, name, branch:branches!inner(organization_id)")
    .eq("branch.organization_id", orgId)
    .order("name");
  if (error) throw error;
  return (data ?? []).map((g: any) => ({ id: g.id, name: g.name }));
}

async function fetchStudyCodes(): Promise<StudyCodeOption[]> {
  const { data, error } = await supabase.from("study_codes").select("code, description").eq("is_active", true).order("code");
  if (error) throw error;
  return data ?? [];
}

async function fetchOrgStudents(orgId: string): Promise<StudentOption[]> {
  const { data, error } = await supabase
    .from("student_assignments")
    .select("students!inner(id, external_id, full_name)")
    .eq("organization_id", orgId)
    .eq("is_active", true);
  if (error) throw error;
  return (data ?? []).map((r: any) => r.students);
}

async function fetchRules(orgId: string): Promise<CommissionRule[]> {
  const { data, error } = await supabase
    .from("commission_rules")
    .select(
      "id, group_id, study_code, student_id, calculation_type, percentage, fixed_amount, rounding_rule, rounding_step, rounding_target, priority, effective_from, effective_until, is_active, notes, group:groups(name), student:students(external_id, full_name)",
    )
    .eq("organization_id", orgId)
    .order("priority", { ascending: false })
    .order("effective_from", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    ...r,
    group: Array.isArray(r.group) ? (r.group[0] ?? null) : r.group,
    student: Array.isArray(r.student) ? (r.student[0] ?? null) : r.student,
  }));
}

const EMPTY_FORM = {
  groupId: "",
  studyCode: "",
  studentId: "",
  calculationType: "percentage" as CalculationType,
  percentage: "",
  fixedAmount: "",
  roundingRule: "none" as RoundingRule,
  roundingStep: "1",
  roundingTarget: "commission" as RoundingTarget,
  priority: "0",
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveUntil: "",
  notes: "",
};

const EMPTY_SIM = { groupId: "", studyCode: "", studentId: "", date: new Date().toISOString().slice(0, 10), grossAmount: "" };

export function CommissionRulesScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("commission_rules", "manage");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });

  const [orgId, setOrgId] = useLastSelected<string>("last-org", "");
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showSim, setShowSim] = useState(false);
  const [sim, setSim] = useState(EMPTY_SIM);
  const [simRunning, setSimRunning] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [simResult, setSimResult] = useState<{
    rule_id: string | null;
    calculation_type: CalculationType | null;
    commission_amount: number;
    net_amount: number;
  } | null>(null);

  const groupsQuery = useQuery({ queryKey: ["commission-org-groups", orgId], queryFn: () => fetchOrgGroups(orgId), enabled: !!orgId });
  const studyCodesQuery = useQuery({ queryKey: ["study-codes-active"], queryFn: fetchStudyCodes });
  const studentsQuery = useQuery({ queryKey: ["commission-org-students", orgId], queryFn: () => fetchOrgStudents(orgId), enabled: !!orgId });
  const rulesQuery = useQuery({ queryKey: ["commission-rules", orgId], queryFn: () => fetchRules(orgId), enabled: !!orgId });

  const toNum = (v: string) => (v.trim() === "" ? null : Number(v));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error: err } = await supabase.from("commission_rules").insert({
      organization_id: orgId,
      group_id: form.groupId || null,
      study_code: form.studyCode || null,
      student_id: form.studentId || null,
      calculation_type: form.calculationType,
      percentage: toNum(form.percentage),
      fixed_amount: toNum(form.fixedAmount),
      rounding_rule: form.roundingRule,
      rounding_step: Number(form.roundingStep) || 1,
      rounding_target: form.roundingTarget,
      priority: Number(form.priority) || 0,
      effective_from: form.effectiveFrom,
      effective_until: form.effectiveUntil || null,
      notes: form.notes || null,
    });
    setSubmitting(false);
    if (err) {
      setError(err.message);
      return;
    }
    setForm(EMPTY_FORM);
    setShowAdd(false);
    queryClient.invalidateQueries({ queryKey: ["commission-rules", orgId] });
  };

  const toggleActive = async (rule: CommissionRule) => {
    const { error: err } = await supabase.from("commission_rules").update({ is_active: !rule.is_active }).eq("id", rule.id);
    if (!err) queryClient.invalidateQueries({ queryKey: ["commission-rules", orgId] });
  };

  const exportToExcel = () => {
    const rows = (rulesQuery.data ?? []).map((r) => ({
      קבוצה: r.group?.name ?? "",
      "קוד לימוד": r.study_code ?? "",
      "חריג לתלמיד": r.student ? `${r.student.full_name} (${r.student.external_id})` : "",
      "סוג חישוב": TYPE_LABEL[r.calculation_type],
      אחוז: r.percentage ?? "",
      "סכום קבוע": r.fixed_amount ?? "",
      "כלל עיגול": roundingText(r),
      עדיפות: r.priority,
      "תקף מתאריך": r.effective_from,
      "תקף עד תאריך": r.effective_until ?? "",
      סטטוס: r.is_active ? "פעיל" : "כבוי",
      הערות: r.notes ?? "",
    }));
    exportRowsToExcel(rows, "כללי עמלה", `commission-rules-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const runSimulation = async () => {
    if (!sim.grossAmount) return;
    setSimRunning(true);
    setSimError(null);
    const { data, error: err } = await supabase
      .rpc("simulate_commission_rule", {
        p_organization_id: orgId,
        p_group_id: sim.groupId || null,
        p_study_code: sim.studyCode || null,
        p_student_id: sim.studentId || null,
        p_date: sim.date,
        p_gross_amount: Number(sim.grossAmount),
      })
      .single();
    setSimRunning(false);
    if (err) {
      setSimError(err.message);
      return;
    }
    setSimResult(data as any);
  };

  const columns: DataTableColumn<CommissionRule>[] = [
    {
      key: "scope",
      header: "היקף",
      render: (r) =>
        [r.student ? `תלמיד: ${r.student.full_name} (${r.student.external_id})` : null, r.group ? `קבוצה: ${r.group.name}` : null, r.study_code ? `קוד לימוד: ${r.study_code}` : null]
          .filter(Boolean)
          .join(" · ") || "כל העמותה",
    },
    { key: "type", header: "סוג", render: (r) => TYPE_LABEL[r.calculation_type] },
    {
      key: "value",
      header: "ערך",
      className: "tabular",
      render: (r) =>
        [r.percentage != null ? `${r.percentage}%` : null, r.fixed_amount != null ? r.fixed_amount.toLocaleString("he-IL") : null].filter(Boolean).join(" + ") || "—",
    },
    { key: "rounding", header: "עיגול", className: "whitespace-nowrap", render: (r) => roundingText(r) },
    { key: "priority", header: "עדיפות", className: "tabular", render: (r) => r.priority },
    {
      key: "effective",
      header: "בתוקף",
      className: "tabular",
      render: (r) => `${r.effective_from} — ${r.effective_until ?? "ללא הגבלה"}`,
    },
    {
      key: "status",
      header: "סטטוס",
      render: (r) =>
        canManage ? (
          <button onClick={() => toggleActive(r)} className="link-action text-xs">
            <StatusBadge severity={r.is_active ? "ok" : "neutral"} label={r.is_active ? "פעיל" : "כבוי"} />
          </button>
        ) : (
          <StatusBadge severity={r.is_active ? "ok" : "neutral"} label={r.is_active ? "פעיל" : "כבוי"} />
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="כללי עמלה"
        description="כלל תואם לפי עמותה, קבוצה, קוד לימוד או חריג לתלמיד ספציפי, בטווח תאריכים. כשכמה כללים תואמים - מנצח העדיפות הגבוהה ביותר."
        primaryAction={
          orgId && (
            <div className="flex flex-wrap gap-2">
              {canManage && (
                <button onClick={() => setShowSim((v) => !v)} className="btn-secondary flex items-center gap-2">
                  <FlaskConical className="h-4 w-4" aria-hidden="true" />
                  {showSim ? "סגירת סימולציה" : "סימולציה"}
                </button>
              )}
              {canManage && (
                <button
                  onClick={() => {
                    setShowImport((v) => !v);
                    setShowAdd(false);
                  }}
                  className="btn-secondary"
                >
                  {showImport ? "סגירת יבוא" : "יבוא מאקסל"}
                </button>
              )}
              <button onClick={exportToExcel} disabled={!(rulesQuery.data ?? []).length} className="btn-secondary">
                ייצוא לאקסל
              </button>
              {canManage && (
                <button
                  onClick={() => {
                    setShowAdd((v) => !v);
                    setShowImport(false);
                  }}
                  className="btn-primary"
                >
                  {showAdd ? "סגירה" : "כלל חדש"}
                </button>
              )}
            </div>
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

      {showSim && orgId && (
        <div className="card mb-6 max-w-3xl space-y-3 p-4">
          <p className="text-xs text-ink-subtle">בדיקת הכלל שהיה נבחר, בלי לכתוב/לשמור דבר.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="field-label">קבוצה (לא חובה)</label>
              <select value={sim.groupId} onChange={(e) => setSim((f) => ({ ...f, groupId: e.target.value }))} className="input-field">
                <option value="">— ללא —</option>
                {(groupsQuery.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">קוד לימוד (לא חובה)</label>
              <select value={sim.studyCode} onChange={(e) => setSim((f) => ({ ...f, studyCode: e.target.value }))} className="input-field">
                <option value="">— ללא —</option>
                {(studyCodesQuery.data ?? []).map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} - {s.description}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">תלמיד (לא חובה)</label>
              <select value={sim.studentId} onChange={(e) => setSim((f) => ({ ...f, studentId: e.target.value }))} className="input-field">
                <option value="">— ללא —</option>
                {(studentsQuery.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name} ({s.external_id})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">תאריך</label>
              <input type="date" value={sim.date} onChange={(e) => setSim((f) => ({ ...f, date: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="field-label">סכום ברוטו לבדיקה</label>
              <input type="number" step="0.01" value={sim.grossAmount} onChange={(e) => setSim((f) => ({ ...f, grossAmount: e.target.value }))} className="input-field tabular" />
            </div>
          </div>
          {simError && <ErrorState message={simError} />}
          <button onClick={runSimulation} disabled={!sim.grossAmount || simRunning} className="btn-secondary text-sm">
            {simRunning ? "מריצה…" : "הרצת סימולציה"}
          </button>
          {simResult && (
            <div className="rounded-md bg-surface-muted p-3 text-sm">
              {simResult.rule_id ? (
                <p>
                  כלל תואם: <strong>{TYPE_LABEL[simResult.calculation_type as CalculationType]}</strong> · עמלה:{" "}
                  <strong className="tabular">{simResult.commission_amount.toLocaleString("he-IL")}</strong> · נטו:{" "}
                  <strong className="tabular">{simResult.net_amount.toLocaleString("he-IL")}</strong>
                </p>
              ) : (
                <p className="text-warn-ink">לא נמצא כלל תואם - עמלה 0, נטו = ברוטו במלואו.</p>
              )}
            </div>
          )}
        </div>
      )}

      {showImport && orgId && (
        <div className="mb-6">
          <CommissionRulesImportPanel orgId={orgId} />
        </div>
      )}

      {showAdd && orgId && (
        <form onSubmit={submit} className="card mb-6 max-w-3xl space-y-3 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="field-label">קבוצה (לא חובה - ריק = כל העמותה)</label>
              <select value={form.groupId} onChange={(e) => setForm((f) => ({ ...f, groupId: e.target.value }))} className="input-field">
                <option value="">— ללא —</option>
                {(groupsQuery.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">קוד לימוד (לא חובה)</label>
              <select value={form.studyCode} onChange={(e) => setForm((f) => ({ ...f, studyCode: e.target.value }))} className="input-field">
                <option value="">— ללא —</option>
                {(studyCodesQuery.data ?? []).map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} - {s.description}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">חריג לתלמיד (לא חובה)</label>
              <select value={form.studentId} onChange={(e) => setForm((f) => ({ ...f, studentId: e.target.value }))} className="input-field">
                <option value="">— ללא —</option>
                {(studentsQuery.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name} ({s.external_id})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <label className="field-label">סוג חישוב</label>
              <select value={form.calculationType} onChange={(e) => setForm((f) => ({ ...f, calculationType: e.target.value as CalculationType }))} className="input-field">
                {(Object.keys(TYPE_LABEL) as CalculationType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">אחוז</label>
              <input type="number" step="0.01" value={form.percentage} onChange={(e) => setForm((f) => ({ ...f, percentage: e.target.value }))} className="input-field tabular" />
            </div>
            <div>
              <label className="field-label">סכום קבוע</label>
              <input type="number" step="0.01" value={form.fixedAmount} onChange={(e) => setForm((f) => ({ ...f, fixedAmount: e.target.value }))} className="input-field tabular" />
            </div>
            <div>
              <label className="field-label">כיוון עיגול</label>
              <select value={form.roundingRule} onChange={(e) => setForm((f) => ({ ...f, roundingRule: e.target.value as RoundingRule }))} className="input-field">
                {(Object.keys(ROUNDING_LABEL) as RoundingRule[]).map((r) => (
                  <option key={r} value={r}>
                    {ROUNDING_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* שדות העיגול מוסתרים כש"ללא עיגול" נבחר: הם חסרי משמעות אז,
              ושדה שאפשר למלא ואין לו השפעה מזמין טעות שקטה. */}
          {form.roundingRule !== "none" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="field-label" htmlFor="rounding-step">מעגלים לכפולות של</label>
                <input
                  id="rounding-step"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.roundingStep}
                  onChange={(e) => setForm((f) => ({ ...f, roundingStep: e.target.value }))}
                  className="input-field tabular"
                />
                <p className="mt-1 text-xs text-ink-subtle">1 = שקל שלם · 10 = כפולות של עשרה</p>
              </div>
              <div>
                <label className="field-label" htmlFor="rounding-target">העיגול חל</label>
                <select
                  id="rounding-target"
                  value={form.roundingTarget}
                  onChange={(e) => setForm((f) => ({ ...f, roundingTarget: e.target.value as RoundingTarget }))}
                  className="input-field"
                >
                  {(Object.keys(TARGET_LABEL) as RoundingTarget[]).map((t) => (
                    <option key={t} value={t}>
                      {TARGET_LABEL[t]}
                    </option>
                  ))}
                </select>
              </div>
              {/* ההפרש חייב להיאמר במפורש: הברוטו מגיע מתלמוד ואינו משתנה,
                  ולכן מה שנגרע מהתלמיד עובר לעמלה. זו החלטה כספית. */}
              <div className="sm:col-span-3">
                <p className="text-xs text-ink-muted">
                  {form.roundingTarget === "net"
                    ? `דוגמה: אם לתלמיד יוצא 99 ₪ והעיגול הוא כלפי מטה לכפולות של ${form.roundingStep || 1} — הוא יקבל ${
                        Math.floor(99 / (Number(form.roundingStep) || 1)) * (Number(form.roundingStep) || 1)
                      } ₪, וההפרש נזקף לעמלה. הברוטו מגיע מתלמוד ואינו משתנה.`
                    : "העיגול חל על סכום העמלה. הסכום לתלמיד הוא השארית, ולכן הוא עצמו אינו מעוגל."}
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="field-label">עדיפות (מספר גבוה יותר מנצח)</label>
              <input type="number" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} className="input-field tabular" />
            </div>
            <div>
              <label className="field-label">בתוקף מתאריך</label>
              <input required type="date" value={form.effectiveFrom} onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="field-label">בתוקף עד (לא חובה)</label>
              <input type="date" value={form.effectiveUntil} onChange={(e) => setForm((f) => ({ ...f, effectiveUntil: e.target.value }))} className="input-field" />
            </div>
          </div>

          <div>
            <label className="field-label">הערות</label>
            <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="input-field" />
          </div>

          {error && <ErrorState message={error} />}
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? "שומרת…" : "שמירת כלל"}
          </button>
        </form>
      )}

      {orgId && (
        <DataTable columns={columns} rows={rulesQuery.data ?? []} rowKey={(r) => r.id} loading={rulesQuery.isLoading} emptyTitle="אין כללי עמלה לעמותה זו" emptyIcon={Percent} />
      )}
    </div>
  );
}
