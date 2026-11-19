import { todayLocalIso } from "@/lib/today";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, CircleCheck, Landmark, Scale, Undo2, HandCoins, Send, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useLastSelected } from "@/lib/useLastSelected";
import { PageHeader } from "@/components/PageHeader";
import { MonthField } from "@/components/MonthField";
import { LoadingState } from "@/components/LoadingState";
import { ErrorState } from "@/components/ErrorState";
import { StatusBadge, type Severity } from "@/components/StatusBadge";
import { MetricCard, SectionHeader } from "@/components/MetricCard";
import { formatMoney, formatMonth, formatNumber } from "@/lib/format";
import { BankStatusCard } from "./BankStatusCard";
import { fetchFinanceCounts, fetchOrgs, PERIOD_STATUS_LABEL, type ChecklistItem, type FinanceCounts } from "./FinanceDashboard";

// דשבורד כספי בערכה v3 (שלב ג' של שדרוג העיצוב, 2026-11).
//
// אותן שאילתות בדיוק כמו המסך הקודם (get_finance_dashboard_counts,
// get_month_close_checklist, BankStatusCard) - שום מספר חדש לא מחושב כאן.
// מה שהשתנה הוא הסדר: הקשר (עמותה, חודש, מצב החודש) ← סיכום הכסף ← מה דורש
// טיפול ← סגירת החודש והבנק. ומה שהוסר: כרטיס 90/10 שהיה תמיד 0 (הנוסחה כבויה
// עד אישור), כי אפס קבוע בדשבורד נקרא כמדד.

const PERIOD_SEVERITY: Record<string, Severity> = { open: "ok", in_review: "medium", closed: "neutral" };

interface WorkItem {
  key: string;
  label: string;
  hint: string;
  count: number;
  severity: Extract<Severity, "critical" | "high" | "medium">;
  href: string;
  icon: typeof Wallet;
}

// תור העבודה: אותם שישה מונים של ExceptionGrid, ממוינים לפי חומרה. מונה 0 לא מקבל
// שורה משלו - הוא מסוכם בשורה אחת "תקין", כדי שהעין תגיע ישר למה שפתוח.
function workItems(c: FinanceCounts, orgId: string): WorkItem[] {
  const items: WorkItem[] = [
    { key: "unclassified", label: "תנועות בנק לא מסווגות", hint: "צריך לסווג או לאשר הצעת סיווג", count: c.unclassified_transactions, severity: "critical", href: `/finance/bank-transactions?org=${orgId}`, icon: ArrowLeftRight },
    { key: "bank-exceptions", label: "חריגות בהתאמת הבנק", hint: "תנועה שלא נמצאה לה התאמה", count: c.open_bank_exceptions, severity: "critical", href: `/finance/bank-matching?org=${orgId}`, icon: Scale },
    { key: "masav-not-completed", label: "מס\"ב ששודר וטרם סומן כבוצע", hint: "לסמן אחרי שהכסף יצא מהבנק", count: c.masav_transmitted_not_completed_count, severity: "high", href: `/finance/bank-matching?org=${orgId}`, icon: Send },
    { key: "returns", label: "תשלומים שחזרו", hint: "לתקן פרטים ולשלוח שוב", count: c.open_returns, severity: "high", href: `/finance/returns?org=${orgId}`, icon: Undo2 },
    { key: "masav-in-process", label: "אצוות מס\"ב בהכנה", hint: "טרם שודרו לבנק", count: c.masav_in_process_count, severity: "medium", href: `/finance/masav?org=${orgId}`, icon: Landmark },
    { key: "donations", label: "תרומות ממתינות או לא משויכות", hint: "לשייך לקבוצה או לאשר", count: c.unassigned_donations, severity: "medium", href: `/finance/donations?org=${orgId}`, icon: HandCoins },
  ];
  return items;
}

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2 } as const;
const COUNT_TONE = { critical: "text-danger-ink", high: "text-high-ink", medium: "text-warn-ink" } as const;

