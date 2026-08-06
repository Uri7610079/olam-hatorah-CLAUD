import { useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Calculator, Coins } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { exportRowsToExcel } from "@/lib/reportExport";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { Tabs, type TabDef } from "@/components/Tabs";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { StudyCodesImportPanel } from "./StudyCodesImportPanel";

/* ---------------------------------------------------------------------------
   מסך אחד לשלושת נתוני היסוד שמשרד החינוך קובע: קודי הלימוד עצמם, שווי הנקודה
   בשקלים, והניקוד לכל קוד לימוד. שני האחרונים נשמרים כהיסטוריה ולא כערך יחיד -
   ר' ההסבר ב-HISTORY_NOTE ובמיגרציה 088.
--------------------------------------------------------------------------- */

type TabKey = "codes" | "values" | "points";

const SCREEN_TABS: TabDef<TabKey>[] = [
  { key: "codes", label: "קודי לימוד" },
  { key: "values", label: "שווי נקודה" },
  { key: "points", label: "ניקוד לפי קוד לימוד" },
];

// המשפט הזה הוא לב הדרישה של הלקוח ("שהחישוב יישאר כמו בחודש קודם אם אין שינוי
// מפורש"), ולכן הוא מוצג במפורש בשני הטאבים ולא נשאר רק בהערות הקוד.
const HISTORY_NOTE =
  "אין עריכה של ערך קיים - כל שינוי נרשם כשורה חדשה עם חודש תחילת תוקף. הוספת ערך חדש אינה משנה חודשים שכבר עברו: עליהם ממשיך לחול הערך שהיה בתוקף באותו חודש.";

function currentMonthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// "2026-08-01" → "08/2026". חודש בלבד, כי הערכים תמיד חלים מה-1 בחודש.
function monthLabel(isoDate: string): string {
  return `${isoDate.slice(5, 7)}/${isoDate.slice(0, 4)}`;
}

function formatNumber(value: number | string | null | undefined, maxDigits: number, minDigits = 0): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("he-IL", { minimumFractionDigits: minDigits, maximumFractionDigits: maxDigits });
}

function effectivityBadge(isCurrent: boolean, effectiveFrom: string, currentMonth: string): ReactNode {
  if (isCurrent) return <StatusBadge severity="ok" label="בתוקף כעת" />;
  if (effectiveFrom > currentMonth) return <StatusBadge severity="medium" label="עתידי" />;
  return <StatusBadge severity="neutral" label="היסטורי" />;
}

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

  const [tab, setTab] = useState<TabKey>("codes");
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
        title="קודי לימוד וערכי מערכת"
        description="קטלוג קודי הלימוד, שווי הנקודה והניקוד לכל קוד - הערכים שמשרד החינוך קובע ושלפיהם מחושבת הזכאות."
        primaryAction={
          tab === "codes" ? (
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
          ) : undefined
        }
      />

      <Tabs tabs={SCREEN_TABS} activeTab={tab} onChange={setTab} ariaLabel="קודי לימוד וערכי מערכת" />

      {tab === "codes" && (
        <>
          <p className="mb-4 text-sm text-ink-muted">
            קטלוג קודי הלימוד שהתקבלו מהמשרד. קודים בעלי תיאור זהה (למשל 600/605) נשמרים בנפרד - אין לאחד אותם ללא אישור.
          </p>

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
        </>
      )}

      {tab === "values" && <PointValuesTab canManage={canManage} />}
      {tab === "points" && <StudyCodePointsTab canManage={canManage} />}
    </div>
  );
}

/* ------------------------------ שווי נקודה ------------------------------ */

interface PointValue {
  id: string;
  effective_from: string;
  value: number | string;
  notes: string | null;
}

