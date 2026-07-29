import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Split, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useLastSelected } from "@/lib/useLastSelected";
import { useHasPermission } from "@/lib/permissions";
import { parseImportFile } from "@/lib/importParsing";
import { exportRowsToExcel } from "@/lib/reportExport";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { HeaderRowConfirm } from "@/components/HeaderRowConfirm";

interface OrgOption {
  id: string;
  legal_name: string;
}

interface GroupOption {
  id: string;
  name: string;
}

type SourceType = "net_scholarships" | "donations" | "retro" | "combined";
type Method = "equal" | "fixed_amounts" | "percentages" | "instruction_file" | "manual";
type BatchStatus = "draft" | "in_review" | "approved" | "locked_for_masav" | "superseded";

interface BatchRow {
  id: string;
  period_month: string;
  source_type: SourceType;
  method: Method;
  status: BatchStatus;
  version: number;
  created_at: string;
}

interface LineRow {
  id: string;
  student_id: string;
  amount: number;
  student: { external_id: string; full_name: string };
}

interface GroupStudent {
  id: string;
  external_id: string;
  full_name: string;
  status: string;
  verified: boolean;
}

const SOURCE_LABEL: Record<SourceType, string> = { net_scholarships: "מלגות נטו", donations: "תרומות", retro: "רטרו", combined: "שילוב" };
const METHOD_LABEL: Record<Method, string> = { equal: "שווה", fixed_amounts: "סכומים", percentages: "אחוזים", instruction_file: "קובץ הוראות", manual: "ידנית" };
const STATUS_LABEL: Record<BatchStatus, string> = { draft: "טיוטה", in_review: "בבדיקה", approved: "מאושרת", locked_for_masav: "נעולה למס\"ב", superseded: "הוחלפה" };
const STATUS_SEVERITY: Record<BatchStatus, "neutral" | "medium" | "ok" | "high"> = {
  draft: "neutral",
  in_review: "medium",
  approved: "ok",
  locked_for_masav: "ok",
  superseded: "neutral",
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

async function fetchGroupBalance(groupId: string): Promise<number> {
  const { data, error } = await supabase.from("group_balances").select("balance").eq("group_id", groupId).maybeSingle();
  if (error) throw error;
  return data?.balance ?? 0;
}

async function fetchBatches(groupId: string): Promise<BatchRow[]> {
  const { data, error } = await supabase
    .from("distribution_batches")
    .select("id, period_month, source_type, method, status, version, created_at")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function fetchLines(batchId: string): Promise<LineRow[]> {
  const { data, error } = await supabase
    .from("distribution_lines")
    .select("id, student_id, amount, student:students(external_id, full_name)")
    .eq("batch_id", batchId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, student: Array.isArray(r.student) ? r.student[0] : r.student }));
}

async function fetchGroupStudents(groupId: string): Promise<GroupStudent[]> {
  const { data, error } = await supabase
    .from("student_assignments")
    .select("students!inner(id, external_id, full_name, status)")
    .eq("group_id", groupId)
    .eq("is_active", true);
  if (error) throw error;
  const students = (data ?? []).map((r: any) => r.students);
  const studentIds = students.map((s) => s.id);
  if (studentIds.length === 0) return [];

  // שאילתה אחת מרוכזת במקום שאילתה נפרדת לכל תלמיד בקבוצה (N+1 שנתפס בביקורת ביצועים
  // שלב 16 - קבוצה של מאות תלמידים הייתה יוצרת מאות בקשות רשת נפרדות בכל טעינת מסך).
  const { data: verifiedAccounts, error: accountsError } = await supabase
    .from("student_bank_accounts")
    .select("student_id")
    .in("student_id", studentIds)
    .eq("is_active", true)
    .eq("verification_status", "verified");
  if (accountsError) throw accountsError;
  const verifiedIds = new Set((verifiedAccounts ?? []).map((r) => r.student_id));

  return students.map((s) => ({ id: s.id, external_id: s.external_id, full_name: s.full_name, status: s.status, verified: verifiedIds.has(s.id) }));
}

