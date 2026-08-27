import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, HelpCircle, X } from "lucide-react";
import type { ScreenGuide } from "@/lib/screenGuide";

// סימן העזרה שליד כותרת כל מסך.
//
// התשובה הקצרה מופיעה מיד במקום, ולא רק כקישור למדריך: מי שלא מבין מה
// המסך עושה לא ינדוד למסך אחר כדי לברר - הוא פשוט ימשיך בלי להבין.
// הקישור למדריך המלא נשאר שם למי שרוצה יותר.

export function HelpHint({ guide }: { guide: ScreenGuide }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // סגירה בלחיצה בחוץ וב-Escape. בלעדיהן החלונית נשארת פתוחה ומסתירה
  // את המסך שהיא אמורה להסביר.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="relative inline-flex" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`מה עושה המסך ${guide.title}`}
        title="מה המסך הזה עושה?"
        className="rounded-full p-1 text-ink-subtle transition hover:bg-surface-muted hover:text-brand-500"
      >
        <HelpCircle className="h-5 w-5" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`עזרה — ${guide.title}`}
          className="absolute top-8 z-40 w-[22rem] rounded-control border border-line bg-surface p-4 text-right shadow-lg ltr:left-0 rtl:right-0"
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-ink">{guide.title}</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="סגירה"
              className="rounded p-0.5 text-ink-subtle hover:bg-surface-muted"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <p className="text-sm leading-relaxed text-ink-muted">{guide.short}</p>

          {guide.whenToUse && (
            <p className="mt-2 text-xs leading-relaxed text-ink-subtle">
              <span className="font-medium text-ink-muted">מתי נכנסים לכאן: </span>
              {guide.whenToUse}
            </p>
          )}

          <Link
            to={`/admin/guide#${guide.path.replace(/\//g, "-")}`}
            onClick={() => setOpen(false)}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-brand-500 hover:underline"
          >
            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
            למדריך המלא של המסך
          </Link>
        </div>
      )}
    </span>
  );
}