async function fetchPointValues(): Promise<PointValue[]> {
  const { data, error } = await supabase.from("point_values").select("id, effective_from, value, notes").order("effective_from", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

const EMPTY_VALUE_FORM = () => ({ month: currentMonthStart().slice(0, 7), value: "", notes: "" });

function PointValuesTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["point-values"], queryFn: fetchPointValues });

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_VALUE_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = query.data ?? [];
  const currentMonth = currentMonthStart();
  // הרשימה ממוינת יורד, ולכן הראשונה שתחילת תוקפה אינה בעתיד היא זו שבתוקף כעת -
  // בדיוק כמו point_value_for_month במסד.
  const currentRow = rows.find((r) => r.effective_from <= currentMonth) ?? null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = Number(form.value);
    if (!form.month || !Number.isFinite(value) || value <= 0) {
      setError("יש לבחור חודש תחילת תוקף ולהזין שווי גדול מאפס.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    const { error: err } = await supabase.from("point_values").insert({
      effective_from: `${form.month}-01`,
      value,
      notes: form.notes.trim() || null,
      created_by: userData.user?.id ?? null,
    });
    setSubmitting(false);
    if (err) {
      setError(err.message.includes("duplicate") ? "כבר קיים שווי נקודה לחודש זה." : err.message);
      return;
    }
    setForm(EMPTY_VALUE_FORM());
    setShowAdd(false);
    queryClient.invalidateQueries({ queryKey: ["point-values"] });
  };

  const columns: DataTableColumn<PointValue>[] = [
    { key: "month", header: "חודש תחילת תוקף", className: "tabular", render: (r) => monthLabel(r.effective_from) },
    { key: "value", header: 'שווי נקודה (ש"ח)', className: "tabular", render: (r) => formatNumber(r.value, 4, 2) },
    { key: "state", header: "מצב", render: (r) => effectivityBadge(r.id === currentRow?.id, r.effective_from, currentMonth) },
    { key: "notes", header: "הערות", render: (r) => r.notes ?? "—" },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl space-y-1">
          <p className="text-sm text-ink-muted">שווי נקודה בשקלים, נקבע ומתפרסם על ידי משרד החינוך. כלל-מערכתי - זהה לכל העמותות.</p>
          <p className="text-xs text-ink-subtle">{HISTORY_NOTE}</p>
        </div>
        {canManage && (
          <button onClick={() => setShowAdd((v) => !v)} className="btn-primary">
            {showAdd ? "סגירה" : "שווי חדש"}
          </button>
        )}
      </div>

      {query.isLoading ? (
        <div className="mb-4">
          <LoadingState rows={1} />
        </div>
      ) : (
        <div className="card mb-4 flex flex-wrap items-center gap-2 p-3 text-sm">
          <Coins className="h-4 w-4 text-ink-subtle" aria-hidden="true" />
          <span className="text-ink-muted">שווי הנקודה בתוקף לחודש {monthLabel(currentMonth)}:</span>
          <span className="tabular font-semibold text-ink">{currentRow ? formatNumber(currentRow.value, 4, 2) : "לא הוגדר"}</span>
        </div>
      )}

      {query.error && <ErrorState message="שגיאה בטעינת שווי הנקודה." />}

      {showAdd && canManage && (
        <form onSubmit={submit} className="card mb-4 max-w-lg space-y-3 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="pv-month">
                חודש תחילת תוקף
              </label>
              {/* בורר חודש ולא תאריך מלא: במסד יש אילוץ שהיום חייב להיות 1 בחודש. */}
              <input
                id="pv-month"
                type="month"
                required
                value={form.month}
                onChange={(e) => setForm((f) => ({ ...f, month: e.target.value }))}
                className="input-field tabular"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="pv-value">
                שווי נקודה (ש"ח)
              </label>
              <input
                id="pv-value"
                type="number"
                step="0.0001"
                min="0"
                required
                value={form.value}
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                className="input-field tabular"
              />
            </div>
          </div>
          <div>
            <label className="field-label" htmlFor="pv-notes">
              הערות (לא חובה)
            </label>
            <input id="pv-notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="input-field" placeholder="לדוגמה: חוזר משרד החינוך" />
          </div>
          <p className="text-xs text-ink-subtle">
            הערך יחול מהחודש שנבחר ואילך, עד שתיווסף שורה מאוחרת יותר. חודשים קודמים אינם מושפעים.
          </p>
          {error && <ErrorState message={error} />}
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? "שומרת…" : "הוספה"}
          </button>
        </form>
      )}

      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} loading={query.isLoading} emptyTitle="לא הוגדר עדיין שווי נקודה" emptyIcon={Coins} />
    </div>
  );
}

/* -------------------------- ניקוד לפי קוד לימוד -------------------------- */

interface StudyCodePoint {
  id: string;
  study_code: string;
  effective_from: string;
  points: number | string;
  notes: string | null;
}