const EMPTY_NEW_BATCH = { periodMonth: new Date().toISOString().slice(0, 7) + "-01", sourceType: "net_scholarships" as SourceType, method: "equal" as Method, notes: "" };

export function DistributionsScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("distributions", "manage");
  const { hasPermission: canApprove } = useHasPermission("distributions", "approve");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });

  const [orgId, setOrgId] = useLastSelected<string>("last-org", "");
  const [groupId, setGroupId] = useLastSelected<string>("last-group", "");
  const [showNewBatch, setShowNewBatch] = useState(false);
  const [newBatch, setNewBatch] = useState(EMPTY_NEW_BATCH);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [percentages, setPercentages] = useState<Record<string, string>>({});
  const [equalTotal, setEqualTotal] = useState("");
  const [pctTotal, setPctTotal] = useState("");
  const [savingLines, setSavingLines] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [fileWarnings, setFileWarnings] = useState<string[]>([]);
  const [headerConfirm, setHeaderConfirm] = useState<{ file: File; previewRows: string[][]; detectedIndex: number } | null>(null);

  const groupsQuery = useQuery({ queryKey: ["distributions-org-groups", orgId], queryFn: () => fetchOrgGroups(orgId), enabled: !!orgId });
  const balanceQuery = useQuery({ queryKey: ["group-balance-single", groupId], queryFn: () => fetchGroupBalance(groupId), enabled: !!groupId });
  const batchesQuery = useQuery({ queryKey: ["distribution-batches", groupId], queryFn: () => fetchBatches(groupId), enabled: !!groupId });
  const linesQuery = useQuery({ queryKey: ["distribution-lines", selectedBatchId], queryFn: () => fetchLines(selectedBatchId!), enabled: !!selectedBatchId });
  const groupStudentsQuery = useQuery({ queryKey: ["distribution-group-students", groupId], queryFn: () => fetchGroupStudents(groupId), enabled: !!groupId });

  const selectedBatch = batchesQuery.data?.find((b) => b.id === selectedBatchId) ?? null;

  const refreshBatch = () => {
    queryClient.invalidateQueries({ queryKey: ["distribution-batches", groupId] });
    queryClient.invalidateQueries({ queryKey: ["distribution-lines", selectedBatchId] });
  };

  const openBatch = (batch: BatchRow) => {
    setSelectedBatchId(batch.id);
    setAmounts({});
    setPercentages({});
    setEqualTotal("");
    setPctTotal("");
    setError(null);
    setFileWarnings([]);
    setHeaderConfirm(null);
  };

  const createBatch = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("distribution_batches")
      .insert({
        organization_id: orgId,
        group_id: groupId,
        period_month: newBatch.periodMonth,
        source_type: newBatch.sourceType,
        method: newBatch.method,
        notes: newBatch.notes || null,
      })
      .select("id")
      .single();
    setSubmitting(false);
    if (err) {
      setError(err.message);
      return;
    }
    setNewBatch(EMPTY_NEW_BATCH);
    setShowNewBatch(false);
    queryClient.invalidateQueries({ queryKey: ["distribution-batches", groupId] });
    if (data) openBatch({ id: data.id, period_month: newBatch.periodMonth, source_type: newBatch.sourceType, method: newBatch.method, status: "draft", version: 1, created_at: "" });
  };

  const applyEqualSplit = () => {
    const total = Number(equalTotal);
    const ids = (groupStudentsQuery.data ?? []).filter((s) => selectedIds.has(s.id)).map((s) => s.id);
    if (!total || ids.length === 0) return;
    const base = Math.floor((total / ids.length) * 100) / 100;
    const remainder = Math.round((total - base * ids.length) * 100) / 100;
    const next: Record<string, string> = {};
    ids.forEach((id, i) => {
      next[id] = (i === ids.length - 1 ? base + remainder : base).toFixed(2);
    });
    setAmounts(next);
  };

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // מילוי-אוטומטי של סכומים מקובץ (עמודות "מזהה תלמיד"/"סכום") - מנגנון קליינט-בלבד, לא דרך
  // מנוע היבוא הכללי (import_batches/import_rows): זו רק "עזרה במילוי טופס" שמזינה את אותו
  // amounts/selectedIds state כמו הזנה ידנית שורה-שורה, לא זרם רשומות שנשמר/נגרם commit
  // עצמאי - saveLines() הרגילה היא זו שכותבת בפועל (full-replace). מזהה מהקובץ שלא נמצא
  // בקבוצה לא נזרק בשקט - נאסף ל-fileWarnings ומוצג למשתמש (בעבר לא הוצג כלל, מה שיכול
  // היה להטעות לגבי "סה"כ נוכחי בטופס" שנראה נמוך מהצפוי בלי הסבר).
  const applyInstructionRows = (rows: Record<string, string>[]) => {
    const nextAmounts: Record<string, string> = {};
    const nextSelected = new Set<string>();
    const notFound: string[] = [];
    let matchedCount = 0;
    for (const row of rows) {
      const externalId = (row["מזהה תלמיד"] ?? "").trim();
      const amountRaw = (row["סכום"] ?? "").trim();
      if (!externalId && !amountRaw) continue; // שורה ריקה לגמרי - מתעלמים בשקט
      const student = (groupStudentsQuery.data ?? []).find((s) => s.external_id === externalId);
      if (!student) {
        if (externalId) notFound.push(externalId);
        continue;
      }
      if (!amountRaw) continue;
      nextAmounts[student.id] = amountRaw;
      nextSelected.add(student.id);
      matchedCount++;
    }
    setAmounts(nextAmounts);
    setSelectedIds(nextSelected);
    setFileWarnings(notFound);
    if (matchedCount === 0 && notFound.length === 0) {
      setError('לא נמצאו שורות תקינות בקובץ - יש לוודא עמודות בשם מדויק "מזהה תלמיד" ו"סכום"');
    }
  };

  // אותה בעיית "שורות כותרת מוסדית/פרטי חשבון לפני הטבלה" שנחשפה בדוח הבנק האמיתי יכולה
  // להופיע גם כאן (קובץ הוראות חלוקה) - headerConfidence="low" תמיד מוצג לאישור המשתמשת,
  // לעולם לא מדלגים בשקט על שורות (ר' importParsing.ts/detectHeaderRow).
  const handleInstructionFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setFileWarnings([]);
    setHeaderConfirm(null);
    try {
      const parsed = await parseImportFile(file);
      if (parsed.headerConfidence === "low") {
        setHeaderConfirm({ file, previewRows: parsed.previewRows, detectedIndex: parsed.headerRowIndex });
        return;
      }
      applyInstructionRows(parsed.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בניתוח הקובץ");
    }
  };

  const handleHeaderConfirm = async (chosenIndex: number) => {
    if (!headerConfirm) return;
    const chosenFile = headerConfirm.file;
    setHeaderConfirm(null);
    setError(null);
    try {
      const parsed = await parseImportFile(chosenFile, chosenIndex);
      applyInstructionRows(parsed.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בניתוח הקובץ");
    }
  };

  const handleHeaderCancel = () => {
    setHeaderConfirm(null);
    setFileWarnings([]);
  };

  const exportLines = () => {
    if (!selectedBatch) return;
    const rows = lines.map((l) => ({
      "מזהה תלמיד": l.student.external_id,
      "שם": l.student.full_name,
      "סכום": l.amount,
    }));
    exportRowsToExcel(rows, "שורות חלוקה", `שורות-חלוקה-${selectedBatch.period_month}-גרסה-${selectedBatch.version}.xlsx`);
  };

  const saveLines = async () => {
    if (!selectedBatchId) return;
    setSavingLines(true);
    setError(null);
    const rows = Array.from(selectedIds)
      .map((studentId) => {
        const pct = percentages[studentId];
        const amount =
          newBatch.method === "percentages" || selectedBatch?.method === "percentages"
            ? (Number(pct || 0) * Number(pctTotal || 0)) / 100
            : Number(amounts[studentId] || 0);
        return { student_id: studentId, amount };
      })
      .filter((r) => r.amount > 0);

    const { error: delErr } = await supabase.from("distribution_lines").delete().eq("batch_id", selectedBatchId);
    if (delErr) {
      setSavingLines(false);
      setError(delErr.message);
      return;
    }
    if (rows.length > 0) {
      const { error: insErr } = await supabase.from("distribution_lines").insert(rows.map((r) => ({ batch_id: selectedBatchId, ...r })));
      if (insErr) {
        setSavingLines(false);
        setError(insErr.message);
        return;
      }
    }
    setSavingLines(false);
    refreshBatch();
  };

  const runAction = async (rpc: string, params: Record<string, unknown>) => {
    setActionBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc(rpc, params);
    setActionBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    refreshBatch();
    queryClient.invalidateQueries({ queryKey: ["group-balance-single", groupId] });
    queryClient.invalidateQueries({ queryKey: ["group-balances"] });
  };

  const createNewVersion = async () => {
    if (!selectedBatchId) return;
    setActionBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("create_distribution_version", { p_batch_id: selectedBatchId }).single();
    setActionBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["distribution-batches", groupId] });
    if (data) setSelectedBatchId(data as unknown as string);
  };

  const lines = linesQuery.data ?? [];
  const linesTotal = lines.reduce((sum, l) => sum + l.amount, 0);
  const draftTotal =
    selectedBatch?.status === "draft"
      ? Array.from(selectedIds).reduce((sum, id) => {
          const pct = percentages[id];
          const amount = selectedBatch.method === "percentages" ? (Number(pct || 0) * Number(pctTotal || 0)) / 100 : Number(amounts[id] || 0);
          return sum + amount;
        }, 0)
      : linesTotal;

  const batchColumns: DataTableColumn<BatchRow>[] = [
    { key: "month", header: "חודש", className: "tabular", render: (r) => r.period_month },
    { key: "source", header: "מקור", render: (r) => SOURCE_LABEL[r.source_type] },
    { key: "method", header: "שיטה", render: (r) => METHOD_LABEL[r.method] },
    { key: "version", header: "גרסה", className: "tabular", render: (r) => r.version },
    { key: "status", header: "סטטוס", render: (r) => <StatusBadge severity={STATUS_SEVERITY[r.status]} label={STATUS_LABEL[r.status]} /> },
  ];

  const lineColumns: DataTableColumn<LineRow>[] = [
    { key: "id", header: "מזהה", className: "tabular", render: (r) => r.student.external_id },
    { key: "name", header: "שם", render: (r) => r.student.full_name },
    { key: "amount", header: "סכום", className: "tabular", render: (r) => r.amount.toLocaleString("he-IL") },
  ];

  return (
    <div>
      <PageHeader
        title="הוראות חלוקה"
        description="חלוקה נשלפת מיתרת הקבוצה (מלגות נטו + תרומות + רטרו, פונגיבילי). אין שידור תשלום בשלב זה - אישור/נעילה כאן הם רק תוכנית מאושרת, ממתינה להכנת מס״ב."
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 max-w-lg">
        <div>
          <label className="field-label">עמותה</label>
          <select
            value={orgId}
            onChange={(e) => {
              setOrgId(e.target.value);
              setGroupId("");
              setSelectedBatchId(null);
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
          <label className="field-label">קבוצה</label>
          <select
            value={groupId}
            onChange={(e) => {
              setGroupId(e.target.value);
              setSelectedBatchId(null);
            }}
            className="input-field"
            disabled={!orgId}
          >
            <option value="">— בחרי —</option>
            {(groupsQuery.data ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {groupId && (
        <>
          <div className="card mb-4 max-w-sm p-3">
            <p className="text-xs text-slate-500">יתרת קבוצה נוכחית</p>
            <p className="text-lg font-bold tabular">{(balanceQuery.data ?? 0).toLocaleString("he-IL")}</p>
          </div>

          {canManage && (
            <div className="mb-4">
              <button onClick={() => setShowNewBatch((v) => !v)} className="btn-primary">
                {showNewBatch ? "סגירה" : "אצווה חדשה"}
              </button>
            </div>
          )}

          {showNewBatch && (
            <form onSubmit={createBatch} className="card mb-6 max-w-2xl space-y-3 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="field-label">חודש</label>
                  <input required type="date" value={newBatch.periodMonth} onChange={(e) => setNewBatch((f) => ({ ...f, periodMonth: e.target.value }))} className="input-field" />
                </div>
                <div>
                  <label className="field-label">מקור כסף</label>
                  <select value={newBatch.sourceType} onChange={(e) => setNewBatch((f) => ({ ...f, sourceType: e.target.value as SourceType }))} className="input-field">
                    {(Object.keys(SOURCE_LABEL) as SourceType[]).map((s) => (
                      <option key={s} value={s}>
                        {SOURCE_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label">שיטה</label>
                  <select value={newBatch.method} onChange={(e) => setNewBatch((f) => ({ ...f, method: e.target.value as Method }))} className="input-field">
                    {(Object.keys(METHOD_LABEL) as Method[]).map((m) => (
                      <option key={m} value={m}>
                        {METHOD_LABEL[m]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="field-label">הערות</label>
                <input value={newBatch.notes} onChange={(e) => setNewBatch((f) => ({ ...f, notes: e.target.value }))} className="input-field" />
              </div>
              {error && <ErrorState message={error} />}
              <button type="submit" disabled={submitting} className="btn-primary">
                {submitting ? "יוצרת…" : "יצירת אצווה"}
              </button>
            </form>
          )}

          <DataTable
            columns={batchColumns}
            rows={batchesQuery.data ?? []}
            rowKey={(r) => r.id}
            loading={batchesQuery.isLoading}
            emptyTitle="אין עדיין אצוות חלוקה לקבוצה זו"
            emptyIcon={Split}
            onRowClick={openBatch}
          />

          {selectedBatchId && selectedBatch && (
            <div className="card mt-6 max-w-4xl space-y-4 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-700">
                    אצווה {selectedBatch.period_month} · גרסה {selectedBatch.version}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {SOURCE_LABEL[selectedBatch.source_type]} · {METHOD_LABEL[selectedBatch.method]}
                  </p>
                </div>
                <StatusBadge severity={STATUS_SEVERITY[selectedBatch.status]} label={STATUS_LABEL[selectedBatch.status]} />
              </div>

              {error && <ErrorState message={error} />}

              {selectedBatch.status === "draft" && canManage && (
                <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  {selectedBatch.method === "equal" && (
                    <div className="flex items-end gap-2">
                      <div>
                        <label className="field-label">סכום כולל לחלוקה שווה</label>
                        <input type="number" step="0.01" value={equalTotal} onChange={(e) => setEqualTotal(e.target.value)} className="input-field tabular" />
                      </div>
                      <button type="button" onClick={applyEqualSplit} className="btn-secondary text-xs">
                        חישוב חלוקה שווה
                      </button>
                    </div>
                  )}
                  {selectedBatch.method === "percentages" && (
                    <div>
                      <label className="field-label">סכום כולל</label>
                      <input type="number" step="0.01" value={pctTotal} onChange={(e) => setPctTotal(e.target.value)} className="input-field tabular w-48" />
                    </div>
                  )}
                  {selectedBatch.method !== "percentages" && (
                    <div>
                      <label className="field-label">
                        {selectedBatch.method === "instruction_file"
                          ? "קובץ הוראות (עמודות: מזהה תלמיד, סכום)"
                          : 'או: טעינת קובץ למילוי מהיר (עמודות: "מזהה תלמיד", "סכום")'}
                      </label>
                      <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => handleInstructionFile(e.target.files?.[0] ?? null)} className="input-field" />
                      {headerConfirm && (
                        <div className="mt-2">
                          <HeaderRowConfirm
                            previewRows={headerConfirm.previewRows}
                            detectedIndex={headerConfirm.detectedIndex}
                            onConfirm={handleHeaderConfirm}
                            onCancel={handleHeaderCancel}
                          />
                        </div>
                      )}
                      {fileWarnings.length > 0 && (
                        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                          {fileWarnings.length} מזהי תלמיד מהקובץ לא נמצאו בקבוצה זו ולכן לא נכללו: {fileWarnings.join(", ")}
                        </div>
                      )}
                    </div>
                  )}

                  {groupStudentsQuery.isLoading ? (
                    <LoadingState rows={3} />
                  ) : (
                    <div className="max-h-80 overflow-y-auto rounded-md border border-slate-200 bg-white">
                      <table className="w-full text-right text-sm">
                        <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                          <tr>
                            <th className="px-3 py-2"></th>
                            <th className="px-3 py-2">מזהה</th>
                            <th className="px-3 py-2">שם</th>
                            <th className="px-3 py-2"></th>
                            <th className="px-3 py-2">{selectedBatch.method === "percentages" ? "אחוז" : "סכום"}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(groupStudentsQuery.data ?? []).map((s) => (
                            <tr key={s.id}>
                              <td className="px-3 py-2">
                                <input type="checkbox" checked={selectedIds.has(s.id)} onChange={() => toggleSelected(s.id)} />
                              </td>
                              <td className="px-3 py-2 tabular">{s.external_id}</td>
                              <td className="px-3 py-2">{s.full_name}</td>
                              <td className="px-3 py-2">
                                {s.status === "inactive" && <StatusBadge severity="critical" label="לא פעיל" />}
                                {!s.verified && s.status !== "inactive" && <StatusBadge severity="medium" label="חשבון לא מאומת" />}
                              </td>
                              <td className="px-3 py-2">
                                {selectedIds.has(s.id) &&
                                  (selectedBatch.method === "percentages" ? (
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={percentages[s.id] ?? ""}
                                      onChange={(e) => setPercentages((p) => ({ ...p, [s.id]: e.target.value }))}
                                      className="input-field tabular w-24"
                                    />
                                  ) : (
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={amounts[s.id] ?? ""}
                                      onChange={(e) => setAmounts((a) => ({ ...a, [s.id]: e.target.value }))}
                                      className="input-field tabular w-28"
                                    />
                                  ))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-500">סה"כ נוכחי בטופס: {draftTotal.toLocaleString("he-IL")}</p>
                    <button onClick={saveLines} disabled={savingLines} className="btn-secondary flex items-center gap-2 text-xs">
                      <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                      {savingLines ? "שומרת…" : "שמירת שורות"}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end">
                <button onClick={exportLines} className="btn-secondary flex items-center gap-2 text-xs">
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  ייצוא לאקסל
                </button>
              </div>

              <DataTable columns={lineColumns} rows={lines} rowKey={(r) => r.id} loading={linesQuery.isLoading} emptyTitle="אין עדיין שורות באצווה" />

              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-600">סה"כ שורות שמורות: {linesTotal.toLocaleString("he-IL")}</p>
                <div className="flex gap-2">
                  {selectedBatch.status === "draft" && canManage && (
                    <button onClick={() => runAction("submit_distribution_for_review", { p_batch_id: selectedBatchId })} disabled={actionBusy} className="btn-primary text-xs">
                      הגשה לבדיקה
                    </button>
                  )}
                  {selectedBatch.status === "in_review" && canApprove && (
                    <button onClick={() => setConfirmApprove(true)} disabled={actionBusy} className="btn-primary text-xs">
                      אישור
                    </button>
                  )}
                  {selectedBatch.status === "approved" && canApprove && (
                    <button onClick={() => runAction("lock_distribution_for_masav", { p_batch_id: selectedBatchId })} disabled={actionBusy} className="btn-primary text-xs">
                      נעילה להכנת מס״ב
                    </button>
                  )}
                  {(selectedBatch.status === "approved" || selectedBatch.status === "locked_for_masav") && canManage && (
                    <button onClick={createNewVersion} disabled={actionBusy} className="btn-secondary text-xs">
                      יצירת גרסה חדשה
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmApprove}
        title="אישור אצוות חלוקה"
        description="השרת יבדוק שוב תלמיד לא פעיל/ללא חשבון מאומת ויתרה זמינה לפני אישור בפועל."
        onConfirm={() => {
          setConfirmApprove(false);
          runAction("approve_distribution_batch", { p_batch_id: selectedBatchId });
        }}
        onCancel={() => setConfirmApprove(false)}
      />
    </div>
  );
}
