import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useLocation } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge, type Severity } from "@/components/StatusBadge";
import { LoadingState } from "@/components/LoadingState";
import { ErrorState } from "@/components/ErrorState";

interface OrgOption {
  id: string;
  legal_name: string;
}

type ExceptionType =
  | "masav_transmitted_no_match"
  | "masav_transaction_no_batch"
  | "donation_no_bank_match"
  | "credit_suspected_donation"
  | "unidentified_debit"
  | "talmud_error"
  | "audit_attendance"
  | "document_expiry"
  | "payment_return_open"
  | "masav_needs_correction"
  | "talmud_student_missing"
  | "talmud_student_unassigned"
  | "talmud_branch_missing"
  | "talmud_students_missing_no_amount"
  | "talmud_row_recoverable";

interface ExceptionRow {
  exception_type: ExceptionType;
  severity: Severity;
  organization_id: string;
  related_table: string;
  related_id: string;
  amount: number | null;
  related_date: string | null;
  description: string;
  organization: { legal_name: string } | null;
}

const TYPE_LABEL: Record<ExceptionType, string> = {
  masav_transmitted_no_match: 'מס"ב שודר ללא התאמה',
  masav_transaction_no_batch: 'תנועת בנק מסווגת כמס"ב ללא אצווה',
  donation_no_bank_match: "תרומה ללא תנועת בנק תואמת",
  credit_suspected_donation: "תנועת זכות חשודה כתרומה",
  unidentified_debit: "חיוב לא מזוהה",
  talmud_error: "שגיאת תלמוד",
  audit_attendance: "חוסר בביקורת משרד החינוך",
  document_expiry: "תוקף מסמך מתקרב/פג",
  payment_return_open: "החזרת תשלום פתוחה",
  masav_needs_correction: 'אצוות מס"ב דורשת תיקון',
  // ארבעת אלה מסבירים את הפער בין הסכום שבדוח תלמוד לסכום שנקלט בפועל.
  // עד שנוספו, הפער היה גלוי רק בכרטיס שלפני הקליטה ונעלם אחריו.
  talmud_student_missing: "תלמיד בדוח תלמוד שאינו במערכת",
  talmud_student_unassigned: "תלמיד ללא שיוך לסניף/קבוצה",
  talmud_branch_missing: "סניף בדוח תלמוד שאינו במערכת",
  talmud_students_missing_no_amount: "תלמידים חסרים ללא זכאות החודש",
  // הנתונים תוקנו מאז הקליטה, ולכן התלמיד כבר אינו "חסר" - אבל הכסף שלו
  // לא נזקף, כי הקליטה כבר רצה. בלי השורה הזו הפער בלתי נראה לחלוטין.
  talmud_row_recoverable: "זכאות שנדחתה וניתן להשלים",
};

type Domain = "bank" | "talmud" | "audits" | "documents" | "masav_returns";
const TYPE_DOMAIN: Record<ExceptionType, Domain> = {
  masav_transmitted_no_match: "bank",
  masav_transaction_no_batch: "bank",
  donation_no_bank_match: "bank",
  credit_suspected_donation: "bank",
  unidentified_debit: "bank",
  talmud_error: "talmud",
  audit_attendance: "audits",
  document_expiry: "documents",
  payment_return_open: "masav_returns",
  masav_needs_correction: "masav_returns",
  talmud_student_missing: "talmud",
  talmud_student_unassigned: "talmud",
  talmud_branch_missing: "talmud",
  talmud_students_missing_no_amount: "talmud",
  talmud_row_recoverable: "talmud",
};
const DOMAIN_LABEL: Record<Domain, string> = {
  bank: "בנק והתאמות",
  talmud: "תלמוד",
  audits: "ביקורות",
  documents: "מסמכים",
  masav_returns: 'מס"ב והחזרות',
};

function routeFor(areaPrefix: string, type: ExceptionType): string {
  // חריגות הפער של תלמוד מובילות למסך שבו *מתקנים* אותן, לא למרכז שגיאות
  // תלמוד: מה שחסר הוא תלמיד או סניף, ושם מזינים אותם.
  // כאן לא חסר נתון - צריך להריץ את ההשלמה, והכפתור נמצא במסך זכאות.
  if (type === "talmud_row_recoverable") return "/ops/talmud/eligibility";
  if (type === "talmud_branch_missing") return "/ops/branches-groups";
  if (type === "talmud_student_missing" || type === "talmud_student_unassigned"
      || type === "talmud_students_missing_no_amount") return "/ops/students";
  const domain = TYPE_DOMAIN[type];
  if (domain === "bank") return "/finance/bank-matching";
  if (domain === "talmud") return "/ops/talmud/errors";
  if (domain === "audits") return "/ops/audits";
  if (domain === "documents") return `${areaPrefix}/documents`;
  if (domain === "masav_returns") return "/finance/masav";
  return areaPrefix;
}

