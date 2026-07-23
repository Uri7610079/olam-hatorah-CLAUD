import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HeartHandshake } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { SensitiveValue } from "@/components/SensitiveValue";
import { ErrorState } from "@/components/ErrorState";

interface OrgOption {
  id: string;
  legal_name: string;
}

interface GroupOption {
  id: string;
  name: string;
}

type DonationStatus = "pending" | "approved" | "rejected";

interface DonationRow {
  id: string;
  organization_id: string;
  group_id: string | null;
  donation_date: string;
  amount: number;
  donor_reference_masked: string | null;
  reference: string | null;
  status: DonationStatus;
  rejection_reason: string | null;
  source_file_path: string | null;
  notes: string | null;
  group: { name: string } | null;
}

const STATUS_LABEL: Record<DonationStatus, string> = { pending: "ממתינה לאישור", approved: "מאושרת", rejected: "נדחתה" };
const STATUS_SEVERITY: Record<DonationStatus, "medium" | "ok" | "critical"> = { pending: "medium", approved: "ok", rejected: "critical" };

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

async function fetchDonations(orgId: string, unassignedOnly: boolean): Promise<DonationRow[]> {
  let query = supabase
    .from("donations_view")
    .select(
      "id, organization_id, group_id, donation_date, amount, donor_reference_masked, reference, status, rejection_reason, source_file_path, notes, group:groups(name)",
    )
    .eq("organization_id", orgId)
    .order("donation_date", { ascending: false });
  if (unassignedOnly) query = query.is("group_id", null);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, group: Array.isArray(r.group) ? (r.group[0] ?? null) : r.group }));
}

const EMPTY_FORM = {
  groupId: "",
  donationDate: new Date().toISOString().slice(0, 10),
  amount: "",
  donorReference: "",
  reference: "",
  notes: "",
};

