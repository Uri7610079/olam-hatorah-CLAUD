import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CircleCheck, FileOutput } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { ExceptionGrid, type ExceptionCounter } from "@/components/ExceptionGrid";
import { LoadingState } from "@/components/LoadingState";
import { ErrorState } from "@/components/ErrorState";
import { StatusBadge } from "@/components/StatusBadge";
import { MetricCard, SectionHeader } from "@/components/MetricCard";
import { formatNumber } from "@/lib/format";
import { useIsV3 } from "@/lib/uiTheme";

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
      label: "תלמידים פעילים חסרי טלפון, חשבון בנק תקין או שיוך",
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
  const isV3 = useIsV3();

  if (isV3) return <OpsDashboardV3 counts={query.data} portal={portal.data ?? []} loading={query.isLoading} failed={query.isError} />;

  return (
    <div>
      <PageHeader title="דשבורד תפעולי" description="מונים שדורשים טיפול בפועל — כל כרטיס מוביל לרשימה המסוננת הרלוונטית. ללא תנועות בנק או סכומים רגישים." />
      {query.isLoading && <LoadingState rows={3} />}
      {query.isError && <ErrorState message="שגיאה בטעינת נתוני הדשבורד." />}
      {query.data && <ExceptionGrid items={[...buildItems(query.data), ...(portal.data ?? [])]} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ערכה v3 (שדרוג העיצוב, 2026-11): אותם מונים בדיוק, מאותן שתי שאילתות - רק סדר
// והדגשה. תור עבודה אחד ממוין לפי דחיפות, עם שורת הסבר איפה מטפלים בכל נושא;
// מונה 0 לא מקבל שורה משלו אלא מסוכם ב"תקין". "ממתינים ליצוא" יוצא מהתור לכרטיס
// נפרד: זה שלב בתהליך החודשי ולא תקלה - בתוך התור הוא נראה כמו עוד בעיה.
// הקישורים הם אותם קישורים של המסך הקודם (בלי פרמטרים שמסכי היעד לא קוראים).

interface OpsWorkItem {
  key: string;
  label: string;
  hint: string;
  count: number;
  severity: "critical" | "high" | "medium";
  href: string;
}

const WORK_ORDER = { critical: 0, high: 1, medium: 2 } as const;
const WORK_TONE = { critical: "text-danger-ink", high: "text-high-ink", medium: "text-warn-ink" } as const;

function opsWorkItems(c: OpsCounts, portal: ExceptionCounter[]): OpsWorkItem[] {
  const items: OpsWorkItem[] = [
    { key: "recurring-errors", label: "שגיאות תלמוד חוזרות", hint: "אותה שגיאה חזרה בכמה חודשים · במרכז שגיאות תלמוד", count: c.recurring_errors, severity: "critical", href: "/ops/talmud/errors" },
    {
      key: "missing-from-report",
      label: "תלמידים פעילים שלא הופיעו בדוח הזכאות האחרון",
      hint: "במסך זכאות, בלשונית \"תלמידים פעילים שלא הופיעו בדוח\"",
      count: c.active_not_in_latest_report,
      severity: "critical",
      href: "/ops/talmud/eligibility",
    },
    { key: "open-errors", label: "שגיאות תלמוד פתוחות", hint: "לתקן את הנתון ולשלוח שוב · במרכז שגיאות תלמוד", count: c.open_errors, severity: "high", href: "/ops/talmud/errors" },
    {
      key: "missing-details",
      label: "תלמידים פעילים חסרי טלפון, חשבון בנק תקין או שיוך",
      hint: "ברשימת התלמידים",
      count: c.missing_phone_bank_or_assignment,
      severity: "high",
      href: "/ops/students",
    },
    { key: "drafts", label: "תלמידים בטיוטה שטרם הושלמו", hint: "ברשימת התלמידים - סינון לפי סטטוס \"טיוטה\"", count: c.draft_students, severity: "medium", href: "/ops/students" },
    {
      key: "pending-lists",
      label: "רשימות בימות המשיח וביקורות שטרם נקלטו",
      hint: "במסך רשימות טלפוניות",
      count: c.pending_phone_lists_or_audits,
      severity: "medium",
      href: "/ops/phone-lists",
    },
  ];
  // מוני הפורטל - כמו שהגיעו (ריק כשאין הרשאה לטבלאות הפורטל)
  for (const p of portal) {
    items.push({ key: p.key, label: p.label, hint: "במסך פורטל ראשי קבוצות", count: p.count, severity: "high", href: p.href });
  }
  return items;
}

function OpsDashboardV3({ counts, portal, loading, failed }: { counts?: OpsCounts; portal: ExceptionCounter[]; loading: boolean; failed: boolean }) {
  const all = counts ? opsWorkItems(counts, portal) : [];
  const open = all.filter((i) => i.count > 0).sort((a, b) => WORK_ORDER[a.severity] - WORK_ORDER[b.severity] || b.count - a.count);
  const clear = all.filter((i) => i.count === 0);

  return (
    <div>
      <PageHeader title="דשבורד תפעולי" description="מה דורש טיפול בתפעול, מהדחוף ביותר. כל שורה מובילה לרשימה שבה מטפלים בנושא. ללא תנועות בנק או סכומים רגישים." />
      {loading && <LoadingState rows={3} />}
      {failed && <ErrorState message="שגיאה בטעינת נתוני הדשבורד." />}
      {counts && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <section className="card p-4 lg:col-span-2">
            <SectionHeader title="מה דורש טיפול" description={open.length ? `${formatNumber(open.length)} נושאים פתוחים, מהדחוף ביותר` : undefined} />
            {open.length === 0 ? (
              <p className="flex items-center gap-2 rounded-control bg-ok-soft px-3 py-2.5 text-sm text-ok-ink">
                <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                אין כרגע שום נושא פתוח בתפעול.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {open.map((i) => (
                  <li key={i.key}>
                    <Link to={i.href} className="group -mx-2 flex items-center gap-3 rounded-control px-2 py-2.5 transition hover:bg-brand-50">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-ink">{i.label}</span>
                        <span className="block text-xs text-ink-subtle">{i.hint}</span>
                      </span>
                      <span className={`tabular text-xl font-bold ${WORK_TONE[i.severity]}`}>{formatNumber(i.count)}</span>
                      <StatusBadge severity={i.severity} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {clear.length > 0 && open.length > 0 && (
              <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-subtle">
                <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" aria-hidden="true" />
                <span>תקין: {clear.map((i) => i.label).join(" · ")}</span>
              </p>
            )}
          </section>
          <div>
            <MetricCard
              label="ממתינים ליצוא לתלמוד"
              value={formatNumber(counts.ready_for_export)}
              hint="תלמידים שמוכנים לקובץ לתלמוד - שלב בתהליך, לא תקלה"
              tone="info"
              icon={FileOutput}
              href="/ops/talmud/export"
              muted={counts.ready_for_export === 0}
            />
          </div>
        </div>
      )}
    </div>
  );
}
