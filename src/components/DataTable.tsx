import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronRight, ChevronLeft, Columns3 } from "lucide-react";
import { EmptyState } from "./EmptyState";
import { LoadingState } from "./LoadingState";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
  // עמודה שמוסתרת כברירת מחדל בבחירת העמודות (columnPicker) - עדיין מוצגת אם columnPicker
  // לא מופעל בכלל, כדי לא לשבור מסכים קיימים שלא ביקשו את היכולת הזו.
  hiddenByDefault?: boolean;
  // העמודה שסופגת את הרוחב הפנוי, במקום עמודת הסרק. מיועדת לעמודת טקסט
  // חופשי ארוך: בלעדיה הסרק בולע את כל השארית, וטקסט ארוך נדחס לרוחב
  // המילה הארוכה ביותר - עמודה צרה וגבוהה שקשה לקרוא. עמודה אחת לכל
  // היותר; אם סומנו כמה, הראשונה מנצחת.
  grow?: boolean;
}

export interface DataTablePagination {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: LucideIcon;
  onRowClick?: (row: T) => void;
  // שתי יכולות אופציונליות בלבד (שלב 14) - טבלה שלא מבקשת אותן מתנהגת בדיוק כמו קודם.
  columnPicker?: boolean;
  pagination?: DataTablePagination;
  // הדגשת שורה שלמה לפי תוכנה (למשל שורה עם פער סכומים בבדיקת הזכאות). אופציונלי -
  // טבלה שלא מעבירה את זה מקבלת בדיוק את אותו className כמו קודם.
  rowClassName?: (row: T) => string | undefined;
}

