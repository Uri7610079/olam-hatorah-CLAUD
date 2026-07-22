import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useArea, ROLE_LABELS, type MockRole } from "./AreaContext";
import { screensForArea } from "./screens";
import { DemoBanner } from "@/components/DemoBanner";

const AREA_LABEL = { ops: "תפעול שוטף", finance: "כספים ובקרה", admin: "ניהול" } as const;
const AREA_ACCENT = {
  ops: "border-ops text-ops",
  finance: "border-finance text-finance",
  admin: "border-admin text-admin",
} as const;

export function Layout() {
  const { role, setRole, currentArea, availableAreas } = useArea();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const screens = screensForArea(currentArea);
  const dashboardHref = `/${currentArea}`;

  return (
    <div className="flex min-h-screen flex-col">
      <DemoBanner />
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <button
          className="rounded-md p-2 hover:bg-slate-100 lg:hidden"
          aria-label="פתח תפריט"
          onClick={() => setSidebarOpen((v) => !v)}
        >
          ☰
        </button>
        <button
          onClick={() => navigate(dashboardHref)}
          className="font-bold text-slate-900 hover:text-slate-700"
        >
          עולם התורה
        </button>

        <input
          type="search"
          placeholder="חיפוש גלובלי: תלמיד, קבוצה, סניף, אסמכתה…"
          aria-label="חיפוש גלובלי"
          className="mx-2 hidden w-80 rounded-md border border-slate-300 px-3 py-1.5 text-sm sm:block"
        />

        <div className="flex-1" />

        {availableAreas.length > 1 && (
          <div className="hidden gap-1 sm:flex" role="tablist" aria-label="מתג אזור">
            {availableAreas.map((area) => (
              <button
                key={area}
                role="tab"
                aria-selected={currentArea === area}
                onClick={() => navigate(`/${area}`)}
                className={`rounded-md border px-3 py-1 text-sm ${
                  currentArea === area
                    ? `${AREA_ACCENT[area]} bg-slate-50`
                    : "border-transparent text-slate-500 hover:bg-slate-50"
                }`}
              >
                {AREA_LABEL[area]}
              </button>
            ))}
          </div>
        )}

        {/* סימולטור תפקידים לצורכי פיתוח בלבד — יוסר כשיהיה Auth אמיתי בשלב 2 */}
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as MockRole)}
          aria-label="סימולציית תפקיד (זמני, לפיתוח בלבד)"
          className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-600"
        >
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </header>

      <div className="flex flex-1">
        <aside
          className={`${
            sidebarOpen ? "block" : "hidden"
          } w-64 shrink-0 border-l border-slate-200 bg-white p-3 lg:block`}
        >
          <p className={`mb-2 px-2 text-xs font-semibold uppercase ${AREA_ACCENT[currentArea]}`}>
            {AREA_LABEL[currentArea]}
          </p>
          <nav className="space-y-0.5">
            <NavLink
              to={dashboardHref}
              end
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm ${
                  isActive ? "bg-slate-100 font-medium text-slate-900" : "text-slate-600 hover:bg-slate-50"
                }`
              }
            >
              Dashboard
            </NavLink>
            {screens.map((s) => (
              <NavLink
                key={s.path}
                to={s.path}
                className={({ isActive }) =>
                  `block rounded-md px-3 py-2 text-sm ${
                    isActive ? "bg-slate-100 font-medium text-slate-900" : "text-slate-600 hover:bg-slate-50"
                  }`
                }
              >
                {s.navLabel}
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
