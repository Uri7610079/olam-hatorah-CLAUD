import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDownAZ, ArrowDownWideNarrow, ArrowUpAZ, ArrowUpWideNarrow, ChevronDown, Filter, FilterX, X } from "lucide-react";
import {
  EMPTY_FILTER_STATE, EMPTY_LABEL, applyColumnFilters, distinctValues, isFiltered,
  type ColumnFilterState, type FilterColumn, type SortDir,
} from "@/lib/columnFilters";

// סינון ומיון בכותרת העמודה, כמו באקסל. לחיצה על שם העמודה פותחת חלון קטן:
// מיון עולה/יורד, חיפוש, ורשימת הערכים עם תיבות סימון.

export interface ColumnFilterController<T> {
  state: ColumnFilterState;
  setState: (s: ColumnFilterState) => void;
  rows: T[];
  allRows: T[];
  columns: FilterColumn<T>[];
  clearAll: () => void;
}

/** מצב הסינון של טבלה, והשורות אחרי סינון ומיון. */
export function useColumnFilters<T>(rows: T[], columns: FilterColumn<T>[], external?: [ColumnFilterState, (s: ColumnFilterState) => void]): ColumnFilterController<T> {
  const [own, setOwn] = useState<ColumnFilterState>(EMPTY_FILTER_STATE);
  const [state, setState] = external ?? [own, setOwn];
  // columns נבנות מחדש בכל רינדור; התוצאה תלויה בהן רק דרך המפתחות
  const colKeys = columns.map((c) => c.key).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filtered = useMemo(() => applyColumnFilters(rows, columns, state), [rows, state, colKeys]);
  return { state, setState, rows: filtered, allRows: rows, columns, clearAll: () => setState(EMPTY_FILTER_STATE) };
}

/** שורת "מוצגות X מתוך Y · ניקוי כל הסינונים" - רק כשיש סינון פעיל */
export function ColumnFilterSummary<T>({ ctrl }: { ctrl: ColumnFilterController<T> }) {
  if (!isFiltered(ctrl.state)) return null;
  return (
    <div className="mb-2 flex items-center gap-2 text-sm">
      <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-brand-700">
        <Filter className="h-3.5 w-3.5" aria-hidden="true" />
        מוצגות {ctrl.rows.length.toLocaleString("he-IL")} מתוך {ctrl.allRows.length.toLocaleString("he-IL")} שורות
        <button onClick={() => ctrl.setState({ ...ctrl.state, allowed: {} })} className="inline-flex items-center gap-1 rounded-full px-1.5 hover:bg-brand-100">
          <FilterX className="h-3.5 w-3.5" aria-hidden="true" />
          ניקוי כל הסינונים
        </button>
      </span>
    </div>
  );
}

const MAX_LIST = 1000;

