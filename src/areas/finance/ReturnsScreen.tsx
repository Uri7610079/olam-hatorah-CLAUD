import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useLastSelected } from "@/lib/useLastSelected";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";

interface OrgOption {
  id: string;
  legal_name: string;
}

interface TransmittedBatch {
  id: string;
  period_month: string;
  status: string;
}

interface ValidLine {
  id: string;
  amount: number;
  student: { external_id: string; full_name: string };
}

type ReturnStatus = "open" | "retried" | "resolved";

interface ReturnRow {
  id: string;
  return_date: string;
  amount: number;
  reason: string;
  status: ReturnStatus;
  notes: string | null;
  masav_line_id: string;
  new_bank_account_id: string | null;
  retry_masav_line_id: string | null;
  masav_line: { student: { id: string; external_id: string; full_name: string } };
  retry_line: { batch: { status: string } } | null;
}

interface BankAccountOption {
  id: string;
  account_number_masked: string | null;
}

interface RetryLineOption {
  id: string;
  amount: number;
  batch: { period_month: string; status: string };
}

const RETURN_STATUS_LABEL: Record<ReturnStatus, string> = { open: "פתוח", retried: "נשלח שוב", resolved: "טופל" };

async function fetchVerifiedAccounts(studentId: string): Promise<BankAccountOption[]> {
  const { data, error } = await supabase
    .from("student_bank_accounts_view")
    .select("id, account_number_masked")
    .eq("student_id", studentId)
    .eq("verification_status", "verified")
    .eq("is_active", true);
  if (error) throw error;
  return data ?? [];
}

async function fetchRetryLineOptions(studentId: string, excludeLineId: string): Promise<RetryLineOption[]> {
  const { data, error } = await supabase
    .from("masav_lines")
    .select("id, amount, batch:masav_batches(period_month, status)")
    .eq("student_id", studentId)
    .eq("status", "valid")
    .neq("id", excludeLineId);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, batch: Array.isArray(r.batch) ? r.batch[0] : r.batch }));
}

async function fetchOrgs(): Promise<OrgOption[]> {
  const { data, error } = await supabase.from("organizations").select("id, legal_name").eq("status", "active").order("legal_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchTransmittedBatches(orgId: string): Promise<TransmittedBatch[]> {
  const { data, error } = await supabase
    .from("masav_batches")
    .select("id, period_month, status")
    .eq("organization_id", orgId)
    .in("status", ["transmitted", "bank_completed"])
    .order("period_month", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function fetchValidLines(batchId: string): Promise<ValidLine[]> {
  const { data, error } = await supabase
    .from("masav_lines")
    .select("id, amount, student:students(external_id, full_name)")
    .eq("batch_id", batchId)
    .eq("status", "valid");
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, student: Array.isArray(r.student) ? r.student[0] : r.student }));
}

async function fetchReturns(orgId: string): Promise<ReturnRow[]> {
  // payment_returns has two FKs into masav_lines (the original line and the optional
  // retry line) - PostgREST can't infer which one for a plain "masav_lines(...)" embed,
  // so the FK constraint name must be given explicitly (caught live: this returned a
  // PGRST201 "more than one relationship found" error until fixed).
  const { data, error } = await supabase
    .from("payment_returns")
    .select(
      "id, return_date, amount, reason, status, notes, masav_line_id, new_bank_account_id, retry_masav_line_id, masav_line:masav_lines!payment_returns_masav_line_id_fkey(student:students(id, external_id, full_name), batch:masav_batches(organization_id)), retry_line:masav_lines!payment_returns_retry_masav_line_id_fkey(batch:masav_batches(status))",
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? [])
    .map((r: any) => ({
      ...r,
      masav_line: Array.isArray(r.masav_line) ? r.masav_line[0] : r.masav_line,
      retry_line: Array.isArray(r.retry_line) ? r.retry_line[0] : r.retry_line,
    }))
    .map((r: any) => ({
      ...r,
      masav_line: { ...r.masav_line, student: Array.isArray(r.masav_line.student) ? r.masav_line.student[0] : r.masav_line.student },
      retry_line: r.retry_line ? { batch: Array.isArray(r.retry_line.batch) ? r.retry_line.batch[0] : r.retry_line.batch } : null,
      _orgId: Array.isArray(r.masav_line.batch) ? r.masav_line.batch[0]?.organization_id : r.masav_line.batch?.organization_id,
    }))
    .filter((r: any) => r._orgId === orgId);
}

