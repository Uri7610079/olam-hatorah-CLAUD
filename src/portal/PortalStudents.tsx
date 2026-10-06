import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, UserPlus, MessageCircleQuestion, AlertTriangle } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { ELIGIBILITY, monthLabel } from "@/lib/portalRequests";
import { portalRpc, type PortalGroup, type PortalStudent } from "./portalApi";
import { AskDialog, NewStudentDialog, StudentDialog } from "./PortalDialogs";

type Filter = "all" | "not_eligible" | "no_bank";

const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};

export function PortalStudents({ groups }: { groups: PortalGroup[] }) {
  const months = useQuery({ queryKey: ["portal-months"], queryFn: () => portalRpc<string[]>("portal_months") });
  const [picked, setPicked] = useState<string | null>(null);
  const month = picked ?? months.data?.[0] ?? currentMonth();

  const students = useQuery({
    queryKey: ["portal-students", month],
    queryFn: () => portalRpc<PortalStudent[]>("portal_students", { p_month: month }),
    enabled: !months.isLoading,
  });

  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [openStudent, setOpenStudent] = useState<PortalStudent | null>(null);
  const [askAbout, setAskAbout] = useState<PortalStudent | null>(null);
  const [adding, setAdding] = useState(false);

  const all = useMemo(() => students.data ?? [], [students.data]);
  const counts = useMemo(() => ({
    eligible: all.filter((s) => s.eligibility === "eligible").length,
    notEligible: all.filter((s) => s.eligibility === "not_eligible").length,
    noData: all.filter((s) => s.eligibility === "no_data").length,
    noBank: all.filter((s) => !s.has_bank_account).length,
  }), [all]);

  const shown = all
    .filter((s) => {
      if (filter === "not_eligible" && s.eligibility !== "not_eligible") return false;
      if (filter === "no_bank" && s.has_bank_account) return false;
      const q = search.trim();
      return !q || s.full_name.includes(q) || s.external_id.includes(q);
    })
    // שם הקבוצה בעמודה הראשונה - ולכן התלמידים של כל קבוצה מוצגים יחד
    .sort((a, b) => a.group_name.localeCompare(b.group_name, "he") || a.full_name.localeCompare(b.full_name, "he"));

  // ראש קבוצה בכמה סניפים או עמותות - שם הקבוצה לבדו לא מספיק כדי לדעת איזו
  const multiGroup = new Set(all.map((s) => s.group_id)).size > 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <label htmlFor="portal-month" className="field-label text-base">חודש</label>
          <select
            id="portal-month"
            value={month}
            onChange={(e) => setPicked(e.target.value)}
            className="input-field h-11 w-auto min-w-[12rem] text-base"
          >
            {(months.data?.length ? months.data : [month]).map((m) => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
        </div>
        <button onClick={() => setAdding(true)} className="btn-secondary flex h-11 items-center gap-2 px-4 text-base">
          <UserPlus className="h-5 w-5" aria-hidden="true" />
          הוספת תלמיד חדש
        </button>
      </div>

      {students.data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="זכאים" value={counts.eligible} tone="ok" />
          <Stat label="לא זכאים" value={counts.notEligible} tone={counts.notEligible ? "danger" : "neutral"} />
          <Stat label="אין נתון לחודש" value={counts.noData} tone="neutral" />
          <Stat label="בלי חשבון בנק" value={counts.noBank} tone={counts.noBank ? "warn" : "neutral"} />
        </div>
      )}

      {counts.notEligible > 0 && (
        <p className="flex items-start gap-2 rounded-control bg-warn-soft p-3 text-base text-warn-ink">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          {counts.notEligible === 1 ? "תלמיד אחד אינו זכאי" : `${counts.notEligible} תלמידים אינם זכאים`} ב{monthLabel(month)}.
          הסיבה מופיעה ליד כל אחד. אם משהו לא ברור - כפתור "שאלה" שולח למשרד שאלה על התלמיד.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {([
          ["all", `כולם (${all.length})`],
          ["not_eligible", `לא זכאים (${counts.notEligible})`],
          ["no_bank", `בלי חשבון בנק (${counts.noBank})`],
        ] as [Filter, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            className={`rounded-full border px-4 py-2 text-base transition ${
              filter === key ? "border-brand-500 bg-brand-50 font-semibold text-brand-700" : "border-line bg-surface text-ink-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
        <div className="relative ms-auto w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle rtl:right-3" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם או ת״ז"
            aria-label="חיפוש תלמיד"
            className="input-field h-11 ps-9 text-base"
          />
        </div>
      </div>

      {students.isLoading || months.isLoading ? (
        <p className="py-10 text-center text-ink-muted">טוען את רשימת התלמידים…</p>
      ) : students.isError ? (
        <p className="rounded-control bg-danger-soft p-4 text-danger-ink">לא ניתן לטעון את הרשימה. נסו לרענן את הדף.</p>
      ) : shown.length === 0 ? (
        <p className="card p-8 text-center text-ink-muted">{all.length === 0 ? "אין תלמידים בקבוצות שלך." : "אין תלמידים שמתאימים לסינון."}</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-base">
            <thead className="bg-surface-muted text-right text-sm text-ink-muted">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">שם קבוצה</th>
                <th className="px-4 py-3 font-semibold">שם</th>
                <th className="px-4 py-3 font-semibold">ת״ז</th>
                <th className="px-4 py-3 font-semibold">זכאות</th>
                <th className="px-4 py-3 font-semibold">סיבה</th>
                <th className="px-4 py-3"><span className="sr-only">פעולות</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.student_id} className="border-t border-line align-top">
                  <td className="whitespace-nowrap px-4 py-3">
                    {s.group_name}
                    {multiGroup && (
                      <div className="text-sm text-ink-muted">{[s.branch_name, s.organization_name].filter(Boolean).join(" · ")}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-semibold">
                    {s.full_name}
                    <div className="mt-1 flex flex-wrap gap-1.5 text-xs font-normal">
                      {!s.has_bank_account && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-warn-ink">בלי חשבון בנק</span>}
                      {s.pending_requests > 0 && <span className="rounded-full bg-info-soft px-2 py-0.5 text-info-ink">עדכון ממתין לאישור</span>}
                      {s.open_questions > 0 && <span className="rounded-full bg-info-soft px-2 py-0.5 text-info-ink">שאלה ממתינה לתשובה</span>}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">{s.external_id}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <StatusBadge severity={ELIGIBILITY[s.eligibility].severity} label={ELIGIBILITY[s.eligibility].label} />
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    {s.eligibility === "not_eligible"
                      ? s.reasons.length ? s.reasons.join(" · ") : "הסיבה טרם התקבלה מתלמוד"
                      : ""}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => setOpenStudent(s)} className="btn-secondary h-10 px-3 text-base">פרטים ועדכון</button>
                      <button onClick={() => setAskAbout(s)} className="btn-secondary flex h-10 items-center gap-1 px-3 text-base">
                        <MessageCircleQuestion className="h-4 w-4" aria-hidden="true" />
                        שאלה
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openStudent && (
        <StudentDialog
          student={openStudent}
          month={month}
          onClose={() => setOpenStudent(null)}
          onAsk={() => { setAskAbout(openStudent); setOpenStudent(null); }}
        />
      )}
      {askAbout && <AskDialog student={askAbout} month={month} onClose={() => setAskAbout(null)} />}
      {adding && <NewStudentDialog groups={groups} onClose={() => setAdding(false)} />}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "ok" | "danger" | "warn" | "neutral" }) {
  const tones = {
    ok: "bg-ok-soft text-ok-ink",
    danger: "bg-danger-soft text-danger-ink",
    warn: "bg-warn-soft text-warn-ink",
    neutral: "bg-surface text-ink",
  };
  return (
    <div className={`rounded-card border border-line p-4 ${tones[tone]}`}>
      <p className="text-sm">{label}</p>
      <p className="text-3xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
