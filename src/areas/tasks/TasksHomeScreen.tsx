import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CheckSquare, BellRing, MessageSquare, NotebookPen } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/LoadingState";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { dismissReminder, fetchDueReminders, fetchMyTasks, fetchWhatsAppMessages, snoozeReminder, type TaskWithRelations } from "./api";
import { STATUS_LABEL, STATUS_SEVERITY } from "./types";
import { TaskDrawer } from "./TaskDrawer";
import { BulkTaskCaptureModal } from "./BulkTaskCaptureModal";
import { PriorityBadge } from "./PriorityBadge";
import { todayIso } from "./dateUtils";

function tomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

function isToday(dateStr: string): boolean {
  return dateStr === todayIso();
}

function isPast(dateStr: string): boolean {
  return dateStr < todayIso();
}

interface TaskListSectionProps {
  title: string;
  tasks: TaskWithRelations[];
  onOpen: (id: string) => void;
  emptyText: string;
  accentClass: string;
}

function TaskListSection({ title, tasks, onOpen, emptyText, accentClass }: TaskListSectionProps) {
  return (
    <div className={`card border-t-4 p-4 ${accentClass}`}>
      <h2 className="mb-3 text-sm font-semibold text-slate-800">
        {title} <span className="text-slate-400">({tasks.length})</span>
      </h2>
      {tasks.length === 0 ? (
        <p className="text-xs text-slate-400">{emptyText}</p>
      ) : (
        <ul className="space-y-1.5">
          {tasks.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => onOpen(t.id)}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-100 p-2 text-right text-sm hover:bg-slate-50"
              >
                <span className="truncate">{t.title}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-slate-400">
                  {t.due_date && <span className="tabular">{t.due_date}</span>}
                  <PriorityBadge priority={t.priority} />
                  <StatusBadge severity={STATUS_SEVERITY[t.status]} label={STATUS_LABEL[t.status]} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TasksHomeScreen() {
  const { session } = useAuth();
  const userId = session?.user.id ?? "";
  const queryClient = useQueryClient();
  const { hasPermission: canCreate } = useHasPermission("tasks", "create");
  const { hasPermission: canSeeWhatsApp } = useHasPermission("tasks", "convert_whatsapp");
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
  const [showDrawer, setShowDrawer] = useState(false);
  const [showBulkCapture, setShowBulkCapture] = useState(false);

  const query = useQuery({ queryKey: ["my-tasks", userId], queryFn: () => fetchMyTasks(userId), enabled: !!userId });
  const remindersQuery = useQuery({ queryKey: ["due-reminders"], queryFn: fetchDueReminders, enabled: !!userId });
  const whatsAppQuery = useQuery({ queryKey: ["whatsapp-messages"], queryFn: fetchWhatsAppMessages, enabled: canSeeWhatsApp });

  const openTask = (id: string | null) => {
    setDrawerTaskId(id);
    setShowDrawer(true);
  };
  const closeDrawer = () => setShowDrawer(false);
  const onSaved = () => {
    queryClient.invalidateQueries({ queryKey: ["my-tasks", userId] });
    queryClient.invalidateQueries({ queryKey: ["due-reminders"] });
  };

  const refreshReminders = () => queryClient.invalidateQueries({ queryKey: ["due-reminders"] });

  if (query.isLoading) return <LoadingState rows={6} />;

  const dueReminders = remindersQuery.data ?? [];
  const pendingWhatsAppCount = (whatsAppQuery.data ?? []).filter((m) => m.status === "pending").length;

  const tasks = query.data ?? [];
  const overdue = tasks.filter((t) => t.due_date && isPast(t.due_date) && t.status !== "completed");
  const today = tasks.filter((t) => t.due_date && isToday(t.due_date) && t.status !== "completed");
  const upcoming = tasks.filter((t) => t.due_date && !isPast(t.due_date) && !isToday(t.due_date) && t.status !== "completed");
  const waitingOrBlocked = tasks.filter((t) => t.status === "waiting" || t.status === "blocked");

  return (
    <div>
      <PageHeader
        title="המשימות שלי"
        description="עזר אישי לריכוז משימות ותזכורות - לא כלי מדידה או השוואת ביצועים."
        primaryAction={
          canCreate && (
            <div className="flex gap-2">
              <button onClick={() => setShowBulkCapture(true)} className="btn-secondary flex items-center gap-1.5">
                <NotebookPen className="h-4 w-4" aria-hidden="true" />
                יצירה מטקסט חופשי
              </button>
              <button onClick={() => openTask(null)} className="btn-primary">
                משימה חדשה
              </button>
            </div>
          )
        }
      />

      {dueReminders.length > 0 && (
        <div className="card mb-4 border-amber-200 bg-tasks-light p-4">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-tasks">
            <BellRing className="h-4 w-4" aria-hidden="true" />
            תזכורות שהגיע זמנן ({dueReminders.length})
          </h2>
          <ul className="space-y-1.5">
            {dueReminders.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-white p-2 text-sm">
                <button onClick={() => openTask(r.task_id)} className="link-action truncate text-right">
                  {r.task_title}
                </button>
                <span className="flex shrink-0 gap-2 text-xs">
                  <button
                    onClick={async () => {
                      await snoozeReminder(r.id, tomorrowIso());
                      refreshReminders();
                    }}
                    className="text-slate-500 underline hover:text-slate-700"
                  >
                    דחייה למחר
                  </button>
                  <button
                    onClick={async () => {
                      await dismissReminder(r.id);
                      refreshReminders();
                    }}
                    className="text-slate-500 underline hover:text-slate-700"
                  >
                    סגירה
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tasks.length === 0 ? (
        <EmptyState title="אין לך משימות פתוחות כרגע" icon={CheckSquare} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <TaskListSection title="באיחור" tasks={overdue} onOpen={openTask} emptyText="אין משימות באיחור." accentClass="border-t-rose-400" />
          <TaskListSection title="להיום" tasks={today} onOpen={openTask} emptyText="אין משימות להיום." accentClass="border-t-tasks" />
          <TaskListSection title="קרובות" tasks={upcoming} onOpen={openTask} emptyText="אין משימות קרובות." accentClass="border-t-sky-400" />
          <TaskListSection
            title="ממתינות או חסומות"
            tasks={waitingOrBlocked}
            onOpen={openTask}
            emptyText="אין משימות ממתינות או חסומות."
            accentClass="border-t-violet-400"
          />
        </div>
      )}

      {canSeeWhatsApp && pendingWhatsAppCount > 0 && (
        <Link
          to="/tasks/whatsapp"
          className="mt-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700 hover:bg-slate-50"
        >
          <MessageSquare className="h-4 w-4 text-tasks" aria-hidden="true" />
          {pendingWhatsAppCount} הודעות WhatsApp ממתינות לסיווג
        </Link>
      )}

      <TaskDrawer open={showDrawer} onClose={closeDrawer} taskId={drawerTaskId} onSaved={onSaved} />
      <BulkTaskCaptureModal open={showBulkCapture} onClose={() => setShowBulkCapture(false)} onCreated={onSaved} />
    </div>
  );
}