// טבלה בסיסית לפי עקרונות ה-UX באפיון: עמודות מעטות כברירת מחדל, pagination אמיתי
// (עמוד/גודל עמוד נשלטים ע"י ההורה - הוא זה שמביא את הנתונים מהשרת), בחירת עמודות.
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  emptyTitle = "אין נתונים להצגה",
  emptyDescription,
  emptyIcon,
  onRowClick,
  columnPicker = false,
  pagination,
  rowClassName,
}: DataTableProps<T>) {
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => new Set(columnPicker ? columns.filter((c) => c.hiddenByDefault).map((c) => c.key) : []));
  const [showPicker, setShowPicker] = useState(false);

  const visibleColumns = columnPicker ? columns.filter((c) => !hiddenKeys.has(c.key)) : columns;
  const growKey = visibleColumns.find((c) => c.grow)?.key;

  // ברירת מחדל: תא אינו נשבר לשורות. עמודת הסרק שסופגת את הרוחב הפנוי
  // מכריחה כל עמודה אמיתית להצטמצם למינימום שלה, ולטקסט המינימום הוא
  // רוחב המילה הארוכה ביותר - כך "אורלנסקי משה" נפרס לשתי שורות בעמודה
  // צרה בזמן שיש מקום פנוי בשפע מימין.
  //
  // עמודה שמסמנת grow היא היוצאת: היא סופגת את השארית *ומותר* לה
  // להישבר, כי טקסט חופשי ארוך בשורה אחת היה מותח את הטבלה בלי סוף.
  // עמודה שמגדירה whitespace משלה מנצחת - היא ביקשה במפורש.
  const cellClass = (col: DataTableColumn<T>) => {
    const own = col.className ?? "";
    if (col.key === growKey) return `min-w-[22rem] ${own}`;
    return own.includes("whitespace") ? own : `whitespace-nowrap ${own}`;
  };

  const toggleColumn = (key: string) => {
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.totalCount / pagination.pageSize)) : 1;

  return (
    <div>
      {columnPicker && (
        <div className="mb-2 flex justify-end">
          <div className="relative">
            <button onClick={() => setShowPicker((v) => !v)} className="flex items-center gap-1 text-xs text-ink-subtle hover:text-ink-muted">
              <Columns3 className="h-3.5 w-3.5" aria-hidden="true" />
              בחירת עמודות
            </button>
            {showPicker && (
              <div className="absolute left-0 z-10 mt-1 w-56 rounded-control border border-line bg-surface p-2 shadow-lg">
                {columns.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-muted">
                    <input type="checkbox" checked={!hiddenKeys.has(c.key)} onChange={() => toggleColumn(c.key)} />
                    {c.header}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <LoadingState rows={5} />
      ) : rows.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} icon={emptyIcon} />
      ) : (
        // גובה חסום + overflow משני הצירים על העטיפה עצמה (לא על כל העמוד) - כך הכותרת
        // הדביקה (sticky) נשארת קבועה תוך גלילה אנכית פנימית של הטבלה בלבד, ולא של כל
        // העמוד, וגלילה אופקית (לטבלאות רחבות כמו יומן פעילות) לא סוחבת איתה את הפריסה
        // מסביב - נתפס בבקשת Chani: הטבלה גררה את הפאנל הצדדי איתה בגלילה אופקית, כי
        // main ב-Layout היה flex item בלי min-w-0 ולכן לא הצטמצם מתחת לרוחב התוכן הטבעי.
        <div className="card max-h-[70vh] overflow-auto">
          <table className="w-full text-right text-sm">
            <thead className="sticky top-0 z-10 border-b border-line bg-surface-muted text-ink-muted">
              <tr>
                {visibleColumns.map((col) => (
                  <th
                    key={col.key}
                    // w-full: העמודה סופגת את הרוחב הפנוי כשיש כזה.
                    // min-w: כשאין - כשהטבלה כבר רחבה מהמסך - w-full חסר
                    // משמעות, והעמודה הייתה מתמוטטת לרוחב המילה הארוכה
                    // ביותר. עדיף שהטבלה תיגלל לרוחב (המכל כבר תומך בזה)
                    // מאשר עמודת טקסט צרה וגבוהה.
                    className={`whitespace-nowrap px-4 py-3 font-medium ${col.key === growKey ? "w-full min-w-[22rem]" : ""}`}
                  >
                    {col.header}
                  </th>
                ))}
                {/* עמודת סרק שסופגת את הרוחב העודף.
                    בלי זה הדפדפן מחלק את הרוחב הפנוי *יחסית* בין העמודות: נמדד
                    בפועל שעמודת "קוד" קיבלה 507 פיקסל לתוכן שצריך 120, והסטטוס
                    ישב 800 פיקסל משמאל לקוד שלו. העין לא מצליחה לקשר בין שני
                    קצוות של שורה, וזה מה שגרם למסך להיראות מפוזר.
                    כשהטבלה רחבה מהמכל, הסרק מקבל 0 ושום דבר לא משתנה. */}
                {!growKey && <th className="w-full" aria-hidden="true" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={() => onRowClick?.(row)}
                  // שורה עם onRowClick חייבת להיות נגישה גם למקלדת - tr לא focusable
                  // כברירת מחדל, ו-onClick לבדו לא מספיק (נתפס בביקורת נגישות שלב 16,
                  // השפיע על 14 מסכים דרך הרכיב המשותף הזה).
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                  className={`${onRowClick ? "cursor-pointer transition hover:bg-surface-muted focus:outline-none focus-visible:bg-surface-muted focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-inset" : ""} ${rowClassName?.(row) ?? ""}`.trim()}
                >
                  {visibleColumns.map((col) => (
                    <td key={col.key} className={`px-4 py-3 ${cellClass(col)}`}>
                      {col.render(row)}
                    </td>
                  ))}
                  {!growKey && <td aria-hidden="true" />}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && !loading && rows.length > 0 && (
        <div className="mt-2 flex items-center justify-between text-xs text-ink-subtle">
          <span>
            סה"כ {pagination.totalCount.toLocaleString("he-IL")} · עמוד {pagination.page + 1} מתוך {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => pagination.onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 0}
              className="rounded p-1 hover:bg-surface-muted disabled:opacity-30"
              aria-label="עמוד קודם"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              disabled={pagination.page + 1 >= totalPages}
              className="rounded p-1 hover:bg-surface-muted disabled:opacity-30"
              aria-label="עמוד הבא"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
