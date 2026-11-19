import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { formatMoney, formatMonth } from "@/lib/format";
import { useIsV3 } from "@/lib/uiTheme";

interface EligibilityRow {
  id: string;
  month: string;
  gross_amount: number;
  score_or_payment_type: string | null;
  status: "active" | "superseded";
}

interface ErrorRow {
  id: string;
  month: string;
  error_code: string;
  error_description: string | null;
  status: string;
  is_recurring: boolean;
}

// סטטוס שגיאת תלמוד בעברית - עד היום הוצג הערך הגולמי מהמסד (open, closed…)
const ERROR_STATUS_LABEL: Record<string, string> = {
  open: "פתוח",
  in_progress: "בטיפול",
  pending_info: "ממתין למידע",
  closed: "סגור",
};

async function fetchEligibility(studentId: string): Promise<EligibilityRow[]> {
  const { data, error } = await supabase
    .from("monthly_eligibility")
    .select("id, month, gross_amount, score_or_payment_type, status")
    .eq("student_id", studentId)
    .order("month", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function fetchErrors(studentId: string): Promise<ErrorRow[]> {
  const { data, error } = await supabase
    .from("talmud_errors")
    .select("id, month, error_code, error_description, status, is_recurring")
    .eq("student_id", studentId)
    .order("month", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export function StudentTalmudTab({ studentId }: { studentId: string }) {
  const eligibilityQuery = useQuery({ queryKey: ["student-eligibility", studentId], queryFn: () => fetchEligibility(studentId) });
  const errorsQuery = useQuery({ queryKey: ["student-talmud-errors", studentId], queryFn: () => fetchErrors(studentId) });
  const isV3 = useIsV3();
  // v3: "נובמבר 2026" במקום 2026-11-01, וסכום אחיד; המיון לפי הערך המקורי
  const monthCol = <T extends { month: string }>(): DataTableColumn<T> =>
    isV3
      ? { key: "month", header: "חודש", filterValue: (r) => formatMonth(r.month), sortValue: (r) => r.month, render: (r) => formatMonth(r.month) }
      : { key: "month", header: "חודש", className: "tabular", render: (r) => r.month };

  const eligibilityCols: DataTableColumn<EligibilityRow>[] = [
    monthCol<EligibilityRow>(),
    isV3
      ? { key: "amount", header: "סכום ברוטו", kind: "money", filterValue: (r) => formatMoney(r.gross_amount), sortValue: (r) => r.gross_amount, render: (r) => formatMoney(r.gross_amount) }
      : { key: "amount", header: "סכום ברוטו", className: "tabular", render: (r) => r.gross_amount.toLocaleString("he-IL") },
    { key: "score", header: "ניקוד/סוג תשלום", render: (r) => r.score_or_payment_type ?? "—" },
    {
      key: "status",
      header: "סטטוס",
      render: (r) => <StatusBadge severity={r.status === "active" ? "ok" : "neutral"} label={r.status === "active" ? "פעיל" : "הוחלף בגרסה מאוחרת"} />,
    },
  ];

  const errorCols: DataTableColumn<ErrorRow>[] = [
    monthCol<ErrorRow>(),
    { key: "code", header: "קוד", className: "tabular", render: (r) => r.error_code },
    { key: "desc", header: "תיאור", render: (r) => r.error_description ?? "—" },
    { key: "recurring", header: "", render: (r) => (r.is_recurring ? <StatusBadge severity="high" label="חוזרת" /> : null) },
    { key: "status", header: "סטטוס", render: (r) => ERROR_STATUS_LABEL[r.status] ?? r.status },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink-muted">זכאות חודשית</h3>
        <DataTable
          columns={eligibilityCols}
          rows={eligibilityQuery.data ?? []}
          rowKey={(r) => r.id}
          loading={eligibilityQuery.isLoading}
          emptyTitle="אין זכאות רשומה"
          emptyIcon={ClipboardList}
        />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink-muted">שגיאות</h3>
        <DataTable columns={errorCols} rows={errorsQuery.data ?? []} rowKey={(r) => r.id} loading={errorsQuery.isLoading} emptyTitle="אין שגיאות רשומות" />
      </div>
    </div>
  );
}
