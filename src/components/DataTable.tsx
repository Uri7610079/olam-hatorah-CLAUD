import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { EmptyState } from "./EmptyState";
import { LoadingState } from "./LoadingState";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
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
}

// טבלה בסיסית לפי עקרונות ה-UX באפיון: עמודות מעטות כברירת מחדל, pagination
// אמיתי (סינון/מיון בצד שרת) יתווסף בשלבים 3+ כשיהיה מקור נתונים אמיתי.
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  emptyTitle = "אין נתונים להצגה",
  emptyDescription,
  emptyIcon,
  onRowClick,
}: DataTableProps<T>) {
  if (loading) return <LoadingState rows={5} />;
  if (rows.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} icon={emptyIcon} />;

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-right text-sm">
        <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            {columns.map((col) => (
              <th key={col.key} className="px-4 py-3 font-medium">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={() => onRowClick?.(row)}
              className={onRowClick ? "cursor-pointer transition hover:bg-slate-50" : ""}
            >
              {columns.map((col) => (
                <td key={col.key} className={`px-4 py-3 ${col.className ?? ""}`}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
