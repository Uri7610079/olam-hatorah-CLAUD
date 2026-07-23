import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
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

interface BranchRow {
  id: string;
  internal_name: string;
  talmud_branch_code: string;
}

interface QuotaRow {
  branchId: string;
  branchName: string;
  branchCode: string;
  approvedQuota: number | null;
  registeredCount: number;
  eligibleCount: number;
}

async function fetchOrgs(): Promise<OrgOption[]> {
  const { data, error } = await supabase.from("organizations").select("id, legal_name").eq("status", "active").order("legal_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchBranches(orgId: string): Promise<BranchRow[]> {
  const { data, error } = await supabase.from("branches").select("id, internal_name, talmud_branch_code").eq("organization_id", orgId).eq("status", "active").order("talmud_branch_code");
  if (error) throw error;
  return data ?? [];
}

// רשומים/זכאים נגזרים בזמן שאילתה - לא נשמרים כשדה סטטי (ר' הערת migration 023).
// "רשומים" = כרגע (אין מעקב היסטורי "נכון לתאריך X" עדיין); "זכאים" = זכאות פעילה לחודש שנבחר.
async function fetchQuotaData(orgId: string, month: string, branches: BranchRow[]): Promise<QuotaRow[]> {
  const { data: approved } = await supabase.from("monthly_quotas").select("branch_id, approved_quota").eq("organization_id", orgId).eq("month", month);
  const approvedMap = new Map((approved ?? []).map((a) => [a.branch_id, a.approved_quota]));

  const rows: QuotaRow[] = [];
  for (const branch of branches) {
    const { count: registeredCount } = await supabase
      .from("student_assignments")
      .select("id", { count: "exact", head: true })
      .eq("branch_id", branch.id)
      .eq("is_active", true);
    const { count: eligibleCount } = await supabase
      .from("monthly_eligibility")
      .select("id", { count: "exact", head: true })
      .eq("branch_id", branch.id)
      .eq("month", month)
      .eq("status", "active");
    rows.push({
      branchId: branch.id,
      branchName: branch.internal_name,
      branchCode: branch.talmud_branch_code,
      approvedQuota: approvedMap.get(branch.id) ?? null,
      registeredCount: registeredCount ?? 0,
      eligibleCount: eligibleCount ?? 0,
    });
  }
  return rows;
}

export function QuotasScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("quotas", "manage");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });

  const [orgId, setOrgId] = useState("");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7) + "-01");
  const [editingBranch, setEditingBranch] = useState<string | null>(null);
  const [quotaInput, setQuotaInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const branchesQuery = useQuery({ queryKey: ["quota-branches", orgId], queryFn: () => fetchBranches(orgId), enabled: !!orgId });
  const quotasQuery = useQuery({
    queryKey: ["quotas", orgId, month, branchesQuery.data],
    queryFn: () => fetchQuotaData(orgId, month, branchesQuery.data ?? []),
    enabled: !!orgId && !!month && !!branchesQuery.data,
  });

  const startEdit = (row: QuotaRow) => {
    setEditingBranch(row.branchId);
    setQuotaInput(row.approvedQuota != null ? String(row.approvedQuota) : "");
    setError(null);
  };

  const saveQuota = async () => {
    if (!editingBranch) return;
    const value = Number(quotaInput);
    if (!Number.isFinite(value) || value < 0) {
      setError("יש להזין מספר תקין");
      return;
    }
    setSaving(true);
    setError(null);
    const { error } = await supabase.from("monthly_quotas").upsert(
      { organization_id: orgId, branch_id: editingBranch, month, approved_quota: value },
      { onConflict: "organization_id,branch_id,month" },
    );
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setEditingBranch(null);
    queryClient.invalidateQueries({ queryKey: ["quotas", orgId, month] });
  };

  const columns: DataTableColumn<QuotaRow>[] = [
    { key: "code", header: "קוד סניף", className: "tabular", render: (r) => r.branchCode },
    { key: "name", header: "סניף", render: (r) => r.branchName },
    {
      key: "quota",
      header: "מכסה מאושרת",
      className: "tabular",
      render: (r) =>
        editingBranch === r.branchId ? (
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={quotaInput}
              onChange={(e) => setQuotaInput(e.target.value)}
              className="input-field w-24 tabular"
              autoFocus
            />
            <button onClick={saveQuota} disabled={saving} className="link-action text-xs">
              {saving ? "שומרת…" : "שמירה"}
            </button>
            <button onClick={() => setEditingBranch(null)} className="text-xs text-slate-500 underline">
              ביטול
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span>{r.approvedQuota ?? "לא הוגדרה"}</span>
            {canManage && (
              <button onClick={() => startEdit(r)} className="link-action text-xs">
                עריכה
              </button>
            )}
          </div>
        ),
    },
    { key: "registered", header: "רשומים", className: "tabular", render: (r) => r.registeredCount },
    { key: "eligible", header: "זכאים", className: "tabular", render: (r) => r.eligibleCount },
    {
      key: "utilization",
      header: "ניצול",
      render: (r) => {
        if (!r.approvedQuota) return <span className="text-slate-400">—</span>;
        const pct = Math.round((r.eligibleCount / r.approvedQuota) * 100);
        const over = r.eligibleCount > r.approvedQuota;
        return <StatusBadge severity={over ? "high" : pct >= 90 ? "medium" : "ok"} label={`${pct}%${over ? " (חריגה)" : ""}`} />;
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="מכסות"
        description="מכסה מול רשומים וזכאים, לפי סניף וחודש. משמעות המכסה המדויקת (והאם ניתנת להעברה בין סניפים) טרם אושרה - המסך מציג נתונים בלבד."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 max-w-lg mb-4">
        <div>
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
        <div>
          <label className="field-label">חודש</label>
          <input type="date" value={month} onChange={(e) => setMonth(e.target.value)} className="input-field" />
        </div>
      </div>

      {error && <div className="mb-4"><ErrorState message={error} /></div>}

      {orgId && (
        <DataTable
          columns={columns}
          rows={quotasQuery.data ?? []}
          rowKey={(r) => r.branchId}
          loading={quotasQuery.isLoading || branchesQuery.isLoading}
          emptyTitle="אין סניפים לעמותה זו"
          emptyIcon={Gauge}
        />
      )}
    </div>
  );
}
