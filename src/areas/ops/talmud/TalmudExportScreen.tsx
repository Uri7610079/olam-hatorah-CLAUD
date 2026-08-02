import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { AlertTriangle, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { useLastSelected } from "@/lib/useLastSelected";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { SearchAndFilters } from "@/components/SearchAndFilters";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";

interface OrgOption {
  id: string;
  legal_name: string;
}
interface BranchOption {
  id: string;
  internal_name: string;
}
interface GroupOption {
  id: string;
  name: string;
}

interface CandidateStudent {
  id: string;
  external_id: string;
  full_name: string;
  phone_normalized: string | null;
  status: string;
  already_exported: boolean;
}

async function fetchOrgs(): Promise<OrgOption[]> {
  const { data, error } = await supabase.from("organizations").select("id, legal_name").eq("status", "active").order("legal_name");
  if (error) throw error;
  return data ?? [];
}
async function fetchBranches(orgId: string): Promise<BranchOption[]> {
  const { data, error } = await supabase.from("branches").select("id, internal_name").eq("organization_id", orgId).eq("status", "active").order("internal_name");
  if (error) throw error;
  return data ?? [];
}
async function fetchGroups(branchId: string): Promise<GroupOption[]> {
  const { data, error } = await supabase.from("groups").select("id, name").eq("branch_id", branchId).eq("status", "active").order("name");
  if (error) throw error;
  return data ?? [];
}

async function fetchCandidates(orgId: string, branchId: string, groupId: string): Promise<CandidateStudent[]> {
  let query = supabase
    .from("student_assignments")
    .select("student_id, students!inner(id, external_id, full_name, phone_normalized, status)")
    .eq("is_active", true)
    .eq("organization_id", orgId)
    .in("students.status", ["ready_for_talmud", "sent_to_talmud", "active", "active_with_error"]);
  if (branchId) query = query.eq("branch_id", branchId);
  if (groupId) query = query.eq("group_id", groupId);

  const { data, error } = await query;
  if (error) throw error;

  const studentIds = (data ?? []).map((r: any) => r.student_id);
  const { data: exported } = studentIds.length
    ? await supabase.from("export_batch_students").select("student_id").in("student_id", studentIds)
    : { data: [] as { student_id: string }[] };
  const exportedSet = new Set((exported ?? []).map((e) => e.student_id));

  return (data ?? []).map((r: any) => ({
    id: r.students.id,
    external_id: r.students.external_id,
    full_name: r.students.full_name,
    phone_normalized: r.students.phone_normalized,
    status: r.students.status,
    already_exported: exportedSet.has(r.students.id),
  }));
}

async function fetchExportHistory(orgId: string) {
  const { data, error } = await supabase
    .from("export_batches")
    .select("id, file_name, period_start, period_end, student_count, is_override, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

// היסטוריית היצוא ממוינת לפי created_at (לא בהכרח לפי period_end) - כדי למצוא את
// "החודש האחרון שיוצא בפועל" יש לחפש את ה-period_end הגבוה ביותר בין כל הרשומות.
function mostRecentPeriodEnd(history: { period_end: string }[] | undefined | null): string | null {
  if (!history || history.length === 0) return null;
  let max = history[0].period_end;
  for (const h of history) if (h.period_end > max) max = h.period_end;
  return max;
}

function addDaysToDateString(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ברירת המחדל לסוף תקופה: סוף אותו חודש קלנדרי שבו מתחילה התקופה - תואם למוסכמה
// הקיימת של יצוא חודשי (ניתן לשנות ידנית בשדה אם התקופה בפועל שונה).
function endOfMonthForDateString(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return end.toISOString().slice(0, 10);
}

// בונה XLSX טיוטה - מבנה העמודות אינו התבנית המאושרת בפועל של תלמוד/מרכבה (זו טרם
// התקבלה, ר' יומן ההחלטות באפיון). מסומן בבירור בממשק כטיוטה.
function buildExportWorkbook(students: CandidateStudent[]): Blob {
  const sheetData = students.map((s) => ({
    "מזהה תלמיד": s.external_id,
    "שם מלא": s.full_name,
    טלפון: s.phone_normalized ?? "",
  }));
  const sheet = XLSX.utils.json_to_sheet(sheetData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "יצוא לתלמוד");
  const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function TalmudExportScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canExport, isLoading: permissionLoading } = useHasPermission("talmud", "export");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs, enabled: canExport });

  const [orgId, setOrgId] = useLastSelected<string>("last-org", "");
  const [branchId, setBranchId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [override, setOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultFileName, setResultFileName] = useState<string | null>(null);
  const [candidateSearch, setCandidateSearch] = useState("");

  const branchesQuery = useQuery({ queryKey: ["branches", orgId], queryFn: () => fetchBranches(orgId), enabled: !!orgId });
  const groupsQuery = useQuery({ queryKey: ["groups", branchId], queryFn: () => fetchGroups(branchId), enabled: !!branchId });
  const candidatesQuery = useQuery({
    queryKey: ["talmud-export-candidates", orgId, branchId, groupId],
    queryFn: () => fetchCandidates(orgId, branchId, groupId),
    enabled: !!orgId,
  });
  const historyQuery = useQuery({ queryKey: ["talmud-export-history", orgId], queryFn: () => fetchExportHistory(orgId), enabled: !!orgId });

  // מילוי ברירת מחדל של תקופת היצוא לפי היסטוריית היצוא: תחילת תקופה = היום שאחרי
  // period_end האחרון שיוצא בפועל לעמותה זו, וסוף תקופה = סוף אותו חודש קלנדרי.
  // רק "השלמה" - אם כבר יש ערך בשדה (מולא ידנית או ע"י ריצה קודמת של האפקט) לא דורסים
  // אותו; השדות עצמם נשארים לגמרי ניתנים לעריכה ידנית בכל שלב.
  useEffect(() => {
    if (!orgId || !historyQuery.isSuccess) return;
    if (periodStart || periodEnd) return;
    const lastEnd = mostRecentPeriodEnd(historyQuery.data);
    if (!lastEnd) return;
    const start = addDaysToDateString(lastEnd, 1);
    const end = endOfMonthForDateString(start);
    setPeriodStart(start);
    setPeriodEnd(end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, historyQuery.isSuccess, historyQuery.data]);

  const selectable = useMemo(
    () => (candidatesQuery.data ?? []).filter((s) => override || (!s.already_exported && s.status === "ready_for_talmud")),
    [candidatesQuery.data, override],
  );

  const filteredCandidates = useMemo(() => {
    const term = candidateSearch.trim().toLowerCase();
    if (!term) return candidatesQuery.data ?? [];
    return (candidatesQuery.data ?? []).filter(
      (s) => s.full_name.toLowerCase().includes(term) || s.external_id.toLowerCase().includes(term),
    );
  }, [candidatesQuery.data, candidateSearch]);

  const toggleAll = () => {
    setSelected(selected.size === selectable.length ? new Set() : new Set(selectable.map((s) => s.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const runExport = async () => {
    if (!orgId || !periodStart || !periodEnd || selected.size === 0) return;
    setExporting(true);
    setError(null);
    setResultFileName(null);
    try {
      const students = selectable.filter((s) => selected.has(s.id));
      const blob = buildExportWorkbook(students);
      const fileName = `talmud-export-${periodStart}-${crypto.randomUUID().slice(0, 8)}.xlsx`;
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const path = `${crypto.randomUUID()}-${fileName}`;
      const { error: uploadError } = await supabase.storage.from("talmud-exports").upload(path, blob);
      if (uploadError) throw new Error(`העלאת הקובץ נכשלה: ${uploadError.message}`);

      const { error: rpcError } = await supabase.rpc("create_talmud_export", {
        p_organization_id: orgId,
        p_branch_id: branchId || null,
        p_group_id: groupId || null,
        p_period_start: periodStart,
        p_period_end: periodEnd,
        p_student_ids: Array.from(selected),
        p_file_path: path,
        p_file_name: fileName,
        p_file_hash: hash,
        p_is_override: override,
        p_override_reason: override ? overrideReason : null,
      });
      if (rpcError) throw new Error(rpcError.message);

      setResultFileName(fileName);
      setSelected(new Set());
      setOverride(false);
      setOverrideReason("");
      queryClient.invalidateQueries({ queryKey: ["talmud-export-candidates"] });
      queryClient.invalidateQueries({ queryKey: ["talmud-export-history", orgId] });
      queryClient.invalidateQueries({ queryKey: ["students"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה לא צפויה");
    } finally {
      setExporting(false);
    }
  };

  if (permissionLoading) return <LoadingState rows={4} />;
  if (!canExport) return <ErrorState message="אין לך הרשאה ליצוא לתלמוד." />;

  const columns: DataTableColumn<CandidateStudent>[] = [
    {
      key: "select",
      header: "",
      render: (s) =>
        selectable.some((c) => c.id === s.id) ? (
          <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleOne(s.id)} />
        ) : (
          <span className="text-xs text-ink-subtle" title="כבר יוצא / לא במצב מוכן לתלמוד">
            —
          </span>
        ),
    },
    { key: "id", header: "מזהה", className: "tabular ltr-num", render: (s) => s.external_id },
    { key: "name", header: "שם", render: (s) => s.full_name },
    { key: "status", header: "סטטוס נוכחי", render: (s) => s.status },
  ];

  return (
    <div>
      <PageHeader title="יצוא תלמידים לתלמוד" description="בחירת תלמידים ליצוא. פורמט הקובץ הוא טיוטה - התבנית המאושרת של תלמוד/מרכבה טרם התקבלה." />

      <div className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn-soft p-3 text-sm text-warn-ink mb-4">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>עמודות הקובץ (מזהה תלמיד, שם מלא, טלפון) הן הנחה זמנית בלבד, לא הפורמט הרשמי שתלמוד/מרכבה דורשים.</span>
      </div>

      <div className="card mb-6 max-w-3xl space-y-4 p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="field-label">עמותה</label>
            <select
              value={orgId}
              onChange={(e) => {
                setOrgId(e.target.value);
                setBranchId("");
                setGroupId("");
                setSelected(new Set());
                setPeriodStart("");
                setPeriodEnd("");
              }}
              className="input-field"
            >
              <option value="">— בחרי —</option>
              {(orgsQuery.data ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.legal_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">סניף (לא חובה)</label>
            <select value={branchId} onChange={(e) => { setBranchId(e.target.value); setGroupId(""); }} disabled={!orgId} className="input-field">
              <option value="">— הכול —</option>
              {(branchesQuery.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.internal_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">קבוצה (לא חובה)</label>
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={!branchId} className="input-field">
              <option value="">— הכול —</option>
              {(groupsQuery.data ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="field-label">תחילת תקופה</label>
            <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="field-label">סוף תקופה</label>
            <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="input-field" />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input type="checkbox" checked={override} onChange={(e) => { setOverride(e.target.checked); setSelected(new Set()); }} />
          יצוא חוזר (כולל תלמידים שכבר יוצאו בעבר)
        </label>
        {override && (
          <input
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            placeholder="סיבת היצוא החוזר (חובה)"
            className="input-field"
          />
        )}

        {orgId && (
          <div>
            <button onClick={toggleAll} className="link-action mb-2 text-xs">
              {selected.size === selectable.length && selectable.length > 0 ? "בטל בחירת הכול" : "בחר הכול"}
            </button>
            <SearchAndFilters searchValue={candidateSearch} onSearchChange={setCandidateSearch} searchPlaceholder="חיפוש לפי שם או מזהה…" />
            <DataTable columns={columns} rows={filteredCandidates} rowKey={(s) => s.id} loading={candidatesQuery.isLoading} emptyTitle="אין תלמידים מתאימים" />
          </div>
        )}

        {error && <ErrorState message={error} />}
        {resultFileName && <p className="text-sm text-ok-ink">היצוא הופק בהצלחה: {resultFileName}</p>}

        <button
          onClick={runExport}
          disabled={exporting || selected.size === 0 || !periodStart || !periodEnd || (override && !overrideReason.trim())}
          className="btn-primary flex items-center gap-2"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          {exporting ? "מייצאת…" : `יצוא ${selected.size} תלמידים`}
        </button>
      </div>

      {orgId && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-ink-muted">היסטוריית יצוא</h2>
          <DataTable
            columns={[
              { key: "file", header: "קובץ", render: (b: any) => b.file_name },
              { key: "period", header: "תקופה", className: "tabular", render: (b: any) => `${b.period_start} — ${b.period_end}` },
              { key: "count", header: "מס' תלמידים", className: "tabular", render: (b: any) => b.student_count },
              { key: "override", header: "חוזר", render: (b: any) => (b.is_override ? "כן" : "—") },
              { key: "date", header: "תאריך", className: "tabular", render: (b: any) => new Date(b.created_at).toLocaleDateString("he-IL") },
            ]}
            rows={historyQuery.data ?? []}
            rowKey={(b: any) => b.id}
            loading={historyQuery.isLoading}
            emptyTitle="אין עדיין יצוא"
          />
        </>
      )}
    </div>
  );
}
