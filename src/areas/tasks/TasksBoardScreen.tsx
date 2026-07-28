import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/LoadingState";
import { fetchAllTasks, updateTask } from "./api";
import { STATUS_LABEL, type TaskStatus } from "./types";
import { TaskDrawer } from "./TaskDrawer";
import { PriorityBadge } from "./PriorityBadge";

// לוח עבודה שוטף - draft/archived לא מוצגים כאן (הם לא חלק מזרימת העבודה היומית),
// עדיין נגישים דרך "כל המשימות". שינוי טור = שינוי סטטוס בפועל (עדכון אמיתי, לא ויזואלי
// בלבד) - מותר רק ל-canEdit, שאוכף גם can_view_task וגם tasks.edit בשרת (RLS).
const BOARD_STATUSES: TaskStatus[] = ["open", "in_progress", "waiting", "blocked", "completed", "cancelled"];

// גוון פסטלי נבדל לכל טור - לחיוניות ויזואלית (לבקשת Chani), עדיין רך ולא רווי.
const COLUMN_CLASSES: Record<TaskStatus, string> = {
  draft: "border-slate-200 bg-slate-50",
  open: "border-sky-200 bg-sky-50/60",
  in_progress: "border-amber-200 bg-amber-50/60",
  waiting: "border-violet-200 bg-violet-50/60",
  blocked: "border-rose-200 bg-rose-50/60",
  completed: "border-emerald-200 bg-emerald-50/60",
  cancelled: "border-slate-200 bg-slate-50",
  archived: "border-slate-200 bg-slate-50",
};
const COLUMN_HEADER_CLASSES: Record<TaskStatus, string> = {
  draft: "text-slate-600",
  open: "text-sky-700",
  in_progress: "text-amber-700",
  waiting: "text-violet-700",
  blocked: "text-rose-700",
  completed: "text-emerald-700",
  cancelled: "text-slate-600",
  archived: "text-slate-600",
};

export function TasksBoardScreen() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["all-tasks"], queryFn: fetchAllTasks });
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
  const [showDrawer, setShowDrawer] = useState(false);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["all-tasks"] });

  const openTask = (id: string) => {
    setDrawerTaskId(id);
    setShowDrawer(true);
  };

  const handleDrop = async (status: TaskStatus, e: React.DragEvent) => {
    e.preventDefault();
    setDragOverStatus(null);
    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;
    try {
      await updateTask(taskId, { status });
      refresh();
    } catch {
      // דחייה מהשרת (לרוב חוסר הרשאת tasks.complete/tasks.reopen למעבר הספציפי) - הכרטיס
      // פשוט נשאר בטור המקורי אחרי רענון, בלי צורך בהודעת שגיאה חוסמת על גרירה.
    }
  };

  if (query.isLoading) return <LoadingState rows={6} />;

  const tasks = query.data ?? [];

  return (
    <div>
      <PageHeader title="לוח משימות" description="גרירה בין טורים משנה את הסטטוס בפועל. אין כאן מדדי עומס או השוואת עובדים." />

      <div className="flex gap-3 overflow-x-auto pb-2">
        {BOARD_STATUSES.map((status) => {
          const columnTasks = tasks.filter((t) => t.status === status);
          return (
            <div
              key={status}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverStatus(status);
              }}
              onDragLeave={() => setDragOverStatus((s) => (s === status ? null : s))}
              onDrop={(e) => handleDrop(status, e)}
              className={`w-64 shrink-0 rounded-lg border p-2 transition-colors ${dragOverStatus === status ? "border-tasks bg-tasks-light" : COLUMN_CLASSES[status]}`}
            >
              <h2 className={`mb-2 flex items-center justify-between px-1 text-xs font-semibold ${COLUMN_HEADER_CLASSES[status]}`}>
                {STATUS_LABEL[status]} <span className="text-slate-400">({columnTasks.length})</span>
              </h2>
              <div className="space-y-2">
                {columnTasks.map((t) => (
                  <div
                    key={t.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
                    onClick={() => openTask(t.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openTask(t.id);
                      }
                    }}
                    className="card cursor-grab p-2.5 text-sm hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    <p className="truncate font-medium text-slate-800">{t.title}</p>
                    <p className="mt-1.5 flex items-center justify-between text-xs text-slate-400">
                      <PriorityBadge priority={t.priority} />
                      {t.due_date && <span className="tabular">{t.due_date}</span>}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <TaskDrawer open={showDrawer} onClose={() => setShowDrawer(false)} taskId={drawerTaskId} onSaved={refresh} />
    </div>
  );
}
