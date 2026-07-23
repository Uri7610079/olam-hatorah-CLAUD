import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ErrorState } from "@/components/ErrorState";

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
  masav_line: { student: { external_id: string; full_name: string } };
}

const RETURN_STATUS_LABEL: Record<ReturnStatus, string> = { open: "פתוח", retried: "נשלח שוב", resolved: "טופל" };

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
      "id, return_date, amount, reason, status, notes, masav_line:masav_lines!payment_returns_masav_line_id_fkey(student:students(external_id, full_name), batch:masav_batches(organization_id))",
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? [])
    .map((r: any) => ({ ...r, masav_line: Array.isArray(r.masav_line) ? r.masav_line[0] : r.masav_line }))
    .map((r: any) => ({
      ...r,
      masav_line: { ...r.masav_line, student: Array.isArray(r.masav_line.student) ? r.masav_line.student[0] : r.masav_line.student },
      _orgId: Array.isArray(r.masav_line.batch) ? r.masav_line.batch[0]?.organization_id : r.masav_line.batch?.organization_id,
    }))
    .filter((r: any) => r._orgId === orgId);
}

export function ReturnsScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("payment_returns", "manage");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });

  const [orgId, setOrgId] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [batchId, setBatchId] = useState("");
  const [lineId, setLineId] = useState("");
  const [returnDate, setReturnDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const batchesQuery = useQuery({ queryKey: ["returns-transmitted-batches", orgId], queryFn: () => fetchTransmittedBatches(orgId), enabled: !!orgId });
  const linesQuery = useQuery({ queryKey: ["returns-valid-lines", batchId], queryFn: () => fetchValidLines(batchId), enabled: !!batchId });
  const returnsQuery = useQuery({ queryKey: ["payment-returns", orgId], queryFn: () => fetchReturns(orgId), enabled: !!orgId });

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
        description='הזנה ידנית בלבד בשלב זה - התאמה אוטומטית מול דוח בנק תגיע רק לאחר מודול הבנק. החזרה אינה מוחקת את שורת המקור; היתרה של הקבוצה מזוכה בתנועת "החזרה" נגדית.'
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
        <DataTable columns={columns} rows={returnsQuery.data ?? []} rowKey={(r) => r.id} loading={returnsQuery.isLoading} emptyTitle="אין החזרות רשומות" emptyIcon={Undo2} />
      )}
    </div>
  );
}
