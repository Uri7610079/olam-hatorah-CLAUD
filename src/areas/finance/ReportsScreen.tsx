import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useLastSelected } from "@/lib/useLastSelected";
import { exportRowsToExcel, logReportExport } from "@/lib/reportExport";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";

type ReportRow = Record<string, string | number | null>;

interface OrgOption {
  id: string;
  legal_name: string;
}

interface GroupOption {
  id: string;
  name: string;
}

interface ReportCtx {
  orgId: string;
  month: string;
  groupId: string;
}

interface ReportDef {
  key: string;
  label: string;
  needsGroup?: boolean;
  fetch: (ctx: ReportCtx) => Promise<ReportRow[]>;
}

const STUDENT_STATUS_LABEL: Record<string, string> = {
  draft: "טיוטה",
  ready_for_talmud: "מוכן לתלמוד",
  sent_to_talmud: "נשלח לתלמוד",
  active: "פעיל",
  active_with_error: "פעיל עם שגיאה",
  inactive: "לא פעיל",
};

function monthRange(month: string) {
  const start = month;
  const d = new Date(month);
  d.setMonth(d.getMonth() + 1);
  return { start, end: d.toISOString().slice(0, 10) };
}

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

async function orgStudentIds(orgId: string): Promise<string[]> {
  const { data } = await supabase.from("student_assignments").select("student_id").eq("organization_id", orgId);
  return Array.from(new Set((data ?? []).map((r) => r.student_id)));
}

async function orgActiveStudentIds(orgId: string): Promise<string[]> {
  const { data } = await supabase.from("student_assignments").select("student_id").eq("organization_id", orgId).eq("is_active", true);
  return Array.from(new Set((data ?? []).map((r) => r.student_id)));
}

