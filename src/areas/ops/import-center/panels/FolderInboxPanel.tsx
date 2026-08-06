import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  FolderSearch,
  Landmark,
  Folder,
  RefreshCw,
  Settings,
  ArrowLeft,
  Archive,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { hashFile, parseImportFile } from "@/lib/importParsing";
import { detectImportType, type DetectionCandidate } from "@/lib/importDetection";
import {
  archiveFile,
  ensureFolderPermission,
  FOLDER_LABEL,
  getFolderStatus,
  isFolderAccessSupported,
  scanFolder,
  type FolderKey,
  type FolderStatus,
} from "@/lib/folderAccess";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";

interface FolderInboxPanelProps {
  onRouteToTab: (tab: string, file: File) => void;
}

// שלוש הטבלאות שבהן נשמר hash של קובץ שנקלט. הבדיקה כאן היא בדיוק אותה בדיקה שכל
// מסך יבוא עושה ממילא לפני commit - מה שמאפשר לזהות קובץ שכבר נקלט ולהעביר אותו
// לארכיון אוטומטית, בלי לבקש מהמשתמשת לזכור מה כבר עשתה.
const HASH_TABLES = [
  { table: "import_batches", column: "file_hash" },
  { table: "bank_import_batches", column: "file_hash" },
  { table: "phone_list_imports", column: "file_hash" },
] as const;

async function findExistingImport(hash: string): Promise<boolean> {
  for (const { table, column } of HASH_TABLES) {
    const { data, error } = await supabase.from(table).select("id").eq(column, hash).maybeSingle();
    // שגיאת הרשאה על טבלה אחת (למשל למי שאין לו גישה לאזור הכספי) לא צריכה להכשיל
    // את כל הסריקה - במקרה כזה פשוט לא נדע לגבי הטבלה הזו, וזה מצב בטוח: הקובץ
    // ייחשב "לא נקלט" והמשתמשת תראה אותו, ובקליטה עצמה הכפילות תיחסם בכל מקרה.
    if (!error && data) return true;
  }
  return false;
}

type FileState =
  | { kind: "already-imported" }
  | { kind: "detected"; candidate: DetectionCandidate; rowCount: number }
  | { kind: "ambiguous"; candidates: DetectionCandidate[]; rowCount: number }
  | { kind: "unknown"; headers: string[] }
  | { kind: "unreadable"; message: string };

interface ScannedFile {
  folder: FolderKey;
  name: string;
  file: File;
  lastModified: number;
  state: FileState;
}

interface FolderScan {
  folder: FolderKey;
  files: ScannedFile[];
  archived: string[];
  skippedUnsettled: string[];
  error: string | null;
}

// עבור תיקיית הבנק סוג הקובץ ידוע מראש, ולכן אין צורך שהמשתמשת תאשר סוג. עדיין
// מריצים זיהוי - לא כדי לשאול, אלא כדי לתפוס קובץ שנחת בטעות בתיקייה הלא נכונה.
function resolveState(
  folder: FolderKey,
  candidates: DetectionCandidate[],
  confidence: string,
  rowCount: number,
  headers: string[],
): FileState {
  if (folder === "bank") {
    const bank = candidates.find((c) => c.signature.key === "bank_transactions");
    if (bank) return { kind: "detected", candidate: bank, rowCount };
    if (candidates.length > 0) return { kind: "ambiguous", candidates, rowCount };
    return { kind: "unknown", headers };
  }
  if (confidence === "single" && candidates.length > 0) return { kind: "detected", candidate: candidates[0], rowCount };
  if (candidates.length > 0) return { kind: "ambiguous", candidates, rowCount };
  return { kind: "unknown", headers };
}

