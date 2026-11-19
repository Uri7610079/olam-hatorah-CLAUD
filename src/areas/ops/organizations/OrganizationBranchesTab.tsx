import { BranchesGroupsManager } from "./BranchesGroupsManager";

interface OrganizationBranchesTabProps {
  organizationId: string;
  // לכותרת הקבוצות בערכה v3 ("עמותה › סניף")
  organizationName?: string;
}

// אותו ניהול סניפים וקבוצות שבמסך העמותות - לא עותק. ראה BranchesGroupsManager.
export function OrganizationBranchesTab({ organizationId, organizationName }: OrganizationBranchesTabProps) {
  return <BranchesGroupsManager orgId={organizationId} orgName={organizationName} />;
}
