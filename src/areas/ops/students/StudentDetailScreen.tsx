import { todayLocalIso } from "@/lib/today";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, UserMinus } from "lucide-react";
import { useIsV3 } from "@/lib/uiTheme";
import { formatDate } from "@/lib/format";
import { ActionsMenu } from "@/components/ActionsMenu";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { StudentBagatzNote } from "../talmud/TalmudReportRowsView";
import { StudentTalmudTruth } from "./StudentTalmudTruth";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { EmptyState } from "@/components/EmptyState";
import { Tabs, type TabDef } from "@/components/Tabs";
import { StudentPortalTab } from "@/areas/ops/leader-portal/StudentPortalTab";
import { Stepper, type StepDef } from "@/components/Stepper";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ID_TYPE_LABEL, STATUS_LABEL, type Student } from "./types";
import { StudentDetailsTab } from "./StudentDetailsTab";
import { StudentAssignmentTab, fetchAssignments } from "./StudentAssignmentTab";
import { StudentBankTab } from "./StudentBankTab";
import { StudentTalmudTab } from "./StudentTalmudTab";
import { StudentAuditsTab } from "./StudentAuditsTab";

type TabKey = "details" | "assignment" | "talmud" | "bank" | "audits" | "documents" | "portal";

const TABS: TabDef<TabKey>[] = [
  { key: "details", label: "פרטים" },
  { key: "assignment", label: "שיוך" },
  { key: "talmud", label: "תלמוד" },
  { key: "bank", label: "בנק" },
  { key: "audits", label: "ביקורות" },
  { key: "documents", label: "מסמכים" },
  { key: "portal", label: "מראש הקבוצה" },
];
// v3: בלי לשונית "מסמכים" - היא ריקה ("ייבנה בשלב 13") ורק מוסיפה עוד מקום לבדוק.
const TABS_V3 = TABS.filter((t) => t.key !== "documents");