function FileRow({
  entry,
  onChoose,
  onArchive,
}: {
  entry: ScannedFile;
  onChoose: (entry: ScannedFile, candidate: DetectionCandidate) => void;
  onArchive: (entry: ScannedFile, outcome: "done" | "failed") => void;
}) {
  const { state } = entry;
  return (
    <div className="card space-y-2.5 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink">{entry.name}</span>
        <span className="text-xs text-ink-subtle ltr-num">{new Date(entry.lastModified).toLocaleString("he-IL")}</span>
      </div>

      {state.kind === "already-imported" && (
        <>
          <p className="flex items-center gap-1.5 text-sm text-ink-muted">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
            הקובץ הזה כבר נקלט במערכת, אבל לא הצלחתי להעביר אותו לתיקיית "נקלטו".
          </p>
          <button type="button" onClick={() => onArchive(entry, "done")} className="btn-secondary text-xs">
            ניסיון נוסף להעברה
          </button>
        </>
      )}

      {state.kind === "detected" && (
        <>
          <p className="text-sm text-ink-muted">
            זוהה כ<span className="font-semibold text-ink">{state.candidate.signature.label}</span>
            {state.candidate.variant.name && <span className="text-ink-subtle"> · {state.candidate.variant.name}</span>}
            <span className="text-ink-subtle"> · {state.rowCount} שורות</span>
          </p>
          {state.candidate.missingOptional.length > 0 && (
            <div className="flex items-start gap-2 rounded-control border border-warn bg-warn-soft p-2 text-xs text-warn-ink">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>אין בקובץ: {state.candidate.missingOptional.join(", ")}. הקליטה תעבוד, אבל השדות האלה יישארו ריקים.</span>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onChoose(entry, state.candidate)} className="btn-primary text-xs">
              המשך ליבוא
            </button>
            <button type="button" onClick={() => onArchive(entry, "failed")} className="btn-secondary text-xs">
              העברה לשגיאות
            </button>
          </div>
        </>
      )}

      {state.kind === "ambiguous" && (
        <>
          <div className="flex items-start gap-2 rounded-control border border-warn bg-warn-soft p-2 text-xs text-warn-ink">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              {entry.folder === "bank"
                ? "הקובץ הזה לא נראה כמו דף בנק. בדקי שהוא הגיע לתיקייה הנכונה."
                : "הקובץ מתאים ליותר מסוג אחד. בחרי את הסוג הנכון:"}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {state.candidates.map((c) => (
              <button key={c.signature.key} type="button" onClick={() => onChoose(entry, c)} className="btn-secondary text-xs">
                {c.signature.label}
              </button>
            ))}
            <button type="button" onClick={() => onArchive(entry, "failed")} className="btn-secondary text-xs">
              העברה לשגיאות
            </button>
          </div>
        </>
      )}

      {state.kind === "unknown" && (
        <>
          <div className="flex items-start gap-2 rounded-control border border-warn bg-warn-soft p-2 text-xs text-warn-ink">
            <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">לא הצלחתי לזהות את סוג הקובץ</p>
              <p className="mt-0.5">הכותרות שנמצאו: {state.headers.join(" · ") || "—"}</p>
            </div>
          </div>
          <button type="button" onClick={() => onArchive(entry, "failed")} className="btn-secondary text-xs">
            העברה לשגיאות
          </button>
        </>
      )}

      {state.kind === "unreadable" && (
        <>
          <div className="flex items-start gap-2 rounded-control border border-warn bg-warn-soft p-2 text-xs text-warn-ink">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>לא ניתן לקרוא את הקובץ: {state.message}</span>
          </div>
          <button type="button" onClick={() => onArchive(entry, "failed")} className="btn-secondary text-xs">
            העברה לשגיאות
          </button>
        </>
      )}
    </div>
  );
}

// "קבצים מהתיקייה" - סורק את התיקיות שהוגדרו במסך ההגדרות, מזהה כל קובץ, ומציג מה
// מצא. הקליטה עצמה תמיד עוברת דרך מסך היבוא הרגיל ובאישור מפורש: הסריקה חוסכת את
// שלב חיפוש הקובץ, לא את שלב הבדיקה.
export function FolderInboxPanel({ onRouteToTab }: FolderInboxPanelProps) {
  const navigate = useNavigate();
  const supported = isFolderAccessSupported();
  const [statuses, setStatuses] = useState<Record<FolderKey, FolderStatus | null>>({ general: null, bank: null });
  // בדיקת התיקיות היא אסינכרונית. בלי הדגל הזה הפאנל היה מציג לרגע "עדיין לא
  // הוגדרה תיקייה" בכל כניסה ללשונית, גם למי שהתיקיות שלה מוגדרות היטב.
  const [statusesLoaded, setStatusesLoaded] = useState(false);
  const [scans, setScans] = useState<FolderScan[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [routedHint, setRoutedHint] = useState<string | null>(null);

  const refreshStatuses = useCallback(async () => {
    const [general, bank] = await Promise.all([getFolderStatus("general"), getFolderStatus("bank")]);
    setStatuses({ general, bank });
    setStatusesLoaded(true);
  }, []);

  useEffect(() => {
    void refreshStatuses();
  }, [refreshStatuses]);

  const configured = (["bank", "general"] as FolderKey[]).filter(
    (k) => statuses[k] && statuses[k]!.permission !== "missing" && statuses[k]!.permission !== "unsupported",
  );

  const scanOne = async (folder: FolderKey): Promise<FolderScan> => {
    const permission = await ensureFolderPermission(folder);
    if (permission !== "granted") {
      return { folder, files: [], archived: [], skippedUnsettled: [], error: "אין הרשאת גישה לתיקייה. בחרי אותה מחדש בהגדרות." };
    }

    const { files, skippedUnsettled } = await scanFolder(folder);
    const entries: ScannedFile[] = [];
    const archived: string[] = [];

    for (const found of files) {
      // קובץ שכבר נקלט בעבר מועבר לארכיון בשקט - זה בדיוק המצב שבו אין מה לשאול.
      const hash = await hashFile(found.file);
      if (await findExistingImport(hash)) {
        const result = await archiveFile(folder, found.name, "done");
        if (result.moved) archived.push(found.name);
        else entries.push({ folder, name: found.name, file: found.file, lastModified: found.lastModified, state: { kind: "already-imported" } });
        continue;
      }

      try {
        const parsed = await parseImportFile(found.file);
        const detection = detectImportType(parsed.headers, parsed.rows.length);
        entries.push({
          folder,
          name: found.name,
          file: found.file,
          lastModified: found.lastModified,
          state: resolveState(folder, detection.candidates, detection.confidence, detection.rowCount, detection.headers),
        });
      } catch (e) {
        entries.push({
          folder,
          name: found.name,
          file: found.file,
          lastModified: found.lastModified,
          state: { kind: "unreadable", message: e instanceof Error ? e.message : "שגיאה לא מזוהה" },
        });
      }
    }

    return { folder, files: entries, archived, skippedUnsettled, error: null };
  };

  const scanAll = async () => {
    setScanning(true);
    setRoutedHint(null);
    try {
      const results: FolderScan[] = [];
      for (const folder of configured) results.push(await scanOne(folder));
      setScans(results);
    } finally {
      setScanning(false);
      void refreshStatuses();
    }
  };

  const choose = (entry: ScannedFile, candidate: DetectionCandidate) => {
    const target = candidate.signature.target;
    if (target.kind === "import-center-tab") {
      onRouteToTab(target.tab, entry.file);
    } else {
      // מסכים שמנהלים את היבוא אצלם - אין להם עדיין מסלול קליטת-קובץ חיצוני, ולכן
      // מנווטים אליהם ומראים בדיוק איפה ללחוץ.
      setRoutedHint(target.hint);
      navigate(target.path);
    }
  };

  const handleArchive = async (entry: ScannedFile, outcome: "done" | "failed") => {
    const result = await archiveFile(entry.folder, entry.name, outcome);
    if (!result.moved) {
      window.alert(`לא ניתן להעביר את הקובץ: ${result.error ?? "שגיאה לא מזוהה"}`);
      return;
    }
    setScans((prev) =>
      prev?.map((s) => (s.folder === entry.folder ? { ...s, files: s.files.filter((f) => f.name !== entry.name) } : s)) ?? null,
    );
  };

  if (!supported) {
    return (
      <div className="card flex items-start gap-2.5 border-warn bg-warn-soft p-4 text-sm text-warn-ink">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">הדפדפן הזה לא תומך בקריאת תיקיות</p>
          <p className="mt-1">היכולת קיימת ב-Chrome וב-Edge בלבד. אפשר להעלות קבצים ידנית בכל שאר הלשוניות.</p>
        </div>
      </div>
    );
  }

  if (!statusesLoaded) return <LoadingState rows={2} />;

  if (configured.length === 0) {
    return (
      <EmptyState
        icon={FolderSearch}
        title="עדיין לא הוגדרה תיקייה"
        description="אפשר להגדיר תיקייה במחשב שממנה המערכת תקלוט קבצים, במקום להעלות כל קובץ ידנית."
        action={
          <Link to="/admin/folders" className="btn-primary inline-flex items-center gap-1.5 text-xs">
            <Settings className="h-3.5 w-3.5" aria-hidden="true" />
            הגדרת תיקיות קליטה
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        סריקת התיקיות שהוגדרו במחשב. המערכת מציגה כל קובץ ומה זיהתה בו, והקליטה עצמה תמיד דורשת אישור שלך. קובץ שכבר
        נקלט בעבר מועבר אוטומטית לתת-תיקיית "נקלטו".
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={scanAll} disabled={scanning} className="btn-primary flex items-center gap-1.5 text-xs">
          <RefreshCw className={`h-3.5 w-3.5 ${scanning ? "animate-spin" : ""}`} aria-hidden="true" />
          {scanning ? "סורק..." : "סריקת התיקיות"}
        </button>
        <Link to="/admin/folders" className="btn-secondary inline-flex items-center gap-1.5 text-xs">
          <Settings className="h-3.5 w-3.5" aria-hidden="true" />
          הגדרות התיקיות
        </Link>
        {configured.map((k) => (
          <span key={k} className="text-xs text-ink-subtle">
            {FOLDER_LABEL[k]}: <span className="ltr-num">{statuses[k]?.name}</span>
          </span>
        ))}
      </div>

      {routedHint && (
        <div className="flex items-start gap-2 rounded-control border border-warn bg-warn-soft p-3 text-sm text-warn-ink">
          <ArrowLeft className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{routedHint}</span>
        </div>
      )}

      {scans?.map((scan) => (
        <section key={scan.folder} className="space-y-2.5">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            {scan.folder === "bank" ? (
              <Landmark className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" />
            ) : (
              <Folder className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" />
            )}
            {FOLDER_LABEL[scan.folder]}
          </h3>

          {scan.error && (
            <div className="flex items-start gap-2 rounded-control border border-warn bg-warn-soft p-3 text-sm text-warn-ink">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{scan.error}</span>
            </div>
          )}

          {scan.archived.length > 0 && (
            <div className="flex items-start gap-2 rounded-control border border-line bg-surface-muted p-2.5 text-xs text-ink-muted">
              <Archive className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>נקלטו כבר בעבר והועברו ל"נקלטו": {scan.archived.join(", ")}</span>
            </div>
          )}

          {scan.skippedUnsettled.length > 0 && (
            <div className="flex items-start gap-2 rounded-control border border-warn bg-warn-soft p-2.5 text-xs text-warn-ink">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                עדיין בכתיבה, לא נקראו: {scan.skippedUnsettled.join(", ")}. אפשר לסרוק שוב עוד רגע.
              </span>
            </div>
          )}

          {!scan.error && scan.files.length === 0 && scan.archived.length === 0 && scan.skippedUnsettled.length === 0 && (
            <p className="flex items-center gap-1.5 rounded-control border border-line bg-surface-muted p-2.5 text-sm text-ink-muted">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
              אין קבצים חדשים בתיקייה.
            </p>
          )}

          <div className="grid gap-2.5 lg:grid-cols-2">
            {scan.files.map((entry) => (
              <FileRow key={`${entry.folder}:${entry.name}`} entry={entry} onChoose={choose} onArchive={handleArchive} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
