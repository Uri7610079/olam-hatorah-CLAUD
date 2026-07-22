export interface Organization {
  id: string;
  legal_name: string;
  org_number: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  contact_address: string | null;
  status: "active" | "closed";
  notes: string | null;
  created_at: string;
}

export interface OrganizationBankAccount {
  id: string;
  organization_id: string;
  bank_name: string | null;
  bank_branch_code: string | null;
  account_number_masked: string | null;
  account_holder_name: string | null;
  currency: string;
  is_active: boolean;
  opened_at: string | null;
  closed_at: string | null;
}

export interface OrganizationOfficeholder {
  id: string;
  organization_id: string;
  full_name: string;
  role_type: "committee_member" | "signatory" | "audit_committee";
  role_title: string | null;
  id_number: string | null;
  phone: string | null;
  tenure_start: string | null;
  tenure_end: string | null;
}

export const OFFICEHOLDER_ROLE_LABEL: Record<OrganizationOfficeholder["role_type"], string> = {
  committee_member: "חבר ועד",
  signatory: "מורשה חתימה",
  audit_committee: "ועדת ביקורת",
};
