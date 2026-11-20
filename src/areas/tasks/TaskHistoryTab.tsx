import { useQuery } from "@tanstack/react-query";
import { fetchAssignableUsers, fetchHistory, fetchTeams } from "./api";
import { HISTORY_EVENT_LABEL, STATUS_LABEL } from "./types";
import { LoadingState } from "@/components/LoadingState";
import { EmptyState } from "@/components/EmptyState";
import { useIsV3 } from "@/lib/uiTheme";
import { formatDateTime } from "@/lib/format";

// פרטי האירוע במילים: מי נוסף/הוסר, מאיזה סטטוס לאיזה, תאריך יעד. עד היום הוצג
// ה-JSON כמו שהוא, עם מזהים פנימיים של משתמשים וצוותים (INT-12).
export function describeHistoryDetail(
  detail: Record<string, unknown>,
  userName: (id: string) => string | undefined,
  teamName: (id: string) => string | undefined,
): string {
  const parts: string[] = [];
  const str = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
  const status = (v: unknown) => (STATUS_LABEL as Record<string, string>)[String(v)] ?? str(v);
  for (const [key, value] of Object.entries(detail)) {
    if (key === "user_id") parts.push(`משתמש: ${userName(String(value)) ?? "משתמש שאינו פעיל"}`);
    else if (key === "team_id") parts.push(`צוות: ${teamName(String(value)) ?? "צוות שאינו פעיל"}`);
    else if (key === "from" || key === "to") continue;
    else if (key === "title") parts.push(`כותרת: ${str(value)}`);
    else if (key === "whatsapp_message_id") parts.push("מהודעת WhatsApp");
  }
  if ("from" in detail || "to" in detail) {
    const looksLikeStatus = [detail.from, detail.to].some((v) => typeof v === "string" && v in STATUS_LABEL);
    parts.unshift(looksLikeStatus ? `${status(detail.from)} ← ${status(detail.to)}` : `${str(detail.from)} ← ${str(detail.to)}`);
  }
  return parts.join(" · ");
}

interface TaskHistoryTabProps {
  taskId: string;
}

// יומן שינויים מינימלי לתפעול/שחזור תקלה בלבד (סעיף 20 באפיון) - לא לניתוח ביצועי עובדים.
export function TaskHistoryTab({ taskId }: TaskHistoryTabProps) {
  const isV3 = useIsV3();
  const query = useQuery({ queryKey: ["task-history", taskId], queryFn: () => fetchHistory(taskId) });
  const usersQuery = useQuery({ queryKey: ["assignable-users"], queryFn: fetchAssignableUsers });
  const teamsQuery = useQuery({ queryKey: ["teams"], queryFn: fetchTeams });
  const userName = (id: string) => usersQuery.data?.find((u) => u.id === id)?.full_name ?? undefined;
  const teamName = (id: string) => teamsQuery.data?.find((t) => t.id === id)?.label_he ?? undefined;

  if (query.isLoading) return <LoadingState rows={4} />;

  const events = query.data ?? [];
  if (events.length === 0) return <EmptyState title="אין היסטוריה עדיין" />;

  return (
    <ul className="space-y-2">
      {events.map((ev) => (
        <li key={ev.id} className="rounded-control border border-line p-2.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium text-ink-muted">{HISTORY_EVENT_LABEL[ev.event_type] ?? ev.event_type}</span>
            <span className="text-xs text-ink-subtle">{(isV3 ? formatDateTime(ev.created_at) : new Date(ev.created_at).toLocaleString("he-IL"))}</span>
          </div>
          {ev.detail && describeHistoryDetail(ev.detail, userName, teamName) && (
            <p className="mt-0.5 text-xs text-ink-subtle">{describeHistoryDetail(ev.detail, userName, teamName)}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
