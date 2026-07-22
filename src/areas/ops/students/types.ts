export type StudentIdType = "israeli_id" | "passport" | "other";
export type StudentStatus = "draft" | "ready_for_talmud" | "active" | "inactive";

export interface Student {
  id: string;
  id_type: StudentIdType;
  external_id: string;
  full_name: string;
  birth_date: string | null;
  phone_raw: string | null;
  phone_normalized: string | null;
  address: string | null;
  student_type: string | null;
  study_code: string | null;
  status: StudentStatus;
  exit_date: string | null;
  exit_reason: string | null;
  created_at: string;
}

export const ID_TYPE_LABEL: Record<StudentIdType, string> = {
  israeli_id: 'ת"ז',
  passport: "דרכון",
  other: "אחר",
};

export const STATUS_LABEL: Record<StudentStatus, string> = {
  draft: "טיוטה",
  ready_for_talmud: "מוכן לתלמוד",
  active: "פעיל",
  inactive: "לא פעיל",
};

export interface StudentAssignment {
  id: string;
  student_id: string;
  organization_id: string;
  branch_id: string;
  group_id: string;
  start_date: string;
  end_date: string | null;
  end_reason: string | null;
  is_active: boolean;
  organization_name?: string | null;
  branch_name?: string | null;
  group_name?: string | null;
}

export interface StudentBankAccount {
  id: string;
  student_id: string;
  bank_name: string | null;
  bank_branch_code: string | null;
  account_number_masked: string | null;
  account_holder_name: string | null;
  student_relationship: "self" | "parent" | "guardian" | "other" | null;
  supporting_document_path: string | null;
  verification_status: "pending" | "verified" | "rejected";
  is_active: boolean;
  opened_at: string | null;
  closed_at: string | null;
}

export const RELATIONSHIP_LABEL: Record<NonNullable<StudentBankAccount["student_relationship"]>, string> = {
  self: "התלמיד עצמו",
  parent: "הורה",
  guardian: "אפוטרופוס",
  other: "אחר",
};

export const VERIFICATION_LABEL: Record<StudentBankAccount["verification_status"], string> = {
  pending: "ממתין לאימות",
  verified: "מאומת",
  rejected: "נדחה",
};
