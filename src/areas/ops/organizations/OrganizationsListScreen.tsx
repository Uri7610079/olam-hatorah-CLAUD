import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Building2, Download } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import { exportRowsToExcel } from "@/lib/reportExport";
import { PageHeader } from "@/components/PageHeader";
import { SearchAndFilters } from "@/components/SearchAndFilters";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import type { Organization } from "./types";
import { OrganizationForm, EMPTY_ORGANIZATION_FORM, type OrganizationFormValues } from "./OrganizationForm";

async function fetchOrganizations(): Promise<Organization[]> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, legal_name, org_number, contact_phone, contact_email, contact_address, status, notes, created_at")
    .order("legal_name");
  if (error) throw error;
  return data ?? [];
}

export function OrganizationsListScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("organizations", "manage");
  const query = useQuery({ queryKey: ["organizations"], queryFn: fetchOrganizations });

  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEscapeToClose(showCreate, () => setShowCreate(false));

  const filtered = (query.data ?? []).filter((o) => {
    if (!search) return true;
    const needle = search.trim();
    return o.legal_name.includes(needle) || (o.org_number ?? "").includes(needle);
  });

  const handleCreate = async (values: OrganizationFormValues) => {
    setCreating(true);
    setCreateError(null);
    const { error } = await supabase.from("organizations").insert({
      legal_name: values.legal_name,
      org_number: values.org_number || null,
      contact_phone: values.contact_phone || null,
      contact_email: values.contact_email || null,
      contact_address: values.contact_address || null,
      notes: values.notes || null,
    });
    setCreating(false);
    if (error) {
      setCreateError(error.message);
      return;
    }
    setShowCreate(false);
    queryClient.invalidateQueries({ queryKey: ["organizations"] });
  };

  const handleExport = () => {
    exportRowsToExcel(
      filtered.map((o) => ({
        "שם": o.legal_name,
        "מספר עמותה": o.org_number ?? "",
        "טלפון": o.contact_phone ?? "",
        'דוא"ל': o.contact_email ?? "",
        "כתובת": o.contact_address ?? "",
      })),
      "עמותות",
      `organizations-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  };

  const columns: DataTableColumn<Organization>[] = [
    {
      key: "legal_name",
      header: "שם",
      render: (o) => (
        <Link to={`/ops/organizations/${o.id}`} className="link-action font-medium">
          {o.legal_name}
        </Link>
      ),
    },
    { key: "org_number", header: "מספר עמותה", className: "tabular ltr-num", render: (o) => o.org_number ?? "—" },
    {
      key: "status",
      header: "סטטוס",
      render: (o) => (
        <StatusBadge severity={o.status === "active" ? "ok" : "neutral"} label={o.status === "active" ? "פעילה" : "סגורה"} />
      ),
    },
    { key: "phone", header: "טלפון", className: "ltr-num", render: (o) => o.contact_phone ?? "—" },
  ];

  return (
    <div>
      <PageHeader
        title="עמותות"
        description="ניהול עמותות, חשבונות ובעלי תפקידים."
        primaryAction={
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={handleExport} className="btn-secondary flex items-center gap-2">
              <Download className="h-4 w-4" aria-hidden="true" />
              ייצוא לאקסל
            </button>
            <div className="flex flex-col items-start">
              <button onClick={() => navigate("/ops/import-center")} className="btn-secondary">
                יבוא עמותות/סניפים/קבוצות מאקסל
              </button>
              <span className="mt-0.5 text-xs text-ink-subtle">כולל גם סניפים וקבוצות</span>
            </div>
            {canManage && (
              <button onClick={() => setShowCreate(true)} className="btn-primary">
                עמותה חדשה
              </button>
            )}
          </div>
        }
      />
      <SearchAndFilters searchValue={search} onSearchChange={setSearch} searchPlaceholder="חיפוש לפי שם או מספר עמותה…" />
      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(o) => o.id}
        loading={query.isLoading}
        emptyTitle="אין עמותות עדיין"
        emptyIcon={Building2}
      />

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4">
          <div role="dialog" aria-modal="true" aria-labelledby="new-org-title" className="card w-full max-w-md p-6">
            <h2 id="new-org-title" className="mb-4 text-base font-semibold text-ink">עמותה חדשה</h2>
            <OrganizationForm
              initialValues={EMPTY_ORGANIZATION_FORM}
              onSubmit={handleCreate}
              submitLabel="יצירה"
              submitting={creating}
              error={createError}
            />
            <button onClick={() => setShowCreate(false)} className="link-action mt-3 text-xs">
              ביטול
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
