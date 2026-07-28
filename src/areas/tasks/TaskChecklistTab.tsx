import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addChecklistItem, deleteChecklistItem, fetchChecklist, toggleChecklistItem } from "./api";
import { LoadingState } from "@/components/LoadingState";
import { EmptyState } from "@/components/EmptyState";

interface TaskChecklistTabProps {
  taskId: string;
  canEdit: boolean;
}

export function TaskChecklistTab({ taskId, canEdit }: TaskChecklistTabProps) {
  const queryClient = useQueryClient();
  const [newItem, setNewItem] = useState("");
  const query = useQuery({ queryKey: ["task-checklist", taskId], queryFn: () => fetchChecklist(taskId) });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["task-checklist", taskId] });

  const handleAdd = async () => {
    if (!newItem.trim()) return;
    const nextPosition = (query.data ?? []).length;
    await addChecklistItem(taskId, newItem.trim(), nextPosition);
    setNewItem("");
    refresh();
  };

  if (query.isLoading) return <LoadingState rows={3} />;

  const items = query.data ?? [];

  return (
    <div className="space-y-2">
      {items.length === 0 && <EmptyState title="אין פעולות משנה עדיין" />}
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-2 rounded-lg border border-slate-100 p-2">
          <input
            type="checkbox"
            checked={item.is_done}
            disabled={!canEdit}
            onChange={async (e) => {
              await toggleChecklistItem(item.id, e.target.checked);
              refresh();
            }}
          />
          <span className={`flex-1 text-sm ${item.is_done ? "text-slate-400 line-through" : "text-slate-700"}`}>{item.text}</span>
          {canEdit && (
            <button
              onClick={async () => {
                await deleteChecklistItem(item.id);
                refresh();
              }}
              aria-label="מחיקת פריט"
              className="text-xs text-red-600 underline hover:text-red-800"
            >
              מחיקה
            </button>
          )}
        </div>
      ))}
      {canEdit && (
        <div className="flex gap-2 pt-1">
          <input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="פעולת משנה חדשה…"
            className="input-field"
          />
          <button onClick={handleAdd} className="btn-secondary text-sm">
            הוספה
          </button>
        </div>
      )}
    </div>
  );
}
