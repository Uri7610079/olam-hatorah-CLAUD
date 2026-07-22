import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Network } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";

interface BranchRow {
  id: string;
  talmud_branch_code: string;
  internal_name: string;
  status: "active" | "closed";
}

interface OrganizationBranchesTabProps {
  organizationId: string;
}

async function fetchBranches(organizationId: string): Promise<BranchRow[]> {
  const { data, error } = await supabase
    .from("branches")
    .select("id, talmud_branch_code, internal_name, status")
    .eq("organization_id", organizationId)
    .order("talmud_branch_code");
  if (error) throw error;
  return data ?? [];
}

export function OrganizationBranchesTab({ organizationId }: OrganizationBranchesTabProps) {
  const query = useQuery({ queryKey: ["organization-branches", organizationId], queryFn: () => fetchBranches(organizationId) });

  const columns: DataTableColumn<BranchRow>[] = [
    { key: "code", header: "קוד סניף", className: "tabular", render: (r) => r.talmud_branch_code },
    { key: "name", header: "שם", render: (r) => r.internal_name },
    {
      key: "status",
      header: "סטטוס",
      render: (r) => <StatusBadge severity={r.status === "active" ? "ok" : "neutral"} label={r.status === "active" ? "פעיל" : "סגור"} />,
    },
  ];

  return (
    <div>
      <div className="mb-3">
        <Link to={`/ops/branches-groups?org=${organizationId}`} className="link-action text-sm">
          ניהול סניפים וקבוצות של עמותה זו
        </Link>
      </div>
      <DataTable
        columns={columns}
        rows={query.data ?? []}
        rowKey={(r) => r.id}
        loading={query.isLoading}
        emptyTitle="אין סניפים רשומים לעמותה זו"
        emptyIcon={Network}
      />
    </div>
  );
}