const REPORTS: ReportDef[] = [
  {
    key: "students_movement",
    label: "תלמידים חדשים ויוצאים",
    fetch: async ({ orgId, month }) => {
      const { start, end } = monthRange(month);
      const ids = await orgStudentIds(orgId);
      if (ids.length === 0) return [];
      const { data } = await supabase.from("students").select("external_id, full_name, status, created_at, exit_date, exit_reason").in("id", ids);
      return (data ?? [])
        .filter((s) => (s.created_at >= start && s.created_at < end) || (s.exit_date && s.exit_date >= start && s.exit_date < end))
        .map((s) => ({
          "מזהה": s.external_id,
          "שם": s.full_name,
          "סוג תנועה": s.exit_date && s.exit_date >= start && s.exit_date < end ? "יצא" : "חדש",
          "סטטוס נוכחי": STUDENT_STATUS_LABEL[s.status] ?? s.status,
          "תאריך יציאה": s.exit_date ?? "—",
          "סיבת יציאה": s.exit_reason ?? "—",
        }));
    },
  },
  {
    key: "active_not_in_report",
    label: "תלמידים פעילים שלא הופיעו בדוח האחרון",
    fetch: async ({ orgId }) => {
      const { data: latest } = await supabase.from("monthly_eligibility").select("month").eq("organization_id", orgId).order("month", { ascending: false }).limit(1);
      const latestMonth = latest?.[0]?.month;
      const ids = await orgActiveStudentIds(orgId);
      if (!latestMonth || ids.length === 0) return [];
      const { data: have } = await supabase.from("monthly_eligibility").select("student_id").eq("organization_id", orgId).eq("month", latestMonth);
      const haveSet = new Set((have ?? []).map((r) => r.student_id));
      const missing = ids.filter((id) => !haveSet.has(id));
      if (missing.length === 0) return [];
      const { data: students } = await supabase.from("students").select("external_id, full_name").in("id", missing);
      return (students ?? []).map((s) => ({ "מזהה": s.external_id, "שם": s.full_name, "חודש אחרון שדווח": latestMonth }));
    },
  },
  {
    key: "eligibility",
    label: "זכאות חודשית",
    fetch: async ({ orgId, month }) => {
      const { data } = await supabase
        .from("monthly_eligibility")
        .select("gross_amount, score_or_payment_type, status, student:students(external_id, full_name)")
        .eq("organization_id", orgId).eq("month", month);
      return (data ?? []).map((r: any) => {
        const s = unwrap(r.student);
        return { "מזהה": s?.external_id ?? "—", "שם": s?.full_name ?? "—", "ברוטו": r.gross_amount, "ניקוד/סוג תשלום": r.score_or_payment_type ?? "—", "סטטוס": r.status };
      });
    },
  },
  {
    key: "errors",
    label: "שגיאות תלמוד",
    fetch: async ({ orgId, month }) => {
      const { data } = await supabase
        .from("talmud_errors")
        .select("external_student_ref, error_code, error_description, status, is_recurring, student:students(external_id, full_name)")
        .eq("organization_id", orgId).eq("month", month);
      return (data ?? []).map((r: any) => {
        const s = unwrap(r.student);
        return { "מזהה": s?.external_id ?? r.external_student_ref ?? "—", "שם": s?.full_name ?? "(לא הותאם)", "קוד": r.error_code, "תיאור": r.error_description ?? "—", "סטטוס": r.status, "חוזרת": r.is_recurring ? "כן" : "לא" };
      });
    },
  },
  {
    key: "retro",
    label: "רטרו והפרשים",
    fetch: async ({ orgId, month }) => {
      const { data } = await supabase
        .from("payment_calculation_versions")
        .select("source_month, received_month, calculation_type, prior_amount, current_amount, difference, student:students(external_id, full_name)")
        .eq("organization_id", orgId).eq("received_month", month);
      return (data ?? []).map((r: any) => {
        const s = unwrap(r.student);
        return { "מזהה": s?.external_id ?? "—", "שם": s?.full_name ?? "—", "חודש מקור": r.source_month, "חודש קליטה": r.received_month, "סוג חישוב": r.calculation_type ?? "—", "סכום קודם": r.prior_amount, "סכום נוכחי": r.current_amount, "הפרש": r.difference };
      });
    },
  },
  {
    key: "commission",
    label: "עמלה - ברוטו/עמלה/נטו והכלל שהופעל",
    fetch: async ({ orgId, month }) => {
      const { data } = await supabase
        .from("eligibility_financial_results")
        .select("gross_amount, commission_amount, net_amount, rule_snapshot, student:students(external_id, full_name)")
        .eq("organization_id", orgId).eq("month", month).eq("status", "active");
      return (data ?? []).map((r: any) => {
        const s = unwrap(r.student);
        return { "מזהה": s?.external_id ?? "—", "שם": s?.full_name ?? "—", "ברוטו": r.gross_amount, "עמלה": r.commission_amount, "נטו": r.net_amount, "כלל שהופעל": r.rule_snapshot?.calculation_type ?? "—" };
      });
    },
  },
  {
    key: "quotas",
    label: "מכסות",
    fetch: async ({ orgId, month }) => {
      const { data } = await supabase.from("monthly_quotas").select("approved_quota, notes, branch:branches(internal_name)").eq("organization_id", orgId).eq("month", month);
      return (data ?? []).map((r: any) => {
        const b = unwrap(r.branch);
        return { "סניף": b?.internal_name ?? "כל העמותה", "מכסה מאושרת": r.approved_quota, "הערות": r.notes ?? "—" };
      });
    },
  },
  {
    key: "group_balances",
    label: "יתרות קבוצות",
    fetch: async ({ orgId }) => {
      const { data } = await supabase.from("group_balances").select("group_name, balance").eq("organization_id", orgId);
      return (data ?? []).map((r) => ({ "קבוצה": r.group_name, "יתרה": r.balance }));
    },
  },
  {
    key: "group_ledger",
    label: "ספר תנועות קבוצות",
    fetch: async ({ orgId, month }) => {
      const { data } = await supabase
        .from("group_ledger_entries")
        .select("entry_type, amount, reason, created_at, group:groups(name)")
        .eq("organization_id", orgId).eq("period_month", month);
      return (data ?? []).map((r: any) => {
        const g = unwrap(r.group);
        return { "קבוצה": g?.name ?? "—", "סוג תנועה": r.entry_type, "סכום": r.amount, "סיבה": r.reason ?? "—", "תאריך": r.created_at?.slice(0, 10) };
      });
    },
  },
  {
    key: "donations",
    label: "תרומות",
    fetch: async ({ orgId, month }) => {
      const { start, end } = monthRange(month);
      // donations_view (לא הטבלה הבסיסית) - donor_reference ממוסך כברירת מחדל, בדיוק כמו
      // בכל מסך אחר; ה-view היא view (לא טבלה) אז PostgREST לא יכול להסיק embed ל-groups
      // דרכה - שם הקבוצה נפתר בצד לקוח מרשימת קבוצות העמותה (אותו דפוס כמו מרכז החריגות).
      const [{ data }, { data: groupsData }] = await Promise.all([
        supabase.from("donations_view").select("donation_date, amount, donor_reference_masked, status, group_id").eq("organization_id", orgId).gte("donation_date", start).lt("donation_date", end),
        supabase.from("groups").select("id, name"),
      ]);
      const groupById = new Map((groupsData ?? []).map((g) => [g.id, g.name]));
      return (data ?? []).map((r) => ({
        "תאריך": r.donation_date,
        "סכום": r.amount,
        "אסמכתת תורם": r.donor_reference_masked ?? "—",
        "קבוצה": (r.group_id && groupById.get(r.group_id)) ?? "—",
        "סטטוס": r.status,
      }));
    },
  },
  {
    key: "distributions",
    label: "הוראות חלוקה",
    fetch: async ({ orgId, month }) => {
      const { data } = await supabase
        .from("distribution_lines")
        .select("amount, student:students(external_id, full_name), batch:distribution_batches!inner(organization_id, period_month, status, method, group:groups(name))")
        .eq("batch.organization_id", orgId).eq("batch.period_month", month);
      return (data ?? []).map((r: any) => {
        const s = unwrap(r.student);
        const b = unwrap(r.batch);
        const g = b ? unwrap(b.group) : null;
        return { "מזהה תלמיד": s?.external_id ?? "—", "שם": s?.full_name ?? "—", "קבוצה": g?.name ?? "—", "שיטה": b?.method ?? "—", "סטטוס אצווה": b?.status ?? "—", "סכום": r.amount };
      });
    },
  },
  {
    key: "masav_lines",
    label: 'מס"ב - שורות תשלום',
    fetch: async ({ orgId, month }) => {
      const { data } = await supabase
        .from("masav_lines")
        .select("amount, status, rejection_code, student:students(external_id, full_name), batch:masav_batches!inner(organization_id, period_month)")
        .eq("batch.organization_id", orgId).eq("batch.period_month", month);
      return (data ?? []).map((r: any) => {
        const s = unwrap(r.student);
        return { "מזהה": s?.external_id ?? "—", "שם": s?.full_name ?? "—", "סכום": r.amount, "סטטוס": r.status, "קוד דחייה": r.rejection_code ?? "—" };
      });
    },
  },
  {
    key: "returns",
    label: "החזרות תשלום",
    fetch: async ({ orgId, month }) => {
      const { start, end } = monthRange(month);
      const { data } = await supabase
        .from("payment_returns")
        .select("return_date, amount, reason, status, masav_line:masav_lines!payment_returns_masav_line_id_fkey(student:students(external_id, full_name), batch:masav_batches(organization_id))")
        .gte("return_date", start).lt("return_date", end);
      return (data ?? [])
        .map((r: any) => ({ ...r, masav_line: unwrap(r.masav_line) }))
        .filter((r: any) => unwrap(r.masav_line?.batch)?.organization_id === orgId)
        .map((r: any) => {
          const s = unwrap(r.masav_line?.student);
          return { "תאריך": r.return_date, "מזהה": s?.external_id ?? "—", "שם": s?.full_name ?? "—", "סכום": r.amount, "סיבה": r.reason, "סטטוס": r.status };
        });
    },
  },
  {
    key: "unclassified_transactions",
    label: "תנועות בנק לא מסווגות",
    fetch: async ({ orgId }) => {
      const { data: accounts } = await supabase.from("organization_bank_accounts_view").select("id").eq("organization_id", orgId);
      const accountIds = (accounts ?? []).map((a) => a.id);
      if (accountIds.length === 0) return [];
      const { data } = await supabase.from("bank_transactions").select("execution_date, direction, amount, description, classification_status").in("organization_bank_account_id", accountIds).neq("classification_status", "confirmed");
      return (data ?? []).map((r) => ({ "תאריך": r.execution_date, "צד": r.direction === "debit" ? "חובה" : "זכות", "סכום": r.amount, "תיאור": r.description ?? "—", "סטטוס סיווג": r.classification_status }));
    },
  },
  {
    key: "bank_reconciliation",
    label: 'התאמה חודשית להנה"ח',
    fetch: async ({ orgId }) => {
      const { data } = await supabase.from("bank_reconciliation_exceptions").select("exception_type, severity, amount, related_date, description").eq("organization_id", orgId);
      return (data ?? []).map((r) => ({ "סוג": r.exception_type, "חומרה": r.severity, "סכום": r.amount ?? "—", "תאריך": r.related_date ?? "—", "פירוט": r.description }));
    },
  },
  {
    key: "audit_attendance",
    label: "חוסרים בביקורת משרד החינוך",
    fetch: async ({ orgId }) => {
      const { data } = await supabase
        .from("audit_attendance")
        .select("external_student_ref, status, is_recurring, student:students(external_id, full_name), audit:audits!inner(organization_id, audit_date)")
        .eq("audit.organization_id", orgId);
      return (data ?? []).map((r: any) => {
        const s = unwrap(r.student);
        const a = unwrap(r.audit);
        return { "תאריך ביקורת": a?.audit_date ?? "—", "מזהה": s?.external_id ?? r.external_student_ref ?? "—", "שם": s?.full_name ?? "(לא הותאם)", "סטטוס": r.status, "חוזר": r.is_recurring ? "כן" : "לא" };
      });
    },
  },
  {
    key: "phone_gaps",
    label: "פערי בימות המשיח",
    fetch: async ({ orgId }) => {
      const { data: imports } = await supabase.from("phone_list_imports").select("id").eq("organization_id", orgId).eq("status", "committed").order("created_at", { ascending: false }).limit(1);
      const importId = imports?.[0]?.id;
      if (!importId) return [];
      const { data } = await supabase.from("phone_list_entries").select("raw_phone, normalized_phone, status").eq("import_id", importId).in("status", ["extra", "duplicate", "invalid"]);
      return (data ?? []).map((r) => ({ "טלפון גולמי": r.raw_phone ?? "—", "מנורמל": r.normalized_phone ?? "—", "סטטוס": r.status }));
    },
  },
  {
    key: "group_leader_monthly",
    label: "דוח חודשי לראש קבוצה (יצוא בלבד)",
    needsGroup: true,
    fetch: async ({ groupId, month }) => {
      if (!groupId) return [];
      const { data } = await supabase.from("group_ledger_entries").select("entry_type, amount, reason, created_at").eq("group_id", groupId).eq("period_month", month);
      return (data ?? []).map((r) => ({ "סוג תנועה": r.entry_type, "סכום": r.amount, "סיבה": r.reason ?? "—", "תאריך": r.created_at?.slice(0, 10) }));
    },
  },
  {
    key: "decision_log",
    label: "יומן החלטות",
    fetch: async ({ month }) => {
      const { start, end } = monthRange(month);
      const { data } = await supabase.from("audit_events").select("action, resource, resource_id, created_at").gte("created_at", start).lt("created_at", end).order("created_at", { ascending: false }).limit(500);
      return (data ?? []).map((r) => ({ "תאריך": r.created_at?.slice(0, 16).replace("T", " "), "פעולה": r.action, "משאב": r.resource, "מזהה רשומה": r.resource_id ?? "—" }));
    },
  },
];

