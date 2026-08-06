import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FolderOpen, Folder, Landmark, AlertTriangle, Info, ArrowLeft, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import {
  DONE_DIR,
  ensureFolderPermission,
  FAILED_DIR,
  FOLDER_LABEL,
  forgetFolder,
  getFolderStatus,
  isFolderAccessSupported,
  pickFolder,
  type FolderKey,
  type FolderStatus,
} from "@/lib/folderAccess";

const FOLDERS: { key: FolderKey; icon: typeof Folder; description: string }[] = [
  {
    key: "bank",
    icon: Landmark,
    description:
      "התיקייה שהסקרייפר מוריד אליה את דפי הבנק. סוג הקובץ ידוע מראש ולכן אין כאן שלב זיהוי - הקבצים נקלטים כתנועות בנק.",
  },
  {
    key: "general",
    icon: Folder,
    description:
      "תיקייה לכל אקסל אחר - תלמידים, זכאות, ביקורות, רשימות טלפון וכו'. אפשר פשוט לזרוק לשם קובץ, והמערכת מזהה בעצמה לאיזה סוג הוא שייך.",
  },
];

function PermissionBadge({ status }: { status: FolderStatus }) {
  switch (status.permission) {
    case "granted":
      return <StatusBadge severity="ok" label="מחוברת" />;
    case "prompt":
      return <StatusBadge severity="medium" label="ממתינה לאישור" />;
    case "denied":
      return <StatusBadge severity="critical" label="הגישה נדחתה" />;
    default:
      return <StatusBadge severity="neutral" label="לא הוגדרה" />;
  }
}

function FolderCard({
  folderKey,
  icon: Icon,
  description,
  status,
  onChanged,
}: {
  folderKey: FolderKey;
  icon: typeof Folder;
  description: string;
  status: FolderStatus | null;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const choose = async () => {
    setError(null);
    try {
      await pickFolder(folderKey);
      onChanged();
    } catch (e) {
      // ביטול בחלון הבחירה הוא לא שגיאה - הדפדפן זורק AbortError גם כשפשוט נסגר החלון.
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "שגיאה בבחירת התיקייה");
    }
  };

  // הדפדפן שוכח את ההרשאה בין הפעלות, והתיקייה עצמה נשארת זכורה. בלי הכפתור הזה
  // המשתמשת הייתה צריכה לבחור את התיקייה מחדש בכל בוקר, כאילו לא הגדירה כלום.
  const grant = async () => {
    setError(null);
    try {
      await ensureFolderPermission(folderKey);
      onChanged();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "שגיאה באישור הגישה");
    }
  };

  const remove = async () => {
    await forgetFolder(folderKey);
    onChanged();
  };

  const isSet = status !== null && status.permission !== "missing" && status.permission !== "unsupported";

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-admin-light text-admin">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">{FOLDER_LABEL[folderKey]}</p>
            <p className="mt-1 text-sm text-ink-muted">{description}</p>
          </div>
        </div>
        {status && <PermissionBadge status={status} />}
      </div>

      {isSet && (
        <p className="flex items-center gap-1.5 text-sm text-ink">
          <FolderOpen className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" />
          <span className="font-medium ltr-num">{status?.name}</span>
        </p>
      )}

      {status?.permission === "prompt" && (
        <div className="flex items-start gap-2 rounded-control border border-warn bg-warn-soft p-2.5 text-xs text-warn-ink">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>התיקייה זכורה, אבל הדפדפן שכח את ההרשאה מאז שנסגר. לחיצה על "אישור גישה" ותכף חוזרים לעבוד.</span>
        </div>
      )}

      {status?.permission === "denied" && (
        <div className="flex items-start gap-2 rounded-control border border-warn bg-warn-soft p-2.5 text-xs text-warn-ink">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>הדפדפן חוסם את הגישה לתיקייה הזו. בחרי אותה מחדש כדי לאשר.</span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-control border border-warn bg-warn-soft p-2.5 text-xs text-warn-ink">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {status?.permission === "prompt" && (
          <button type="button" onClick={grant} className="btn-primary text-xs">
            אישור גישה
          </button>
        )}
        <button type="button" onClick={choose} className={status?.permission === "prompt" ? "btn-secondary text-xs" : "btn-primary text-xs"}>
          {isSet ? "בחירת תיקייה אחרת" : "בחירת תיקייה"}
        </button>
        {isSet && (
          <button type="button" onClick={remove} className="btn-secondary flex items-center gap-1.5 text-xs">
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            ניתוק
          </button>
        )}
      </div>
    </div>
  );
}

