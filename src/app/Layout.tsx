import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useArea } from "./AreaContext";
import { screensForArea } from "./screens";
import { DemoBanner } from "@/components/DemoBanner";
import { supabase } from "@/lib/supabase";

const AREA_LABEL = { ops: "תפעול שוטף", finance: "כספים ובקרה", admin: "ניהול" } as const;
const AREA_TEXT = { ops: "text-ops", finance: "text-finance", admin: "text-admin" } as const;
const AREA_BG_SOFT = { ops: "bg-ops-light", finance: "bg-finance-light", admin: "bg-admin-light" } as const;
const AREA_TAB_ACTIVE = {
  ops: "bg-ops-light text-ops",
  finance: "bg-finance-light text-finance",
  admin: "bg-admin-light text-admin",
} as const;

export function Layout() {
  const { fullName, roleLabel, currentArea, availableAreas } = useArea();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const screens = screensForArea(currentArea);
  const dashboardHref = `/${currentArea}`;
  const initial = (fullName ?? "מ").trim().charAt(0);

  return (
    <div className="flex min-h-screen flex-col">
      <DemoBanner />
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <button
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
          aria-label="פתח תפריט"
          onClick={() => setSidebarOpen((v) => !v)}
        >
          ☰
        </button>
        <button onClick={() => navigate(dashboardHref)} className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white">
            עת
          </span>
          <span className="hidden font-bold text-slate-900 sm:inline">עולם התורה</span>
        </button>

        <input
          type="search"
          placeholder="חיפוש גלובלי: תלמיד, קבוצה, סניף, אסמכתה…"
          aria-label="חיפוש גלובלי"
          className="input-field mx-2 hidden w-80 sm:block"
        />

        <div className="flex-1" />

        {availableAreas.length > 1 && (
          <div className="hidden gap-1 rounded-lg bg-slate-100 p-1 sm:flex" role="tablist" aria-label="מתג אזור">
            {availableAreas.map((area) => (
              <button
                key={area}
                role="tab"
                aria-selected={currentArea === area}
                onClick={() => navigate(`/${area}`)}
                className={`rounded-md px-3 py-1 text-sm font-medium transition ${
                  currentArea === area ? `${AREA_TAB_ACTIVE[area]} shadow-sm` : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {AREA_LABEL[area]}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-slate-600">
          <span className="hidden items-center gap-2 sm:flex">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
              {initial}
            </span>
            <span>
              {fullName ?? "משתמש"}
              {roleLabel && <span className="text-slate-400"> · {roleLabel}</span>}
            </span>
          </span>
          <button onClick={() => supabase.auth.signOut()} className="btn-secondary px-2.5 py-1.5 text-xs">
            התנתקות
          </button>
        </div>
      </header>

      <div className="flex flex-1">
        <aside
          className={`${
            sidebarOpen ? "block" : "hidden"
          } w-64 shrink-0 border-l border-slate-200 bg-white p-3 lg:block`}
        >
          <p className={`mb-2 px-2 text-xs font-semibold uppercase tracking-wide ${AREA_TEXT[currentArea]}`}>
            {AREA_LABEL[currentArea]}
          </p>
          <nav className="space-y-0.5">
            <NavLink
              to={dashboardHref}
              end
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm transition ${
                  isActive
                    ? `${AREA_BG_SOFT[currentArea]} ${AREA_TEXT[currentArea]} font-medium`
                    : "text-slate-600 hover:bg-slate-50"
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
                  `block rounded-lg px-3 py-2 text-sm transition ${
                    isActive
                      ? `${AREA_BG_SOFT[currentArea]} ${AREA_TEXT[currentArea]} font-medium`
                      : "text-slate-600 hover:bg-slate-50"
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