async function fetchOrgs(): Promise<OrgOption[]> {
  const { data, error } = await supabase.from("organizations").select("id, legal_name").eq("status", "active").order("legal_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchGroups(orgId: string): Promise<GroupOption[]> {
  const { data, error } = await supabase.from("groups").select("id, name, branch:branches!inner(organization_id)").eq("branch.organization_id", orgId);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ id: r.id, name: r.name }));
}

export function ReportsScreen() {
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });
  const [searchParams] = useSearchParams();
  const [orgId, setOrgId] = useLastSelected<string>("last-org", "");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7) + "-01");
  const [groupId, setGroupId] = useState("");
  const [reportKey, setReportKey] = useState(REPORTS[0].key);
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const orgParam = searchParams.get("org");
    if (orgParam) setOrgId(orgParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groupsQuery = useQuery({ queryKey: ["reports-groups", orgId], queryFn: () => fetchGroups(orgId), enabled: !!orgId });
  const report = REPORTS.find((r) => r.key === reportKey)!;

  const runPreview = async () => {
    if (!orgId) return;
    if (report.needsGroup && !groupId) return;
    setRunning(true);
    setError(null);
    try {
      setRows(await report.fetch({ orgId, month, groupId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בהרצת הדוח");
    } finally {
      setRunning(false);
    }
  };

  const runExport = async () => {
    if (!rows) return;
    setExporting(true);
    try {
      const orgLabel = orgsQuery.data?.find((o) => o.id === orgId)?.legal_name ?? orgId;
      exportRowsToExcel(rows, report.label, `${report.key}-${month}-${crypto.randomUUID().slice(0, 8)}.xlsx`);
      await logReportExport(report.key, { organization: orgLabel, month, group_id: groupId || null }, rows.length);
    } finally {
      setExporting(false);
    }
  };

  const columns: DataTableColumn<ReportRow>[] =
    rows && rows.length > 0
      ? Object.keys(rows[0]).map((k) => ({ key: k, header: k, render: (r: ReportRow) => (r[k] != null ? String(r[k]) : "—") }))
      : [];

  return (
    <div>
      <PageHeader title="דוחות ויצוא" description='כל יצוא נרשם ביומן הפעילות: משתמש, זמן, סוג דוח, מסננים והיקף. תצוגה מקדימה לפני יצוא בפועל.' />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 max-w-2xl">
        <div>
          <label className="field-label">סוג דוח</label>
          <select
            value={reportKey}
            onChange={(e) => {
              setReportKey(e.target.value);
              setRows(null);
            }}
            className="input-field"
          >
            {REPORTS.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">עמותה</label>
          <select value={orgId} onChange={(e) => { setOrgId(e.target.value); setGroupId(""); setRows(null); }} className="input-field">
            <option value="">— בחרי —</option>
            {(orgsQuery.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.legal_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">חודש</label>
          <input type="month" value={month.slice(0, 7)} onChange={(e) => { setMonth(e.target.value + "-01"); setRows(null); }} className="input-field" />
        </div>
        {report.needsGroup && (
          <div>
            <label className="field-label">קבוצה</label>
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="input-field" disabled={!orgId}>
              <option value="">— בחרי —</option>
              {(groupsQuery.data ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="mb-4 flex gap-2">
        <button onClick={runPreview} disabled={!orgId || running || (report.needsGroup && !groupId)} className="btn-secondary">
          {running ? "מריצה…" : "תצוגה מקדימה"}
        </button>
        {rows && (
          <button onClick={runExport} disabled={exporting} className="btn-primary flex items-center gap-2">
            <Download className="h-4 w-4" aria-hidden="true" />
            {exporting ? "מייצאת…" : `יצוא לאקסל (${rows.length} שורות)`}
          </button>
        )}
      </div>

      {error && <div className="mb-4"><ErrorState message={error} /></div>}
      {running && <LoadingState rows={4} />}
      {rows && <DataTable columns={columns} rows={rows} rowKey={(r) => String(rows.indexOf(r))} emptyTitle="אין נתונים לדוח זה" />}
    </div>
  );
}
