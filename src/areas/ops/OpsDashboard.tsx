import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { ExceptionGrid, type ExceptionCounter } from "@/components/ExceptionGrid";
import { LoadingState } from "@/components/LoadingState";
import { ErrorState } from "@/components/ErrorState";

interface OpsCounts {
  draft_students: number;
  ready_for_export: number;
  open_errors: number;
  recurring_errors: number;
  active_not_in_latest_report: number;
  missing_phone_bank_or_assignment: number;
  pending_phone_lists_or_audits: number;
}

async function fetchOpsCounts(): Promise<OpsCounts> {
  const { data, error } = await supabase.rpc("get_ops_dashboard_counts").single();
  if (error) throw error;
  return data as unknown as OpsCounts;
}

function buildItems(c: OpsCounts): ExceptionCounter[] {
  return [
    { key: "drafts", label: "תלמידים בטיוטה שטרם הושלמו", count: c.draft_students, severity: c.draft_students > 0 ? "medium" : "ok", href: "/ops/students" },
    { key: "waiting-export", label: "ממתינים ליצוא לתלמוד", count: c.ready_for_export, severity: "neutral", href: "/ops/talmud/export" },
    { key: "open-errors", label: "שגיאות תלמוד פתוחות", count: c.open_errors, severity: c.open_errors > 0 ? "high" : "ok", href: "/ops/talmud/errors" },
    { key: "recurring-errors", label: "שגיאות תלמוד חוזרות", count: c.recurring_errors, severity: c.recurring_errors > 0 ? "critical" : "ok", href: "/ops/talmud/errors" },
    {
      key: "missing-from-report",
      label: "תלמידים פעילים שלא הופיעו בדוח הזכאות האחרון",
      count: c.active_not_in_latest_report,
      severity: c.active_not_in_latest_report > 0 ? "critical" : "ok",
      href: "/ops/talmud/eligibility",
    },
    {
      key: "missing-details",
      label: "תלמידים פעילים חסרי טלפון, חשבון מאומת או שיוך",
      count: c.missing_phone_bank_or_assignment,
      severity: c.missing_phone_bank_or_assignment > 0 ? "high" : "ok",
      href: "/ops/students",
    },
    {
      key: "pending-lists",
      label: "רשימות בימות המשיח וביקורות שטרם נקלטו",
      count: c.pending_phone_lists_or_audits,
      severity: c.pending_phone_lists_or_audits > 0 ? "medium" : "ok",
      href: "/ops/phone-lists",
    },
  ];
}

async function fetchPortalCounts(): Promise<ExceptionCounter[]> {
  const [requests, questions] = await Promise.all([
    supabase.from("portal_change_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("portal_questions").select("id", { count: "exact", head: true }).eq("status", "open"),
  ]);
  if (requests.error || questions.error) return [];
  const r = requests.count ?? 0;
  const q = questions.count ?? 0;
  return [
    { key: "portal-requests", label: "עדכונים מראשי קבוצות שממתינים לאישור", count: r, severity: r > 0 ? "high" : "ok", href: "/ops/leader-portal" },
    { key: "portal-questions", label: "שאלות מראשי קבוצות שממתינות לתשובה", count: q, severity: q > 0 ? "high" : "ok", href: "/ops/leader-portal" },
  ];
}

export function OpsDashboard() {
  const query = useQuery({ queryKey: ["ops-dashboard-counts"], queryFn: fetchOpsCounts });
  const portal = useQuery({ queryKey: ["portal-office-counts"], queryFn: fetchPortalCounts });

  return (
    <div>
      <PageHeader title="דשבורד תפעולי" description="מונים שדורשים טיפול בפועל — כל כרטיס מוביל לרשימה המסוננת הרלוונטית. ללא תנועות בנק או סכומים רגישים." />
      {query.isLoading && <LoadingState rows={3} />}
      {query.isError && <ErrorState message="שגיאה בטעינת נתוני הדשבורד." />}
      {query.data && <ExceptionGrid items={[...buildItems(query.data), ...(portal.data ?? [])]} />}
    </div>
  );
}
