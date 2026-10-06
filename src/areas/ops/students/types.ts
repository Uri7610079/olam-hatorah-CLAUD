export type StudentIdType = "israeli_id" | "passport" | "other";
export type StudentStatus = "draft" | "ready_for_talmud" | "sent_to_talmud" | "active" | "active_with_error" | "inactive";

export interface StudentPlacement {
  organization: { id: string; legal_name: string } | null;
  branch: { id: string; internal_name: string; talmud_branch_code: string } | null;
  group: { id: string; name: string } | null;
}

export interface Student {
  id: string;
  id_type: StudentIdType;
  external_id: string;
  full_name: string;
  birth_date: string | null;
  phone_raw: string | null;
  phone_normalized: string | null;
  address_street: string | null;
  address_house_number: string | null;
  address_city: string | null;
  student_type: string | null;
  study_code: string | null;
  marital_status?: "single" | "married" | null;
  study_scope?: "full_day" | "half_day_morning" | "half_day_afternoon" | null;
  status: StudentStatus;
  exit_date: string | null;
  exit_reason: string | null;
  created_at: string;
  /** השיוך הפעיל (עמותה, סניף, קבוצה) - מגיע רק ממסך הרשימה */
  assignment?: StudentPlacement | null;
}

// עיצוב כתובת קריאה משלושת השדות המפוצלים - פונקציה משותפת אחת כדי שההיגיון לא ייסטה
// בין המקומות שמציגים כתובת (במקום שכל מסך יכתוב תבנית משלו). "רחוב"/"מספר בית"
// מוצמדים ברווח, "עיר" מצטרפת בפסיק - אבל רק כשיש משהו לפניה, אחרת נשאר פסיק תלוי
// בהתחלה (למשל כשיש רק עיר, בלי רחוב/מספר בית).
export function formatStudentAddress(student: Pick<Student, "address_street" | "address_house_number" | "address_city">): string {
  const streetPart = [student.address_street, student.address_house_number].filter(Boolean).join(" ");
  const parts = [streetPart, student.address_city].filter(Boolean);
  return parts.length ? parts.join(", ") : "—";
}

export const ID_TYPE_LABEL: Record<StudentIdType, string> = {
  israeli_id: 'ת"ז',
  passport: "דרכון",
  other: "אחר",
};

export const STATUS_LABEL: Record<StudentStatus, string> = {
  draft: "טיוטה",
  ready_for_talmud: "מוכן לתלמוד",
  sent_to_talmud: "נשלח לתלמוד",
  active: "פעיל",
  active_with_error: "פעיל עם שגיאה",
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
  // תוצאת בדיקת ספרת הביקורת (מיגרציה 114). null בחשבון שעוד לא נבדק.
  check_digit_result: "valid" | "invalid" | "unknown" | null;
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

// מאז מיגרציה 114 אין אימות ידני: המצב נקבע לפי בדיקת ספרת הביקורת, ואישור ידני
// נשאר רק כעקיפה לחשבון שהבדיקה פסלה.
export function bankAccountStateLabel(r: Pick<StudentBankAccount, "verification_status" | "check_digit_result">): {
  label: string;
  severity: "ok" | "medium" | "critical";
} {
  if (r.verification_status === "rejected") return { label: "מספר שגוי - חסום לתשלום", severity: "critical" };
  if (r.verification_status === "pending") return { label: "ממתין לבדיקה", severity: "medium" };
  if (r.check_digit_result === "invalid") return { label: "אושר ידנית למרות הבדיקה", severity: "medium" };
  if (r.check_digit_result === "unknown") return { label: "אין בדיקה לבנק הזה", severity: "ok" };
  return { label: "מספר תקין", severity: "ok" };
}
