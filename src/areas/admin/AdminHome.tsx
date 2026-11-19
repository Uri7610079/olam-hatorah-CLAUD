import { PageHeader } from "@/components/PageHeader";
import { Link } from "react-router-dom";
import { screensForArea } from "@/app/screens";

export function AdminHome() {
  const screens = screensForArea("admin");
  return (
    <div>
      <PageHeader title="ניהול" description="הגדרות מערכת, הרשאות ונתוני דמו." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {screens.map((s) => (
          <Link key={s.path} to={s.path} className="card flex items-start gap-3 px-4 py-3.5 transition hover:-translate-y-0.5 hover:shadow-md v3:hover:translate-y-0 v3:hover:border-brand-300 v3:hover:shadow-none">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-admin-light text-admin">
              <s.icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-medium text-ink v3:font-semibold v3:text-primary">{s.navLabel}</p>
              {/* עד היום הוצג כאן "שלב 26" - מספר שלב פיתוח שלא אומר דבר למשתמש.
                  במקומו - תיאור המסך, כשיש. */}
              {s.description && <p className="mt-1 text-xs text-ink-subtle">{s.description}</p>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
