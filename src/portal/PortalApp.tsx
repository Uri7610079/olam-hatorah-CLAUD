import { useEffect, useState, type FormEvent } from "react";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { LogOut, MessageCircleQuestion, Users, ClipboardList, MessagesSquare } from "lucide-react";
import { portalLogin, portalLogout, portalRpc, portalToken, PortalSessionExpired, type PortalMe } from "./portalApi";
import { PortalStudents } from "./PortalStudents";
import { PortalRequests, PortalQuestions } from "./PortalHistory";
import { AskDialog } from "./PortalDialogs";

// אזור ראשי הקבוצות. נטען רק בכתובת /portal, מחוץ למערכת המשרד: בלי
// תפריט, בלי חיפוש גלובלי ובלי שום מסך אחר. מתוכנן קודם כל למחשב - לרבים
// מראשי הקבוצות אין טלפון חכם - בגופן גדול, ובמילים של יום-יום.

// חיבור שפג באמצע עבודה (30 דקות בלי פעילות, או שהמשרד שינה סיסמה) מחזיר
// למסך הכניסה מכל מקום - שאילתה או שליחה - עם הסבר, ולא עם הודעת שגיאה.
let handleExpired = () => {};
const onError = (error: unknown) => { if (error instanceof PortalSessionExpired) handleExpired(); };

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) => !(error instanceof PortalSessionExpired) && count < 1,
    },
  },
});

export default function PortalApp() {
  const [loggedIn, setLoggedIn] = useState(() => !!portalToken.get());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    handleExpired = () => {
      queryClient.clear();
      setLoggedIn(false);
      setNotice("החיבור הסתיים (אחרי 30 דקות בלי פעילות, או שהסיסמה שונתה). יש להיכנס שוב.");
    };
    return () => { handleExpired = () => {}; };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <div dir="rtl" className="min-h-screen bg-surface-muted text-[17px] text-ink">
        {loggedIn ? (
          <PortalShell
            onLogout={async () => {
              await portalLogout();
              queryClient.clear();
              setLoggedIn(false);
              setNotice(null);
            }}
          />
        ) : (
          <PortalLogin notice={notice} onLoggedIn={() => { setNotice(null); setLoggedIn(true); }} />
        )}
      </div>
    </QueryClientProvider>
  );
}

function PortalLogin({ notice, onLoggedIn }: { notice: string | null; onLoggedIn: () => void }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await portalLogin(identifier, password);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "הכניסה נכשלה.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-md space-y-5 p-8">
        <div>
          <p className="text-sm font-semibold text-brand-500">עולם התורה</p>
          <h1 className="mt-1 text-3xl font-bold">כניסת ראשי קבוצות</h1>
        </div>

        {notice && <p className="rounded-control bg-warn-soft p-3 text-base text-warn-ink">{notice}</p>}

        <div>
          <label htmlFor="portal-id" className="field-label text-base">מייל (או טלפון, למי שאין מייל)</label>
          <input
            id="portal-id"
            dir="ltr"
            autoComplete="username"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            className="input-field h-12 text-right text-lg"
            placeholder="name@gmail.com"
            autoFocus
          />
        </div>
        <div>
          <label htmlFor="portal-pw" className="field-label text-base">סיסמה</label>
          <input
            id="portal-pw"
            type="password"
            dir="ltr"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-field h-12 text-right text-lg"
          />
          <p className="mt-1 text-sm text-ink-muted">בכניסה הראשונה: 4 הספרות האחרונות של הטלפון שלך.</p>
        </div>

        {error && <p role="alert" className="rounded-control bg-danger-soft p-3 text-base text-danger-ink">{error}</p>}

        <button type="submit" disabled={busy} className="btn-primary h-12 w-full text-lg">
          {busy ? "נכנס…" : "כניסה"}
        </button>
        <p className="text-center text-sm text-ink-muted">שכחת סיסמה? יש להתקשר למשרד.</p>
      </form>
    </main>
  );
}

type Tab = "students" | "requests" | "questions";

function PortalShell({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("students");
  const [asking, setAsking] = useState(false);
  const me = useQuery({ queryKey: ["portal-me"], queryFn: () => portalRpc<PortalMe>("portal_me") });

  const TABS: { key: Tab; label: string; icon: typeof Users }[] = [
    { key: "students", label: "התלמידים שלי", icon: Users },
    { key: "requests", label: "העדכונים שלי", icon: ClipboardList },
    { key: "questions", label: "השאלות שלי", icon: MessagesSquare },
  ];

  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <p className="text-sm text-ink-muted">עולם התורה · אזור ראשי קבוצות</p>
            <p className="text-xl font-bold">{me.data ? `שלום ${me.data.name}` : "שלום"}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setAsking(true)} className="btn-primary flex h-11 items-center gap-2 px-4 text-base">
              <MessageCircleQuestion className="h-5 w-5" aria-hidden="true" />
              שאלה למשרד
            </button>
            <button onClick={onLogout} className="btn-secondary flex h-11 items-center gap-2 px-4 text-base">
              <LogOut className="h-5 w-5" aria-hidden="true" />
              יציאה
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 px-4" aria-label="אזורים">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              aria-current={tab === t.key ? "page" : undefined}
              className={`flex items-center gap-2 border-b-[3px] px-4 py-3 text-base font-semibold transition ${
                tab === t.key ? "border-brand-500 text-ink" : "border-transparent text-ink-muted hover:text-ink"
              }`}
            >
              <t.icon className="h-5 w-5" aria-hidden="true" />
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {tab === "students" && <PortalStudents groups={me.data?.groups ?? []} />}
        {tab === "requests" && <PortalRequests />}
        {tab === "questions" && <PortalQuestions onAsk={() => setAsking(true)} />}
      </main>

      {asking && <AskDialog onClose={() => setAsking(false)} onSent={() => setTab("questions")} />}
    </>
  );
}