export function DonationsScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("donations", "manage");
  const { hasPermission: canApprove } = useHasPermission("donations", "approve");
  const { hasPermission: canReveal } = useHasPermission("bank_accounts", "view_sensitive");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });

  const [orgId, setOrgId] = useState("");
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignGroupId, setAssignGroupId] = useState("");
  const [assignReason, setAssignReason] = useState("");
  const [rowError, setRowError] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const groupsQuery = useQuery({ queryKey: ["donations-org-groups", orgId], queryFn: () => fetchOrgGroups(orgId), enabled: !!orgId });
  const donationsQuery = useQuery({
    queryKey: ["donations", orgId, unassignedOnly],
    queryFn: () => fetchDonations(orgId, unassignedOnly),
    enabled: !!orgId,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["donations", orgId] });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    let filePath: string | null = null;
    if (file) {
      const path = `${orgId}/${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from("donation-documents").upload(path, file);
      if (uploadError) {
        setSubmitting(false);
        setError(`העלאת הקובץ נכשלה: ${uploadError.message}`);
        return;
      }
      filePath = path;
    }

    const { error: insertError } = await supabase.from("donations").insert({
      organization_id: orgId,
      group_id: form.groupId || null,
      donation_date: form.donationDate,
      amount: Number(form.amount),
      donor_reference: form.donorReference || null,
      reference: form.reference || null,
      notes: form.notes || null,
      source_file_path: filePath,
    });
    setSubmitting(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setForm(EMPTY_FORM);
    setFile(null);
    setShowAdd(false);
    refresh();
  };

  const approve = async (id: string) => {
    setRowBusy(id);
    setRowError(null);
    const { error: err } = await supabase.rpc("approve_donation", { p_donation_id: id });
    setRowBusy(null);
    if (err) {
      setRowError(err.message);
      return;
    }
    refresh();
    queryClient.invalidateQueries({ queryKey: ["group-balances"] });
  };

  const submitReject = async () => {
    if (!rejectingId || !rejectReason.trim()) return;
    setRowBusy(rejectingId);
    setRowError(null);
    const { error: err } = await supabase.rpc("reject_donation", { p_donation_id: rejectingId, p_reason: rejectReason });
    setRowBusy(null);
    if (err) {
      setRowError(err.message);
      return;
    }
    setRejectingId(null);
    setRejectReason("");
    refresh();
  };

  const submitAssign = async () => {
    if (!assigningId || !assignGroupId) return;
    setRowBusy(assigningId);
    setRowError(null);
    const { error: err } = await supabase.rpc("set_donation_group", {
      p_donation_id: assigningId,
      p_group_id: assignGroupId,
      p_reason: assignReason || null,
    });
    setRowBusy(null);
    if (err) {
      setRowError(err.message);
      return;
    }
    setAssigningId(null);
    setAssignGroupId("");
    setAssignReason("");
    refresh();
    queryClient.invalidateQueries({ queryKey: ["group-balances"] });
  };

  const openDocument = async (path: string) => {
    const { data, error: err } = await supabase.storage.from("donation-documents").createSignedUrl(path, 60);
    if (!err && data) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const columns: DataTableColumn<DonationRow>[] = [
    { key: "date", header: "תאריך", className: "tabular", render: (r) => r.donation_date },
    { key: "amount", header: "סכום", className: "tabular", render: (r) => r.amount.toLocaleString("he-IL") },
    {
      key: "source",
      header: "מקור",
      render: (r) => (
        <SensitiveValue
          masked={r.donor_reference_masked ?? "—"}
          canReveal={canReveal}
          onReveal={async () => {
            const { data, error: err } = await supabase.rpc("reveal_donation_source", { p_donation_id: r.id });
            if (err) throw err;
            return data ?? "";
          }}
        />
      ),
    },
    { key: "reference", header: "אסמכתה", render: (r) => r.reference ?? "—" },
    {
      key: "group",
      header: "קבוצה",
      render: (r) =>
        assigningId === r.id ? (
          <div className="flex items-center gap-1.5">
            <select value={assignGroupId} onChange={(e) => setAssignGroupId(e.target.value)} className="input-field text-xs">
              <option value="">— בחרי —</option>
              {(groupsQuery.data ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            {r.group_id && (
              <input placeholder="סיבת שינוי" value={assignReason} onChange={(e) => setAssignReason(e.target.value)} className="input-field w-24 text-xs" />
            )}
            <button onClick={submitAssign} disabled={!assignGroupId || rowBusy === r.id} className="link-action text-xs">
              אישור
            </button>
            <button onClick={() => setAssigningId(null)} className="text-xs text-slate-500 underline">
              ביטול
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span>{r.group?.name ?? "לא משויך"}</span>
            {canManage && (
              <button
                onClick={() => {
                  setAssigningId(r.id);
                  setAssignGroupId(r.group_id ?? "");
                  setAssignReason("");
                  setRowError(null);
                }}
                className="link-action text-xs"
              >
                {r.group_id ? "שינוי" : "שיוך"}
              </button>
            )}
          </div>
        ),
    },
    {
      key: "status",
      header: "סטטוס",
      render: (r) => (
        <div>
          <StatusBadge severity={STATUS_SEVERITY[r.status]} label={STATUS_LABEL[r.status]} />
          {r.status === "rejected" && r.rejection_reason && <p className="mt-1 text-xs text-slate-400">{r.rejection_reason}</p>}
        </div>
      ),
    },
    {
      key: "document",
      header: "קובץ",
      render: (r) =>
        r.source_file_path ? (
          <button onClick={() => openDocument(r.source_file_path!)} className="link-action text-xs">
            פתיחה
          </button>
        ) : (
          "—"
        ),
    },
    {
      key: "actions",
      header: "",
      render: (r) =>
        canApprove && r.status === "pending" ? (
          rejectingId === r.id ? (
            <div className="flex items-center gap-1.5">
              <input placeholder="סיבת דחייה" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className="input-field w-28 text-xs" />
              <button onClick={submitReject} disabled={!rejectReason.trim() || rowBusy === r.id} className="text-xs text-red-600 underline">
                אישור דחייה
              </button>
              <button onClick={() => setRejectingId(null)} className="text-xs text-slate-500 underline">
                ביטול
              </button>
            </div>
          ) : (
            <div className="flex gap-3">
              <button onClick={() => approve(r.id)} disabled={rowBusy === r.id} className="link-action text-xs">
                אישור
              </button>
              <button
                onClick={() => {
                  setRejectingId(r.id);
                  setRejectReason("");
                  setRowError(null);
                }}
                className="text-xs text-red-600 underline hover:text-red-800"
              >
                דחייה
              </button>
            </div>
          )
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="תרומות"
        description="רק תרומה מאושרת ומשויכת לקבוצה יוצרת זכות בספר התנועות. שינוי שיוך לאחר אישור מבטל את התנועה הקודמת ויוצר חדשה - לא דורס."
        primaryAction={
          orgId &&
          canManage && (
            <button onClick={() => setShowAdd((v) => !v)} className="btn-primary">
              {showAdd ? "סגירה" : "תרומה חדשה"}
            </button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div className="max-w-sm">
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
        {orgId && (
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-600">
            <input type="checkbox" checked={unassignedOnly} onChange={(e) => setUnassignedOnly(e.target.checked)} />
            הצג רק תרומות לא משויכות לקבוצה
          </label>
        )}
      </div>

      {showAdd && orgId && (
        <form onSubmit={submit} className="card mb-6 max-w-3xl space-y-3 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="field-label">תאריך תרומה</label>
              <input required type="date" value={form.donationDate} onChange={(e) => setForm((f) => ({ ...f, donationDate: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="field-label">סכום</label>
              <input required type="number" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="input-field tabular" />
            </div>
            <div>
              <label className="field-label">קבוצה (לא חובה)</label>
              <select value={form.groupId} onChange={(e) => setForm((f) => ({ ...f, groupId: e.target.value }))} className="input-field">
                <option value="">— ללא (ברמת עמותה) —</option>
                {(groupsQuery.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">מקור (יוצג ממוסך)</label>
              <input value={form.donorReference} onChange={(e) => setForm((f) => ({ ...f, donorReference: e.target.value }))} className="input-field tabular" />
            </div>
            <div>
              <label className="field-label">אסמכתה</label>
              <input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="field-label">קובץ מקור (לא חובה)</label>
              <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="input-field" />
            </div>
          </div>
          <div>
            <label className="field-label">הערות</label>
            <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="input-field" />
          </div>
          {error && <ErrorState message={error} />}
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? "שומרת…" : "שמירת תרומה"}
          </button>
        </form>
      )}

      {rowError && <div className="mb-4"><ErrorState message={rowError} /></div>}

      {orgId && (
        <DataTable
          columns={columns}
          rows={donationsQuery.data ?? []}
          rowKey={(r) => r.id}
          loading={donationsQuery.isLoading}
          emptyTitle={unassignedOnly ? "אין תרומות לא משויכות" : "אין תרומות רשומות"}
          emptyIcon={HeartHandshake}
        />
      )}
    </div>
  );
}
