import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";

interface AuditEventRow {
  id: string;
  actor_id: string | null;
  action: string;
  resource: string;
  resource_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

const AUDIT_EVENTS_LIMIT = 200;

async function fetchAuditEvents(): Promise<AuditEventRow[]> {
  const { data, error } = await supabase
    .from("audit_events")
    .select("id, actor_id, action, resource, resource_id, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(AUDIT_EVENTS_LIMIT);
  if (error) throw error;
  return data ?? [];
}

export function AdminAuditLog() {
  const { hasPermission, isLoading: permissionLoading } = useHasPermission("audit", "view");
  const query = useQuery({ queryKey: ["audit-events"], queryFn: fetchAuditEvents, enabled: hasPermission });

  if (permissionLoading) return <LoadingState rows={4} />;

  if (!hasPermission) {
    return (
      <div>
        <PageHeader title="יומן פעילות" />
        <ErrorState message="אין לך הרשאה לצפות במסך זה." />
      </div>
    );
  }

  const columns: DataTableColumn<AuditEventRow>[] = [
    {
      key: "created_at",
      header: "מועד",
      className: "tabular",
      render: (r) => new Date(r.created_at).toLocaleString("he-IL"),
    },
    { key: "action", header: "פעולה", render: (r) => r.action },
    { key: "resource", header: "משאב", render: (r) => `${r.resource}${r.resource_id ? ` / ${r.resource_id}` : ""}` },
    {
      key: "detail",
      header: "פרטים",
      render: (r) => (r.detail ? <code className="text-xs">{JSON.stringify(r.detail)}</code> : "—"),
    },
  ];

  return (
    <div>
      <PageHeader title="יומן פעילות" description={`${AUDIT_EVENTS_LIMIT} האירועים האחרונים בלבד.`} />
      <DataTable
        columns={columns}
        rows={query.data ?? []}
        rowKey={(r) => r.id}
        loading={query.isLoading}
        emptyTitle="אין רשומות ביומן"
        emptyIcon={History}
      />
    </div>
  );
}
