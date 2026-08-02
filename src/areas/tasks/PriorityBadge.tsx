import { PRIORITY_LABEL, type TaskPriority } from "./types";

// עדיפות מוצגת תמיד עם צבע (לא רק טקסט) לחיוניות ויזואלית - אבל בגוונים רכים/פסטליים,
// לא רוויים, כדי לשמור על הסולידיות של שאר המערכת (לבקשת Chani: "קצת יותר חיוניות,
// לשמור על הסולידיות"). אין קשר בין הצבע הזה לביצועי עובד - זה סידור עבודה בלבד (סעיף 9).
const PRIORITY_CLASSES: Record<TaskPriority, string> = {
  low: "bg-neutral-soft text-neutral-ink ring-1 ring-line",
  normal: "bg-info-soft text-info-ink ring-1 ring-info/30",
  high: "bg-warn-soft text-warn-ink ring-1 ring-warn/30",
  urgent: "bg-danger-soft text-danger-ink ring-1 ring-danger/40",
};

const PRIORITY_DOT: Record<TaskPriority, string> = {
  low: "bg-neutral",
  normal: "bg-info",
  high: "bg-warn",
  urgent: "bg-danger",
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
