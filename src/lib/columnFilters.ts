import { isValidElement, type ReactNode } from "react";

// סינון ומיון בכותרת העמודה, כמו באקסל: לכל עמודה רשימת הערכים שמופיעים בה,
// מסמנים אילו להציג, וממיינים עולה/יורד. הלוגיקה כאן בלי React-DOM, כדי
// שאפשר יהיה לבדוק אותה, ומשותפת ל-DataTable ולטבלאות שנבנו ידנית.

export type CellValue = string | number | null | undefined;
export type SortDir = "asc" | "desc";

export interface FilterColumn<T> {
  key: string;
  /** הטקסט שהעמודה מציגה - לרשימת הערכים ולסינון */
  text: (row: T) => string;
  /** ערך למיון, אם שונה מהטקסט (למשל תאריך ISO במקום "15.3.2026") */
  sortValue?: (row: T) => CellValue;
}

export interface ColumnFilterState {
  /** לכל עמודה: הערכים שמוצגים. עמודה שאינה כאן - בלי סינון. */
  allowed: Record<string, Set<string>>;
  sort: { key: string; dir: SortDir } | null;
}

export const EMPTY_FILTER_STATE: ColumnFilterState = { allowed: {}, sort: null };

/** הטקסט שתא מציג, מתוך מה ש-render מחזיר: מחרוזות, ילדים, ו-label (תגית סטטוס). */
export function textOf(node: ReactNode): string {
  const walk = (n: ReactNode): string => {
    if (n === null || n === undefined || typeof n === "boolean") return "";
    if (typeof n === "string" || typeof n === "number") return String(n);
    if (Array.isArray(n)) return n.map(walk).join(" ");
    if (isValidElement(n)) {
      const p = n.props as { children?: ReactNode; label?: ReactNode; type?: string };
      // שדה קלט ותיבת סימון בתוך התא - אינם "ערך" של העמודה
      if (n.type === "input" || n.type === "select" || n.type === "textarea") return "";
      return [walk(p.label), walk(p.children)].join(" ");
    }
    return "";
  };
  return walk(node).replace(/\s+/g, " ").trim();
}

export const EMPTY_LABEL = "(ריקים)";
// "—" ו"-" בטבלאות פירושם "אין ערך" - נחשבים ריקים, כמו תא ריק באקסל
const isBlank = (s: string) => s === "" || s === "—" || s === "-";
export const filterKey = (text: string) => (isBlank(text.trim()) ? "" : text.trim());

/** מספר מתוך טקסט: "1,234.50 ₪", "12%", "-30" */
function asNumber(s: string): number | null {
  const t = s.replace(/[₪%,\s‎‏]/g, "");
  if (!/^[-+]?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}
/** תאריך מתוך טקסט: 15/03/2026, 15.3.2026, 2026-03-15 (אפשר עם שעה אחריו) */
function asDateKey(s: string): string | null {
  let m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")} ${(m[4] ?? "").padStart(2, "0")}:${m[5] ?? "00"}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? s : null;
}

/** השוואה כמו באקסל: ריקים תמיד בסוף, מספרים כמספרים, תאריכים כתאריכים, טקסט לפי א"ב. */
export function compareValues(a: CellValue, b: CellValue): number {
  const sa = a === null || a === undefined ? "" : String(a).trim();
  const sb = b === null || b === undefined ? "" : String(b).trim();
  const ea = isBlank(sa), eb = isBlank(sb);
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const na = asNumber(sa), nb = asNumber(sb);
  if (na !== null && nb !== null) return na - nb;
  const da = asDateKey(sa), db = asDateKey(sb);
  if (da && db) return da < db ? -1 : da > db ? 1 : 0;
  return sa.localeCompare(sb, "he", { numeric: true, sensitivity: "base" });
}

function passes<T>(row: T, columns: FilterColumn<T>[], allowed: ColumnFilterState["allowed"], skipKey?: string) {
  for (const col of columns) {
    if (col.key === skipKey) continue;
    const set = allowed[col.key];
    if (set && !set.has(filterKey(col.text(row)))) return false;
  }
  return true;
}

/** השורות אחרי הסינון והמיון */
export function applyColumnFilters<T>(rows: T[], columns: FilterColumn<T>[], state: ColumnFilterState): T[] {
  const active = columns.filter((c) => state.allowed[c.key]);
  let out = active.length ? rows.filter((r) => passes(r, active, state.allowed)) : rows;
  const sortCol = state.sort ? columns.find((c) => c.key === state.sort!.key) : undefined;
  if (sortCol && state.sort) {
    const dir = state.sort.dir === "asc" ? 1 : -1;
    const value = sortCol.sortValue ?? sortCol.text;
    // מיון יציב: שורות שוות נשארות בסדר המקורי. ריקים בסוף גם במיון יורד.
    out = out.map((row, i) => ({ row, i, v: value(row) }))
      .sort((x, y) => {
        const blankX = isBlank(String(x.v ?? "").trim()), blankY = isBlank(String(y.v ?? "").trim());
        if (blankX !== blankY) return blankX ? 1 : -1;
        return dir * compareValues(x.v, y.v) || x.i - y.i;
      })
      .map((x) => x.row);
  }
  return out;
}

/**
 * הערכים שמופיעים בעמודה, עם כמות - מתוך השורות שעוברות את הסינון של שאר
 * העמודות (כמו באקסל: אחרי סינון קבוצה, רשימת הסטטוסים היא של הקבוצה הזו).
 */
export function distinctValues<T>(rows: T[], columns: FilterColumn<T>[], state: ColumnFilterState, key: string) {
  const col = columns.find((c) => c.key === key);
  if (!col) return [];
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!passes(row, columns, state.allowed, key)) continue;
    const k = filterKey(col.text(row));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => compareValues(a.value, b.value));
}

export function isFiltered(state: ColumnFilterState) {
  return Object.keys(state.allowed).length > 0;
}
