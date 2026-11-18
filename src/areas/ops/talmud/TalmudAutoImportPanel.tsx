import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, MinusCircle, XCircle } from "lucide-react";
import { autoImportPulledFiles, isTalmudAutoImportEnabled, type AutoImportResult } from "@/lib/talmudAutoImport";

const monthText = (iso: string | null) => (iso ? iso.slice(0, 7).split("-").reverse().join("/") : "");
const DONE_KEY = "talmud-auto-import-done";

function wasHandled(jobId: string): boolean {
  try { return (JSON.parse(localStorage.getItem(DONE_KEY) ?? "[]") as string[]).includes(jobId); } catch { return false; }
}
function markHandled(jobId: string) {
  try {
    const list = (JSON.parse(localStorage.getItem(DONE_KEY) ?? "[]") as string[]).filter((j) => j !== jobId).slice(-30);
    localStorage.setItem(DONE_KEY, JSON.stringify([...list, jobId]));
  } catch { /* בלי זיכרון בדפדפן - הכפילות נחסמת ממילא לפי טביעת הקובץ */ }
}

// קליטה אוטומטית בסיום משיכה מתלמוד (שלב 42). רצה פעם אחת לכל משיכה, מיד כשהיא
// מסתיימת, ומראה מה נקלט ומה נעצר ולמה. קובץ שנעצר נשאר ב"קבצים מתלמוד" לקליטה ידנית.
// jobId = null: הרצה ידנית (הכפתור ב"קבצים מתלמוד") על כל מה שירד ועוד לא נקלט.
export function TalmudAutoImportPanel({ jobId, auto }: { jobId: string | null; auto: boolean }) {
  const qc = useQueryClient();
  const [results, setResults] = useState<AutoImportResult[]>([]);
  const [running, setRunning] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    setResults([]);
    try {
      if (!(await isTalmudAutoImportEnabled())) {
        setDisabled(true);
        return;
      }
      await autoImportPulledFiles(jobId, (r) => setResults((prev) => [...prev, r]));
      if (jobId) markHandled(jobId);
      ["talmud-files-for-import", "eligibility-batches", "students", "eligibility-lists", "talmud-report-rows", "financial-periods"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בקליטה האוטומטית");
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    if (!auto || !jobId || started.current === jobId || wasHandled(jobId)) return;
    started.current = jobId;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, jobId]);

  if (!auto && !running && results.length === 0 && !disabled && !error) {
    return (
      <button onClick={() => void run()} className="btn-primary text-sm">
        קליטה אוטומטית של כל הקבצים
      </button>
    );
  }
  if (auto && !running && results.length === 0 && !disabled && !error) return null;

  const imported = results.filter((r) => r.status === "imported").length;
  const stopped = results.filter((r) => r.status === "blocked" || r.status === "failed").length;

  return (
    <div className="card space-y-2 p-4">
      <p className="flex items-center gap-2 font-semibold">
        {running && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {running ? "קולטת את הקבצים מתלמוד…" : "קליטה אוטומטית"}
        {!running && results.length > 0 && (
          <span className="text-sm font-normal text-ink-muted">
            · {imported} נקלטו{stopped ? ` · ${stopped} נעצרו לבדיקה` : ""}
          </span>
        )}
      </p>
      {disabled && (
        <p className="text-sm text-ink-muted">
          הקליטה האוטומטית כבויה בהגדרות. אפשר לקלוט ידנית ב<Link to="/ops/import-center?tab=talmudPulled" className="link-action">קבצים מתלמוד</Link>.
        </p>
      )}
      {error && <p className="text-sm text-danger-ink">{error}</p>}
      <ul className="space-y-1 text-sm">
        {results.map((r) => (
          <li key={r.fileId} className="flex items-start gap-2">
            {r.status === "imported" && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden="true" />}
            {r.status === "skipped" && <MinusCircle className="mt-0.5 h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" />}
            {r.status === "blocked" && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />}
            {r.status === "failed" && <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />}
            <span>
              <span className="font-medium">{r.reportLabel}</span>
              <span className="text-ink-muted"> · {r.organization}{r.month ? ` · ${monthText(r.month)}` : ""} · </span>
              <span className={r.status === "blocked" || r.status === "failed" ? "text-warn-ink" : "text-ink-muted"}>{r.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      {!running && stopped > 0 && (
        <p className="text-xs text-ink-subtle">
          קבצים שנעצרו נשארו ב<Link to="/ops/import-center?tab=talmudPulled" className="link-action">קבצים מתלמוד</Link> לקליטה ידנית, עם התצוגה המקדימה.
        </p>
      )}
    </div>
  );
}
