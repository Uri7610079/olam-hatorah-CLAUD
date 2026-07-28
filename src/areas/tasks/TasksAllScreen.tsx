import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { CheckSquare } from "lucide-react";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { SearchAndFilters } from "@/components/SearchAndFilters";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { fetchAllTasks, fetchAssignableUsers, fetchCategories, type TaskWithRelations } from "./api";
import { PRIORITY_LABEL, STATUS_LABEL, STATUS_SEVERITY, type TaskPriority, type TaskStatus } from "./types";
import { TaskDrawer } from "./TaskDrawer";
import { PriorityBadge } from "./PriorityBadge";

export function TasksAllScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canCreate } = useHasPermission("tasks", "create");
  const query = useQuery({ queryKey: ["all-tasks"], queryFn: fetchAllTasks });
  const usersQuery = useQuery({ queryKey: ["assignable-users"], queryFn: fetchAssignableUsers });
  const categoriesQuery = useQuery({ queryKey: ["task-categories"], queryFn: fetchCategories });

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "">("");
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | "">("");
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
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

  const filtered = (query.data ?? []).filter((t) => {
    if (statusFilter && t.status !== statusFilter) return false;
    if (priorityFilter && t.priority !== priorityFilter) return false;
    if (search && !t.title.includes(search.trim())) return false;
    return true;
  });

  const openTask = (id: string | null) => {
    setDrawerTaskId(id);
    setShowDrawer(true);
  };
  const onSaved = () => queryClient.invalidateQueries({ queryKey: ["all-tasks"] });

  const columns: DataTableColumn<TaskWithRelations>[] = [
    {
      key: "title",
      header: "כותרת",
      render: (t) => (
        <button onClick={() => openTask(t.id)} className="link-action font-medium">
          {t.title}
        </button>
      ),
    },
    {
      key: "status",
      header: "סטטוס",
      render: (t) => <StatusBadge severity={STATUS_SEVERITY[t.status]} label={STATUS_LABEL[t.status]} />,
    },
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

  return (
    <div>
      <PageHeader
        title="כל המשימות"
        description="כל המשימות שמורשית לראות."
        primaryAction={
          canCreate && (
            <button onClick={() => openTask(null)} className="btn-primary">
              משימה חדשה
            </button>
          )
        }
      />
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
        columns={columns}
        rows={filtered}
        rowKey={(t) => t.id}
        loading={query.isLoading}
        emptyTitle="אין משימות התואמות את הסינון"
        emptyIcon={CheckSquare}
        columnPicker
      />

      <TaskDrawer open={showDrawer} onClose={() => setShowDrawer(false)} taskId={drawerTaskId} onSaved={onSaved} />
    </div>
  );
}
