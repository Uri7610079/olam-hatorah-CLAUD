import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, CloudDownload, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { hashFile, parseImportFile } from "@/lib/importParsing";
import { detectImportType, type DetectionCandidate } from "@/lib/importDetection";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { findExistingImport } from "./FolderInboxPanel";
import { TalmudAutoImportPanel } from "@/areas/ops/talmud/TalmudAutoImportPanel";
import { STORED_REPORT_KEYS, nonEntitlementToErrorsFile, type StoredReportKey } from "@/lib/talmudReports";
import { useIsV3 } from "@/lib/uiTheme";
import { formatMonth } from "@/lib/format";

// "קבצים מתלמוד": הדוחות שירדו במשיכה מתלמוד (מיגרציה 118), מזוהים ומוכנים לקליטה.
// כמו "קבצים מהתיקייה" - הזיהוי והניתוב אוטומטיים, והקליטה עצמה עוברת במסך היבוא
// הרגיל עם תצוגה מקדימה ואישור. קובץ שכבר נקלט (אותה טביעה) מסומן ולא נקלט שוב.

interface PulledFile {
  id: string;
  organization_id: string;
  legal_name: string;
  report_key: string;
  report_label: string;
  month: string | null;
  file_name: string;
  file_type: string | null;
  file_hash: string;
  created_at: string;
}

type FileState =
  | { kind: "imported" }
  | { kind: "detected"; candidate: DetectionCandidate; rowCount: number }
  | { kind: "unknown" }
  | { kind: "mismatch"; label: string }
  | { kind: "unreadable"; message: string };

interface Entry { pulled: PulledFile; file: File; state: FileState }

// כל דוח מתלמוד צריך להיות מזוהה כסוג שלו. זיהוי אחר = משהו השתנה בתלמוד, ולא שולחים לקליטה.
const EXPECTED: Record<string, string> = {
  payment_demand: "talmud_eligibility",
  students_list: "talmud_eligibility_list",
  non_entitlement: "talmud_non_entitlement",
  institute_payments: "talmud_institute_payments",
  bagatz: "talmud_bagatz",
  payment_explanation: "talmud_payment_explanation",
};

const monthText = (iso: string | null) => (iso ? iso.slice(0, 7).split("-").reverse().join("/") : "");

async function loadEntries(): Promise<Entry[]> {
  const { data, error } = await supabase.rpc("talmud_pulled_files_list", { p_job_id: null });
  if (error) throw error;
  // אישורי לימודים הם PDF לתלמיד - לא קובץ לקליטה
  // אותו קובץ בדיוק משתי משיכות - פעם אחת (הרשימה מהחדש לישן)
  const seen = new Set<string>();
  const pulled = ((data ?? []) as PulledFile[])
    .filter((f) => f.report_key !== "study_approval" && !seen.has(f.file_hash) && seen.add(f.file_hash))
    .slice(0, 60);
  const out: Entry[] = [];
  for (const p of pulled) {
    const { data: rows, error: e2 } = await supabase.rpc("talmud_pulled_file", { p_file_id: p.id });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (e2 || !row) continue;
    const bytes = Uint8Array.from(atob(row.file_base64), (c) => c.charCodeAt(0));
    const file = new File([bytes], p.file_name, { type: p.file_type ?? "" });
    let state: FileState;
    if (await findExistingImport(await hashFile(file))) {
      state = { kind: "imported" };
    } else {
      try {
        const parsed = await parseImportFile(file);
        const detection = detectImportType(parsed.headers, parsed.rows.length);
        const top = detection.candidates[0];
        const expected = EXPECTED[p.report_key];
        state = !top ? { kind: "unknown" }
          : expected && top.signature.key !== expected ? { kind: "mismatch", label: top.signature.label }
          : { kind: "detected", candidate: top, rowCount: detection.rowCount };
      } catch (e) {
        state = { kind: "unreadable", message: e instanceof Error ? e.message : "שגיאה" };
      }
    }
    out.push({ pulled: p, file, state });
  }
  return out;
}

type RouteMeta = { orgId?: string | null; month?: string | null; reportKey?: string | null };
const isStored = (key: string): key is StoredReportKey => (STORED_REPORT_KEYS as string[]).includes(key);

