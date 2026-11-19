import { fetchAll } from "@/lib/fetchAll";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useLocation } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge, type Severity } from "@/components/StatusBadge";
import { LoadingState } from "@/components/LoadingState";
import { ErrorState } from "@/components/ErrorState";
import { SearchAndFilters } from "@/components/SearchAndFilters";
import { CountChips, type ChipTone } from "@/components/CountChips";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { useIsV3 } from "@/lib/uiTheme";

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
  | "talmud_row_recoverable"
  | "student_missing_data"
  | "talmud_exited_but_listed"
  | "talmud_branch_differs"
  | "bank_auto_sync_issue"
  | "bank_account_unmatched";

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
  // תלמוד = מערכת האמת (122): מה שתלמוד לא יודע, ומה שהמערכת לא משנה לבד
  student_missing_data: "חסר נתון",
  talmud_exited_but_listed: "יצא במערכת ורשום בתלמוד",
  talmud_branch_differs: "סניף שונה מתלמוד",
  // משיכה אוטומטית מהבנק: ריצה שנכשלה, או שזוהה בה פער (כולל בדיקת יתרה, 123)
  bank_auto_sync_issue: "משיכה מהבנק - נכשלה או חסרות תנועות",
  // הסקרייפר הביא חשבון שאין לו בעלים במערכת - התנועות שלו לא נקלטו (123)
  bank_account_unmatched: "חשבון בנק שאינו רשום תחת עמותה",
};

type Domain = "bank" | "talmud" | "students" | "audits" | "documents" | "masav_returns";
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
  student_missing_data: "students",
  talmud_exited_but_listed: "talmud",
  talmud_branch_differs: "talmud",
  bank_auto_sync_issue: "bank",
  bank_account_unmatched: "bank",
};
const DOMAIN_LABEL: Record<Domain, string> = {
  bank: "בנק והתאמות",
  talmud: "תלמוד",
  students: "נתוני תלמידים",
  audits: "ביקורות",
  documents: "מסמכים",
  masav_returns: 'מס"ב והחזרות',
};

// v3: סדר חומרה אמיתי. המיון בשאילתה הוא אלפביתי על הטקסט (critical, high, low,
// medium), ולכן "לידיעה" הופיע לפני "בינוני".
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITY_TEXT: Record<string, string> = { critical: "קריטי", high: "גבוה", medium: "בינוני", low: "לידיעה" };
const DOMAIN_TONE: Record<Domain, ChipTone> = {
  bank: "info",
  talmud: "warn",
  students: "neutral",
  audits: "neutral",
  documents: "neutral",
  masav_returns: "high",
};
const rankOf = (s: string) => SEVERITY_RANK[s] ?? 9;

