import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Clock, Info, Play, RefreshCw, Save, Settings, ShieldCheck, XCircle } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import {
  ensureFolderPermission,
  getFolderStatus,
  isFolderAccessSupported,
  readJsonFromFolder,
  SCRAPER_CONFIG_FILE,
  SCRAPER_STATUS_FILE,
  writeJsonToFolder,
  type FolderStatus,
} from "@/lib/folderAccess";

// המבנה חייב להישאר תואם ל-bank-scraper/scheduler.ps1 שקורא את הקובץ הזה.
interface ScraperConfig {
  enabled: boolean;
  time: string;
  days: number[];
  lookbackDays: number;
  runNowRequestedAt: string | null;
  updatedAt: string;
}

interface ScraperStatus {
  lastCheckAt?: string | null;
  lastRunAt?: string | null;
  lastResult?: "success" | "failed" | null;
  lastError?: string | null;
  lastOutput?: string | null;
  lastDurationSec?: number | null;
  outputFolder?: string | null;
}

const DEFAULT_CONFIG: ScraperConfig = {
  enabled: false,
  time: "07:30",
  days: [0, 1, 2, 3, 4],
  lookbackDays: 45,
  runNowRequestedAt: null,
  updatedAt: "",
};

const DAY_LABELS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("he-IL");
}

// "חי" = המתזמן נבדק לאחרונה לפני פחות מחצי שעה. המשימה ב-Windows מתעוררת כל
// רבע שעה, אז פער גדול מזה אומר שהיא לא מותקנת, כבויה, או שהמחשב היה כבוי.
function isSchedulerAlive(lastCheckAt: string | null | undefined): boolean {
  if (!lastCheckAt) return false;
  const t = new Date(lastCheckAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < 30 * 60 * 1000;
}

function StatusPanel({ status, onRefresh }: { status: ScraperStatus | null; onRefresh: () => void }) {
  const alive = isSchedulerAlive(status?.lastCheckAt);

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">מצב המתזמן במחשב</p>
        <button type="button" onClick={onRefresh} className="btn-secondary flex items-center gap-1.5 text-xs">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          רענון
        </button>
      </div>

      {!status ? (
        <div className="flex items-start gap-2 rounded-control border border-warn bg-warn-soft p-2.5 text-xs text-warn-ink">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            המתזמן עדיין לא דיווח על עצמו. צריך להתקין אותו פעם אחת במחשב - לחיצה כפולה על "התקנת תזמון.bat" בתיקיית
            הסקרייפר.
          </span>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            {alive ? <StatusBadge severity="ok" label="פעיל" /> : <StatusBadge severity="critical" label="לא מגיב" />}
            <span className="text-xs text-ink-subtle">נבדק לאחרונה: {formatDateTime(status.lastCheckAt)}</span>
          </div>

          {!alive && (
            <p className="text-xs text-ink-muted">
              המתזמן אמור להיבדק כל רבע שעה. אם עבר יותר מזה - ייתכן שהמחשב היה כבוי, או שהמשימה לא הותקנה.
            </p>
          )}

          <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-2 sm:block">
              <dt className="text-ink-subtle">משיכה אחרונה</dt>
              <dd className="text-ink">{formatDateTime(status.lastRunAt)}</dd>
            </div>
            <div className="flex justify-between gap-2 sm:block">
              <dt className="text-ink-subtle">תוצאה</dt>
              <dd>
                {status.lastResult === "success" && (
                  <span className="flex items-center gap-1 text-ink">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-ok" aria-hidden="true" />
                    הצליחה
                  </span>
                )}
                {status.lastResult === "failed" && (
                  <span className="flex items-center gap-1 text-ink">
                    <XCircle className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
                    נכשלה
                  </span>
                )}
                {!status.lastResult && <span className="text-ink-subtle">עוד לא רצה</span>}
              </dd>
            </div>
          </dl>

          {status.lastError && (
            <div className="flex items-start gap-2 rounded-control border border-warn bg-warn-soft p-2.5 text-xs text-warn-ink">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{status.lastError}</span>
            </div>
          )}

          {status.lastOutput && (
            <details className="text-xs">
              <summary className="cursor-pointer text-ink-muted">פלט מלא מההרצה האחרונה</summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-control border border-line bg-surface-muted p-2.5 text-ink-muted ltr-num">
                {status.lastOutput}
              </pre>
            </details>
          )}
        </>
      )}
    </div>
  );
}

