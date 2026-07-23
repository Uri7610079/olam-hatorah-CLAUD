import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Landmark, AlertTriangle, Download } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface OrgOption {
  id: string;
  legal_name: string;
}

interface BankAccountOption {
  id: string;
  bank_name: string | null;
  account_number_masked: string | null;
}

type MasavStatus =
  | "draft"
  | "pending_review"
  | "pending_approval"
  | "approved"
  | "file_generated"
  | "transmitted"
  | "bank_completed"
  | "needs_correction"
  | "cancelled";

interface BatchRow {
  id: string;
  period_month: string;
  status: MasavStatus;
  total_amount: number;
  payment_count: number;
  reviewed_at: string | null;
  status_reason: string | null;
}

type LineStatus = "pending" | "valid" | "rejected" | "returned";

interface LineRow {
  id: string;
  student_id: string;
  group_id: string;
  student_bank_account_id: string | null;
  amount: number;
  status: LineStatus;
  rejection_code: string | null;
  student: { external_id: string; full_name: string };
  group: { name: string };
  bank_account: { account_number_masked: string | null } | null;
}

const STATUS_LABEL: Record<MasavStatus, string> = {
  draft: "טיוטה",
  pending_review: "ממתין לבדיקה",
  pending_approval: "ממתין לאישור",
  approved: "מאושר",
  file_generated: "קובץ הופק",
  transmitted: "שודר",
  bank_completed: "בוצע בבנק",
  needs_correction: "דורש תיקון",
  cancelled: "בוטל",
};
const STATUS_SEVERITY: Record<MasavStatus, "neutral" | "medium" | "ok" | "critical"> = {
  draft: "neutral",
  pending_review: "medium",
  pending_approval: "medium",
  approved: "ok",
  file_generated: "ok",
  transmitted: "ok",
  bank_completed: "ok",
  needs_correction: "critical",
  cancelled: "neutral",
};
const LINE_STATUS_LABEL: Record<LineStatus, string> = { pending: "טרם נבדק", valid: "תקין", rejected: "נדחה", returned: "חזר" };

