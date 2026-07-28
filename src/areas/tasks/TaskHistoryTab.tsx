import { useQuery } from "@tanstack/react-query";
import { fetchHistory } from "./api";
import { HISTORY_EVENT_LABEL } from "./types";
import { LoadingState } from "@/components/LoadingState";
import { EmptyState } from "@/components/EmptyState";

interface TaskHistoryTabProps {
  taskId: string;
}

// יומן שינויים מינימלי לתפעול/שחזור תקלה בלבד (סעיף 20 באפיון) - לא לניתוח ביצועי עובדים.
export function TaskHistoryTab({ taskId }: TaskHistoryTabProps) {
  const query = useQuery({ queryKey: ["task-history", taskId], queryFn: () => fetchHistory(taskId) });

  if (query.isLoading) return <LoadingState rows={4} />;

  const events = query.data ?? [];
  if (events.length === 0) return <EmptyState title="אין היסטוריה עדיין" />;

  return (
    <ul className="space-y-2">
      {events.map((ev) => (
        <li key={ev.id} className="rounded-lg border border-slate-100 p-2.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium text-slate-700">{HISTORY_EVENT_LABEL[ev.event_type] ?? ev.event_type}</span>
            <span className="text-xs text-slate-400">{new Date(ev.created_at).toLocaleString("he-IL")}</span>
          </div>
          {ev.detail && Object.keys(ev.detail).length > 0 && (
            <p className="mt-0.5 text-xs text-slate-500">{JSON.stringify(ev.detail)}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
