import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";

interface AuditEventRow {
  id: string;
  action: string;
  resource: string;
  resource_id: string | null;
  created_at: string;
}

const RESOURCE_LABEL: Record<string, string> = {
  organizations: "עמותה",
  organization_officeholders: "בעל תפקיד",
  organization_bank_accounts: "חשבון בנק",
  branches: "סניף",
};

// היסטוריית עמותה כוללת גם שינויים בישויות הבת שלה (בעלי תפקידים, חשבונות, סניפים) -
// לכן אוספת קודם את המזהים הרלוונטיים, ואז שולפת audit_events לפי כל המזהים יחד.
async function fetchOrganizationHistory(organizationId: string): Promise<AuditEventRow[]> {
  const [officeholders, bankAccounts, branches] = await Promise.all([
    supabase.from("organization_officeholders").select("id").eq("organization_id", organizationId),
    supabase.from("organization_bank_accounts").select("id").eq("organization_id", organizationId),
    supabase.from("branches").select("id").eq("organization_id", organizationId),
  ]);

  const relatedIds = [
    organizationId,
    ...(officeholders.data ?? []).map((r) => r.id),
    ...(bankAccounts.data ?? []).map((r) => r.id),
    ...(branches.data ?? []).map((r) => r.id),
  ];

  const { data, error } = await supabase
    .from("audit_events")
    .select("id, action, resource, resource_id, created_at")
    .in("resource_id", relatedIds)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

interface OrganizationHistoryTabProps {
  organizationId: string;
}

export function OrganizationHistoryTab({ organizationId }: OrganizationHistoryTabProps) {
  const { hasPermission, isLoading: permissionLoading } = useHasPermission("audit", "view");
  const query = useQuery({
    queryKey: ["organization-history", organizationId],
    queryFn: () => fetchOrganizationHistory(organizationId),
    enabled: hasPermission,
  });

  if (permissionLoading) return <LoadingState rows={4} />;
  if (!hasPermission) return <ErrorState message="אין לך הרשאה לצפות בהיסטוריה." />;

  const columns: DataTableColumn<AuditEventRow>[] = [
    { key: "created_at", header: "מועד", className: "tabular", render: (r) => new Date(r.created_at).toLocaleString("he-IL") },
    { key: "action", header: "פעולה", render: (r) => r.action },
    { key: "resource", header: "סוג", render: (r) => RESOURCE_LABEL[r.resource] ?? r.resource },
  ];

  return (
    <DataTable
      columns={columns}
      rows={query.data ?? []}
      rowKey={(r) => r.id}
      loading={query.isLoading}
      emptyTitle="אין היסטוריה עדיין"
      emptyIcon={History}
    />
  );
}