async function fetchOrgs(): Promise<OrgOption[]> {
  const { data, error } = await supabase.from("organizations").select("id, legal_name").eq("status", "active").order("legal_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchOrgBankAccounts(orgId: string): Promise<BankAccountOption[]> {
  const { data, error } = await supabase
    .from("organization_bank_accounts_view")
    .select("id, bank_name, account_number_masked")
    .eq("organization_id", orgId)
    .eq("is_active", true);
  if (error) throw error;
  return data ?? [];
}

async function fetchBatches(orgId: string): Promise<BatchRow[]> {
  const { data, error } = await supabase
    .from("masav_batches")
    .select("id, period_month, status, total_amount, payment_count, reviewed_at, status_reason")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function fetchLines(batchId: string): Promise<LineRow[]> {
  const { data, error } = await supabase
    .from("masav_lines")
    .select(
      "id, student_id, group_id, student_bank_account_id, amount, status, rejection_code, student:students(external_id, full_name), group:groups(name)",
    )
    .eq("batch_id", batchId)
    .order("created_at");
  if (error) throw error;

  const rows = (data ?? []).map((r: any) => ({
    ...r,
    student: Array.isArray(r.student) ? r.student[0] : r.student,
    group: Array.isArray(r.group) ? r.group[0] : r.group,
    bank_account: null as { account_number_masked: string | null } | null,
  }));

  // student_bank_accounts_view הוא view, לא הטבלה שאליה מצביע ה-FK (student_bank_account_id
  // מצביע ל-student_bank_accounts) - PostgREST לא יכול להסיק embed דרך view כזה, אז
  // שולפים בנפרד ומאחדים בצד הלקוח, במקום embed שהיה נכשל ב-runtime.
  const accountIds = Array.from(new Set(rows.map((r) => r.student_bank_account_id).filter((id): id is string => !!id)));
  if (accountIds.length > 0) {
    const { data: accounts } = await supabase.from("student_bank_accounts_view").select("id, account_number_masked").in("id", accountIds);
    const byId = new Map((accounts ?? []).map((a) => [a.id, a.account_number_masked]));
    for (const row of rows) {
      if (row.student_bank_account_id) row.bank_account = { account_number_masked: byId.get(row.student_bank_account_id) ?? null };
    }
  }

  return rows;
}

function buildMasavExportWorkbook(lines: LineRow[], revealed: Map<string, string>): Blob {
  const sheetData = lines
    .filter((l) => l.status === "valid")
    .map((l) => ({
      "מזהה תלמיד": l.student.external_id,
      "שם מלא": l.student.full_name,
      קבוצה: l.group.name,
      "מספר חשבון": revealed.get(l.id) ?? l.bank_account?.account_number_masked ?? "",
      סכום: l.amount,
    }));
  const sheet = XLSX.utils.json_to_sheet(sheetData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "טיוטה - לא לשידור");
  const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function MasavScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("masav", "manage");
  const { hasPermission: canApprove } = useHasPermission("masav", "approve");
  const { hasPermission: canReveal } = useHasPermission("bank_accounts", "view_sensitive");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });

  const [orgId, setOrgId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [periodMonth, setPeriodMonth] = useState(() => new Date().toISOString().slice(0, 7) + "-01");
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmTransmit, setConfirmTransmit] = useState(false);
  const [reasonAction, setReasonAction] = useState<"cancel" | "correction" | null>(null);
  const [reasonText, setReasonText] = useState("");

  const bankAccountsQuery = useQuery({ queryKey: ["masav-org-accounts", orgId], queryFn: () => fetchOrgBankAccounts(orgId), enabled: !!orgId });
  const batchesQuery = useQuery({ queryKey: ["masav-batches", orgId], queryFn: () => fetchBatches(orgId), enabled: !!orgId });
  const linesQuery = useQuery({ queryKey: ["masav-lines", selectedBatchId], queryFn: () => fetchLines(selectedBatchId!), enabled: !!selectedBatchId });

  const selectedBatch = batchesQuery.data?.find((b) => b.id === selectedBatchId) ?? null;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["masav-batches", orgId] });
    queryClient.invalidateQueries({ queryKey: ["masav-lines", selectedBatchId] });
  };

  const createBatch = async () => {
    if (!orgId || !bankAccountId || !periodMonth) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase
      .rpc("create_masav_batch", { p_organization_id: orgId, p_organization_bank_account_id: bankAccountId, p_period_month: periodMonth })
      .single();
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["masav-batches", orgId] });
    setSelectedBatchId(data as unknown as string);
  };

  const runAction = async (rpc: string, params: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc(rpc, params);
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    refresh();
    queryClient.invalidateQueries({ queryKey: ["group-balances"] });
  };

  const submitReasonAction = async () => {
    if (!selectedBatchId || !reasonText.trim() || !reasonAction) return;
    const rpc = reasonAction === "cancel" ? "cancel_masav_batch" : "request_masav_correction";
    await runAction(rpc, { p_batch_id: selectedBatchId, p_reason: reasonText });
    setReasonAction(null);
    setReasonText("");
  };

  const runExport = async () => {
    if (!selectedBatchId || !linesQuery.data) return;
    setExporting(true);
    setError(null);
    try {
      const revealed = new Map<string, string>();
      if (canReveal) {
        for (const line of linesQuery.data.filter((l) => l.status === "valid" && l.student_bank_account_id)) {
          const { data, error: err } = await supabase.rpc("reveal_student_bank_account_number", {
            p_account_id: line.student_bank_account_id,
          });
          if (!err && data) revealed.set(line.id, data as unknown as string);
        }
      }
      const blob = buildMasavExportWorkbook(linesQuery.data, revealed);
      const fileName = `masav-draft-${selectedBatch?.period_month}-${crypto.randomUUID().slice(0, 8)}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      await runAction("mark_masav_file_generated", { p_batch_id: selectedBatchId, p_reference: fileName });
    } finally {
      setExporting(false);
    }
  };

  const batchColumns: DataTableColumn<BatchRow>[] = [
    { key: "month", header: "חודש", className: "tabular", render: (r) => r.period_month },
    { key: "amount", header: "סכום", className: "tabular", render: (r) => r.total_amount.toLocaleString("he-IL") },
    { key: "count", header: "מס' תשלומים", className: "tabular", render: (r) => r.payment_count },
    { key: "status", header: "סטטוס", render: (r) => <StatusBadge severity={STATUS_SEVERITY[r.status]} label={STATUS_LABEL[r.status]} /> },
  ];

  const lineColumns: DataTableColumn<LineRow>[] = [
    { key: "id", header: "מזהה", className: "tabular", render: (r) => r.student.external_id },
    { key: "name", header: "שם", render: (r) => r.student.full_name },
    { key: "group", header: "קבוצה", render: (r) => r.group.name },
    { key: "account", header: "חשבון", className: "tabular", render: (r) => r.bank_account?.account_number_masked ?? "—" },
    { key: "amount", header: "סכום", className: "tabular", render: (r) => r.amount.toLocaleString("he-IL") },
    {
      key: "status",
      header: "סטטוס שורה",
      render: (r) => (
        <div>
          <StatusBadge severity={r.status === "valid" ? "ok" : r.status === "rejected" ? "critical" : r.status === "returned" ? "medium" : "neutral"} label={LINE_STATUS_LABEL[r.status]} />
          {r.rejection_code && <p className="mt-1 text-xs text-slate-400">{r.rejection_code}</p>}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="מס״ב ותשלומים"
        description='מרכזת את כל הוראות החלוקה הנעולות לאותה עמותה/חודש. פורמט הקובץ הוא טיוטה בלבד - "פורמט שידור סופי טרם אושר" מול הבנק/מס"ב. אין שידור אוטומטי - כל שלב מסומן ידנית לאחר ביצוע בפועל מחוץ למערכת.'
      />

      <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 mb-4">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>פורמט שידור סופי טרם אושר מול הבנק/מס"ב. הקובץ המיוצא כאן הוא טיוטה לבדיקה/דמו בלבד ואינו מתאים לשידור אמיתי.</span>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3 max-w-2xl">
        <div>
          <label className="field-label">עמותה</label>
          <select
            value={orgId}
            onChange={(e) => {
              setOrgId(e.target.value);
              setBankAccountId("");
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
          <label className="field-label">חשבון עמותה</label>
          <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} className="input-field" disabled={!orgId}>
            <option value="">— בחרי —</option>
            {(bankAccountsQuery.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.bank_name ?? "בנק"} · {a.account_number_masked}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">חודש</label>
          <input type="date" value={periodMonth} onChange={(e) => setPeriodMonth(e.target.value)} className="input-field" />
        </div>
      </div>

      {orgId && canManage && (
        <div className="mb-4">
          <button onClick={createBatch} disabled={!bankAccountId || busy} className="btn-primary">
            {busy ? "יוצרת…" : "יצירת אצוות מס״ב"}
          </button>
        </div>
      )}

      {error && <div className="mb-4"><ErrorState message={error} /></div>}

      {orgId && (
        <DataTable
          columns={batchColumns}
          rows={batchesQuery.data ?? []}
          rowKey={(r) => r.id}
          loading={batchesQuery.isLoading}
          emptyTitle="אין עדיין אצוות מס״ב"
          emptyIcon={Landmark}
          onRowClick={(r) => setSelectedBatchId(r.id)}
        />
      )}

      {selectedBatchId && selectedBatch && (
        <div className="card mt-6 max-w-5xl space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">אצוות מס״ב · {selectedBatch.period_month}</h2>
            <StatusBadge severity={STATUS_SEVERITY[selectedBatch.status]} label={STATUS_LABEL[selectedBatch.status]} />
          </div>
          {selectedBatch.status_reason && <p className="text-xs text-slate-500">סיבה: {selectedBatch.status_reason}</p>}

          {linesQuery.isLoading ? <LoadingState rows={3} /> : <DataTable columns={lineColumns} rows={linesQuery.data ?? []} rowKey={(r) => r.id} emptyTitle="אין שורות" />}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-600">
              סה"כ: {selectedBatch.total_amount.toLocaleString("he-IL")} · {selectedBatch.payment_count} תשלומים
            </p>
            <div className="flex flex-wrap gap-2">
              {selectedBatch.status === "draft" && canManage && (
                <button onClick={() => runAction("submit_masav_for_review", { p_batch_id: selectedBatchId })} disabled={busy} className="btn-primary text-xs">
                  הגשה לבדיקה
                </button>
              )}
              {selectedBatch.status === "pending_review" && canManage && (
                <button onClick={() => runAction("run_masav_validation", { p_batch_id: selectedBatchId })} disabled={busy} className="btn-secondary text-xs">
                  הרצת בדיקה
                </button>
              )}
              {selectedBatch.status === "pending_review" && canManage && selectedBatch.reviewed_at && (
                <button onClick={() => runAction("submit_masav_for_approval", { p_batch_id: selectedBatchId })} disabled={busy} className="btn-primary text-xs">
                  הגשה לאישור
                </button>
              )}
              {selectedBatch.status === "pending_approval" && canApprove && (
                <button onClick={() => runAction("approve_masav_batch", { p_batch_id: selectedBatchId })} disabled={busy} className="btn-primary text-xs">
                  אישור
                </button>
              )}
              {selectedBatch.status === "approved" && canApprove && (
                <button onClick={runExport} disabled={exporting} className="btn-primary flex items-center gap-2 text-xs">
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  {exporting ? "מייצאת…" : "ייצוא קובץ (טיוטה)"}
                </button>
              )}
              {selectedBatch.status === "file_generated" && canApprove && (
                <button onClick={() => setConfirmTransmit(true)} disabled={busy} className="btn-primary text-xs">
                  סימון כמשודר
                </button>
              )}
              {selectedBatch.status === "transmitted" && canApprove && (
                <button onClick={() => runAction("mark_masav_bank_completed", { p_batch_id: selectedBatchId })} disabled={busy} className="btn-secondary text-xs">
                  סימון כבוצע בבנק
                </button>
              )}
              {canManage && ["draft", "pending_review", "pending_approval"].includes(selectedBatch.status) && (
                <>
                  <button onClick={() => setReasonAction("correction")} className="text-xs text-amber-700 underline">
                    דרישת תיקון
                  </button>
                  <button onClick={() => setReasonAction("cancel")} className="text-xs text-red-600 underline">
                    ביטול
                  </button>
                </>
              )}
            </div>
          </div>

          {reasonAction && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <label className="field-label">{reasonAction === "cancel" ? "סיבת ביטול" : "סיבת דרישת תיקון"}</label>
              <div className="flex gap-2">
                <input value={reasonText} onChange={(e) => setReasonText(e.target.value)} className="input-field" />
                <button onClick={submitReasonAction} disabled={!reasonText.trim() || busy} className="btn-primary text-xs shrink-0">
                  אישור
                </button>
                <button onClick={() => setReasonAction(null)} className="text-xs text-slate-500 underline shrink-0">
                  ביטול
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmTransmit}
        title="סימון כמשודר בפועל"
        description="פעולה זו תיצור תנועות תשלום סופיות בספר התנועות של הקבוצות (הכסף נחשב כיוצא בפועל). יש לוודא שהקובץ אכן הועבר לבנק לפני הסימון."
        onConfirm={() => {
          setConfirmTransmit(false);
          runAction("mark_masav_transmitted", { p_batch_id: selectedBatchId });
        }}
        onCancel={() => setConfirmTransmit(false)}
      />
    </div>
  );
}
