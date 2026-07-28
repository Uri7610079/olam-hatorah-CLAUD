import { PRIORITY_LABEL, type TaskPriority } from "./types";

// עדיפות מוצגת תמיד עם צבע (לא רק טקסט) לחיוניות ויזואלית - אבל בגוונים רכים/פסטליים,
// לא רוויים, כדי לשמור על הסולידיות של שאר המערכת (לבקשת Chani: "קצת יותר חיוניות,
// לשמור על הסולידיות"). אין קשר בין הצבע הזה לביצועי עובד - זה סידור עבודה בלבד (סעיף 9).
const PRIORITY_CLASSES: Record<TaskPriority, string> = {
  low: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
  normal: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
  high: "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
  urgent: "bg-rose-50 text-rose-700 ring-1 ring-rose-300",
};

const PRIORITY_DOT: Record<TaskPriority, string> = {
  low: "bg-slate-400",
  normal: "bg-sky-500",
  high: "bg-orange-500",
  urgent: "bg-rose-500",
};

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return (
    <span
      title="עדיפות - לסידור העבודה בלבד, לא מדד לעובד"
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_CLASSES[priority]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[priority]}`} aria-hidden="true" />
      {PRIORITY_LABEL[priority]}
    </span>
  );
}
