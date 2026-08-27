import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { SCREENS } from "@/app/screens";
import { AREA_ICON, AREA_LABEL } from "@/app/Layout";
import { Breadcrumbs, type BreadcrumbItem } from "./Breadcrumbs";
import { HelpHint } from "./HelpHint";
import { guideForPath } from "@/lib/screenGuide";

interface PageHeaderProps {
  title: string;
  description?: string;
  primaryAction?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
}

// מאתר את המסך שממנו הגיע הנתיב הנוכחי. מסכי פירוט (/ops/students/:id) אינם
// רשומים ב-SCREENS בעצמם - לכן נבחרת ההתאמה הארוכה ביותר שהנתיב מתחיל בה, כך
// שגם כרטיס תלמיד יודע שהוא שייך ל"תלמידים" שבתפעול.
function findCurrentScreen(pathname: string) {
  let best: (typeof SCREENS)[number] | null = null;
  for (const screen of SCREENS) {
    if (pathname === screen.path || pathname.startsWith(screen.path + "/")) {
      if (!best || screen.path.length > best.path.length) best = screen;
    }
  }
  return best;
}

export function PageHeader({ title, description, primaryAction, breadcrumbs }: PageHeaderProps) {
  const { pathname } = useLocation();
  const screen = findCurrentScreen(pathname);
  const guide = guideForPath(pathname);
  const AreaIcon = screen ? AREA_ICON[screen.area] : null;

  return (
    <div className="mb-6 border-b border-line pb-5">
      {/* שורת מיקום קבועה: אזור ← מסך. נגזרת אוטומטית מהנתיב, כך שכל מסך מקבל
          אותה בלי לשנות אף קובץ מסך בנפרד. */}
      {screen && AreaIcon && (
        <nav aria-label="מיקום במערכת" className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
          <Link
            to={`/${screen.area}`}
            className="inline-flex items-center gap-1.5 rounded-control bg-area-soft px-2 py-1 font-medium text-area transition hover:brightness-95"
          >
            <AreaIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {AREA_LABEL[screen.area]}
          </Link>
          <ChevronLeft className="h-3.5 w-3.5 text-ink-subtle" aria-hidden="true" />
          <span className="text-ink-muted">{screen.navLabel}</span>
        </nav>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}
          <h1 className="flex items-center gap-1.5 text-2xl font-bold tracking-tight text-ink">
            {title}
            {guide && <HelpHint guide={guide} />}
          </h1>
          {description && <p className="mt-1.5 text-sm text-ink-muted">{description}</p>}
        </div>
        {primaryAction && <div>{primaryAction}</div>}
      </div>
    </div>
  );
}
