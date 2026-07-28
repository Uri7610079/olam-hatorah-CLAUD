import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UsersRound } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { fetchTeamTasks, fetchTeams, type TaskWithRelations } from "./api";
import { PRIORITY_LABEL, STATUS_LABEL, STATUS_SEVERITY } from "./types";
import { TaskDrawer } from "./TaskDrawer";

export function TasksTeamScreen() {
  const queryClient = useQueryClient();
  const teamsQuery = useQuery({ queryKey: ["teams"], queryFn: fetchTeams });
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
  const [showDrawer, setShowDrawer] = useState(false);

  const tasksQuery = useQuery({
    queryKey: ["team-tasks", selectedTeamIds],
    queryFn: () => fetchTeamTasks(selectedTeamIds),
    enabled: selectedTeamIds.length > 0,
  });

  const toggleTeam = (id: string) => {
    setSelectedTeamIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  const openTask = (id: string) => {
    setDrawerTaskId(id);
    setShowDrawer(true);
  };
  const onSaved = () => queryClient.invalidateQueries({ queryKey: ["team-tasks", selectedTeamIds] });

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
    { key: "status", header: "סטטוס", render: (t) => <StatusBadge severity={STATUS_SEVERITY[t.status]} label={STATUS_LABEL[t.status]} /> },
    { key: "priority", header: "עדיפות", render: (t) => PRIORITY_LABEL[t.priority] },
    { key: "due_date", header: "יעד", className: "tabular", render: (t) => t.due_date ?? "—" },
  ];

  return (
    <div>
      <PageHeader title="משימות צוותים" description="ללא גרפי עומס, דירוג או השוואת עובדים - רק רשימת משימות לפי צוות." />

      <div className="mb-4 flex flex-wrap gap-2">
        {(teamsQuery.data ?? []).map((team) => (
          <button
            key={team.id}
            onClick={() => toggleTeam(team.id)}
            className={`rounded-full px-3 py-1 text-sm transition ${
              selectedTeamIds.includes(team.id) ? "bg-tasks-light text-tasks font-medium" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {team.label_he}
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        rows={tasksQuery.data ?? []}
        rowKey={(t) => t.id}
        loading={selectedTeamIds.length > 0 && tasksQuery.isLoading}
        emptyTitle={selectedTeamIds.length === 0 ? "בחרי צוות אחד או יותר כדי לראות משימות" : "אין משימות לצוותים שנבחרו"}
        emptyIcon={UsersRound}
      />

      <TaskDrawer open={showDrawer} onClose={() => setShowDrawer(false)} taskId={drawerTaskId} onSaved={onSaved} />
    </div>
  );
}
