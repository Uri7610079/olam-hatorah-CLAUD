import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { CheckSquare, ChevronRight, ChevronLeft, ChevronsRight, ChevronsLeft, Plus } from "lucide-react";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { SearchAndFilters } from "@/components/SearchAndFilters";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { Tabs } from "@/components/Tabs";
import { LoadingState } from "@/components/LoadingState";
import { fetchAllTasks, fetchAssignableUsers, fetchCategories, fetchTeams, updateTask, type TaskWithRelations } from "./api";
import { PRIORITY_LABEL, STATUS_LABEL, STATUS_SEVERITY, type TaskPriority, type TaskStatus } from "./types";
import { TaskDrawer } from "./TaskDrawer";
import { PriorityBadge } from "./PriorityBadge";
import { localDateIso, todayIso } from "./dateUtils";
import { getHolidayInfo, hebrewDateLabel } from "./hebrewCalendar";

// מחליף את שלושת המסכים הנפרדים שהיו (כל המשימות / לוח / לוח שנה) - שלושתם הציגו את
// אותה קבוצת משימות בדיוק, רק בתצוגה שונה - וגם את "משימות צוותים" (שהיה בעצם תת-קבוצה
// מסוננת של אותה רשימה). כאן יש שאילתת נתונים אחת (fetchAllTasks) ומתג תצוגה, וסינון
// צוות זמין בכל התצוגות. אף לוגיקה קיימת לא השתנתה - כל תצוגה היא בדיוק אותו קוד שהיה.

const BOARD_STATUSES: TaskStatus[] = ["open", "in_progress", "waiting", "blocked", "completed", "cancelled"];

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

type ViewMode = "list" | "board" | "calendar";

