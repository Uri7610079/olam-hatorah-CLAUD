import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { hashFile, readFileMatrix } from "@/lib/importParsing";
import { exportRowsToExcel } from "@/lib/reportExport";
import { isTalmudEligibilityList, parseTalmudEligibilityList, type EligibilityListParseResult } from "@/lib/talmudEligibilityList";
import { fromMonthInput, toMonthInput } from "@/components/MonthField";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";

interface OrgOption {
  id: string;
  legal_name: string;
  org_number: string | null;
}

interface ListSummary {
  id: string;
  month: string;
  file_name: string;
  row_count: number;
  eligible_count: number;
  not_eligible_count: number;
  matched_count: number;
  unmatched_eligible_count: number;
  status: "active" | "superseded";
  created_at: string;
}

interface ListRow {
  external_id: string;
  first_name: string | null;
  last_name: string | null;
  branch_code: string | null;
  study_code: string | null;
  eligible: boolean;
  student_id: string | null;
}

const monthLabel = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

async function fetchOrgs(): Promise<OrgOption[]> {
  const { data, error } = await supabase.from("organizations").select("id, legal_name, org_number").eq("status", "active").order("legal_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchLists(orgId: string): Promise<ListSummary[]> {
  const { data, error } = await supabase
    .from("talmud_eligibility_lists")
    .select("id, month, file_name, row_count, eligible_count, not_eligible_count, matched_count, unmatched_eligible_count, status, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(24);
  if (error) throw error;
  return data ?? [];
}

async function fetchUnmatchedEligible(listId: string): Promise<ListRow[]> {
  const { data, error } = await supabase
    .from("talmud_eligibility_list_rows")
    .select("external_id, first_name, last_name, branch_code, study_code, eligible, student_id")
    .eq("list_id", listId)
    .eq("eligible", true)
    .is("student_id", null)
    .order("branch_code")
    .order("last_name")
    .limit(5000);
  if (error) throw error;
  return data ?? [];
}

// "דוח זכאים" מתלמוד (רשימת תלמידים לפי חודש דיווח) - זכאי / אינו זכאי לכל תלמיד.
// נפרד מ"זכאות חודשית" (דוח דרישת תשלום, עם סכומים). הקליטה לא משנה שום נתון קיים
// בתלמידים - רק שומרת את הדוח, ממנו נבנית רשימת החיוג ב"רשימות טלפוניות".
export function EligibilityListImportPanel({ initialFile }: { initialFile?: File | null }) {
  const queryClient = useQueryClient();
  const { hasPermission: canImport, isLoading: permLoading } = useHasPermission("talmud", "import");
  const orgsQuery = useQuery({ queryKey: ["organizations-active-numbers"], queryFn: fetchOrgs });

  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<EligibilityListParseResult | null>(null);
  const [orgId, setOrgId] = useState("");
  const [month, setMonth] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [result, setResult] = useState<{ eligible: number; matched: number; unmatched: number; replaced: boolean; month: string } | null>(null);

  const listsQuery = useQuery({ queryKey: ["eligibility-lists", orgId], queryFn: () => fetchLists(orgId), enabled: !!orgId });
  const unmatchedQuery = useQuery({
    queryKey: ["eligibility-list-unmatched", selectedListId],
    queryFn: () => fetchUnmatchedEligible(selectedListId!),
    enabled: !!selectedListId,
  });

  const orgFromFile = parsed?.orgNumber ? (orgsQuery.data ?? []).find((o) => (o.org_number ?? "").trim() === parsed.orgNumber) : undefined;
  const orgMissing = !!parsed?.orgNumber && orgsQuery.isSuccess && !orgFromFile;
  const existingForMonth = (listsQuery.data ?? []).find((l) => l.status === "active" && l.month === month);

  const reset = () => {
    setParsed(null);
    setError(null);
    setDuplicate(false);
    setResult(null);
  };

  const handleFile = async (selected: File | null) => {
    reset();
    setFile(selected);
    if (!selected) return;
    setAnalyzing(true);
    try {
      const hash = await hashFile(selected);
      const { data: existing } = await supabase.from("talmud_eligibility_lists").select("id").eq("file_hash", hash).maybeSingle();
      if (existing) {
        setDuplicate(true);
        return;
      }
      const matrix = await readFileMatrix(selected);
      if (!isTalmudEligibilityList(matrix)) {
        setError('הקובץ לא נראה כמו "דוח זכאים" מתלמוד (רשימת תלמידים לפי חודש דיווח): לא נמצאה שורת כותרות עם "מצב זכאות", "ת.ז. / דרכון" ו"סוג זיהוי".');
        return;
      }
      const p = parseTalmudEligibilityList(matrix);
      setParsed(p);
      if (p.month) setMonth(p.month);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בקריאת הקובץ");
    } finally {
      setAnalyzing(false);
    }
  };

  useEffect(() => {
    if (initialFile) void handleFile(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  // העמותה לפי ח.פ. שבקובץ - בחירה גלויה, לא שקטה
  useEffect(() => {
    if (orgFromFile) setOrgId(orgFromFile.id);
  }, [orgFromFile]);

  const blocker = !parsed
    ? null
    : orgMissing
      ? `עמותה ${parsed.orgNumber} (${parsed.orgName ?? ""}) אינה קיימת במערכת. יש להוסיף אותה לפני הקליטה.`
      : !orgId
        ? "יש לבחור עמותה."
        : !month
          ? "יש לבחור חודש."
          : parsed.rows.length === 0
            ? "אין בקובץ שורות תלמידים."
            : null;

  const doImport = async () => {
    if (!file || !parsed || blocker) return;
    setImporting(true);
    setError(null);
    try {
      const hash = await hashFile(file);
      const payload = parsed.rows.map((r) => ({
        branch_code: r.branchCode,
        external_id: r.externalId,
        id_type: r.idType,
        first_name: r.firstName,
        last_name: r.lastName,
        eligible: r.eligible,
        study_code: r.studyCode,
        start_date: r.startDate,
        end_date: r.endDate,
        birth_date: r.birthDate,
        marital_status: r.maritalStatus,
        gender: r.gender,
        origin: r.origin,
      }));
      const { data, error: err } = await supabase
        .rpc("import_talmud_eligibility_list", {
          p_organization_id: orgId,
          p_month: month,
          p_file_name: file.name,
          p_file_hash: hash,
          p_rows: payload,
        })
        .single();
      if (err) throw new Error(err.message);
      const d = data as { list_id: string; eligible_count: number; matched_count: number; unmatched_eligible_count: number; replaced_previous: boolean };
      setResult({ eligible: d.eligible_count, matched: d.matched_count, unmatched: d.unmatched_eligible_count, replaced: d.replaced_previous, month });
      setSelectedListId(d.list_id);
      setParsed(null);
      setFile(null);
      queryClient.invalidateQueries({ queryKey: ["eligibility-lists", orgId] });
      queryClient.invalidateQueries({ queryKey: ["eligibility-lists-active", orgId] });
      queryClient.invalidateQueries({ queryKey: ["eligibility-call-list"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בקליטה");
    } finally {
      setImporting(false);
    }
  };

  if (permLoading) return <LoadingState rows={4} />;
  if (!canImport) return <ErrorState message="אין לך הרשאה ליבוא דוחות תלמוד." />;

  const selectedList = (listsQuery.data ?? []).find((l) => l.id === selectedListId);

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-ink-muted">
        "דוח זכאים" מתלמוד (רשימת תלמידים לפי חודש דיווח): מי זכאי ומי לא בחודש. הקליטה לא משנה נתוני תלמידים - ממנה נבנית רשימת החיוג
        ב<Link to="/ops/phone-lists" className="link-action">רשימות טלפוניות</Link>. העמותה והחודש מזוהים מהקובץ.
      </p>

      <div className="card max-w-3xl space-y-4 p-5">
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} className="input-field" />
        {analyzing && <LoadingState rows={2} />}
        {duplicate && <ErrorState message="הקובץ הזה כבר נקלט בעבר." />}
        {error && <ErrorState message={error} />}

        {parsed && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="el-org">עמותה</label>
                <select id="el-org" value={orgId} onChange={(e) => setOrgId(e.target.value)} className="input-field">
                  <option value="">— בחרי —</option>
                  {(orgsQuery.data ?? []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.legal_name}
                      {o.org_number ? ` (${o.org_number})` : ""}
                    </option>
                  ))}
                </select>
                {parsed.orgNumber && (
                  <p className={`mt-1 text-xs ${orgMissing ? "text-danger-ink" : "text-ink-subtle"}`}>
                    בקובץ: {parsed.orgName ?? ""} · ח.פ. {parsed.orgNumber}
                    {orgFromFile ? " - זוהתה" : orgMissing ? " - לא קיימת במערכת" : ""}
                  </p>
                )}
              </div>
              <div>
                <label className="field-label" htmlFor="el-month">חודש הדיווח</label>
                <input
                  id="el-month"
                  type="month"
                  value={month ? toMonthInput(month) : ""}
                  onChange={(e) => setMonth(fromMonthInput(e.target.value))}
                  className="input-field"
                />
                {parsed.month && <p className="mt-1 text-xs text-ink-subtle">בקובץ: {monthLabel(parsed.month)}</p>}
              </div>
            </div>

            <div className="flex flex-wrap gap-4 text-sm">
              <span>
                סה"כ <span className="tabular font-semibold">{parsed.rows.length}</span> שורות
              </span>
              <span className="text-ok-ink">
                זכאים <span className="tabular font-semibold">{parsed.rows.filter((r) => r.eligible).length}</span>
              </span>
              <span className="text-ink-muted">
                לא זכאים <span className="tabular font-semibold">{parsed.rows.filter((r) => !r.eligible).length}</span>
              </span>
              {parsed.declaredTotal !== null && parsed.declaredTotal === parsed.rows.length && (
                <span className="flex items-center gap-1 text-ok-ink">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  תואם לסיכום שבקובץ
                </span>
              )}
            </div>

            <DataTable
              columns={[
                { key: "code", header: "סניף", className: "tabular", render: (b: EligibilityListParseResult["branches"][number]) => b.code },
                { key: "el", header: "זכאים", className: "tabular", render: (b: EligibilityListParseResult["branches"][number]) => b.eligible },
                { key: "nel", header: "לא זכאים", className: "tabular", render: (b: EligibilityListParseResult["branches"][number]) => b.notEligible },
                {
                  key: "check",
                  header: "מול הסיכום בקובץ",
                  render: (b: EligibilityListParseResult["branches"][number]) =>
                    b.declared === null ? "—" : b.declared === b.eligible + b.notEligible ? <StatusBadge severity="ok" label="תואם" /> : <StatusBadge severity="critical" label={`בקובץ ${b.declared}`} />,
                },
              ]}
              rows={parsed.branches}
              rowKey={(b) => b.code}
              emptyTitle="לא נמצאו סניפים"
            />

            {parsed.problems.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn-soft p-3 text-sm text-warn-ink">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <ul className="list-disc ps-4">
                  {parsed.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )}

            {existingForMonth && !blocker && (
              <p className="text-sm text-warn-ink">
                לעמותה כבר נקלט דוח זכאים לחודש {monthLabel(month)} ({existingForMonth.file_name}). הדוח החדש יחליף אותו.
              </p>
            )}
            {blocker && <ErrorState message={blocker} />}

            <button onClick={doImport} disabled={importing || !!blocker} className="btn-primary flex items-center gap-2">
              <Upload className="h-4 w-4" aria-hidden="true" />
              {importing ? "קולטת…" : "קליטת דוח הזכאים"}
            </button>
          </div>
        )}
      </div>

      {result && (
        <div className="max-w-3xl rounded-md bg-ok-soft p-4 text-sm text-ok-ink">
          <p className="font-medium">
            הדוח נקלט{result.replaced ? " והחליף את הדוח הקודם לאותו חודש" : ""}. {result.eligible} שורות זכאים, {result.matched} שורות הותאמו לתלמידים
            במערכת.
          </p>
          {result.unmatched > 0 && <p className="mt-1">{result.unmatched} תלמידים זכאים לא נמצאו במערכת - הרשימה למטה.</p>}
          <Link to={`/ops/phone-lists?org=${orgId}&month=${result.month}`} className="link-action mt-2 inline-block font-medium">
            לרשימת החיוג של החודש
          </Link>
        </div>
      )}

      {orgId && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-ink-muted">דוחות זכאים שנקלטו</h2>
          <DataTable
            columns={[
              { key: "month", header: "חודש", className: "tabular", render: (l: ListSummary) => monthLabel(l.month) },
              { key: "file", header: "קובץ", render: (l: ListSummary) => l.file_name },
              { key: "el", header: "זכאים", className: "tabular", render: (l: ListSummary) => l.eligible_count },
              { key: "nel", header: "לא זכאים", className: "tabular", render: (l: ListSummary) => l.not_eligible_count },
              { key: "un", header: "זכאים שלא נמצאו", className: "tabular", render: (l: ListSummary) => l.unmatched_eligible_count },
              {
                key: "status",
                header: "סטטוס",
                render: (l: ListSummary) => <StatusBadge severity={l.status === "active" ? "ok" : "neutral"} label={l.status === "active" ? "פעיל" : "הוחלף"} />,
              },
              { key: "date", header: "נקלט", className: "tabular", render: (l: ListSummary) => new Date(l.created_at).toLocaleDateString("he-IL") },
            ]}
            rows={listsQuery.data ?? []}
            rowKey={(l: ListSummary) => l.id}
            loading={listsQuery.isLoading}
            emptyTitle="עוד לא נקלטו דוחות זכאים לעמותה זו"
            onRowClick={(l: ListSummary) => setSelectedListId(l.id === selectedListId ? null : l.id)}
          />
        </div>
      )}

      {selectedListId && (
        <div className="card max-w-3xl space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink">
              זכאים שלא נמצאו במערכת{selectedList ? ` · ${monthLabel(selectedList.month)}` : ""}
            </h3>
            <button
              className="btn-secondary flex items-center gap-2 text-xs"
              disabled={(unmatchedQuery.data ?? []).length === 0}
              onClick={() =>
                exportRowsToExcel(
                  (unmatchedQuery.data ?? []).map((r) => ({
                    "שם פרטי": r.first_name ?? "",
                    "שם משפחה": r.last_name ?? "",
                    "ת.ז/דרכון": r.external_id,
                    "סניף": r.branch_code ?? "",
                    "סוג לימוד": r.study_code ?? "",
                  })),
                  "לא נמצאו",
                  `eligible-not-in-system-${selectedList?.month.slice(0, 7) ?? ""}.xlsx`,
                )
              }
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              ייצוא לאקסל
            </button>
          </div>
          <p className="text-xs text-ink-subtle">תלמוד מסמן אותם כזכאים, אבל אין במערכת תלמיד עם מספר הזהות הזה - הם לא ייכנסו לרשימת החיוג עד שיתווספו.</p>
          <DataTable
            columns={[
              { key: "first", header: "שם פרטי", render: (r: ListRow) => r.first_name ?? "—" },
              { key: "last", header: "שם משפחה", render: (r: ListRow) => r.last_name ?? "—" },
              { key: "id", header: "ת.ז/דרכון", className: "ltr-num tabular", render: (r: ListRow) => r.external_id },
              { key: "branch", header: "סניף", className: "tabular", render: (r: ListRow) => r.branch_code ?? "—" },
              { key: "code", header: "סוג לימוד", className: "tabular", render: (r: ListRow) => r.study_code ?? "—" },
            ]}
            rows={unmatchedQuery.data ?? []}
            rowKey={(r: ListRow) => `${r.branch_code}-${r.external_id}-${r.study_code}`}
            loading={unmatchedQuery.isLoading}
            emptyTitle="כל הזכאים נמצאו במערכת"
          />
        </div>
      )}
    </div>
  );
}