// מסך ההגדרות של תיקיות הקליטה. כאן רק מגדירים היכן הקבצים נמצאים; הקליטה עצמה
// מתבצעת ב"מרכז יבוא" תחת הלשונית "קבצים מהתיקייה", כדי שכל היבוא יישאר במקום אחד.
//
// ההגדרה נשמרת במחשב הזה ובדפדפן הזה בלבד, ולא במסד הנתונים - וזה נכון עניינית:
// נתיב תיקייה מקומי חסר משמעות במחשב אחר, ושמירה שלו בשרת הייתה יוצרת רושם שגוי
// שההגדרה משותפת לכל המשתמשים.
export function FoldersScreen() {
  const [statuses, setStatuses] = useState<Record<FolderKey, FolderStatus | null>>({ general: null, bank: null });
  const supported = isFolderAccessSupported();

  const refresh = useCallback(async () => {
    const [general, bank] = await Promise.all([getFolderStatus("general"), getFolderStatus("bank")]);
    setStatuses({ general, bank });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div>
      <PageHeader
        title="תיקיות קליטה"
        description="הגדרת התיקיות שבמחשב שמהן המערכת קולטת קבצי אקסל. אפשר לזרוק קובץ לתיקייה במקום להעלות אותו ידנית - העלאה ידנית ממשיכה לעבוד בדיוק כמו קודם."
      />

      {!supported ? (
        <div className="card flex items-start gap-2.5 border-warn bg-warn-soft p-4 text-sm text-warn-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">הדפדפן הזה לא תומך בקריאת תיקיות</p>
            <p className="mt-1">
              היכולת קיימת ב-Chrome וב-Edge בלבד. אפשר להמשיך לעבוד רגיל - העלאת קבצים ידנית ב"מרכז יבוא" עובדת בכל
              דפדפן.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-3">
            {FOLDERS.map((f) => (
              <FolderCard
                key={f.key}
                folderKey={f.key}
                icon={f.icon}
                description={f.description}
                status={statuses[f.key]}
                onChanged={refresh}
              />
            ))}

            <Link to="/ops/import-center" className="btn-secondary inline-flex items-center gap-1.5 text-xs">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              מעבר למרכז יבוא כדי לקלוט קבצים
            </Link>
          </div>

          <aside className="card space-y-3 p-4 text-sm">
            <p className="flex items-center gap-1.5 font-semibold text-ink">
              <Info className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" />
              איך זה עובד
            </p>
            <ol className="list-inside list-decimal space-y-1.5 text-ink-muted">
              <li>בוחרים כאן תיקייה. הדפדפן ישאל אישור פעם אחת.</li>
              <li>זורקים לתיקייה קבצי אקסל, או שהסקרייפר מוריד אליה לבד.</li>
              <li>
                נכנסים ל"מרכז יבוא" ← "קבצים מהתיקייה". המערכת מציגה מה מצאה ומה זיהתה, ותמיד מחכה לאישור לפני קליטה.
              </li>
              <li>
                אחרי הטיפול הקובץ עובר לתת-תיקייה <span className="font-medium">{DONE_DIR}</span> או{" "}
                <span className="font-medium">{FAILED_DIR}</span>, כך שתמיד ברור מה כבר טופל.
              </li>
            </ol>
            <p className="border-t border-line pt-3 text-xs text-ink-subtle">
              המערכת קוראת את התיקייה רק כשהיא פתוחה בדפדפן - כך הדפדפן מגן על הקבצים במחשב. בפועל זו לחיצה אחת בבוקר,
              ואין צורך להשאיר שום דבר פתוח ברקע.
            </p>
            <p className="text-xs text-ink-subtle">ההגדרה נשמרת במחשב ובדפדפן הזה בלבד, ולא עוברת למשתמשים אחרים.</p>
          </aside>
        </div>
      )}
    </div>
  );
}