export function ReturnsScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("payment_returns", "manage");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });
  const [searchParams] = useSearchParams();

  const [orgId, setOrgId] = useLastSelected<string>("last-org", "");
  const [showForm, setShowForm] = useState(false);
  const [batchId, setBatchId] = useState("");
  const [lineId, setLineId] = useState("");
  const [returnDate, setReturnDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedReturnId, setSelectedReturnId] = useState<string | null>(null);
  const [retryAccountId, setRetryAccountId] = useState("");
  const [retryLineId, setRetryLineId] = useState("");
  const [linking, setLinking] = useState(false);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    const orgParam = searchParams.get("org");
    if (orgParam) setOrgId(orgParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const batchesQuery = useQuery({ queryKey: ["returns-transmitted-batches", orgId], queryFn: () => fetchTransmittedBatches(orgId), enabled: !!orgId });
  const linesQuery = useQuery({ queryKey: ["returns-valid-lines", batchId], queryFn: () => fetchValidLines(batchId), enabled: !!batchId });
  const returnsQuery = useQuery({ queryKey: ["payment-returns", orgId], queryFn: () => fetchReturns(orgId), enabled: !!orgId });
  const selectedReturn = returnsQuery.data?.find((r) => r.id === selectedReturnId) ?? null;

  const accountsQuery = useQuery({
    queryKey: ["returns-verified-accounts", selectedReturn?.masav_line.student.id],
    queryFn: () => fetchVerifiedAccounts(selectedReturn!.masav_line.student.id),
    enabled: !!selectedReturn,
  });
  const retryLinesQuery = useQuery({
    queryKey: ["returns-retry-line-options", selectedReturn?.masav_line.student.id, selectedReturn?.id],
    queryFn: () => fetchRetryLineOptions(selectedReturn!.masav_line.student.id, selectedReturn!.masav_line_id),
    enabled: !!selectedReturn,
  });

  const linkRetry = async () => {
    if (!selectedReturnId || !retryAccountId || !retryLineId) return;
    setLinking(true);
    setError(null);
    const { error: err } = await supabase
      .from("payment_returns")
      .update({ new_bank_account_id: retryAccountId, retry_masav_line_id: retryLineId })
      .eq("id", selectedReturnId);
    setLinking(false);
    if (err) {
      setError(err.message);
      return;
    }
    setRetryAccountId("");
    setRetryLineId("");
    queryClient.invalidateQueries({ queryKey: ["payment-returns", orgId] });
  };

  const resolveReturn = async () => {
    if (!selectedReturnId) return;
    setResolving(true);
    setError(null);
    const { error: err } = await supabase.from("payment_returns").update({ status: "resolved" }).eq("id", selectedReturnId);
    setResolving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setSelectedReturnId(null);
    queryClient.invalidateQueries({ queryKey: ["payment-returns", orgId] });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!lineId || !amount || !reason.trim()) return;
    setSubmitting(true);
    setError(null);
    const { error: err } = await supabase.rpc("record_payment_return", {
      p_masav_line_id: lineId,
      p_return_date: returnDate,
      p_amount: Number(amount),
      p_reason: reason,
    });
    setSubmitting(false);
    if (err) {
      setError(err.message);
      return;
    }
    setBatchId("");
    setLineId("");
    setAmount("");
    setReason("");
    setShowForm(false);
    queryClient.invalidateQueries({ queryKey: ["payment-returns", orgId] });
    queryClient.invalidateQueries({ queryKey: ["group-balances"] });
  };

  const columns: DataTableColumn<ReturnRow>[] = [
    { key: "date", header: "תאריך החזרה", className: "tabular", render: (r) => r.return_date },
    { key: "id", header: "מזהה תלמיד", className: "tabular", render: (r) => r.masav_line.student.external_id },
    { key: "name", header: "שם", render: (r) => r.masav_line.student.full_name },
    { key: "amount", header: "סכום", className: "tabular", render: (r) => r.amount.toLocaleString("he-IL") },
    { key: "reason", header: "סיבה", render: (r) => r.reason },
    { key: "status", header: "סטטוס", render: (r) => <StatusBadge severity={r.status === "resolved" ? "ok" : "medium"} label={RETURN_STATUS_LABEL[r.status]} /> },
  ];

  return (
    <div>
      <PageHeader
        title="החזרות ותשלום חוזר"
        description='רישום החזרה עצמו ידני. קישור תשלום חוזר דורש חשבון בנק חדש שאומת בפועל, וסגירת ההחזרה ("טופל") דורשת שהתשלום החוזר יותאם ויאושר בפועל מול הבנק (מסך התאמות בנק). החזרה אינה מוחקת את שורת המקור; היתרה של הקבוצה מזוכה בתנועת "החזרה" נגדית.'
        primaryAction={
          orgId &&
          canManage && (
            <button onClick={() => setShowForm((v) => !v)} className="btn-primary">
              {showForm ? "סגירה" : "רישום החזרה"}
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

      {showForm && orgId && (
        <form onSubmit={submit} className="card mb-6 max-w-2xl space-y-3 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label">אצוות מס״ב ששודרה</label>
              <select
                value={batchId}
                onChange={(e) => {
                  setBatchId(e.target.value);
                  setLineId("");
                }}
                className="input-field"
              >
                <option value="">— בחרי —</option>
                {(batchesQuery.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.period_month}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">תשלום שחזר</label>
              <select
                value={lineId}
                onChange={(e) => {
                  setLineId(e.target.value);
                  const line = linesQuery.data?.find((l) => l.id === e.target.value);
                  if (line) setAmount(String(line.amount));
                }}
                className="input-field"
                disabled={!batchId}
              >
                <option value="">— בחרי —</option>
                {(linesQuery.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.student.full_name} ({l.student.external_id}) - {l.amount.toLocaleString("he-IL")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">תאריך החזרה</label>
              <input required type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="field-label">סכום שחזר</label>
              <input required type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-field tabular" />
            </div>
          </div>
          <div>
            <label className="field-label">סיבה (חובה)</label>
            <input required value={reason} onChange={(e) => setReason(e.target.value)} className="input-field" />
          </div>
          {error && <ErrorState message={error} />}
          <button type="submit" disabled={!lineId || submitting} className="btn-primary">
            {submitting ? "שומרת…" : "רישום החזרה"}
          </button>
        </form>
      )}

      {orgId && (
        <DataTable
          columns={columns}
          rows={returnsQuery.data ?? []}
          rowKey={(r) => r.id}
          loading={returnsQuery.isLoading}
          emptyTitle="אין החזרות רשומות"
          emptyIcon={Undo2}
          onRowClick={canManage ? (r) => setSelectedReturnId(r.id === selectedReturnId ? null : r.id) : undefined}
        />
      )}

      {selectedReturn && canManage && (
        <div className="card mt-4 max-w-2xl space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">
              טיפול בהחזרה · {selectedReturn.masav_line.student.full_name} ({selectedReturn.masav_line.student.external_id})
            </h2>
            <StatusBadge severity={selectedReturn.status === "resolved" ? "ok" : "medium"} label={RETURN_STATUS_LABEL[selectedReturn.status]} />
          </div>

          {selectedReturn.status !== "resolved" && (
            <>
              <p className="text-xs text-slate-500">
                לא ניתן לקשר תשלום חוזר בלי חשבון בנק חדש שאומת בפועל. סגירת ההחזרה (״טופל״) מותרת רק לאחר שהתשלום החוזר הותאם ואושר בפועל מול הבנק (התאמות בנק, שלב 12).
              </p>
              {accountsQuery.isLoading || retryLinesQuery.isLoading ? (
                <LoadingState rows={2} />
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="field-label">חשבון בנק חדש (מאומת בלבד)</label>
                    <select value={retryAccountId} onChange={(e) => setRetryAccountId(e.target.value)} className="input-field">
                      <option value="">— בחרי —</option>
                      {(accountsQuery.data ?? []).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.account_number_masked}
                        </option>
                      ))}
                    </select>
                    {(accountsQuery.data ?? []).length === 0 && <p className="mt-1 text-xs text-amber-600">אין לתלמיד זה חשבון בנק מאומת ופעיל.</p>}
                  </div>
                  <div>
                    <label className="field-label">שורת תשלום חוזר (מס״ב)</label>
                    <select value={retryLineId} onChange={(e) => setRetryLineId(e.target.value)} className="input-field">
                      <option value="">— בחרי —</option>
                      {(retryLinesQuery.data ?? []).map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.batch.period_month} · {l.amount.toLocaleString("he-IL")} ({l.batch.status})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              {error && <ErrorState message={error} />}
              <div className="flex flex-wrap gap-2">
                <button onClick={linkRetry} disabled={!retryAccountId || !retryLineId || linking} className="btn-secondary text-xs">
                  {linking ? "מקשרת…" : "קישור תשלום חוזר"}
                </button>
                <button
                  onClick={resolveReturn}
                  disabled={resolving || !selectedReturn.retry_masav_line_id || selectedReturn.retry_line?.batch.status !== "bank_completed"}
                  className="btn-primary text-xs"
                  title={selectedReturn.retry_line?.batch.status !== "bank_completed" ? "התשלום החוזר טרם הותאם ואושר בפועל מול הבנק" : undefined}
                >
                  {resolving ? "מסמנת…" : "סימון כטופל"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
