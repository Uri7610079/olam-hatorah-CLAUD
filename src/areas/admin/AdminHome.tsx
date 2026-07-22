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
          <Link key={s.path} to={s.path} className="card flex items-start gap-3 px-4 py-3.5 transition hover:-translate-y-0.5 hover:shadow-md">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-admin-light text-admin">
              <s.icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-medium text-slate-900">{s.navLabel}</p>
              <span className="mt-1.5 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                {s.builtInStage}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