async function fetchOrgs(): Promise<OrgOption[]> {
  const { data, error } = await supabase.from("organizations").select("id, legal_name").eq("status", "active").order("legal_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchExceptions(orgId: string, severity: string, domain: string, orgs: OrgOption[]): Promise<ExceptionRow[]> {
  // unified_exceptions הוא view (לא טבלה) - ל-PostgREST אין FK אמיתי להסיק ממנו embed
  // אל organizations, אז שם העמותה נפתר בצד לקוח מרשימת העמותות שכבר טעונה לפילטר.
  let query = supabase.from("unified_exceptions").select("exception_type, severity, organization_id, related_table, related_id, amount, related_date, description");
  if (orgId) query = query.eq("organization_id", orgId);
  if (severity) query = query.eq("severity", severity);
  const { data, error } = await query.order("severity");
  if (error) throw error;
  const orgById = new Map(orgs.map((o) => [o.id, o.legal_name]));
  let rows: ExceptionRow[] = (data ?? []).map((r) => ({ ...r, organization: orgById.has(r.organization_id) ? { legal_name: orgById.get(r.organization_id)! } : null }));
  if (domain) rows = rows.filter((r) => TYPE_DOMAIN[r.exception_type as ExceptionType] === domain);
  return rows;
}

// מסך משותף - מותקן גם תחת /ops/exceptions וגם /finance/exceptions (אותו קומפוננט,
// לא שני מסכים נפרדים). "אין להפוך אותו למודול משימות כללי" באפיון - לכן אין כאן שום
// עדכון סטטוס עצמאי; כל שורה רק מציגה את הסטטוס האמיתי של הרשומה שלה ומקשרת למסך
// שבו מטפלים בה בפועל (RLS על unified_exceptions כבר מגביל כל משתמש למה שמותר לו).
export function ExceptionsCenterScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const areaPrefix = location.pathname.startsWith("/finance") ? "/finance" : "/ops";
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });

  const [orgId, setOrgId] = useState("");
  const [severity, setSeverity] = useState("");
  const [domain, setDomain] = useState("");

  const exceptionsQuery = useQuery({
    queryKey: ["unified-exceptions", orgId, severity, domain, orgsQuery.data],
    queryFn: () => fetchExceptions(orgId, severity, domain, orgsQuery.data ?? []),
    enabled: !!orgsQuery.data,
  });

  const columns: DataTableColumn<ExceptionRow>[] = [
    { key: "severity", header: "חומרה", render: (r) => <StatusBadge severity={r.severity} /> },
    { key: "domain", header: "תחום", render: (r) => DOMAIN_LABEL[TYPE_DOMAIN[r.exception_type]] },
    { key: "type", header: "סוג", render: (r) => TYPE_LABEL[r.exception_type] },
    { key: "org", header: "עמותה", render: (r) => r.organization?.legal_name ?? "—" },
    { key: "desc", header: "פירוט", render: (r) => r.description },
    { key: "date", header: "תאריך", className: "tabular", render: (r) => r.related_date ?? "—" },
    { key: "amount", header: "סכום", className: "tabular", render: (r) => (r.amount != null ? r.amount.toLocaleString("he-IL") : "—") },
  ];

  return (
    <div>
      <PageHeader title="מרכז חריגות" description='כל החריגות הפתוחות מכל תחומי המערכת במקום אחד. לחיצה על שורה מובילה למסך שבו מטפלים בה בפועל - זה לא מודול משימות בפני עצמו.' />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3 max-w-2xl">
        <div>
          <label className="field-label">עמותה</label>
          <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className="input-field">
            <option value="">— הכול —</option>
            {(orgsQuery.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.legal_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">חומרה</label>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="input-field">
            <option value="">— הכול —</option>
            <option value="critical">קריטי</option>
            <option value="high">גבוה</option>
            <option value="medium">בינוני</option>
          </select>
        </div>
        <div>
          <label className="field-label">תחום</label>
          <select value={domain} onChange={(e) => setDomain(e.target.value)} className="input-field">
            <option value="">— הכול —</option>
            {(Object.keys(DOMAIN_LABEL) as Domain[]).map((d) => (
              <option key={d} value={d}>
                {DOMAIN_LABEL[d]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {exceptionsQuery.isError && <div className="mb-4"><ErrorState message="שגיאה בטעינת מרכז החריגות." /></div>}
      {exceptionsQuery.isLoading ? (
        <LoadingState rows={5} />
      ) : (
        <DataTable
          columns={columns}
          rows={exceptionsQuery.data ?? []}
          rowKey={(r) => `${r.exception_type}-${r.related_id}`}
          emptyTitle="אין חריגות פתוחות"
          emptyIcon={AlertTriangle}
          onRowClick={(r) => navigate(routeFor(areaPrefix, r.exception_type))}
        />
      )}
    </div>
  );
}
