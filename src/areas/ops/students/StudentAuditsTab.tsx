import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";

interface AttendanceRow {
  id: string;
  status: string;
  reason: string | null;
  is_recurring: boolean;
  audit: { audit_date: string; organization: { legal_name: string } | null } | null;
}

const STATUS_LABEL: Record<string, string> = { open: "פתוח", in_progress: "בטיפול", pending_info: "ממתין למידע", closed: "טופל" };

async function fetchAttendance(studentId: string): Promise<AttendanceRow[]> {
  const { data, error } = await supabase
    .from("audit_attendance")
    .select("id, status, reason, is_recurring, audit:audits(audit_date, organization:organizations(legal_name))")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    ...r,
    audit: Array.isArray(r.audit) ? (r.audit[0] ?? null) : r.audit,
  })).map((r: any) => ({
    ...r,
    audit: r.audit ? { ...r.audit, organization: Array.isArray(r.audit.organization) ? (r.audit.organization[0] ?? null) : r.audit.organization } : null,
  }));
}

// היסטוריית נוכחות וחוסר של התלמיד לפי כרטיס - "היסטוריית נוכחות וחוסר בכרטיס התלמיד" באפיון (שלב 13).
export function StudentAuditsTab({ studentId }: { studentId: string }) {
  const attendanceQuery = useQuery({ queryKey: ["student-audit-attendance", studentId], queryFn: () => fetchAttendance(studentId) });

  const columns: DataTableColumn<AttendanceRow>[] = [
    { key: "date", header: "תאריך ביקורת", className: "tabular", render: (r) => r.audit?.audit_date ?? "—" },
    { key: "org", header: "עמותה", render: (r) => r.audit?.organization?.legal_name ?? "—" },
    { key: "recurring", header: "", render: (r) => (r.is_recurring ? <StatusBadge severity="high" label="חוזר" /> : null) },
    { key: "reason", header: "סיבה", render: (r) => r.reason ?? "—" },
    { key: "status", header: "טיפול", render: (r) => STATUS_LABEL[r.status] ?? r.status },
  ];

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-ink-muted">היסטוריית חוסר בביקורות</h3>
      <DataTable
        columns={columns}
        rows={attendanceQuery.data ?? []}
        rowKey={(r) => r.id}
        loading={attendanceQuery.isLoading}
        emptyTitle="התלמיד לא נרשם כחסר באף ביקורת"
        emptyIcon={ClipboardList}
      />
    </div>
  );
}
