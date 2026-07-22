import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { EmptyState } from "@/components/EmptyState";
import { Tabs, type TabDef } from "@/components/Tabs";
import type { Organization } from "./types";
import { OrganizationDetailsTab } from "./OrganizationDetailsTab";
import { OrganizationOfficeholdersTab } from "./OrganizationOfficeholdersTab";
import { OrganizationBankAccountsTab } from "./OrganizationBankAccountsTab";
import { OrganizationBranchesTab } from "./OrganizationBranchesTab";
import { OrganizationHistoryTab } from "./OrganizationHistoryTab";

type TabKey = "details" | "officeholders" | "accounts" | "branches" | "documents" | "history";

const TABS: TabDef<TabKey>[] = [
  { key: "details", label: "פרטים" },
  { key: "officeholders", label: "בעלי תפקידים" },
  { key: "accounts", label: "חשבונות" },
  { key: "branches", label: "סניפים" },
  { key: "documents", label: "מסמכים" },
  { key: "history", label: "היסטוריה" },
];

async function fetchOrganization(id: string): Promise<Organization> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, legal_name, org_number, contact_phone, contact_email, contact_address, status, notes, created_at")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export function OrganizationDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<TabKey>("details");
  const query = useQuery({ queryKey: ["organization", id], queryFn: () => fetchOrganization(id!), enabled: !!id });

  if (query.isLoading) return <LoadingState rows={6} />;
  if (query.error || !query.data) return <ErrorState message="שגיאה בטעינת העמותה, או שאין לך הרשאה לצפות בה." />;

  const org = query.data;

  return (
    <div>
      <PageHeader
        title={org.legal_name}
        breadcrumbs={[{ label: "עמותות", href: "/ops/organizations" }, { label: org.legal_name }]}
        primaryAction={
          <StatusBadge severity={org.status === "active" ? "ok" : "neutral"} label={org.status === "active" ? "פעילה" : "סגורה"} />
        }
      />

      <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} ariaLabel="לשוניות עמותה" />

      {activeTab === "details" && <OrganizationDetailsTab organization={org} />}
      {activeTab === "officeholders" && <OrganizationOfficeholdersTab organizationId={org.id} />}
      {activeTab === "accounts" && <OrganizationBankAccountsTab organizationId={org.id} />}
      {activeTab === "branches" && <OrganizationBranchesTab organizationId={org.id} />}
      {activeTab === "documents" && (
        <EmptyState title="מסמכי עמותה" description="ייבנה בשלב 13, בהתאם לתוכנית השלבים." icon={FileText} />
      )}
      {activeTab === "history" && <OrganizationHistoryTab organizationId={org.id} />}
    </div>
  );
}
