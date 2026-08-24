import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { analyzeFile, checkDuplicateFile, createImportBatch, type TalmudImportInfo } from "@/lib/importBatches";
import type { ClassifiedRow } from "@/lib/importParsing";
import { validateTalmudImport, type TalmudValidationReport } from "@/lib/talmudImportValidation";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";

// קליטת כמה דוחות מתלמוד בבת אחת.
//
// בפועל מתקבלים כמה קבצים יחד - אחד לכל עמותה - ועד עכשיו כל אחד דרש
// מעבר נפרד: לבחור עמותה, לבחור חודש, להעלות, לאשר. ארבע פעמים, וכל
// בחירה ידנית היא מקום שאפשר לטעות בו.
//
// כאן בוחרים את כולם יחד. כל קובץ מזוהה, משויך לעמותה לפי מספרה, ונבדק
// מול הנתונים שכבר במערכת - והכל מוצג *לפני* שנכתב משהו. הקליטה עצמה
// היא לחיצה נפרדת, ורק על מה שעבר.

type FileState = "מנתח" | "מוכן" | "חסום" | "נקלט" | "נכשל";

interface FileEntry {
  id: string;
  file: File;
  state: FileState;
  info: TalmudImportInfo | null;
  rows: ClassifiedRow[] | null;
  report: TalmudValidationReport | null;
  error: string | null;
  committed: { matched: number; unmatched: number } | null;
}

const money = (n: number) => n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLabel = (iso: string | null) => (iso ? `${iso.split("-")[1]}/${iso.split("-")[0]}` : "—");