export function TalmudFilesPanel({ onRouteToTab }: { onRouteToTab: (tab: string, file: File, meta?: RouteMeta) => void }) {
  const navigate = useNavigate();
  const isV3 = useIsV3();
  // v3: חודש במילים ("נובמבר 2026") במקום 11/2026
  const month = (iso: string | null) => (isV3 ? (iso ? formatMonth(iso) : "") : monthText(iso));
  const query = useQuery({ queryKey: ["talmud-files-for-import"], queryFn: loadEntries });

  if (query.isLoading) {
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> בודק את הקבצים שירדו מתלמוד…</p>
        <LoadingState rows={3} />
      </div>
    );
  }
  if (query.isError) return <ErrorState message={(query.error as Error).message} />;
  if (!query.data?.length) {
    return (
      <EmptyState
        icon={CloudDownload}
        title="עוד לא ירדו קבצים מתלמוד"
        description='במסך "משיכה מתלמוד" לוחצים "משיכה לעמותה זו", והקבצים יופיעו כאן לקליטה.'
        action={<button onClick={() => navigate("/ops/talmud/pull")} className="btn-primary">למשיכה מתלמוד</button>}
      />
    );
  }

  const go = async (entry: Entry) => {
    if (entry.state.kind !== "detected") return;
    const meta = { orgId: entry.pulled.organization_id, month: entry.pulled.month };
    // סיבות אי זכאות → מרכז השגיאות: אותו קובץ בצורה שקליטת השגיאות מכירה
    if (entry.pulled.report_key === "non_entitlement") {
      onRouteToTab("errors", await nonEntitlementToErrorsFile(entry.file), meta);
      return;
    }
    // תשלומים למוסד / בג"ץ / הסבר תשלומים → הקליטה החדשה (מיגרציה 121)
    if (isStored(entry.pulled.report_key)) {
      onRouteToTab("talmudReport", entry.file, { ...meta, reportKey: entry.pulled.report_key });
      return;
    }
    const target = entry.state.candidate.signature.target;
    if (target.kind === "import-center-tab") onRouteToTab(target.tab, entry.file, meta);
    else navigate(target.path);
  };
  const importable = (entry: Entry) => entry.state.kind === "detected"
    && (entry.pulled.report_key === "non_entitlement" || isStored(entry.pulled.report_key) || entry.state.candidate.signature.target.kind === "import-center-tab");

  // רשימת התלמידים קודם (מיגרציה 122): היא יוצרת את התלמידים החסרים, ורק אחריה
  // דרישת התשלום - כדי שהכסף של תלמיד חדש לא יידחה כ"תלמיד שאינו במערכת".
  const order = (k: string) => (k === "students_list" ? 0 : k === "payment_demand" ? 1 : 2);
  const pending = query.data.filter((e) => e.state.kind !== "imported")
    .sort((a, b) => order(a.pulled.report_key) - order(b.pulled.report_key));
  const imported = query.data.filter((e) => e.state.kind === "imported");

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        הקבצים שירדו במשיכה מתלמוד, מזוהים לפי התוכן. "המשך ליבוא" פותח את מסך הקליטה המתאים עם הקובץ כבר בפנים - שם
        בודקים את התצוגה המקדימה ומאשרים. קובץ שכבר נקלט מסומן ולא ייקלט פעמיים.
        מתחילים ב"רשימת תלמידים": היא פותחת כרטיס לכל תלמיד שרשום בתלמוד ואינו במערכת, ומעדכנת את הפרטים של הקיימים לפי תלמוד.
      </p>

      {pending.length > 0 && <TalmudAutoImportPanel jobId={null} auto={false} />}

      {pending.length === 0 && (
        <p className="flex items-center gap-1.5 rounded-control border border-line bg-surface-muted p-2.5 text-sm text-ink-muted">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
          כל הקבצים שירדו כבר נקלטו.
        </p>
      )}

      <div className="grid gap-2.5 lg:grid-cols-2">
        {pending.map((entry) => (
          <div key={entry.pulled.id} className="card space-y-2 p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{entry.pulled.report_label}</span>
              <span className="text-sm text-ink-muted">· {entry.pulled.legal_name}{entry.pulled.month ? ` · ${month(entry.pulled.month)}` : ""}</span>
            </div>
            {entry.state.kind === "detected" && (
              <>
                <p className="text-sm text-ink-muted">
                  זוהה כ<span className="font-semibold text-ink">{entry.state.candidate.signature.label}</span>
                  <span className="text-ink-subtle"> · {entry.state.rowCount} שורות</span>
                </p>
                {/* v3: הפעולה הראשית במסך היא "קליטה אוטומטית של כל הקבצים"; כפתורי הקבצים הבודדים משניים */}
                {importable(entry) ? (
                  <button onClick={() => void go(entry)} className={isV3 ? "btn-secondary text-xs" : "btn-primary text-xs"}>
                    {entry.pulled.report_key === "non_entitlement" ? "המשך ליבוא (למרכז השגיאות)" : "המשך ליבוא"}
                  </button>
                ) : entry.state.candidate.signature.target.kind === "route" ? (
                  <p className="text-xs text-ink-subtle">{entry.state.candidate.signature.target.hint}</p>
                ) : null}
              </>
            )}
            {entry.state.kind === "mismatch" && (
              <p className="flex items-start gap-1.5 text-xs text-warn-ink">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                הקובץ זוהה כ"{entry.state.label}" ולא כמו שהדוח הזה אמור להיות - לא נשלח לקליטה. משיכה חדשה תוריד אותו בפורמט הנכון.
              </p>
            )}
            {(entry.state.kind === "unknown" || entry.state.kind === "unreadable") && (
              <p className="flex items-start gap-1.5 text-xs text-warn-ink">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {entry.state.kind === "unknown" ? "לא זוהה סוג הקובץ" : `לא ניתן לקרוא: ${entry.state.message}`}
              </p>
            )}
          </div>
        ))}
      </div>

      {imported.length > 0 && (
        <p className="text-xs text-ink-subtle">
          כבר נקלטו: {imported.map((e) => `${e.pulled.report_label} (${e.pulled.legal_name}${e.pulled.month ? ` ${month(e.pulled.month)}` : ""})`).join(" · ")}
        </p>
      )}
    </div>
  );
}
