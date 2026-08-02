import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addReminder, deleteReminder, fetchAssignableUsers, fetchReminders } from "./api";
import { LoadingState } from "@/components/LoadingState";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";

interface TaskRemindersTabProps {
  taskId: string;
  canEdit: boolean;
  userId: string;
  hasDueDate: boolean;
}

// "תזכורת בתוך המערכת היא ערוץ הבסיס" (סעיף 13) - כאן רק ניהול התזכורות עצמן (יצירה/
// מחיקה); ה"הגיע-הזמן" מוצג במסך הבית (due_reminders_for_me), לא כאן.
export function TaskRemindersTab({ taskId, canEdit, userId, hasDueDate }: TaskRemindersTabProps) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"absolute" | "relative">("absolute");
  const [absoluteAt, setAbsoluteAt] = useState("");
  const [daysBefore, setDaysBefore] = useState(1);
  const [targetUser, setTargetUser] = useState("");
  const [error, setError] = useState<string | null>(null);

  const remindersQuery = useQuery({ queryKey: ["task-reminders", taskId], queryFn: () => fetchReminders(taskId) });
  const usersQuery = useQuery({ queryKey: ["assignable-users"], queryFn: fetchAssignableUsers });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["task-reminders", taskId] });

  const handleAdd = async () => {
    if (mode === "absolute" && !absoluteAt) {
      setError("יש לבחור תאריך ושעה.");
      return;
    }
    setError(null);
    try {
      await addReminder({
        taskId,
        createdBy: userId,
        userId: targetUser || null,
        remindAt: mode === "absolute" ? new Date(absoluteAt).toISOString() : null,
        daysBeforeDue: mode === "relative" ? daysBefore : null,
      });
      setAbsoluteAt("");
      refresh();
    } catch (e: any) {
      setError(e.message ?? "שגיאה בהוספת התזכורת");
    }
  };

  if (remindersQuery.isLoading) return <LoadingState rows={2} />;

  const reminders = remindersQuery.data ?? [];
  const usersById = new Map((usersQuery.data ?? []).map((u) => [u.id, u.full_name]));

  return (
    <div className="space-y-3">
      {reminders.length === 0 && <EmptyState title="אין תזכורות עדיין" />}
      {reminders.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-2 rounded-control border border-line p-2 text-sm">
          <span>
            {r.days_before_due !== null
              ? r.days_before_due === 0
                ? "ביום היעד"
                : `${r.days_before_due} ימים לפני היעד`
              : r.remind_at && new Date(r.remind_at).toLocaleString("he-IL")}
            {" · "}
            {r.user_id ? (usersById.get(r.user_id) ?? "משתמש") : "כל האחראים"}
            {r.snoozed_until && <span className="text-warn"> · נדחתה ל-{new Date(r.snoozed_until).toLocaleString("he-IL")}</span>}
            {r.is_dismissed && <span className="text-ink-subtle"> · נסגרה</span>}
          </span>
          {canEdit && (
            <button
              onClick={async () => {
                await deleteReminder(r.id);
                refresh();
              }}
              className="shrink-0 text-xs text-danger underline hover:text-danger-ink"
            >
              מחיקה
            </button>
          )}
        </div>
      ))}

      {canEdit && (
        <div className="space-y-2 border-t border-line pt-3">
          {error && <ErrorState message={error} />}
          <div className="flex gap-3 text-xs">
            <label className="flex items-center gap-1">
              <input type="radio" checked={mode === "absolute"} onChange={() => setMode("absolute")} /> תאריך ושעה מדויקים
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={mode === "relative"} disabled={!hasDueDate} onChange={() => setMode("relative")} />
              יחסית ליעד {!hasDueDate && "(דורש תאריך יעד למשימה)"}
            </label>
          </div>
          {mode === "absolute" ? (
            <input type="datetime-local" value={absoluteAt} onChange={(e) => setAbsoluteAt(e.target.value)} className="input-field" />
          ) : (
            <input
              type="number"
              min={0}
              value={daysBefore}
              onChange={(e) => setDaysBefore(Number(e.target.value))}
              className="input-field"
              placeholder="ימים לפני היעד (0 = ביום היעד)"
            />
          )}
          <select value={targetUser} onChange={(e) => setTargetUser(e.target.value)} className="input-field">
            <option value="">כל האחראים</option>
            {(usersQuery.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </select>
          <button onClick={handleAdd} className="btn-secondary text-sm">
            הוספת תזכורת
          </button>
        </div>
      )}
    </div>
  );
}