export function TasksAllScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canCreate } = useHasPermission("tasks", "create");
  const query = useQuery({ queryKey: ["all-tasks"], queryFn: fetchAllTasks });
  const usersQuery = useQuery({ queryKey: ["assignable-users"], queryFn: fetchAssignableUsers });
  const categoriesQuery = useQuery({ queryKey: ["task-categories"], queryFn: fetchCategories });
  const teamsQuery = useQuery({ queryKey: ["teams"], queryFn: fetchTeams });

  const [view, setView] = useState<ViewMode>("list");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "">("");
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | "">("");
  const [teamFilter, setTeamFilter] = useState<string[]>([]);
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
  const [drawerInitialDueDate, setDrawerInitialDueDate] = useState<string | undefined>(undefined);
  const [showDrawer, setShowDrawer] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // תמיכה בקישור ישיר ממסך החיפוש הגלובלי (/tasks/all?open=<id>) - נפתח פעם אחת ואז
  // מוסר מה-URL, כדי שרענון הדף לא ימשיך לפתוח את אותה משימה שוב.
  useEffect(() => {
    const openId = searchParams.get("open");
    if (openId) {
      setDrawerTaskId(openId);
      setShowDrawer(true);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const usersById = new Map((usersQuery.data ?? []).map((u) => [u.id, u.full_name]));
  const categoriesById = new Map((categoriesQuery.data ?? []).map((c) => [c.id, c.label_he]));

  const toggleTeam = (id: string) => setTeamFilter((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));

  const teamFilteredTasks = (query.data ?? []).filter((t) => teamFilter.length === 0 || t.team_ids.some((id) => teamFilter.includes(id)));

  const listFiltered = teamFilteredTasks.filter((t) => {
    if (statusFilter && t.status !== statusFilter) return false;
    if (priorityFilter && t.priority !== priorityFilter) return false;
    if (search && !t.title.includes(search.trim())) return false;
    return true;
  });

  const openTask = (id: string | null) => {
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

  const listColumns: DataTableColumn<TaskWithRelations>[] = [
    {
      key: "title",
      header: "כותרת",
      render: (t) => (
        <button onClick={() => openTask(t.id)} className="link-action font-medium">
          {t.title}
        </button>
      ),
    },
    { key: "status", header: "סטטוס", render: (t) => <StatusBadge severity={STATUS_SEVERITY[t.status]} label={STATUS_LABEL[t.status]} /> },
    { key: "priority", header: "עדיפות", render: (t) => <PriorityBadge priority={t.priority} /> },
    { key: "category", header: "קטגוריה", render: (t) => (t.category_id ? categoriesById.get(t.category_id) ?? "—" : "—") },
    { key: "due_date", header: "יעד", className: "tabular", render: (t) => t.due_date ?? "—" },
    {
      key: "owners",
      header: "אחראים",
      render: (t) => t.owners.map((id) => usersById.get(id) ?? "—").join(", ") || "—",
      hiddenByDefault: true,
    },
  ];

  // --- לוח (Board) ---
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const handleDrop = async (status: TaskStatus, e: React.DragEvent) => {
    e.preventDefault();
    setDragOverStatus(null);
    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;
    try {
      await updateTask(taskId, { status });
      onSaved();
    } catch {
      // דחייה מהשרת (לרוב חוסר הרשאת tasks.complete/tasks.reopen למעבר הספציפי) - הכרטיס
      // פשוט נשאר בטור המקורי אחרי רענון, בלי צורך בהודעת שגיאה חוסמת על גרירה.
    }
  };

  // --- לוח שנה ---
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
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
  const jumpToDate = (value: string) => {
    if (!value) return;
    const [y, m] = value.split("-").map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12 || y < 1900 || y > 2200) return;
    setYear(y);
    setMonth(m - 1);
  };

  const tasksByDate = new Map<string, TaskWithRelations[]>();
  for (const t of teamFilteredTasks) {
    if (!t.due_date) continue;
    if (!tasksByDate.has(t.due_date)) tasksByDate.set(t.due_date, []);
    tasksByDate.get(t.due_date)!.push(t);
  }
  const calendarDays = buildMonthGrid(year, month);
  const todayStr = todayIso();
  const monthLabel = new Date(year, month, 1).toLocaleDateString("he-IL", { month: "long", year: "numeric" });

  const teamFilterChips = (teamsQuery.data ?? []).length > 0 && (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-xs text-slate-500">סינון לפי צוות:</span>
      {(teamsQuery.data ?? []).map((team) => (
        <button
          key={team.id}
          onClick={() => toggleTeam(team.id)}
          className={`rounded-full px-3 py-1 text-xs transition ${
            teamFilter.includes(team.id) ? "bg-tasks-light text-tasks font-medium" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          {team.label_he}
        </button>
      ))}
    </div>
  );

  return (
    <div>
      <PageHeader
        title="כל המשימות"
        description="כל המשימות שמורשית לראות - ברשימה, בלוח, או בלוח שנה."
        primaryAction={
          canCreate && (
            <button onClick={() => openTask(null)} className="btn-primary">
              משימה חדשה
            </button>
          )
        }
      />

      <div className="mb-4">
        <Tabs
          tabs={[
            { key: "list", label: "רשימה" },
            { key: "board", label: "לוח" },
            { key: "calendar", label: "לוח שנה" },
          ]}
          activeTab={view}
          onChange={(k) => setView(k as ViewMode)}
          ariaLabel="תצוגת משימות"
        />
      </div>

      {teamFilterChips}

      {view === "list" && (
        <>
          <SearchAndFilters
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="חיפוש לפי כותרת…"
            advancedFilters={
              <>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as TaskStatus | "")} className="input-field w-auto">
                  <option value="">כל הסטטוסים</option>
                  {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
                <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as TaskPriority | "")} className="input-field w-auto">
                  <option value="">כל העדיפויות</option>
                  {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </select>
              </>
            }
          />
          <DataTable
            columns={listColumns}
            rows={listFiltered}
            rowKey={(t) => t.id}
            loading={query.isLoading}
            emptyTitle="אין משימות התואמות את הסינון"
            emptyIcon={CheckSquare}
            columnPicker
          />
        </>
      )}

      {view === "board" &&
        (query.isLoading ? (
          <LoadingState rows={6} />
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {BOARD_STATUSES.map((status) => {
              const columnTasks = teamFilteredTasks.filter((t) => t.status === status);
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
        ))}

      {view === "calendar" &&
        (query.isLoading ? (
          <LoadingState rows={6} />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
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

            <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-semibold text-slate-500">
              {WEEKDAY_LABELS.map((d, i) => (
                <div key={d} className={`rounded-md py-1 ${i === 5 || i === 6 ? "bg-tasks-light text-tasks" : ""}`}>
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {calendarDays.map((day) => {
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
                      <div className="mb-1 truncate rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-800" title={`חג: ${holiday.name}`}>
                        {holiday.emoji ? `${holiday.emoji} ` : ""}
                        {holiday.name}
                      </div>
                    )}
                    <div className="space-y-0.5">
                      {dayTasks.slice(0, 3).map((t) => (
                        <button
                          key={t.id}
                          onClick={() => openTask(t.id)}
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
          </>
        ))}

      <TaskDrawer open={showDrawer} onClose={() => setShowDrawer(false)} taskId={drawerTaskId} onSaved={onSaved} initialDueDate={drawerInitialDueDate} />
    </div>
  );
}