export function TalmudBatchImportPanel() {
  const queryClient = useQueryClient();
  const { hasPermission: canImport, isLoading: permissionLoading } = useHasPermission("talmud", "import");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [committing, setCommitting] = useState(false);

  const handleFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);

    const initial: FileEntry[] = Array.from(list).map((file, i) => ({
      id: `${Date.now()}-${i}-${file.name}`,
      file,
      state: "מנתח" as FileState,
      info: null,
      rows: null,
      report: null,
      error: null,
      committed: null,
    }));
    setEntries(initial);

    // הקבצים מנותחים בזה אחר זה ולא במקביל. קובץ של ברכת אלימלך מכיל
    // כמעט 2,000 שורות, וכל בדיקה שולחת שאילתות בקבוצות - הרצה במקביל
    // הייתה מציפה את השרת ומאטה את הכל.
    const done: FileEntry[] = [];
    for (const entry of initial) {
      done.push(await analyzeOne(entry));
      setEntries([...done, ...initial.slice(done.length)]);
    }
    setBusy(false);
  };

  const analyzeOne = async (entry: FileEntry): Promise<FileEntry> => {
    try {
      const duplicate = await checkDuplicateFile(entry.file);
      if (duplicate) {
        return { ...entry, state: "חסום", error: "קובץ זה כבר יובא בעבר" };
      }

      const result = await analyzeFile(entry.file);
      if (!result.talmud) {
        return { ...entry, state: "חסום", error: "אינו דוח דרישת תשלום מתלמוד" };
      }

      const rows = result.rows.map((r) => r.raw);
      const report = await validateTalmudImport(result.talmud, rows);

      return {
        ...entry,
        state: report.blocked ? "חסום" : "מוכן",
        info: result.talmud,
        rows: result.rows,
        report,
        error: report.blockReason,
      };
    } catch (e) {
      return { ...entry, state: "נכשל", error: e instanceof Error ? e.message : "שגיאה בניתוח" };
    }
  };

  const commitAll = async () => {
    setCommitting(true);
    const updated = [...entries];

    for (let i = 0; i < updated.length; i++) {
      const entry = updated[i];
      if (entry.state !== "מוכן" || !entry.rows || !entry.info || !entry.report?.orgId) continue;

      try {
        const { batchId } = await createImportBatch(
          {
            file: entry.file,
            profileKey: "talmud_eligibility",
            organizationId: entry.report.orgId,
            periodMonth: entry.info.month,
          },
          entry.rows
        );

        const { data, error } = await supabase.rpc("commit_eligibility_batch", {
          p_batch_id: batchId,
          p_month: entry.info.month,
        });
        if (error) throw error;

        const result = Array.isArray(data) ? data[0] : data;
        updated[i] = {
          ...entry,
          state: "נקלט",
          committed: { matched: result?.matched_count ?? 0, unmatched: result?.unmatched_count ?? 0 },
        };
      } catch (e) {
        updated[i] = { ...entry, state: "נכשל", error: e instanceof Error ? e.message : "הקליטה נכשלה" };
      }
      setEntries([...updated]);
    }

    setCommitting(false);
    queryClient.invalidateQueries({ queryKey: ["eligibility-batches"] });
  };

  if (permissionLoading) return null;
  if (!canImport) return <ErrorState message="אין הרשאה — נדרשת הרשאת יבוא לתלמוד." />;

  const ready = entries.filter((e) => e.state === "מוכן");
  const totalToCommit = ready.reduce((s, e) => s + (e.report?.amountThatWillCommit ?? 0), 0);
  const totalInFiles = ready.reduce((s, e) => s + (e.report?.totalAmount ?? 0), 0);

  const columns: DataTableColumn<FileEntry>[] = [
    {
      key: "file",
      header: "קובץ",
      render: (e) => (
        <div className="flex items-center gap-2">
          <StateIcon state={e.state} />
          <span className="truncate" title={e.file.name}>{e.file.name}</span>
        </div>
      ),
    },
    { key: "org", header: "עמותה", render: (e) => e.report?.orgName ?? <Pending state={e.state} /> },
    {
      key: "month",
      header: "חודש",
      className: "tabular ltr-num",
      render: (e) => (e.info?.month ? monthLabel(e.info.month) : <Pending state={e.state} />),
    },
    {
      key: "students",
      header: "תלמידים",
      className: "tabular ltr-num",
      render: (e) =>
        e.report ? (
          <span>
            {e.report.matchedStudents} / {e.report.totalRows}
          </span>
        ) : (
          <Pending state={e.state} />
        ),
    },
    {
      key: "amount",
      header: "סכום שייכנס",
      className: "tabular ltr-num",
      render: (e) => (e.report ? money(e.report.amountThatWillCommit) : <Pending state={e.state} />),
    },
    {
      key: "issues",
      header: "בעיות",
      render: (e) => <IssueSummary entry={e} />,
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <label className="field-label" htmlFor="talmud-files">
          קבצי דוח דרישת תשלום מתלמוד
        </label>
        <input
          id="talmud-files"
          type="file"
          multiple
          accept=".csv,.xlsx,.xls"
          disabled={busy || committing}
          onChange={(e) => void handleFiles(e.target.files)}
          className="input-field"
        />
        <p className="mt-1 text-xs text-ink-subtle">
          אפשר לבחור את כל הקבצים יחד. כל קובץ ישויך לעמותה שלו לפי מספר העמותה שבתוכו.
        </p>
      </div>

      {entries.length > 0 && (
        <>
          <DataTable columns={columns} rows={entries} rowKey={(e) => e.id} emptyTitle="אין קבצים" />

          {ready.length > 0 && (
            <div className="rounded-control border border-line bg-surface-muted p-4">
              <div className="mb-2 text-sm text-ink">
                {ready.length} קבצים מוכנים לקליטה ·{" "}
                <span className="ltr-num font-medium">{money(totalToCommit)} ₪</span>
                {Math.abs(totalToCommit - totalInFiles) > 0.5 && (
                  <span className="text-warn">
                    {" "}
                    (מתוך {money(totalInFiles)} ₪ בקבצים — ההפרש הוא תלמידים שלא נמצאו)
                  </span>
                )}
              </div>
              <button
                onClick={() => void commitAll()}
                disabled={committing}
                className="btn-primary flex items-center gap-2"
              >
                {committing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
                {committing ? "קולט…" : `קליטת ${ready.length} קבצים`}
              </button>
            </div>
          )}

          {entries.map((e) => (
            <FileDetails key={e.id} entry={e} />
          ))}
        </>
      )}
    </div>
  );
}


// בזמן שקובץ עדיין נבדק מול המסד אין לו עדיין נתונים להציג. "—" במצב הזה
// נקרא ככישלון, לא כהמתנה, ולכן מצב הביניים נאמר במפורש.
function Pending({ state }: { state: FileState }) {
  return state === "מנתח"
    ? <span className="text-ink-subtle">בודק…</span>
    : <span className="text-ink-subtle">—</span>;
}

function StateIcon({ state }: { state: FileState }) {
  if (state === "מנתח") return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ink-subtle" aria-hidden="true" />;
  if (state === "מוכן") return <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" aria-hidden="true" />;
  if (state === "נקלט") return <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" aria-hidden="true" />;
  if (state === "חסום") return <AlertTriangle className="h-4 w-4 shrink-0 text-warn" aria-hidden="true" />;
  return <XCircle className="h-4 w-4 shrink-0 text-danger" aria-hidden="true" />;
}

function IssueSummary({ entry }: { entry: FileEntry }) {
  if (entry.error) return <span className="text-xs text-danger">{entry.error}</span>;
  if (entry.committed) {
    return (
      <span className="text-xs text-ok">
        נקלט: {entry.committed.matched} · לא נקלט: {entry.committed.unmatched}
      </span>
    );
  }
  const r = entry.report;
  if (!r) return <Pending state={entry.state} />;

  const parts: string[] = [];
  if (r.missingStudents.length) parts.push(`${r.missingStudents.length} תלמידים חסרים`);
  if (r.withoutAssignment.length) parts.push(`${r.withoutAssignment.length} בלי שיוך`);
  if (r.missingBranches.length) parts.push(`${r.missingBranches.length} סניפים חסרים`);
  if (r.branchMismatches.length) parts.push(`${r.branchMismatches.length} סניף שונה`);

  if (!parts.length) return <span className="text-xs text-ok">תקין</span>;
  return <span className="text-xs text-warn">{parts.join(" · ")}</span>;
}

// פירוט מלא לכל קובץ. מוסתר בברירת מחדל כדי שהטבלה תישאר קריאה, אבל
// זמין במלואו - רשימה של "300 תלמידים חסרים" בלי השמות אינה שימושית
// למי שצריך לתקן אותם.
function FileDetails({ entry }: { entry: FileEntry }) {
  const r = entry.report;
  if (!r || entry.state === "מנתח") return null;
  const hasIssues =
    r.missingStudents.length || r.withoutAssignment.length || r.missingBranches.length || r.branchMismatches.length;
  if (!hasIssues) return null;

  return (
    <details className="rounded-control border border-line p-3 text-sm">
      <summary className="cursor-pointer text-ink">
        <FileSpreadsheet className="ms-1 inline h-4 w-4" aria-hidden="true" />
        פירוט: {entry.file.name}
      </summary>

      <div className="mt-3 space-y-3">
        {r.missingBranches.length > 0 && (
          <IssueBlock
            title={`סניפים שאינם קיימים במערכת (${r.missingBranches.length})`}
            tone="danger"
            note="הזכאות תיזקף לפי השיוך שבמערכת, לא לפי הקובץ. כדאי להוסיף אותם."
            items={r.missingBranches.map((b) => `סניף ${b}`)}
          />
        )}

        {r.missingStudents.length > 0 && (
          <IssueBlock
            title={`תלמידים שאינם קיימים במערכת (${r.missingStudents.length})`}
            tone="danger"
            note={`סכום שלא ייקלט: ${money(r.missingStudents.reduce((s, m) => s + m.amount, 0))} ₪. יש לייבא אותם קודם דרך מסך תלמידים.`}
            items={r.missingStudents.map((m) => `${m.name} (${m.externalId}) · סניף ${m.branchCode} · ${money(m.amount)} ₪`)}
          />
        )}

        {r.withoutAssignment.length > 0 && (
          <IssueBlock
            title={`תלמידים בלי שיוך פעיל לקבוצה (${r.withoutAssignment.length})`}
            tone="danger"
            note={`סכום שלא ייקלט: ${money(r.withoutAssignment.reduce((s, m) => s + m.amount, 0))} ₪. הקליטה קוראת את הסניף והקבוצה מהשיוך, ולכן תלמיד בלי שיוך נדחה גם אם הוא קיים.`}
            items={r.withoutAssignment.map((m) => `${m.name} (${m.externalId}) · סניף ${m.branchCode} · ${money(m.amount)} ₪`)}
          />
        )}

        {r.branchMismatches.length > 0 && (
          <IssueBlock
            title={`סניף בקובץ שונה מהשיוך במערכת (${r.branchMismatches.length})`}
            tone="warn"
            note="אינו חוסם - הזכאות תיזקף לסניף שבמערכת. אם התלמיד באמת עבר, כדאי לעדכן את השיוך כדי שהדוחות יהיו נכונים."
            items={r.branchMismatches.map((m) => `${m.name} (${m.externalId}): בקובץ ${m.fileBranch}, במערכת ${m.systemBranch}`)}
          />
        )}
      </div>
    </details>
  );
}

function IssueBlock({ title, note, items, tone }: { title: string; note: string; items: string[]; tone: "danger" | "warn" }) {
  const color = tone === "danger" ? "text-danger" : "text-warn";
  return (
    <div>
      <div className={`text-sm font-medium ${color}`}>{title}</div>
      <div className="mb-1 text-xs text-ink-muted">{note}</div>
      <ul className="max-h-48 space-y-0.5 overflow-auto rounded border border-line bg-surface-muted p-2 text-xs text-ink-subtle">
        {items.slice(0, 200).map((t) => (
          <li key={t}>{t}</li>
        ))}
        {items.length > 200 && <li className="text-ink-muted">ועוד {items.length - 200}…</li>}
      </ul>
    </div>
  );
}
