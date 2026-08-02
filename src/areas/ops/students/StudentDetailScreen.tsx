import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { EmptyState } from "@/components/EmptyState";
import { Tabs, type TabDef } from "@/components/Tabs";
import { Stepper, type StepDef } from "@/components/Stepper";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { STATUS_LABEL, type Student } from "./types";
import { StudentDetailsTab } from "./StudentDetailsTab";
import { StudentAssignmentTab } from "./StudentAssignmentTab";
import { StudentBankTab } from "./StudentBankTab";
import { StudentTalmudTab } from "./StudentTalmudTab";
import { StudentAuditsTab } from "./StudentAuditsTab";

type TabKey = "details" | "assignment" | "talmud" | "bank" | "audits" | "documents";

const TABS: TabDef<TabKey>[] = [
  { key: "details", label: "פרטים" },
  { key: "assignment", label: "שיוך" },
  { key: "talmud", label: "תלמוד" },
  { key: "bank", label: "בנק" },
  { key: "audits", label: "ביקורות" },
  { key: "documents", label: "מסמכים" },
];

const STEPS: StepDef[] = [
  { key: "draft", label: "טיוטה" },
  { key: "details", label: "פרטים והושלמו" },
  { key: "assignment", label: "שיוך פעיל" },
  { key: "bank", label: "חשבון מאומת" },
  { key: "ready_for_talmud", label: "מוכן לתלמוד" },
  { key: "sent_to_talmud", label: "נשלח לתלמוד" },
  { key: "active", label: "פעיל" },
];

const STATUS_SEVERITY = {
  draft: "neutral",
  ready_for_talmud: "medium",
  sent_to_talmud: "medium",
  active: "ok",
  active_with_error: "high",
  inactive: "neutral",
} as const;

async function fetchStudent(id: string): Promise<Student> {
  const { data, error } = await supabase
    .from("students")
    .select(
      "id, id_type, external_id, full_name, birth_date, phone_raw, phone_normalized, address_street, address_house_number, address_city, student_type, study_code, status, exit_date, exit_reason, created_at",
    )
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

async function hasActiveAssignment(studentId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("student_assignments")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId)
    .eq("is_active", true);
  if (error) throw error;
  return (count ?? 0) > 0;
}

async function hasVerifiedAccount(studentId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("student_bank_accounts")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId)
    .eq("is_active", true)
    .eq("verification_status", "verified");
  if (error) throw error;
  return (count ?? 0) > 0;
}

