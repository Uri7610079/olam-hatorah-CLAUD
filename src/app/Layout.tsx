import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, ClipboardList, Wallet, Settings, CheckSquare, LogOut, Menu, type LucideIcon } from "lucide-react";
import { useArea, type Area } from "./AreaContext";
import { screensForArea } from "./screens";
import { DemoBanner } from "@/components/DemoBanner";
import { GlobalSearch } from "@/components/GlobalSearch";
import { supabase } from "@/lib/supabase";

export const AREA_LABEL = { ops: "תפעול שוטף", finance: "כספים ובקרה", admin: "ניהול", tasks: "משימות ותזכורות" } as const;
export const AREA_ICON: Record<Area, LucideIcon> = { ops: ClipboardList, finance: Wallet, admin: Settings, tasks: CheckSquare };

export function Layout() {
  const { fullName, roleLabel, currentArea, availableAreas, areasLoaded, homeArea, pathArea } = useArea();
  // כתובת ישירה לאזור שאין למשתמש הרשאה אליו: לא מציגים את המסכים שלו. הנתונים עצמם
  // מוגנים גם בשרת, אבל עד היום המסך נפתח ריק או עם שגיאות, כאילו אין נתונים.
  const areaBlocked = areasLoaded && pathArea !== null && !availableAreas.includes(pathArea);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const screens = screensForArea(currentArea);
  const dashboardHref = `/${currentArea}`;
  const initial = (fullName ?? "מ").trim().charAt(0);
  const AreaHeaderIcon = AREA_ICON[currentArea];

  // צבע האזור מוזרם דרך data-area על <html>, כך שכל רכיב שמשתמש ב-area/area-soft
  // מקבל את הגוון הנכון אוטומטית - בלי להעביר את האזור כ-prop דרך כל עץ הרכיבים.
  useEffect(() => {
    document.documentElement.setAttribute("data-area", currentArea);
  }, [currentArea]);

  // בטלפון: התפריט נסגר אחרי מעבר מסך (עד היום נשאר פתוח ודחף את התוכן הצידה),
  // וגם במקש Esc.
  const { pathname } = useLocation();
  useEffect(() => setSidebarOpen(false), [pathname]);
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSidebarOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);

  return (
    <div className="flex min-h-screen flex-col">
      <DemoBanner />

      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
        <button
          className="rounded-control p-2 text-ink-muted hover:bg-surface-muted lg:hidden"
          aria-label={sidebarOpen ? "סגירת התפריט" : "פתיחת התפריט"}
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen((v) => !v)}
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>

        <button onClick={() => navigate(dashboardHref)} className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-control bg-brand-600 text-xs font-bold text-white v3:bg-primary">
            עת
          </span>
          <span className="hidden font-bold text-ink sm:inline v3:text-primary">עולם התורה</span>
        </button>

        <GlobalSearch />

        <div className="flex-1" />

        {/* מתג אזורים - האזור הפעיל מסומן במילוי מלא בצבע האזור, לא רק בגוון עדין,
            כדי שיהיה חד-משמעי באיזה אזור נמצאים. */}
        {availableAreas.length > 1 && (
          <div className="hidden gap-1 rounded-control bg-surface-muted p-1 sm:flex" role="tablist" aria-label="מתג אזור">
            {availableAreas.map((area) => {
              const AreaIcon = AREA_ICON[area];
              const isActive = currentArea === area;
              return (
                <button
                  key={area}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => navigate(`/${area}`)}
                  className={`flex items-center gap-1.5 rounded-[calc(var(--ui-radius-control)-2px)] px-3 py-1 text-sm font-medium transition ${
                    isActive ? "bg-area text-area-on" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  <AreaIcon className="h-4 w-4" aria-hidden="true" />
                  {AREA_LABEL[area]}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-ink-muted">
          <span className="hidden items-center gap-2 sm:flex">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-ink-muted">
              {initial}
            </span>
            <span>
              {fullName ?? "משתמש"}
              {roleLabel && <span className="text-ink-subtle"> · {roleLabel}</span>}
            </span>
          </span>
          <button onClick={() => supabase.auth.signOut()} className="btn-secondary px-2.5 py-1.5 text-xs" title="התנתקות מהמערכת">
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">התנתקות</span>
          </button>
        </div>
      </header>

      <div className="flex flex-1">
        {/* בטלפון התפריט נפתח מעל התוכן, עם רקע כהה שסוגר אותו בלחיצה - במקום
            לדחוף את המסך הצידה. במחשב (lg) - בדיוק כמו קודם. */}
        {sidebarOpen && (
          <div className="fixed inset-0 top-[3.25rem] z-30 bg-ink/30 lg:hidden" aria-hidden="true" onClick={() => setSidebarOpen(false)} />
        )}
        <aside
          className={`${sidebarOpen ? "block" : "hidden"} fixed inset-y-0 right-0 top-[3.25rem] z-40 w-72 max-w-[85vw] overflow-y-auto border-l border-line bg-surface shadow-lg lg:sticky lg:inset-auto lg:top-[3.25rem] lg:z-auto lg:block lg:h-[calc(100vh-3.25rem)] lg:w-64 lg:max-w-none lg:shrink-0 lg:self-start lg:shadow-none`}
        >
          {/* מעבר בין אזורים בטלפון - המתג שבסרגל העליון מוסתר ברוחב צר, ועד
              היום לא הייתה דרך להחליף אזור מהטלפון. */}
          {availableAreas.length > 1 && (
            <div className="grid grid-cols-2 gap-1 border-b border-line p-2 lg:hidden" aria-label="מעבר בין אזורים">
              {availableAreas.map((area) => {
                const AreaIcon = AREA_ICON[area];
                const isActive = currentArea === area;
                return (
                  <button
                    key={area}
                    onClick={() => navigate(`/${area}`)}
                    aria-current={isActive ? "true" : undefined}
                    className={`flex items-center gap-1.5 rounded-control px-2 py-2 text-sm font-medium ${isActive ? "bg-area text-area-on" : "text-ink-muted hover:bg-surface-muted"}`}
                  >
                    <AreaIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {AREA_LABEL[area]}
                  </button>
                );
              })}
            </div>
          )}
          {/* כותרת האזור - פס צבע בצד ואייקון, כדי שהאזור הנוכחי יזוהה מיד גם
              בלי לקרוא את הטקסט. */}
          <div className="border-b border-line bg-area-soft px-3 py-3">
            <p className="flex items-center gap-2 border-e-[3px] border-area pe-2 text-sm font-semibold text-area">
              <AreaHeaderIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {AREA_LABEL[currentArea]}
            </p>
          </div>

          <nav className="space-y-0.5 p-3">
            <NavLink
              to={dashboardHref}
              end
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-control px-3 py-2 text-sm transition ${
                  isActive ? "bg-area-soft font-semibold text-area v3:shadow-[inset_-3px_0_0_rgb(var(--ui-area))]" : "text-ink-muted hover:bg-surface-muted hover:text-ink"
                }`
              }
            >
              <LayoutDashboard className="h-4 w-4 shrink-0" aria-hidden="true" />
              מסך פתיחה
            </NavLink>
            {screens.map((s) => (
              <div key={s.path}>
              {s.sectionTitle && (
                <p className="px-3 pb-1 pt-4 text-[11px] font-semibold tracking-wide text-ink-subtle v3:text-[0.8125rem] v3:text-ink-muted">{s.sectionTitle}</p>
              )}
              <NavLink
                to={s.path}
                // מסך שהנתיב שלו הוא גם מסך הפתיחה של האזור (למשל /tasks) - רק בהתאמה מדויקת,
                // אחרת הוא נדלק יחד עם "מסך פתיחה" ועם כל מסך שמתחתיו.
                end={s.path === dashboardHref}
                title={s.description}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-control px-3 py-2 text-sm transition ${
                    isActive ? "bg-area-soft font-semibold text-area v3:shadow-[inset_-3px_0_0_rgb(var(--ui-area))]" : "text-ink-muted hover:bg-surface-muted hover:text-ink"
                  }`
                }
              >
                <s.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {s.navLabel}
              </NavLink>
              </div>
            ))}
          </nav>
        </aside>

        {/* max-w ולא רוחב מלא: בלי תקרה, טבלה עם שלוש עמודות קצרות נמתחה על פני
            כל המסך הרחב - הקוד בקצה אחד והסטטוס בקצה השני, עם חלל ריק ביניהם
            שהעין צריכה לחצות כדי לקשר ביניהם. התקרה נדיבה מספיק לטבלאות הרחבות
            באמת (תלמידים, התאמות בנק), וחוסמת את הפריסה המיותרת בשאר. */}
        <main className="mx-auto w-full min-w-0 max-w-[1400px] flex-1 p-4 sm:p-6">
          {areaBlocked ? (
            <div className="card mx-auto mt-10 max-w-md p-6 text-center">
              <p className="font-semibold text-ink">אין לך הרשאה לאזור הזה</p>
              <p className="mt-1 text-sm text-ink-muted">אם צריך גישה, יש לפנות למנהל המערכת.</p>
              {homeArea && <Link to={`/${homeArea}`} className="link-action mt-4 inline-block text-sm">חזרה לאזור שלי</Link>}
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
}
