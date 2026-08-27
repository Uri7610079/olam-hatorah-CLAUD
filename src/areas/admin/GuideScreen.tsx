import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, BookOpen, Search } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { SCREEN_GUIDES, AREA_GUIDE } from "@/lib/screenGuide";
import { SCREENS } from "@/app/screens";

// מדריך המערכת.
//
// הכתיבה מכוונת למי שאינו איש מקצוע, ולכן כל מסך עונה על שלוש שאלות
// באותו סדר: מה הוא עושה, מתי נכנסים אליו, ומה עלול להשתבש. הסעיף
// האחרון הוא החשוב מכולם - שם נמצאים הדברים שנראים כתקלה ואינם, ואלה
// שקורים בשקט ואיש לא שם לב.
//
// המקור הוא אותו קובץ שמזין את סימן העזרה שבכל מסך, כדי ששניהם לא
// ייפרדו זה מזה.

const AREA_ORDER = ["ops", "finance", "admin", "tasks"] as const;
const anchorOf = (path: string) => path.replace(/\//g, "-");

export function GuideScreen() {
  const [query, setQuery] = useState("");

  // גלילה לעוגן אחרי שהתוכן מרונדר. בלי ההשהיה הדפדפן מחפש עוגן שעדיין
  // אינו קיים, ומי שהגיע מסימן העזרה נוחת בראש הדף במקום במסך שביקש.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const t = setTimeout(() => {
      document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => clearTimeout(t);
  }, []);

  const iconFor = useMemo(() => {
    const m = new Map(SCREENS.map((s) => [s.path, s.icon]));
    return (path: string) => m.get(path);
  }, []);

  const q = query.trim();
  const filtered = useMemo(() => {
    if (!q) return SCREEN_GUIDES;
    const hay = (g: (typeof SCREEN_GUIDES)[number]) =>
      [g.title, g.short, g.whenToUse ?? "",
       ...(g.sections ?? []).flatMap((s) => [s.heading, ...s.body]),
       ...(g.watchOut ?? [])].join(" ");
    return SCREEN_GUIDES.filter((g) => hay(g).includes(q));
  }, [q]);

  const areaOf = (path: string) => SCREENS.find((s) => s.path === path)?.area ?? "ops";

  return (
    <div>
      <PageHeader
        title="מדריך המערכת"
        description="מה כל מסך עושה, מתי נכנסים אליו, ומה עלול להשתבש. אפשר להגיע לכאן גם מסימן השאלה שליד כותרת כל מסך."
      />

      <div className="mb-6 max-w-md">
        <label className="field-label" htmlFor="guide-search">חיפוש במדריך</label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle ltr:left-3 rtl:right-3" aria-hidden="true" />
          <input
            id="guide-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="למשל: עמלה, שיוך, מס״ב, סיסמה"
            className="input-field ps-9"
          />
        </div>
        {q && (
          <p className="mt-1 text-xs text-ink-subtle">
            {filtered.length} מסכים תואמים
          </p>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="לא נמצא" description="אפשר לנסות מילה אחרת, או לגלול את המדריך המלא." icon={BookOpen} />
      ) : (
        AREA_ORDER.map((area) => {
          const inArea = filtered.filter((g) => areaOf(g.path) === area);
          if (inArea.length === 0) return null;
          const meta = AREA_GUIDE[area];
          return (
            <section key={area} className="mb-10">
              <h2 className="text-lg font-bold text-ink">{meta.label}</h2>
              <p className="mt-1 mb-4 max-w-3xl text-sm leading-relaxed text-ink-muted">{meta.intro}</p>

              <div className="space-y-4">
                {inArea.map((g) => {
                  const Icon = iconFor(g.path);
                  return (
                    <article key={g.path} id={anchorOf(g.path)} className="card scroll-mt-24 p-5">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <h3 className="flex items-center gap-2 text-base font-semibold text-ink">
                          {Icon && <Icon className="h-4 w-4 shrink-0 text-brand-500" aria-hidden="true" />}
                          {g.title}
                        </h3>
                        <Link to={g.path} className="inline-flex items-center gap-1 text-xs text-brand-500 hover:underline">
                          למסך
                          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      </div>

                      <p className="text-sm leading-relaxed text-ink">{g.short}</p>

                      {g.whenToUse && (
                        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                          <span className="font-medium text-ink">מתי נכנסים לכאן: </span>
                          {g.whenToUse}
                        </p>
                      )}

                      {g.sections?.map((s) => (
                        <div key={s.heading} className="mt-4">
                          <p className="text-sm font-medium text-ink">{s.heading}</p>
                          {s.body.map((b, i) => (
                            <p key={i} className="mt-1 text-sm leading-relaxed text-ink-muted">{b}</p>
                          ))}
                        </div>
                      ))}

                      {g.watchOut && g.watchOut.length > 0 && (
                        <div className="mt-4 rounded-control border border-warn/30 bg-warn-soft p-3">
                          <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-warn-ink">
                            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                            שים לב
                          </p>
                          <ul className="space-y-1">
                            {g.watchOut.map((w, i) => (
                              <li key={i} className="text-sm leading-relaxed text-warn-ink">· {w}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
