import { BranchesGroupsManager } from "./BranchesGroupsManager";

interface OrganizationBranchesTabProps {
  organizationId: string;
}

// אותו ניהול סניפים וקבוצות שבמסך העמותות - לא עותק. ראה BranchesGroupsManager.
export function OrganizationBranchesTab({ organizationId }: OrganizationBranchesTabProps) {
  return <BranchesGroupsManager orgId={organizationId} />;
}
