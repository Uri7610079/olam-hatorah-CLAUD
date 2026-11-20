import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { FileSpreadsheet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/fetchAll";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { STORED_REPORT_LABEL, type StoredReportKey } from "@/lib/talmudReports";
import { useIsV3 } from "@/lib/uiTheme";
import { formatMoney, formatMonth } from "@/lib/format";

// השורות שנקלטו מדוחות תלמוד (מיגרציה 121): תשלומים למוסד, בג"ץ, הסבר תשלומים.
// טבלה אחת לכל דוח, עם סינון ומיון בכותרות (כמו באקסל).

interface Row {
  id: string;
  month: string;
  branch_code: string | null;
  external_id: string | null;
  student_id: string | null;
  data: Record<string, string | number | null>;
  organization: { legal_name: string } | null;
  student: { full_name: string } | null;
}

const monthText = (iso: string) => iso.slice(0, 7).split("-").reverse().join("/");
const money = (n: unknown) => (typeof n === "number" ? n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
const num = (n: unknown) => (typeof n === "number" ? n : null);

const COLUMNS: Record<StoredReportKey, DataTableColumn<Row>[]> = {
  institute_payments: [
    { key: "org", header: "עמותה", render: (r) => r.organization?.legal_name ?? "—" },
    { key: "branch", header: "סניף", className: "tabular", render: (r) => r.branch_code ?? "—" },
    { key: "month", header: "חודש דיווח", className: "tabular", render: (r) => String(r.data.report_month ?? monthText(r.month)) },
    { key: "type", header: "סוג תשלום", render: (r) => String(r.data.payment_type ?? "—") },
    { key: "eligible", header: "זכאים", className: "tabular", render: (r) => String(r.data.eligible ?? "—"), sortValue: (r) => num(r.data.eligible) },
    { key: "amount", header: "סכום לתשלום", className: "tabular", render: (r) => money(r.data.amount), sortValue: (r) => num(r.data.amount) },
    { key: "date", header: "תאריך חישוב", className: "tabular", render: (r) => String(r.data.calc_date ?? "—") },
  ],
  payment_explanation: [
    { key: "org", header: "עמותה", render: (r) => r.organization?.legal_name ?? "—" },
    { key: "branch", header: "סניף", className: "tabular", render: (r) => r.branch_code ?? "—" },
    { key: "month", header: "חודש דיווח", className: "tabular", render: (r) => String(r.data.report_month ?? "—") },
    { key: "type", header: "סוג תשלום", render: (r) => String(r.data.payment_type ?? "—") },
    { key: "prev", header: "חישוב קודם", className: "tabular", render: (r) => money(r.data.prev_amount), sortValue: (r) => num(r.data.prev_amount) },
    { key: "amount", header: "חישוב נוכחי", className: "tabular", render: (r) => money(r.data.amount), sortValue: (r) => num(r.data.amount) },
    { key: "diff", header: "הפרש", className: "tabular", render: (r) => money(r.data.diff), sortValue: (r) => num(r.data.diff) },
    { key: "offset", header: "קיזוז בתשלום זה", className: "tabular", render: (r) => money(r.data.offset_this), sortValue: (r) => num(r.data.offset_this) },
    { key: "offsetTotal", header: "קיזוז מצטבר", className: "tabular", render: (r) => money(r.data.offset_total), sortValue: (r) => num(r.data.offset_total) },
  ],
  bagatz: [
    { key: "org", header: "עמותה", render: (r) => r.organization?.legal_name ?? "—" },
    { key: "branch", header: "סניף", className: "tabular", render: (r) => r.branch_code ?? "—" },
    { key: "month", header: "חודש", className: "tabular", render: (r) => monthText(r.month), sortValue: (r) => r.month },
    { key: "id", header: "ת.ז./דרכון", className: "tabular", render: (r) => r.external_id ?? "—" },
    {
      key: "name", header: "שם",
      render: (r) => r.student_id
        ? <Link to={`/ops/students/${r.student_id}`} className="link-action">{r.student?.full_name ?? `${r.data.last_name ?? ""} ${r.data.first_name ?? ""}`}</Link>
        : `${r.data.last_name ?? ""} ${r.data.first_name ?? ""}`.trim(),
    },
    { key: "suspended", header: 'השעיית בג"ץ', render: (r) => String(r.data.suspended ?? "—") },
    { key: "entitled", header: "זכאות", render: (r) => String(r.data.entitlement ?? "—") },
    { key: "would", header: "זכאי אלמלא השעיה", render: (r) => String(r.data.would_be_entitled ?? "—") },
  ],
};

// v3: אותן עמודות, עם סכומים ב-₪ (ומינוס מפורש בהפרש), חודש במילים ות.ז. מבודדת
// כיוונית. המיון נשאר לפי הערך הגולמי (sortValue שכבר מוגדר למעלה).
const MONEY_FIELD: Record<string, string> = { amount: "amount", prev: "prev_amount", diff: "diff", offset: "offset_this", offsetTotal: "offset_total" };
const v3Money = (n: unknown, sign = false) => (typeof n === "number" ? formatMoney(n, { sign }) : "—");
// rowMonth: עמודת החודש מציגה את month של השורה (בג"ץ), ולא חודש דיווח כטקסט מהקובץ
const toV3 = (cols: DataTableColumn<Row>[], rowMonth = false): DataTableColumn<Row>[] =>
  cols.map((c) => {
    const field = MONEY_FIELD[c.key];
    if (field) return { ...c, className: undefined, kind: "money", render: (r: Row) => v3Money(r.data[field], c.key === "diff") };
    if (c.key === "eligible") return { ...c, className: undefined, kind: "number" };
    if (c.key === "id") return { ...c, className: undefined, kind: "ltr" };
    if (c.key === "month" && rowMonth) return { ...c, render: (r: Row) => formatMonth(r.month) };
    return c;
  });
const COLUMNS_V3: Record<StoredReportKey, DataTableColumn<Row>[]> = {
  institute_payments: toV3(COLUMNS.institute_payments),
  payment_explanation: toV3(COLUMNS.payment_explanation),
  bagatz: toV3(COLUMNS.bagatz, true),
};

export function TalmudReportRowsView({ reportKey, organizationId }: { reportKey: StoredReportKey; organizationId?: string | null }) {
  const isV3 = useIsV3();
  const query = useQuery({
    queryKey: ["talmud-report-rows", reportKey, organizationId ?? "all"],
    queryFn: () => fetchAll(() => {
      let q = supabase.from("talmud_report_rows")
        .select("id, month, branch_code, external_id, student_id, data, organization:organizations(legal_name), student:students(full_name)")
        .eq("report_key", reportKey);
      if (organizationId) q = q.eq("organization_id", organizationId);
      return q.order("month", { ascending: false }).order("branch_code").order("id");
    }).then((rows) => rows.map((r) => ({
      ...r,
      // קשר מוטמע מגיע ממסד כמערך - שורה אחת
      organization: (Array.isArray(r.organization) ? r.organization[0] ?? null : r.organization) as Row["organization"],
      student: (Array.isArray(r.student) ? r.student[0] ?? null : r.student) as Row["student"],
    })) as Row[]),
  });
  if (query.isError) return <ErrorState message={(query.error as Error).message} />;
  return (
    <DataTable
      columns={isV3 ? COLUMNS_V3[reportKey] : COLUMNS[reportKey]}
      rows={query.data ?? []}
      rowKey={(r) => r.id}
      loading={query.isLoading} error={query.error} onRetry={() => query.refetch()}
      clientPageSize={50}
      emptyTitle={`עוד לא נקלט "${STORED_REPORT_LABEL[reportKey]}"`}
      emptyDescription='מושכים מתלמוד, ואז במרכז היבוא → "קבצים מתלמוד".'
      emptyIcon={FileSpreadsheet}
    />
  );
}

/** בכרטיס התלמיד: מצב בג"ץ בחודש האחרון שנקלט */
export function StudentBagatzNote({ studentId }: { studentId: string }) {
  const isV3 = useIsV3();
  const query = useQuery({
    queryKey: ["talmud-report-rows", "bagatz-student", studentId],
    queryFn: async () => {
      const { data } = await supabase.from("talmud_report_rows").select("month, data")
        .eq("report_key", "bagatz").eq("student_id", studentId).order("month", { ascending: false }).limit(1);
      return data?.[0] ?? null;
    },
  });
  const row = query.data;
  if (!row) return null;
  const suspended = String(row.data?.suspended ?? "").trim();
  return (
    <p className={`mb-4 rounded-control p-3 text-sm ${suspended ? "bg-warn-soft text-warn-ink" : "bg-surface-muted text-ink-muted"}`}>
      בג"ץ, חודש {isV3 ? formatMonth(row.month) : monthText(row.month)}: {suspended ? `השעיה - ${suspended}` : "לא מושעה"}
      {row.data?.entitlement ? ` · זכאות: ${row.data.entitlement}` : ""}
      {row.data?.would_be_entitled ? ` · זכאי אלמלא השעיה: ${row.data.would_be_entitled}` : ""}
    </p>
  );
}