/** כותרת עמודה עם סינון ומיון. בלי ctrl או בלי עמודה מתאימה - כותרת רגילה. */
export function ColumnHeader<T>({ ctrl, colKey, children }: { ctrl?: ColumnFilterController<T>; colKey: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  if (!ctrl || !ctrl.columns.some((c) => c.key === colKey)) return <>{children}</>;
  const filtered = !!ctrl.state.allowed[colKey];
  const sortDir = ctrl.state.sort?.key === colKey ? ctrl.state.sort.dir : null;
  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-line/60 ${filtered || sortDir ? "font-semibold text-brand-700" : ""}`}
      >
        {children}
        <span className="sr-only"> - מיון וסינון</span>
        {sortDir === "asc" && <ArrowUpWideNarrow className="h-3.5 w-3.5" aria-label="ממוין עולה" />}
        {sortDir === "desc" && <ArrowDownWideNarrow className="h-3.5 w-3.5" aria-label="ממוין יורד" />}
        {filtered ? <Filter className="h-3.5 w-3.5 fill-current" aria-label="מסונן" /> : <ChevronDown className="h-3.5 w-3.5 opacity-50" aria-hidden="true" />}
      </button>
      {open && <FilterPopover ctrl={ctrl} colKey={colKey} anchor={btn.current} onClose={() => setOpen(false)} />}
    </>
  );
}

function FilterPopover<T>({ ctrl, colKey, anchor, onClose }: { ctrl: ColumnFilterController<T>; colKey: string; anchor: HTMLElement | null; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const values = useMemo(() => distinctValues(ctrl.allRows, ctrl.columns, ctrl.state, colKey), [ctrl.allRows, ctrl.columns, ctrl.state, colKey]);
  const current = ctrl.state.allowed[colKey];
  const [checked, setChecked] = useState<Set<string>>(() => new Set(values.filter((v) => !current || current.has(v.value)).map((v) => v.value)));
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? values.filter((v) => (v.value || EMPTY_LABEL).toLowerCase().includes(q)) : values;
  }, [values, search]);
  const shown = visible.slice(0, MAX_LIST);
  const allVisibleChecked = visible.length > 0 && visible.every((v) => checked.has(v.value));

  // מיקום: מתחת לכותרת, מיושר לקצה הימני שלה (ממשק מימין לשמאל). החלון
  // מחוץ לטבלה (portal) - הטבלה גוללת בתוך מסגרת שהייתה חותכת אותו.
  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const width = 288;
    const right = Math.min(Math.max(window.innerWidth - r.right, 8), window.innerWidth - width - 8);
    setPos({ top: r.bottom + 4, right: Math.max(right, 8) });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (panel.current?.contains(e.target as Node) || anchor?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // גלילה של העמוד (לא של הרשימה בתוך החלון) - החלון כבר לא ליד הכותרת
    const onScroll = (e: Event) => { if (!panel.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [anchor, onClose]);

  const sort = (dir: SortDir) => {
    ctrl.setState({ ...ctrl.state, sort: { key: colKey, dir } });
    onClose();
  };

  const apply = () => {
    // עם חיפוש - רק מה שסומן מתוך מה שנמצא (כמו באקסל)
    const visibleSet = new Set(visible.map((v) => v.value));
    const keep = new Set([...checked].filter((v) => !search.trim() || visibleSet.has(v)));
    const allowed = { ...ctrl.state.allowed };
    if (values.every((v) => keep.has(v.value)) && !search.trim()) delete allowed[colKey];
    else allowed[colKey] = keep;
    ctrl.setState({ ...ctrl.state, allowed });
    onClose();
  };

  const clear = () => {
    const allowed = { ...ctrl.state.allowed };
    delete allowed[colKey];
    ctrl.setState({ ...ctrl.state, allowed });
    onClose();
  };

  const toggleAll = () => {
    const next = new Set(checked);
    visible.forEach((v) => (allVisibleChecked ? next.delete(v.value) : next.add(v.value)));
    setChecked(next);
  };

  if (!pos) return null;
  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label="מיון וסינון"
      dir="rtl"
      style={{ top: pos.top, right: pos.right }}
      className="fixed z-[60] w-72 rounded-control border border-line bg-surface p-2 text-sm font-normal text-ink shadow-xl"
    >
      <button onClick={() => sort("asc")} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-right hover:bg-surface-muted">
        <ArrowUpAZ className="h-4 w-4 text-ink-muted" aria-hidden="true" /> מיון מהקטן לגדול (א-ת)
      </button>
      <button onClick={() => sort("desc")} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-right hover:bg-surface-muted">
        <ArrowDownAZ className="h-4 w-4 text-ink-muted" aria-hidden="true" /> מיון מהגדול לקטן (ת-א)
      </button>
      {ctrl.state.sort?.key === colKey && (
        <button onClick={() => { ctrl.setState({ ...ctrl.state, sort: null }); onClose(); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-right text-ink-muted hover:bg-surface-muted">
          <X className="h-4 w-4" aria-hidden="true" /> ביטול המיון
        </button>
      )}
      <div className="my-2 border-t border-line" />
      {ctrl.state.allowed[colKey] && (
        <button onClick={clear} className="mb-1 flex w-full items-center gap-2 rounded px-2 py-1.5 text-right hover:bg-surface-muted">
          <FilterX className="h-4 w-4 text-ink-muted" aria-hidden="true" /> ניקוי הסינון מהעמודה
        </button>
      )}
      <input
        autoFocus
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
        placeholder="חיפוש"
        className="input-field mb-2 h-8 text-sm"
      />
      <div className="max-h-64 overflow-auto rounded border border-line">
        <label className="flex cursor-pointer items-center gap-2 border-b border-line px-2 py-1.5 font-medium hover:bg-surface-muted">
          <input type="checkbox" checked={allVisibleChecked} onChange={toggleAll} />
          {search.trim() ? "(בחירת כל תוצאות החיפוש)" : "(בחירת הכל)"}
        </label>
        {shown.map((v) => (
          <label key={v.value} className="flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-surface-muted">
            <input
              type="checkbox"
              checked={checked.has(v.value)}
              onChange={() => {
                const next = new Set(checked);
                if (next.has(v.value)) next.delete(v.value); else next.add(v.value);
                setChecked(next);
              }}
            />
            <span className={`flex-1 truncate ${v.value ? "" : "text-ink-muted"}`}>{v.value || EMPTY_LABEL}</span>
            <span className="tabular text-xs text-ink-subtle">{v.count}</span>
          </label>
        ))}
        {!visible.length && <p className="px-2 py-2 text-ink-muted">אין תוצאות</p>}
        {visible.length > MAX_LIST && <p className="px-2 py-2 text-xs text-ink-muted">מוצגים {MAX_LIST} ערכים. כדי למצוא ערך אחר - חיפוש.</p>}
      </div>
      <div className="mt-2 flex gap-2">
        <button onClick={apply} disabled={!checked.size} className="btn-primary h-8 flex-1 text-sm">אישור</button>
        <button onClick={onClose} className="btn-secondary h-8 flex-1 text-sm">ביטול</button>
      </div>
    </div>,
    document.body,
  );
}
