import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ChevronLeft, ChevronsRight, ChevronsLeft, Plus } from "lucide-react";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/LoadingState";
import { fetchAllTasks } from "./api";
import { STATUS_LABEL, STATUS_SEVERITY } from "./types";
import { TaskDrawer } from "./TaskDrawer";
import { localDateIso, todayIso } from "./dateUtils";
import { getHolidayInfo, hebrewDateLabel } from "./hebrewCalendar";

const WEEKDAY_LABELS = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];
const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  ok: "bg-green-500",
  neutral: "bg-slate-400",
};

function buildMonthGrid(year: number, month: number): Date[] {
  const firstOfMonth = new Date(year, month, 1);
  const start = new Date(firstOfMonth);
  start.setDate(start.getDate() - start.getDay());
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}

export function TasksCalendarScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canCreate } = useHasPermission("tasks", "create");
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
  const [drawerInitialDueDate, setDrawerInitialDueDate] = useState<string | undefined>(undefined);
  const [showDrawer, setShowDrawer] = useState(false);

  const query = useQuery({ queryKey: ["all-tasks"], queryFn: fetchAllTasks });

  const openExistingTask = (id: string) => {
    setDrawerTaskId(id);
    setDrawerInitialDueDate(undefined);
    setShowDrawer(true);
  };

  const openNewTaskForDay = (iso: string) => {
    setDrawerTaskId(null);
    setDrawerInitialDueDate(iso);
    setShowDrawer(true);
  };

  const onSaved = () => queryClient.invalidateQueries({ queryKey: ["all-tasks"] });

  const goPrevMonth = () => {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  };
  const goNextMonth = () => {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  };
  const goPrevYear = () => setYear((y) => y - 1);
  const goNextYear = () => setYear((y) => y + 1);

  // ולידציה לפני עדכון המצב - <input type="month"> נופל לתיבת טקסט חופשי בכמה דפדפנים
  // (Firefox/Safari) ומאפשר קלט שרירותי; בלי הגנה, ערך לא-תקין (למשל "אבג" -> NaN, או
  // שנה קיצונית) גורם ל-@hebcal/core לזרוק חריגה בזמן רינדור התא - ובלי ErrorBoundary
  // במערכת, זה מפיל את כל האתר למסך לבן, לא רק את התא. נתפס בביקורת בדיקות ייעודית.
  const jumpToDate = (value: string) => {
    if (!value) return;
    const [y, m] = value.split("-").map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12 || y < 1900 || y > 2200) return;
    setYear(y);
    setMonth(m - 1);
  };

  if (query.isLoading) return <LoadingState rows={6} />;

  const tasks = query.data ?? [];
  const tasksByDate = new Map<string, typeof tasks>();
  for (const t of tasks) {
    if (!t.due_date) continue;
    if (!tasksByDate.has(t.due_date)) tasksByDate.set(t.due_date, []);
    tasksByDate.get(t.due_date)!.push(t);
  }

  const days = buildMonthGrid(year, month);
  const todayStr = todayIso();
  const monthLabel = new Date(year, month, 1).toLocaleDateString("he-IL", { month: "long", year: "numeric" });

  return (
    <div>
      <PageHeader
        title="לוח שנה"
        description="תצוגת חודש לפי תאריך יעד, עם תאריך עברי וחגים. ניתן לעבור לחודש/שנה מסוימים או ללחוץ על יום כדי ליצור בו משימה."
        primaryAction={
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="month"
              value={`${year}-${String(month + 1).padStart(2, "0")}`}
              onChange={(e) => jumpToDate(e.target.value)}
              aria-label="מעבר לחודש מסוים"
              title="מעבר ישיר לחודש ושנה מסוימים"
              className="input-field w-auto text-xs"
            />
            <div className="flex items-center gap-0.5">
              <button onClick={goPrevYear} aria-label="שנה קודמת" title="שנה קודמת" className="rounded p-1.5 hover:bg-slate-100">
                <ChevronsRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <button onClick={goPrevMonth} aria-label="חודש קודם" title="חודש קודם" className="rounded p-1.5 hover:bg-slate-100">
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <span className="min-w-[8rem] text-center text-sm font-medium">{monthLabel}</span>
              <button onClick={goNextMonth} aria-label="חודש הבא" title="חודש הבא" className="rounded p-1.5 hover:bg-slate-100">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <button onClick={goNextYear} aria-label="שנה הבאה" title="שנה הבאה" className="rounded p-1.5 hover:bg-slate-100">
                <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        }
      />

      <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-semibold text-slate-500">
        {WEEKDAY_LABELS.map((d, i) => (
          <div key={d} className={`rounded-md py-1 ${i === 5 || i === 6 ? "bg-tasks-light text-tasks" : ""}`}>
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((day) => {
          const iso = localDateIso(day);
          const inMonth = day.getMonth() === month;
          const isWeekend = day.getDay() === 5 || day.getDay() === 6;
          const dayTasks = tasksByDate.get(iso) ?? [];
          const isToday = iso === todayStr;
          const holiday = getHolidayInfo(day);
          return (
            <div
              key={iso}
              className={`group relative min-h-28 rounded-lg border p-1.5 text-xs transition-colors ${
                !inMonth
                  ? "border-slate-100 bg-slate-50 text-slate-300"
                  : holiday
                    ? "border-amber-300 bg-amber-50/70"
                    : isWeekend
                      ? "border-tasks-light bg-tasks-light/40"
                      : "border-slate-200 bg-white"
              } ${isToday ? "ring-2 ring-tasks border-tasks" : ""}`}
            >
              <div className="mb-0.5 flex items-center justify-between">
                <span className={`tabular ${isToday ? "font-bold text-tasks" : ""}`}>{day.getDate()}</span>
                {canCreate && (
                  <button
                    onClick={() => openNewTaskForDay(iso)}
                    aria-label={`משימה חדשה ליום ${iso}`}
                    title="משימה חדשה ליום הזה"
                    className="rounded p-0.5 text-slate-300 opacity-0 transition hover:bg-tasks-light hover:text-tasks focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
              <div className="mb-1 truncate text-[10px] leading-tight text-slate-400" dir="rtl" title="תאריך עברי">
                {hebrewDateLabel(day)}
              </div>
              {holiday && (
                <div
                  className="mb-1 truncate rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-800"
                  title={`חג: ${holiday.name}`}
                >
                  {holiday.emoji ? `${holiday.emoji} ` : ""}
                  {holiday.name}
                </div>
              )}
              <div className="space-y-0.5">
                {dayTasks.slice(0, 3).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => openExistingTask(t.id)}
                    title={`${t.title} - ${STATUS_LABEL[t.status]}`}
                    className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-right hover:bg-slate-100"
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_DOT[STATUS_SEVERITY[t.status]]}`}
                      title={STATUS_LABEL[t.status]}
                      aria-hidden="true"
                    />
                    <span className="truncate">{t.title}</span>
                  </button>
                ))}
                {dayTasks.length > 3 && <p className="text-slate-400">+{dayTasks.length - 3} נוספות</p>}
              </div>
            </div>
          );
        })}
      </div>

      <TaskDrawer
        open={showDrawer}
        onClose={() => setShowDrawer(false)}
        taskId={drawerTaskId}
        onSaved={onSaved}
        initialDueDate={drawerInitialDueDate}
      />
    </div>
  );
}