function routeFor(areaPrefix: string, row: ExceptionRow): string {
  const type = row.exception_type;
  // חריגות על תלמיד מסוים - לכרטיס שלו, שם מזינים את הנתון או מעבירים סניף
  if (row.related_table === "students") return `/ops/students/${row.related_id}`;
  // חריגות הפער של תלמוד מובילות למסך שבו *מתקנים* אותן, לא למרכז שגיאות
  // תלמוד: מה שחסר הוא תלמיד או סניף, ושם מזינים אותם.
  // כאן לא חסר נתון - צריך להריץ את ההשלמה, והכפתור נמצא במסך זכאות.
  if (type === "talmud_row_recoverable") return "/ops/talmud/eligibility";
  if (type === "talmud_branch_missing") return "/ops/organizations";
  // החשבון נרשם בכרטיס העמותה; מצב המשיכה עצמה - במסך המשיכה האוטומטית
  if (type === "bank_account_unmatched") return "/ops/organizations";
  if (type === "bank_auto_sync_issue") return "/admin/bank-scraper";
  if (type === "talmud_student_unassigned") return "/ops/students/unassigned";
  if (type === "talmud_student_missing" || type === "talmud_students_missing_no_amount") return "/ops/students";
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
  // view בלי מזהה משלה - המיון המלא (חומרה, סוג, רשומה) הוא שמונע חפיפה בין המנות
  const data = await fetchAll(() => {
    let query = supabase.from("unified_exceptions").select("exception_type, severity, organization_id, related_table, related_id, amount, related_date, description");
    if (orgId) query = query.eq("organization_id", orgId);
    if (severity) query = query.eq("severity", severity);
    return query.order("severity").order("exception_type").order("related_id");
  });
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
  const isV3 = useIsV3();
  const [search, setSearch] = useState("");
  // v3: התחום מסונן כאן, מעל השורות שכבר נטענו (גם קודם הסינון לפי תחום היה בצד
  // לקוח, אחרי אותה שאילתה) - כדי שהצ'יפים יוכלו להראות כמה יש בכל תחום.
  const queryDomain = isV3 ? "" : domain;

  const exceptionsQuery = useQuery({
    queryKey: ["unified-exceptions", orgId, severity, queryDomain, orgsQuery.data],
    queryFn: () => fetchExceptions(orgId, severity, queryDomain, orgsQuery.data ?? []),
    enabled: !!orgsQuery.data,
  });

  // v3: חיפוש חופשי ← ספירה לפי תחום ← סינון לפי התחום שנבחר ← מיון לפי חומרה.
  // הכול מהשורות שכבר על המסך; שום שאילתה נוספת.
  const searched = useMemo(() => {
    const all = exceptionsQuery.data ?? [];
    const term = search.trim().toLowerCase();
    if (!isV3 || !term) return all;
    return all.filter((r) =>
      [r.description, TYPE_LABEL[r.exception_type], DOMAIN_LABEL[TYPE_DOMAIN[r.exception_type]], r.organization?.legal_name ?? ""]
        .some((t) => (t ?? "").toLowerCase().includes(term)),
    );
  }, [exceptionsQuery.data, search, isV3]);
  const domainChips = useMemo(() => {
    const counts = new Map<Domain, number>();
    for (const r of searched) {
      const d = TYPE_DOMAIN[r.exception_type];
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    return (Object.keys(DOMAIN_LABEL) as Domain[]).map((d) => ({ value: d, label: DOMAIN_LABEL[d], count: counts.get(d) ?? 0, tone: DOMAIN_TONE[d] }));
  }, [searched]);
  const v3Rows = useMemo(
    () =>
      searched
        .filter((r) => !domain || TYPE_DOMAIN[r.exception_type] === domain)
        .slice()
        .sort((a, b) => rankOf(a.severity) - rankOf(b.severity)),
    [searched, domain],
  );
  const severitySummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of v3Rows) counts.set(r.severity, (counts.get(r.severity) ?? 0) + 1);
    return Object.keys(SEVERITY_RANK)
      .filter((s) => counts.get(s))
      .map((s) => `${formatNumber(counts.get(s))} ${SEVERITY_TEXT[s]}`)
      .join(" · ");
  }, [v3Rows]);

  const v3Empty = <span className="text-ink-subtle">—</span>;

  const columns: DataTableColumn<ExceptionRow>[] = isV3
    ? [
        {
          key: "severity",
          header: "חומרה",
          filterValue: (r) => SEVERITY_TEXT[r.severity] ?? r.severity,
          sortValue: (r) => rankOf(r.severity),
          render: (r) => <StatusBadge severity={r.severity} />,
        },
        { key: "domain", header: "תחום", className: "whitespace-nowrap", render: (r) => DOMAIN_LABEL[TYPE_DOMAIN[r.exception_type]] },
        { key: "type", header: "סוג", className: "whitespace-nowrap", render: (r) => TYPE_LABEL[r.exception_type] },
        { key: "org", header: "עמותה", className: "whitespace-nowrap", filterValue: (r) => r.organization?.legal_name ?? "", render: (r) => r.organization?.legal_name ?? v3Empty },
        { key: "desc", header: "פירוט", grow: true, render: (r) => r.description },
        {
          key: "date",
          header: "תאריך",
          className: "tabular whitespace-nowrap",
          filterValue: (r) => (r.related_date ? formatDate(r.related_date) : ""),
          sortValue: (r) => r.related_date ?? "",
          render: (r) => (r.related_date ? formatDate(r.related_date) : v3Empty),
        },
        {
          key: "amount",
          header: "סכום",
          kind: "money",
          className: "whitespace-nowrap",
          filterValue: (r) => (r.amount != null ? formatMoney(r.amount) : ""),
          sortValue: (r) => r.amount ?? null,
          render: (r) => (r.amount != null ? formatMoney(r.amount) : v3Empty),
        },
      ]
    : [
        { key: "severity", header: "חומרה", render: (r) => <StatusBadge severity={r.severity} /> },
        { key: "domain", header: "תחום", className: "whitespace-nowrap", render: (r) => DOMAIN_LABEL[TYPE_DOMAIN[r.exception_type]] },
        { key: "type", header: "סוג", className: "whitespace-nowrap", render: (r) => TYPE_LABEL[r.exception_type] },
        { key: "org", header: "עמותה", className: "whitespace-nowrap", render: (r) => r.organization?.legal_name ?? "—" },
        // הפירוט הוא הטקסט היחיד באורך משתנה כאן, ולכן הוא שמקבל את הרוחב הפנוי
        { key: "desc", header: "פירוט", grow: true, render: (r) => r.description },
        { key: "date", header: "תאריך", className: "tabular", render: (r) => r.related_date ?? "—" },
        { key: "amount", header: "סכום", className: "tabular", render: (r) => (r.amount != null ? r.amount.toLocaleString("he-IL") : "—") },
      ];

  return (
    <div>
      <PageHeader title="מרכז חריגות" description='כל החריגות הפתוחות מכל תחומי המערכת במקום אחד. לחיצה על שורה מובילה למסך שבו מטפלים בה בפועל - זה לא מודול משימות בפני עצמו.' />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3 max-w-2xl">
        <div>
          <label htmlFor="exc-org" className="field-label">עמותה</label>
          <select id="exc-org" value={orgId} onChange={(e) => setOrgId(e.target.value)} className="input-field">
            <option value="">— הכול —</option>
            {(orgsQuery.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.legal_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="exc-severity" className="field-label">חומרה</label>
          <select id="exc-severity" value={severity} onChange={(e) => setSeverity(e.target.value)} className="input-field">
            <option value="">— הכול —</option>
            <option value="critical">קריטי</option>
            <option value="high">גבוה</option>
            <option value="medium">בינוני</option>
            <option value="low">לידיעה</option>
          </select>
        </div>
        {/* v3: התחום נבחר בצ'יפים שמעל הטבלה (עם ספירה), ולכן הרשימה הנפתחת לא מוצגת */}
        {!isV3 && (
          <div>
            <label htmlFor="exc-domain" className="field-label">תחום</label>
            <select id="exc-domain" value={domain} onChange={(e) => setDomain(e.target.value)} className="input-field">
              <option value="">— הכול —</option>
              {(Object.keys(DOMAIN_LABEL) as Domain[]).map((d) => (
                <option key={d} value={d}>
                  {DOMAIN_LABEL[d]}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* בלי רשימת העמותות שאילתת החריגות לא רצה בכלל, והמסך הציג "אין חריגות" - מטעה */}
      {orgsQuery.isError && <div className="mb-4"><ErrorState message="שגיאה בטעינת רשימת העמותות, ולכן החריגות לא נטענו." /></div>}
      {exceptionsQuery.isError && <div className="mb-4"><ErrorState message="שגיאה בטעינת מרכז החריגות." /></div>}
      {orgsQuery.isError ? null : exceptionsQuery.isLoading ? (
        <LoadingState rows={5} />
      ) : isV3 ? (
        <>
          <SearchAndFilters searchValue={search} onSearchChange={setSearch} searchPlaceholder="חיפוש בפירוט, בסוג או בשם העמותה…" />
          {(exceptionsQuery.data ?? []).length > 0 && (
            <CountChips
              ariaLabel="סינון לפי תחום"
              chips={domainChips}
              active={domain || null}
              onSelect={(v) => setDomain(v ?? "")}
              total={searched.length}
              allLabel="כל התחומים"
            />
          )}
          {severitySummary && (
            <p className="mb-2 text-sm text-ink-muted">
              בתצוגה: <span className="tabular font-semibold text-ink">{formatNumber(v3Rows.length)}</span> חריגות · {severitySummary}
            </p>
          )}
          <DataTable
            columns={columns}
            rows={v3Rows}
            rowKey={(r) => `${r.exception_type}-${r.related_id}`}
            emptyTitle={search.trim() || domain ? "אין חריגות שמתאימות לחיפוש" : "אין חריגות פתוחות"}
            emptyIcon={AlertTriangle}
            onRowClick={(r) => navigate(routeFor(areaPrefix, r))}
          />
        </>
      ) : (
        <DataTable
          columns={columns}
          rows={exceptionsQuery.data ?? []}
          rowKey={(r) => `${r.exception_type}-${r.related_id}`}
          emptyTitle="אין חריגות פתוחות"
          emptyIcon={AlertTriangle}
          onRowClick={(r) => navigate(routeFor(areaPrefix, r))}
        />
      )}
    </div>
  );
}