export function StudentDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("students", "manage");
  const [activeTab, setActiveTab] = useState<TabKey>("details");
  const [showExit, setShowExit] = useState(false);
  const [exitReason, setExitReason] = useState("");
  const [exiting, setExiting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);

  const studentQuery = useQuery({ queryKey: ["student", id], queryFn: () => fetchStudent(id!), enabled: !!id });
  const assignmentGateQuery = useQuery({ queryKey: ["student-has-assignment", id], queryFn: () => hasActiveAssignment(id!), enabled: !!id });
  const bankGateQuery = useQuery({ queryKey: ["student-has-verified-account", id], queryFn: () => hasVerifiedAccount(id!), enabled: !!id });

  if (studentQuery.isLoading) return <LoadingState rows={6} />;
  if (studentQuery.error || !studentQuery.data) return <ErrorState message="שגיאה בטעינת התלמיד, או שאין לך הרשאה לצפות בו." />;

  const student = studentQuery.data;
  const hasDetails = Boolean(student.full_name && student.phone_normalized);
  const hasAssignment = assignmentGateQuery.data ?? false;
  const hasBank = bankGateQuery.data ?? false;

  let currentStep = "draft";
  if (hasDetails) currentStep = "details";
  if (hasAssignment) currentStep = "assignment";
  if (hasBank) currentStep = "bank";
  if (student.status === "ready_for_talmud") currentStep = "ready_for_talmud";
  if (student.status === "sent_to_talmud") currentStep = "sent_to_talmud";
  if (student.status === "active" || student.status === "active_with_error") currentStep = "active";

  const refreshStudent = () => {
    queryClient.invalidateQueries({ queryKey: ["student", id] });
    queryClient.invalidateQueries({ queryKey: ["students"] });
  };

  const advance = async () => {
    setAdvancing(true);
    setActionError(null);
    const { error } = await supabase.rpc("advance_student_status", { p_student_id: id, p_target_status: "ready_for_talmud" });
    setAdvancing(false);
    if (error) {
      setActionError(error.message);
      return;
    }
    refreshStudent();
  };

  const handleExit = async () => {
    setExiting(true);
    const { error } = await supabase.rpc("exit_student", {
      p_student_id: id,
      p_exit_date: new Date().toISOString().slice(0, 10),
      p_exit_reason: exitReason || "לא צוינה סיבה",
    });
    setExiting(false);
    setShowExit(false);
    if (!error) refreshStudent();
  };

  return (
    <div>
      <PageHeader
        title={student.full_name}
        breadcrumbs={[{ label: "תלמידים", href: "/ops/students" }, { label: student.full_name }]}
        primaryAction={<StatusBadge severity={STATUS_SEVERITY[student.status]} label={STATUS_LABEL[student.status]} />}
      />

      <Stepper steps={STEPS} currentStep={currentStep} />

      {canManage && student.status !== "inactive" && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          {student.status === "draft" && (() => {
            const missing: string[] = [];
            if (!hasDetails) missing.push("פרטים מלאים");
            if (!hasAssignment) missing.push("שיוך פעיל");
            if (!hasBank) missing.push("חשבון בנק מאומת");
            return (
              <button
                onClick={advance}
                disabled={missing.length > 0 || advancing}
                title={missing.length > 0 ? `חסר: ${missing.join(", ")}` : undefined}
                className="btn-primary text-sm"
              >
                {advancing ? "מעדכנת…" : "קידום למוכן לתלמוד"}
              </button>
            );
          })()}
          {(student.status === "ready_for_talmud" || student.status === "sent_to_talmud") && (
            <p className="text-xs text-ink-subtle">
              {student.status === "ready_for_talmud"
                ? 'ההמשך (יצוא לתלמוד) נעשה ממסך "יצוא לתלמוד" - לא כפעולה כאן.'
                : "התלמיד נשלח לתלמוד. הסטטוס יתעדכן אוטומטית ל\"פעיל\"/\"פעיל עם שגיאה\" ביבוא דוח הזכאות/שגויים הבא."}
            </p>
          )}
          <button onClick={() => setShowExit(true)} className="text-xs text-danger underline hover:text-danger-ink">
            יציאת תלמיד
          </button>
        </div>
      )}
      {actionError && <div className="mb-4"><ErrorState message={actionError} /></div>}

      <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} ariaLabel="לשוניות תלמיד" />

      {activeTab === "details" && <StudentDetailsTab student={student} />}
      {activeTab === "assignment" && <StudentAssignmentTab studentId={student.id} />}
      {activeTab === "talmud" && <StudentTalmudTab studentId={student.id} />}
      {activeTab === "bank" && <StudentBankTab studentId={student.id} />}
      {activeTab === "audits" && <StudentAuditsTab studentId={student.id} />}
      {activeTab === "documents" && <EmptyState title="מסמכים" description="ייבנה בשלב 13, בהתאם לתוכנית השלבים." icon={FileText} />}

      <ConfirmDialog
        open={showExit}
        title="יציאת תלמיד"
        danger
        confirmLabel={exiting ? "מבצעת…" : "אישור יציאה"}
        description={
          <div className="space-y-2 text-right">
            <p>התלמיד יסומן כלא פעיל והשיוך הפעיל ייסגר. הנתונים וההיסטוריה נשמרים במלואם.</p>
            <div>
              <label className="field-label">סיבת יציאה</label>
              <input value={exitReason} onChange={(e) => setExitReason(e.target.value)} className="input-field" />
            </div>
          </div>
        }
        onCancel={() => setShowExit(false)}
        onConfirm={handleExit}
      />
    </div>
  );
}