function WorkQueue({ counts, orgId }: { counts: FinanceCounts; orgId: string }) {
  const all = workItems(counts, orgId);
  const open = all.filter((i) => i.count > 0).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count);
  const clear = all.filter((i) => i.count === 0);

  return (
    <section className="card p-4">
      <SectionHeader title="מה דורש טיפול" description={open.length ? `${open.length} נושאים פתוחים, מהדחוף ביותר` : undefined} />
      {open.length === 0 ? (
        <p className="flex items-center gap-2 rounded-control bg-ok-soft px-3 py-2.5 text-sm text-ok-ink">
          <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          אין שום דבר פתוח לחודש הזה.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {open.map((i) => (
            <li key={i.key}>
              <Link
                to={i.href}
                className="group -mx-2 flex items-center gap-3 rounded-control px-2 py-2.5 transition hover:bg-brand-50"
              >
                <i.icon className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">{i.label}</span>
                  <span className="block text-xs text-ink-subtle">{i.hint}</span>
                </span>
                <span className={`tabular text-xl font-bold ${COUNT_TONE[i.severity]}`}>{formatNumber(i.count)}</span>
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
  );
}

// סגירת החודש: אותן בדיקות שהסגירה מריצה, עכשיו גם כהתקדמות - "7 מתוך 10 עוברות".
// המספרים מגיעים מ-get_month_close_checklist כמו קודם; הפס רק מצייר אותם.
function MonthCloseProgress({ orgId, month, periodStatus }: { orgId: string; month: string; periodStatus: string | null }) {
  const q = useQuery({
    queryKey: ["month-close-checklist", orgId, month],
    enabled: !!orgId && periodStatus !== "closed",
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_month_close_checklist", { p_organization_id: orgId, p_month: month });
      if (error) throw error;
      return (data ?? []) as ChecklistItem[];
    },
  });

  if (periodStatus === "closed") {
    return (
      <section className="card p-4">
        <SectionHeader title="סגירת החודש" />
        <p className="text-sm text-ink-muted">החודש סגור.</p>
      </section>
    );
  }
  if (q.isError || !q.data) return null;

  const total = q.data.length;
  const open = q.data.filter((i) => i.open_count > 0);
  const passed = total - open.length;
  const pct = total ? Math.round((passed / total) * 100) : 0;

  return (
    <section className="card p-4">
      <SectionHeader
        title="סגירת החודש"
        action={
          <Link to="/finance/months" className="link-action text-sm">
            לחודשים הכספיים
          </Link>
        }
      />
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-ink">{open.length ? `${passed} מתוך ${total} בדיקות עוברות` : "החודש מוכן לסגירה"}</span>
        <span className="tabular text-ink-subtle">{pct}%</span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={passed}
        aria-label="בדיקות סגירת חודש שעוברות"
      >
        <div className={`h-full rounded-full ${open.length ? "bg-accent" : "bg-ok"}`} style={{ width: `${pct}%` }} />
      </div>
      {open.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">כל הבדיקות עוברות. הסגירה עצמה נעשית בלחיצה אחת במסך החודשים.</p>
      ) : (
        <ul className="mt-3 space-y-1.5 text-sm">
          {open.map((i) => (
            <li key={i.item_key} className="flex justify-between gap-3">
              <span className="text-ink">{i.label_he}</span>
              <span className="tabular font-semibold text-warn-ink">{formatNumber(i.open_count)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function FinanceDashboardV3() {
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });
  const [orgId, setOrgId] = useLastSelected<string>("last-org", "");
  const [month, setMonth] = useState(() => todayLocalIso().slice(0, 7) + "-01");
  const countsQuery = useQuery({ queryKey: ["finance-dashboard-counts", orgId, month], queryFn: () => fetchFinanceCounts(orgId, month), enabled: !!orgId });
  const c = countsQuery.data;
  const status = c?.period_status ?? null;

  return (
    <div>
      <PageHeader title="דשבורד כספי" description="מצב החודש של עמותה אחת: כמה כסף, מה פתוח, ומה עוד חוסם את סגירת החודש." />

      {/* שכבה 1 - הקשר: על איזו עמותה ואיזה חודש מסתכלים, ובאיזה מצב החודש */}
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-72">
          <label htmlFor="fin-org" className="field-label">
            עמותה
          </label>
          <select id="fin-org" value={orgId} onChange={(e) => setOrgId(e.target.value)} className="input-field">
            <option value="">— בחירת עמותה —</option>
            {(orgsQuery.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.legal_name}
              </option>
            ))}
          </select>
        </div>
        <div className="w-full sm:w-52">
          <MonthField id="finance-month" value={month} onChange={setMonth} />
        </div>
        {c && (
          <div className="flex items-center gap-2 pb-2 text-sm text-ink-muted">
            <span>{formatMonth(month)}:</span>
            <StatusBadge severity={status ? PERIOD_SEVERITY[status] ?? "neutral" : "neutral"} label={status ? `חודש ${PERIOD_STATUS_LABEL[status] ?? status}` : "החודש טרם נפתח"} />
          </div>
        )}
      </div>

      {!orgId && <p className="text-sm text-ink-muted">בוחרים עמותה כדי לראות את מצב החודש.</p>}
      {countsQuery.isLoading && <LoadingState rows={3} />}
      {countsQuery.isError && <ErrorState message="שגיאה בטעינת נתוני הדשבורד." />}

      {c && (
        <>
          {/* שכבה 2 - תמונת מצב: הכסף של החודש */}
          <section className="mb-6">
            <SectionHeader title="הכסף של החודש" description="אחרי חישוב העמלות. לחיצה על כרטיס פותחת את הרשימה שממנה הוא נגזר." />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard label="ברוטו" value={formatMoney(c.gross_amount, { whole: true })} tone="primary" muted={!c.gross_amount} href="/finance/months" />
              <MetricCard label="עמלה" value={formatMoney(c.commission_amount, { whole: true })} tone="primary" muted={!c.commission_amount} href="/finance/commission-rules" />
              <MetricCard
                label="נטו לחלוקה"
                value={formatMoney(c.net_amount, { whole: true })}
                tone="accent"
                emphasis
                muted={!c.net_amount}
                href={`/finance/distributions?org=${orgId}`}
              />
              <MetricCard
                label="התחייבות לקבוצות"
                value={formatMoney(c.group_commitment_total, { whole: true })}
                tone="primary"
                muted={!c.group_commitment_total}
                hint="יתרת ספר התנועות"
                href="/finance/group-balances"
              />
            </div>

            {/* זכאות שנקלטה מתלמוד ועוד לא חושבה: לפני החישוב ברוטו/עמלה/נטו הם 0 גם
                כשיש מאות אלפי שקלים - בלי ההסבר הזה האפס נקרא ככשל קליטה. */}
            {c.uncalculated_eligibility_amount > 0 ? (
              <div className="mt-3 flex flex-wrap items-start gap-x-4 gap-y-1 rounded-card border border-warn/40 bg-warn-soft px-4 py-3">
                <p className="text-sm font-semibold text-warn-ink">
                  זכאות מתלמוד שטרם חושבה: <span className="tabular">{formatMoney(c.uncalculated_eligibility_amount)}</span>
                  <span className="font-normal"> · {formatNumber(c.uncalculated_eligibility_count)} שורות</span>
                </p>
                <p className="text-sm text-ink-muted">
                  הסכום הזה עוד לא נכלל בברוטו, בעמלה ובנטו. החישוב רץ לבד אחרי הקליטה. אם הוא נשאר כאן, החודש בבדיקה או סגור, או
                  שהחישוב האוטומטי כבוי (ניהול ← הגדרות).
                </p>
              </div>
            ) : (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-subtle">
                <CircleCheck className="h-3.5 w-3.5 text-ok" aria-hidden="true" />
                כל הזכאות שנקלטה לחודש הזה כבר חושבה.
              </p>
            )}
          </section>

          {/* שכבה 3 - סביבת עבודה: מה פתוח, וסגירת החודש והבנק לצדו */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <WorkQueue counts={c} orgId={orgId} />
            <div className="space-y-4">
              <MonthCloseProgress orgId={orgId} month={month} periodStatus={status} />
              <BankStatusCard orgId={orgId} month={month} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
