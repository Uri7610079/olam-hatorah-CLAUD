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
          <Link
            key={s.path}
            to={s.path}
            className="card px-4 py-3 transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <p className="text-sm font-medium text-slate-900">{s.navLabel}</p>
            <p className="mt-1 text-xs text-slate-400">{s.builtInStage}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