const STEPS: StepDef[] = [
  { key: "draft", label: "טיוטה" },
  { key: "details", label: "פרטים הושלמו" },
  { key: "assignment", label: "שיוך פעיל" },
  { key: "bank", label: "חשבון בנק תקין" },
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
      "id, id_type, external_id, full_name, birth_date, phone_raw, phone_normalized, address_street, address_house_number, address_city, student_type, study_code, marital_status, study_scope, first_name, last_name, passport_country, visa_number, visa_type, visa_expiry, gender, talmud_start_date, talmud_end_date, created_from_talmud, status, exit_date, exit_reason, created_at",
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
  // קבוצה שהוגדרה "חשבון בנק אינו חובה" (מיגרציה 115) - תנאי הבנק מתקיים בלי חשבון,
  // בדיוק כמו ב-student_ready_blocker בשרת.
  const { data: optional, error: groupError } = await supabase
    .from("student_assignments")
    .select("group:groups!inner(bank_account_optional)")
    .eq("student_id", studentId)
    .eq("is_active", true)
    .eq("group.bank_account_optional", true)
    .limit(1);
  if (groupError) throw groupError;
  if ((optional ?? []).length > 0) return true;

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
  const [selectedTab, setActiveTab] = useState<TabKey>("details");
  const [showExit, setShowExit] = useState(false);
  const [exitReason, setExitReason] = useState("");
  const [exiting, setExiting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);

  const studentQuery = useQuery({ queryKey: ["student", id], queryFn: () => fetchStudent(id!), enabled: !!id });
  const assignmentGateQuery = useQuery({ queryKey: ["student-has-assignment", id], queryFn: () => hasActiveAssignment(id!), enabled: !!id });
  const bankGateQuery = useQuery({ queryKey: ["student-has-verified-account", id], queryFn: () => hasVerifiedAccount(id!), enabled: !!id });
  const isV3 = useIsV3();
  // מעבר ל-v3 כשלשונית "מסמכים" (שאינה קיימת שם) פתוחה - חוזרים ל"פרטים"
  const activeTab: TabKey = isV3 && selectedTab === "documents" ? "details" : selectedTab;
  // v3: השיוך הנוכחי בכותרת. אותה שאילתה ואותו מפתח בדיוק של לשונית "שיוך" - כך
  // שהיא נטענת פעם אחת, ושינוי שיוך בלשונית מתעדכן גם כאן.
  const assignmentsQuery = useQuery({ queryKey: ["student-assignments", id], queryFn: () => fetchAssignments(id!), enabled: !!id && isV3 });

  if (studentQuery.isLoading) return <LoadingState rows={6} />;
  if (studentQuery.error || !studentQuery.data) return <ErrorState message="שגיאה בטעינת התלמיד, או שאין לך הרשאה לצפות בו." />;

  const student = studentQuery.data;
  const hasDetails = Boolean(student.full_name && student.phone_normalized);
  const hasAssignment = assignmentGateQuery.data ?? false;
  const hasBank = bankGateQuery.data ?? false;

  // כל שלב מסומן רק כשגם כל השלבים שלפניו מתקיימים - אותם תנאים שחוסמים את הקידום.
  // עד היום תלמיד עם שיוך וחשבון אבל בלי טלפון קיבל ✓ ליד "פרטים", ובאותו מסך
  // הופיע "חסר כדי לקדם: טלפון" (INT-08).
  let currentStep = "draft";
  if (hasDetails) currentStep = "details";
  if (hasDetails && hasAssignment) currentStep = "assignment";
  if (hasDetails && hasAssignment && hasBank) currentStep = "bank";
  if (student.status === "ready_for_talmud") currentStep = "ready_for_talmud";
  if (student.status === "sent_to_talmud") currentStep = "sent_to_talmud";
  if (student.status === "active" || student.status === "active_with_error") currentStep = "active";

  const refreshStudent = () => {
    queryClient.invalidateQueries({ queryKey: ["student", id] });
    queryClient.invalidateQueries({ queryKey: ["students"] });
    // יציאה סוגרת את השיוך הפעיל - שהשיוך בכותרת (v3) ובלשונית לא יישאר ישן
    queryClient.invalidateQueries({ queryKey: ["student-assignments", id] });
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
      p_exit_date: todayLocalIso(),
      p_exit_reason: exitReason || "לא צוינה סיבה",
    });
    setExiting(false);
    setShowExit(false);
    // שגיאה מוצגת ולא נבלעת - עד היום יציאה שנכשלה נראתה כאילו לא קרה כלום
    if (error) {
      setActionError(`יציאת התלמיד נכשלה: ${error.message}`);
      return;
    }
    refreshStudent();
  };

  const canExit = canManage && student.status !== "inactive";
  const currentPlacement = (assignmentsQuery.data ?? []).find((a) => a.is_active);
  const gatesLoading = assignmentGateQuery.isLoading || bankGateQuery.isLoading;

  return (
    <div>
      <PageHeader
        title={student.full_name}
        breadcrumbs={[{ label: "תלמידים", href: "/ops/students" }, { label: student.full_name }]}
        primaryAction={
          isV3 ? (
            // v3: "יציאת תלמיד" עוברת מהשורה הבולטת לתפריט - פעולה נדירה ובלתי הפיכה
            // שלא צריכה לעמוד ליד הפעולה הראשית. האישור עצמו (חלון עם סיבה) לא השתנה.
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge severity={STATUS_SEVERITY[student.status]} label={STATUS_LABEL[student.status]} />
              {canExit && (
                <ActionsMenu
                  actions={[{ key: "exit", label: "יציאת תלמיד", hint: "סימון כלא פעיל וסגירת השיוך הפעיל", icon: UserMinus, onSelect: () => setShowExit(true) }]}
                />
              )}
            </div>
          ) : (
            <StatusBadge severity={STATUS_SEVERITY[student.status]} label={STATUS_LABEL[student.status]} />
          )
        }
      />

      {/* v3: מי התלמיד ואיפה הוא משויך - בלי לפתוח לשונית */}
      {isV3 && (
        <dl className="-mt-3 mb-5 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <div className="flex items-baseline gap-1.5">
            <dt className="text-ink-subtle">{ID_TYPE_LABEL[student.id_type]}</dt>
            <dd className="ltr-num font-medium text-ink">{student.external_id}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-ink-subtle">שיוך</dt>
            <dd className="text-ink">
              {assignmentsQuery.isLoading ? (
                <span className="text-ink-subtle">…</span>
              ) : currentPlacement ? (
                <>
                  <Link to={`/ops/organizations/${currentPlacement.organization_id}`} className="link-action">
                    {currentPlacement.organization_name ?? "—"}
                  </Link>
                  <span className="mx-1 text-ink-subtle" aria-hidden="true">›</span>
                  <Link to={`/ops/organizations?org=${currentPlacement.organization_id}&branch=${currentPlacement.branch_id}`} className="link-action">
                    {currentPlacement.branch_name ?? "—"}
                  </Link>
                  <span className="mx-1 text-ink-subtle" aria-hidden="true">›</span>
                  <Link
                    to={`/ops/organizations?org=${currentPlacement.organization_id}&branch=${currentPlacement.branch_id}&group=${currentPlacement.group_id}`}
                    className="link-action"
                  >
                    {currentPlacement.group_name ?? "—"}
                  </Link>
                </>
              ) : (
                <span className="text-ink-subtle">לא משויך</span>
              )}
            </dd>
          </div>
          {student.status === "inactive" && student.exit_date && (
            <div className="flex items-baseline gap-1.5">
              <dt className="text-ink-subtle">יצא</dt>
              <dd className="text-ink">
                <span className="tabular">{formatDate(student.exit_date)}</span>
                {student.exit_reason && <span className="text-ink-muted"> · {student.exit_reason}</span>}
              </dd>
            </div>
          )}
        </dl>
      )}

      <Stepper steps={STEPS} currentStep={currentStep} />

      {/* v3: בתלמיד פעיל השורה הייתה מכילה רק את "יציאת תלמיד", שעברה לתפריט - אז אין שורה */}
      {canExit && (!isV3 || (student.status !== "active" && student.status !== "active_with_error")) && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          {student.status === "draft" && (() => {
            const missing: string[] = [];
            if (!hasDetails) missing.push(isV3 ? "טלפון" : "פרטים מלאים");
            if (!hasAssignment) missing.push("שיוך פעיל");
            if (!hasBank) missing.push("חשבון בנק תקין");
            return (
              <>
                <button
                  onClick={advance}
                  disabled={missing.length > 0 || advancing}
                  title={missing.length > 0 ? `חסר: ${missing.join(", ")}` : undefined}
                  className="btn-primary text-sm"
                >
                  {advancing ? "מעדכנת…" : "קידום למוכן לתלמוד"}
                </button>
                {/* v3: מה חסר כתוב ליד הכפתור, ולא רק בריחוף שאיש לא מגלה */}
                {isV3 && !gatesLoading && missing.length > 0 && (
                  <p className="text-sm text-warn-ink">חסר כדי לקדם: {missing.join(" · ")}</p>
                )}
              </>
            );
          })()}
          {(student.status === "ready_for_talmud" || student.status === "sent_to_talmud") && (
            <p className="text-xs text-ink-subtle">
              {student.status === "ready_for_talmud"
                ? 'ההמשך (יצוא לתלמוד) נעשה ממסך "יצוא לתלמוד" - לא כפעולה כאן.'
                : "התלמיד נשלח לתלמוד. הסטטוס יתעדכן אוטומטית ל\"פעיל\"/\"פעיל עם שגיאה\" ביבוא דוח הזכאות/שגויים הבא."}
            </p>
          )}
          {!isV3 && (
            <button onClick={() => setShowExit(true)} className="text-xs text-danger underline hover:text-danger-ink">
              יציאת תלמיד
            </button>
          )}
        </div>
      )}
      {actionError && <div className="mb-4"><ErrorState message={actionError} /></div>}

      <StudentTalmudTruth studentId={student.id} createdFromTalmud={student.created_from_talmud} />
      <StudentBagatzNote studentId={student.id} />

      <Tabs tabs={isV3 ? TABS_V3 : TABS} activeTab={activeTab} onChange={setActiveTab} ariaLabel="לשוניות תלמיד" />

      {activeTab === "details" && <StudentDetailsTab student={student} />}
      {activeTab === "assignment" && <StudentAssignmentTab studentId={student.id} />}
      {activeTab === "talmud" && <StudentTalmudTab studentId={student.id} />}
      {activeTab === "bank" && <StudentBankTab studentId={student.id} />}
      {activeTab === "audits" && <StudentAuditsTab studentId={student.id} />}
      {activeTab === "portal" && <StudentPortalTab studentId={student.id} />}
      {activeTab === "documents" && <EmptyState title="מסמכים" description="מסמכים של תלמיד עדיין לא נשמרים במערכת." icon={FileText} />}

      <ConfirmDialog
        open={showExit}
        title="יציאת תלמיד"
        danger
        confirmLabel={exiting ? "מבצעת…" : "אישור יציאה"}
        description={
          <div className="space-y-2 text-right">
            <p>התלמיד יסומן כלא פעיל והשיוך הפעיל ייסגר. הנתונים וההיסטוריה נשמרים במלואם.</p>
            <div>
              <label htmlFor="student-exit-reason" className="field-label">סיבת יציאה</label>
              <input id="student-exit-reason" value={exitReason} onChange={(e) => setExitReason(e.target.value)} className="input-field" />
            </div>
          </div>
        }
        onCancel={() => setShowExit(false)}
        onConfirm={handleExit}
      />
    </div>
  );
}
