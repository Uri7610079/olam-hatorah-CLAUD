import { useEffect, useRef, useState } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";

// "פעולות נוספות" (ערכה v3): פעולות שאינן יומיומיות יוצאות מהכותרת לתפריט, כדי
// שלמסך תהיה פעולה ראשית אחת בולטת. הפעולות עצמן לא משתנות - רק המקום שלהן.

export interface MenuAction {
  key: string;
  label: string;
  onSelect: () => void;
  icon?: LucideIcon;
  disabled?: boolean;
  hint?: string;
}

export function ActionsMenu({ actions, label = "פעולות נוספות" }: { actions: MenuAction[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (actions.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <button type="button" className="btn-secondary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {label}
        <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 z-30 mt-1 w-64 rounded-card border border-line bg-surface p-1 shadow-lg">
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              role="menuitem"
              disabled={a.disabled}
              onClick={() => {
                setOpen(false);
                a.onSelect();
              }}
              className="flex w-full items-start gap-2 rounded-control px-3 py-2 text-right text-sm text-ink transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {a.icon && <a.icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" />}
              <span>
                <span className="block font-medium">{a.label}</span>
                {a.hint && <span className="block text-xs text-ink-subtle">{a.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
