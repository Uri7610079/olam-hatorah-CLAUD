import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CircleHelp, FileSearch, ArrowLeft } from "lucide-react";
import { parseImportFile, isLegacyXls } from "@/lib/importParsing";
import { detectImportType, type DetectionCandidate, type DetectionResult } from "@/lib/importDetection";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";

interface AutoDetectPanelProps {
  // מעבר ללשונית אחרת בתוך מרכז היבוא, עם הקובץ שכבר נבחר - כדי שלא יהיה צורך
  // לבחור אותו שוב.
  onRouteToTab: (tab: string, file: File) => void;
}

function CandidateCard({
  candidate,
  isPrimary,
  onChoose,
}: {
  candidate: DetectionCandidate;
  isPrimary: boolean;
  onChoose: (candidate: DetectionCandidate) => void;
}) {
  const { signature, variant, missingOptional } = candidate;
  return (
    <div className={`card p-4 ${isPrimary ? "border-brand-500 ring-2 ring-brand-100" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">{signature.label}</span>
        <span className="rounded-full bg-area-soft px-2 py-0.5 text-xs text-area">{signature.area}</span>
        {variant.name && <span className="text-xs text-ink-subtle">{variant.name}</span>}
      </div>

      {missingOptional.length > 0 && (
        <div className="mt-2 flex items-start gap-2 rounded-control border border-warn bg-warn-soft p-2 text-xs text-warn-ink">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            אין בקובץ: {missingOptional.join(", ")}. הקליטה תעבוד, אבל השדות האלה יישארו ריקים.
          </span>
        </div>
      )}

      <button onClick={() => onChoose(candidate)} className={`mt-3 text-xs ${isPrimary ? "btn-primary" : "btn-secondary"}`}>
        {signature.target.kind === "import-center-tab" ? "המשך ליבוא" : "מעבר למסך המתאים"}
      </button>
    </div>
  );
}

// "זיהוי אוטומטי" - מעלים קובץ בלי לבחור סוג, והמערכת מזהה לפי כותרות העמודות.
// עוצרת תמיד ומציגה מה זיהתה לפני שממשיכים, גם כשהזיהוי חד-משמעי: השיוך השקט הוא
// בדיוק מה שגרם לקובץ להיקלט כסוג לא נכון בלי שאיש שם לב.
export function AutoDetectPanel({ onRouteToTab }: AutoDetectPanelProps) {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<DetectionResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legacyWarning, setLegacyWarning] = useState(false);

  const handleFile = async (selected: File | null) => {
    setResult(null);
    setError(null);
    setFile(selected);
    setLegacyWarning(false);
    if (!selected) return;
    setAnalyzing(true);
    try {
      setLegacyWarning(isLegacyXls(selected));
      const parsed = await parseImportFile(selected);
      setResult(detectImportType(parsed.headers, parsed.rows.length));
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בקריאת הקובץ");
    } finally {
      setAnalyzing(false);
    }
  };

  const choose = (candidate: DetectionCandidate) => {
    if (!file) return;
    const target = candidate.signature.target;
    if (target.kind === "import-center-tab") {
      onRouteToTab(target.tab, file);
    } else {
      navigate(target.path);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        מעלים כאן קובץ בלי לבחור סוג - המערכת מזהה לבד לאיזה תחום הוא שייך לפי כותרות העמודות שבו, ומציגה מה זיהתה
        לפני שממשיכים. הקליטה עצמה תמיד דורשת אישור שלך.
      </p>

      <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} className="input-field" />

      {legacyWarning && (
        <div className="flex items-start gap-2 rounded-control border border-warn bg-warn-soft p-3 text-sm text-warn-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>קובץ XLS ישן - מומלץ להמיר ל-XLSX/CSV.</span>
        </div>
      )}

      {analyzing && <LoadingState rows={2} />}
      {error && <ErrorState message={error} />}

      {result && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <FileSearch className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              נמצאו <span className="font-semibold text-ink tabular">{result.rowCount}</span> שורות ו-
              <span className="font-semibold text-ink tabular">{result.headers.length}</span> עמודות.
            </span>
          </div>

          {result.confidence === "unknown" && (
            <div className="card space-y-3 border-warn bg-warn-soft p-4">
              <div className="flex items-start gap-2">
                <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
                <div className="text-sm">
                  <p className="font-semibold text-ink">לא הצלחתי לזהות את סוג הקובץ</p>
                  <p className="mt-1 text-ink-muted">
                    כותרות העמודות בקובץ לא תואמות לאף סוג יבוא מוכר. אפשר לבחור את הסוג ידנית מהלשוניות למעלה, או לבדוק
                    שהקובץ הוא אכן מה שהתכוונת להעלות.
                  </p>
                  <p className="mt-2 text-xs text-ink-subtle">הכותרות שנמצאו: {result.headers.join(" · ") || "—"}</p>
                </div>
              </div>
            </div>
          )}

          {result.confidence === "ambiguous" && (
            <div className="flex items-start gap-2 rounded-control border border-warn bg-warn-soft p-3 text-sm text-warn-ink">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>הקובץ מתאים ליותר מסוג אחד. בחרי את הסוג הנכון:</span>
            </div>
          )}

          {result.confidence === "single" && result.candidates.length > 0 && (
            <p className="text-sm text-ink">
              זוהה כ<span className="font-semibold">{result.candidates[0].signature.label}</span>. אשרי כדי להמשיך, או בחרי
              אפשרות אחרת אם זה לא נכון.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {result.candidates.map((c, i) => (
              <CandidateCard key={c.signature.key} candidate={c} isPrimary={i === 0 && result.confidence === "single"} onChoose={choose} />
            ))}
          </div>

          {result.candidates.length > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-ink-subtle">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              לא אחד מאלה? אפשר תמיד לבחור לשונית ידנית למעלה.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