async function fetchStudyCodePoints(): Promise<StudyCodePoint[]> {
  const { data, error } = await supabase
    .from("study_code_points")
    .select("id, study_code, effective_from, points, notes")
    .order("study_code")
    .order("effective_from", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

const EMPTY_POINTS_FORM = () => ({ studyCode: "", month: currentMonthStart().slice(0, 7), points: "", notes: "" });

function StudyCodePointsTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const pointsQuery = useQuery({ queryKey: ["study-code-points"], queryFn: fetchStudyCodePoints });
  // אותו queryKey של טאב קודי הלימוד - react-query מאחד את הבקשה במקום לשלוח אותה פעמיים.
  const codesQuery = useQuery({ queryKey: ["study-codes"], queryFn: fetchStudyCodes });

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_POINTS_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = pointsQuery.data ?? [];
  const currentMonth = currentMonthStart();

  const descriptionByCode = new Map((codesQuery.data ?? []).map((c) => [c.code, c.description]));
  const activeCodes = (codesQuery.data ?? []).filter((c) => c.is_active);

  // לכל קוד בנפרד: השורה הראשונה (בסדר יורד) שתחילת תוקפה אינה בעתיד.
  const currentIdByCode = new Map<string, string>();
  for (const row of rows) {
    if (!currentIdByCode.has(row.study_code) && row.effective_from <= currentMonth) {
      currentIdByCode.set(row.study_code, row.id);
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const points = Number(form.points);
    if (!form.studyCode || !form.month || !Number.isFinite(points) || points <= 0) {
      setError("יש לבחור קוד לימוד וחודש תחילת תוקף, ולהזין ניקוד גדול מאפס.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    const { error: err } = await supabase.from("study_code_points").insert({
      study_code: form.studyCode,
      effective_from: `${form.month}-01`,
      points,
      notes: form.notes.trim() || null,
      created_by: userData.user?.id ?? null,
    });
    setSubmitting(false);
    if (err) {
      setError(err.message.includes("duplicate") ? "כבר הוגדר ניקוד לקוד לימוד זה בחודש זה." : err.message);
      return;
    }
    setForm(EMPTY_POINTS_FORM());
    setShowAdd(false);
    queryClient.invalidateQueries({ queryKey: ["study-code-points"] });
  };

  const columns: DataTableColumn<StudyCodePoint>[] = [
    { key: "code", header: "קוד לימוד", className: "tabular", render: (r) => r.study_code },
    { key: "description", header: "תיאור", render: (r) => descriptionByCode.get(r.study_code) ?? "—" },
    { key: "month", header: "חודש תחילת תוקף", className: "tabular", render: (r) => monthLabel(r.effective_from) },
    { key: "points", header: "ניקוד", className: "tabular", render: (r) => formatNumber(r.points, 3) },
    {
      key: "state",
      header: "מצב",
      render: (r) => effectivityBadge(currentIdByCode.get(r.study_code) === r.id, r.effective_from, currentMonth),
    },
    { key: "notes", header: "הערות", render: (r) => r.notes ?? "—" },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl space-y-1">
          <p className="text-sm text-ink-muted">
            הניקוד שמשרד החינוך קובע לכל קוד לימוד (לדוגמה: אברך 1.8, בחור 1, חצי יום 0.9). הסכום הצפוי לחודש הוא הניקוד כפול שווי הנקודה של אותו חודש.
          </p>
          <p className="text-xs text-ink-subtle">{HISTORY_NOTE}</p>
        </div>
        {canManage && (
          <button onClick={() => setShowAdd((v) => !v)} className="btn-primary">
            {showAdd ? "סגירה" : "ניקוד חדש"}
          </button>
        )}
      </div>

      {(pointsQuery.error || codesQuery.error) && <ErrorState message="שגיאה בטעינת הניקוד לפי קוד לימוד." />}

      {showAdd && canManage && (
        <form onSubmit={submit} className="card mb-4 max-w-lg space-y-3 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="scp-code">
                קוד לימוד
              </label>
              {codesQuery.isLoading ? (
                <LoadingState rows={1} />
              ) : (
                <select
                  id="scp-code"
                  required
                  value={form.studyCode}
                  onChange={(e) => setForm((f) => ({ ...f, studyCode: e.target.value }))}
                  className="input-field"
                >
                  <option value="">— בחרי —</option>
                  {activeCodes.map((c) => (
                    <option key={c.id} value={c.code}>
                      {c.code} — {c.description}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className="field-label" htmlFor="scp-month">
                חודש תחילת תוקף
              </label>
              {/* בורר חודש ולא תאריך מלא: במסד יש אילוץ שהיום חייב להיות 1 בחודש. */}
              <input
                id="scp-month"
                type="month"
                required
                value={form.month}
                onChange={(e) => setForm((f) => ({ ...f, month: e.target.value }))}
                className="input-field tabular"
              />
            </div>
          </div>
          <div>
            <label className="field-label" htmlFor="scp-points">
              ניקוד
            </label>
            <input
              id="scp-points"
              type="number"
              step="0.001"
              min="0"
              required
              value={form.points}
              onChange={(e) => setForm((f) => ({ ...f, points: e.target.value }))}
              className="input-field tabular"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="scp-notes">
              הערות (לא חובה)
            </label>
            <input id="scp-notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="input-field" />
          </div>
          <p className="text-xs text-ink-subtle">
            הניקוד יחול על הקוד הזה מהחודש שנבחר ואילך. הניקוד הקודם ממשיך לחול על החודשים שלפניו.
          </p>
          {error && <ErrorState message={error} />}
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? "שומרת…" : "הוספה"}
          </button>
        </form>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={pointsQuery.isLoading}
        emptyTitle="לא הוגדר עדיין ניקוד לאף קוד לימוד"
        emptyIcon={Calculator}
      />
    </div>
  );
}