// מסך תזמון המשיכה האוטומטית מהבנק.
//
// הערה ארכיטקטונית שחשוב שתישאר כתובה: אתר אינטרנט אינו יכול להפעיל תוכנה על
// מחשב, ואינו רץ כשהדפדפן סגור - הדפדפן חוסם את זה בכוונה. לכן המסך הזה אינו
// "מפעיל את הסקרייפר". הוא כותב קובץ הגדרות לתיקייה משותפת, ותוכנית קטנה
// שמותקנת פעם אחת במחשב (scheduler.ps1, מופעלת ע"י מתזמן המשימות של Windows)
// קוראת אותו ומריצה בפועל. הסקרייפר כותב בחזרה קובץ סטטוס, וזה מה שמוצג כאן.
export function BankScraperScreen() {
  const supported = isFolderAccessSupported();
  const [folder, setFolder] = useState<FolderStatus | null>(null);
  const [config, setConfig] = useState<ScraperConfig>(DEFAULT_CONFIG);
  const [status, setStatus] = useState<ScraperStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const f = await getFolderStatus("bank");
      setFolder(f);
      if (f.permission === "granted") {
        const [cfg, st] = await Promise.all([
          readJsonFromFolder<Partial<ScraperConfig>>("bank", SCRAPER_CONFIG_FILE),
          readJsonFromFolder<ScraperStatus>("bank", SCRAPER_STATUS_FILE),
        ]);
        if (cfg) setConfig({ ...DEFAULT_CONFIG, ...cfg, days: cfg.days ?? DEFAULT_CONFIG.days });
        setStatus(st);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (overrides?: Partial<ScraperConfig>) => {
    setSaving(true);
    setMessage(null);
    const next: ScraperConfig = { ...config, ...overrides, updatedAt: new Date().toISOString() };
    try {
      await writeJsonToFolder("bank", SCRAPER_CONFIG_FILE, next);
      setConfig(next);
      setMessage({ kind: "ok", text: overrides?.runNowRequestedAt ? "הבקשה נשלחה. המשיכה תתחיל תוך רבע שעה." : "התזמון נשמר." });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "שגיאה בשמירה" });
    } finally {
      setSaving(false);
    }
  };

  const toggleDay = (day: number) => {
    const days = config.days.includes(day) ? config.days.filter((d) => d !== day) : [...config.days, day].sort();
    setConfig({ ...config, days });
  };

  if (!supported) {
    return (
      <div>
        <PageHeader title="משיכה אוטומטית מהבנק" />
        <div className="card flex items-start gap-2.5 border-warn bg-warn-soft p-4 text-sm text-warn-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>הדפדפן הזה לא תומך בקריאת תיקיות. היכולת קיימת ב-Chrome וב-Edge בלבד.</span>
        </div>
      </div>
    );
  }

  const folderReady = folder?.permission === "granted";
  const needsPermission = folder?.permission === "prompt" || folder?.permission === "denied";

  return (
    <div>
      <PageHeader
        title="משיכה אוטומטית מהבנק"
        description="קביעת השעה והימים שבהם הסקרייפר שבמחשב ימשוך תנועות מהבנק. הקבצים יורדים לתיקיית הבנק ונקלטים משם דרך מרכז היבוא."
      />

      {loading ? (
        <p className="text-sm text-ink-muted">טוען...</p>
      ) : needsPermission ? (
        // מצב נפרד מ"לא הוגדרה תיקייה", ובכוונה: הדפדפן שוכח את ההרשאה בכל פעם
        // שהוא נסגר, אז זה המצב הרגיל בבוקר. הודעה של "לא הגדרת תיקייה" הייתה
        // שולחת את המשתמשת להגדיר מחדש משהו שכבר מוגדר.
        <EmptyState
          icon={ShieldCheck}
          title="צריך לאשר גישה לתיקיית הבנק"
          description="התיקייה מוגדרת, אבל הדפדפן שוכח את ההרשאה בכל פעם שהוא נסגר. אישור אחד ואפשר להמשיך."
          action={
            <button
              type="button"
              onClick={async () => {
                await ensureFolderPermission("bank");
                void load();
              }}
              className="btn-primary inline-flex items-center gap-1.5 text-xs"
            >
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              אישור גישה
            </button>
          }
        />
      ) : !folderReady ? (
        <EmptyState
          icon={Settings}
          title="צריך קודם להגדיר את תיקיית הבנק"
          description="התזמון נשמר בקובץ בתוך תיקיית הבנק, ומשם הסקרייפר קורא אותו. בלי התיקייה אין דרך להעביר לו את ההגדרות."
          action={
            <Link to="/admin/folders" className="btn-primary inline-flex items-center gap-1.5 text-xs">
              <Settings className="h-3.5 w-3.5" aria-hidden="true" />
              הגדרת תיקיות קליטה
            </Link>
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-4">
            <div className="card space-y-4 p-4">
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span>
                  <span className="text-sm font-medium text-ink">משיכה אוטומטית מופעלת</span>
                  <span className="block text-xs text-ink-muted">
                    כשזה כבוי הסקרייפר לא ירוץ מעצמו. תמיד אפשר להריץ ידנית מהמחשב.
                  </span>
                </span>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="field-label" htmlFor="scraper-time">
                    שעה
                  </label>
                  <input
                    id="scraper-time"
                    type="time"
                    value={config.time}
                    onChange={(e) => setConfig({ ...config, time: e.target.value })}
                    className="input-field ltr-num"
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="scraper-lookback">
                    כמה ימים אחורה למשוך
                  </label>
                  <input
                    id="scraper-lookback"
                    type="number"
                    min={1}
                    max={365}
                    value={config.lookbackDays}
                    onChange={(e) => setConfig({ ...config, lookbackDays: Number(e.target.value) || 1 })}
                    className="input-field ltr-num"
                  />
                </div>
              </div>

              <fieldset>
                <legend className="field-label">ימים</legend>
                <div className="flex flex-wrap gap-1.5">
                  {DAY_LABELS.map((label, day) => {
                    const active = config.days.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleDay(day)}
                        aria-pressed={active}
                        className={`rounded-control border px-2.5 py-1 text-xs transition ${
                          active ? "border-brand-500 bg-brand-50 font-medium text-brand-700" : "border-line text-ink-muted hover:border-line-strong"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {config.days.length === 0 && (
                  <p className="mt-1.5 text-xs text-warn-ink">לא נבחר אף יום - המשיכה לא תרוץ.</p>
                )}
              </fieldset>

              {message && (
                <div
                  className={`flex items-start gap-2 rounded-control border p-2.5 text-xs ${
                    message.kind === "ok" ? "border-line bg-surface-muted text-ink-muted" : "border-warn bg-warn-soft text-warn-ink"
                  }`}
                >
                  {message.kind === "ok" ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  )}
                  <span>{message.text}</span>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => save()} disabled={saving} className="btn-primary flex items-center gap-1.5 text-xs">
                  <Save className="h-3.5 w-3.5" aria-hidden="true" />
                  שמירת התזמון
                </button>
                <button
                  type="button"
                  onClick={() => save({ runNowRequestedAt: new Date().toISOString() })}
                  disabled={saving}
                  className="btn-secondary flex items-center gap-1.5 text-xs"
                >
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  משיכה עכשיו
                </button>
              </div>
              <p className="flex items-start gap-1.5 text-xs text-ink-subtle">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                "משיכה עכשיו" אינה מיידית: המתזמן במחשב מתעורר כל רבע שעה, ויתחיל למשוך בפעם הקרובה שיתעורר.
              </p>
            </div>

            <StatusPanel status={status} onRefresh={load} />
          </div>

          <aside className="card space-y-3 p-4 text-sm">
            <p className="flex items-center gap-1.5 font-semibold text-ink">
              <Info className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" />
              איך זה מחובר
            </p>
            <p className="text-ink-muted">
              הסקרייפר הוא תוכנה שיושבת על המחשב, לא חלק מהאתר. אתר אינטרנט לא יכול להפעיל תוכנה במחשב ולא רץ כשהדפדפן
              סגור - זו הגנה של הדפדפן.
            </p>
            <p className="text-ink-muted">
              לכן המסך הזה לא מפעיל את הסקרייפר בעצמו. הוא שומר את ההגדרות בקובץ בתוך תיקיית הבנק, ותוכנית קטנה שמותקנת
              פעם אחת במחשב קוראת אותו ומריצה בזמן. אותה תוכנית כותבת בחזרה את הסטטוס שמוצג כאן.
            </p>
            <div className="border-t border-line pt-3">
              <p className="font-medium text-ink">התקנה חד-פעמית במחשב</p>
              <ol className="mt-1.5 list-inside list-decimal space-y-1 text-ink-muted">
                <li>לחיצה כפולה על "התקנת תזמון.bat" בתיקיית הסקרייפר.</li>
                <li>מילוי סיסמאות הבנק בתיקיית secrets שם.</li>
                <li>התחברות ראשונה לכל בנק דורשת דפדפן גלוי - ר' "קרא אותי.txt".</li>
              </ol>
            </div>
            <p className="border-t border-line pt-3 text-xs text-ink-subtle">
              המשיכה רצה רק כשהמחשב דלוק והמשתמש מחובר אליו.
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}
