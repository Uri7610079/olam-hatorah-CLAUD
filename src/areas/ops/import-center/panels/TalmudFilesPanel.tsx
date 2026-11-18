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

// "קבצים מתלמוד": הדוחות שירדו במשיכה מתלמוד (מיגרציה 118), מזוהים ומוכנים לקליטה.
// כמו "קבצים מהתיקייה" - הזיהוי והניתוב אוטומטיים, והקליטה עצמה עוברת במסך היבוא
// הרגיל עם תצוגה מקדימה ואישור. קובץ שכבר נקלט (אותה טביעה) מסומן ולא נקלט שוב.

interface PulledFile {
  id: string;
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

export function TalmudFilesPanel({ onRouteToTab }: { onRouteToTab: (tab: string, file: File) => void }) {
  const navigate = useNavigate();
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

  const go = (entry: Entry) => {
    if (entry.state.kind !== "detected") return;
    const target = entry.state.candidate.signature.target;
    if (target.kind === "import-center-tab") onRouteToTab(target.tab, entry.file);
    else navigate(target.path);
  };

  const pending = query.data.filter((e) => e.state.kind !== "imported");
  const imported = query.data.filter((e) => e.state.kind === "imported");

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        הקבצים שירדו במשיכה מתלמוד, מזוהים לפי התוכן. "המשך ליבוא" פותח את מסך הקליטה המתאים עם הקובץ כבר בפנים - שם
        בודקים את התצוגה המקדימה ומאשרים. קובץ שכבר נקלט מסומן ולא ייקלט פעמיים.
      </p>

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
              <span className="text-sm text-ink-muted">· {entry.pulled.legal_name}{entry.pulled.month ? ` · ${monthText(entry.pulled.month)}` : ""}</span>
            </div>
            {entry.state.kind === "detected" && (
              <>
                <p className="text-sm text-ink-muted">
                  זוהה כ<span className="font-semibold text-ink">{entry.state.candidate.signature.label}</span>
                  <span className="text-ink-subtle"> · {entry.state.rowCount} שורות</span>
                </p>
                {entry.state.candidate.signature.target.kind === "route" && entry.state.candidate.signature.target.path === "/ops/talmud/pull" ? (
                  <p className="text-xs text-ink-subtle">{entry.state.candidate.signature.target.hint}</p>
                ) : (
                  <button onClick={() => go(entry)} className="btn-primary text-xs">המשך ליבוא</button>
                )}
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
          כבר נקלטו: {imported.map((e) => `${e.pulled.report_label} (${e.pulled.legal_name}${e.pulled.month ? ` ${monthText(e.pulled.month)}` : ""})`).join(" · ")}
        </p>
      )}
    </div>
  );
}
