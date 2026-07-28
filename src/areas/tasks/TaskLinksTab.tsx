import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addLink, fetchLinks, removeLink, searchLinkableEntities } from "./api";
import { ENTITY_TYPE_LABEL } from "./types";
import { LoadingState } from "@/components/LoadingState";
import { EmptyState } from "@/components/EmptyState";

interface TaskLinksTabProps {
  taskId: string;
  canEdit: boolean;
  userId: string;
}

// Picker עם חיפוש-לפי-שם קיים רק ל-4 סוגי הישות הנפוצים ביותר (עמותה/סניף/קבוצה/תלמיד).
// שאר 10 הסוגים נתמכים במלואם ב-DB (RLS/task_links) - כאן, בשלב הבסיסי, מוזן מזהה ידני.
const SEARCHABLE_TYPES = new Set(["organization", "branch", "group", "student"]);

export function TaskLinksTab({ taskId, canEdit, userId }: TaskLinksTabProps) {
  const queryClient = useQueryClient();
  const [entityType, setEntityType] = useState("organization");
  const [searchTerm, setSearchTerm] = useState("");
  const [manualId, setManualId] = useState("");

  const linksQuery = useQuery({ queryKey: ["task-links", taskId], queryFn: () => fetchLinks(taskId) });
  const searchQuery = useQuery({
    queryKey: ["task-link-search", entityType, searchTerm],
    queryFn: () => searchLinkableEntities(entityType, searchTerm),
    enabled: SEARCHABLE_TYPES.has(entityType) && searchTerm.trim().length >= 2,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["task-links", taskId] });

  const handleAdd = async (entityId: string) => {
    if (!entityId) return;
    await addLink(taskId, userId, entityType, entityId);
    setSearchTerm("");
    setManualId("");
    refresh();
  };

  if (linksQuery.isLoading) return <LoadingState rows={3} />;

  const links = linksQuery.data ?? [];

  return (
    <div className="space-y-3">
      {links.length === 0 && <EmptyState title="אין קישורים לישויות" description="ניתן לקשר את המשימה לעמותה, תלמיד, מסמך ועוד." />}
      {links.map((link) => (
        <div key={link.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 p-2 text-sm">
          <span>
            {ENTITY_TYPE_LABEL[link.entity_type] ?? link.entity_type}: <span className="tabular text-slate-500">{link.entity_id}</span>
          </span>
          {canEdit && (
            <button
              onClick={async () => {
                await removeLink(link.id);
                refresh();
              }}
              className="text-xs text-red-600 underline hover:text-red-800"
            >
              הסרה
            </button>
          )}
        </div>
      ))}

      {canEdit && (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <label className="field-label">סוג ישות</label>
          <select value={entityType} onChange={(e) => setEntityType(e.target.value)} className="input-field">
            {Object.entries(ENTITY_TYPE_LABEL).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>

          {SEARCHABLE_TYPES.has(entityType) ? (
            <div>
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="חיפוש לפי שם…"
                className="input-field"
              />
              {(searchQuery.data ?? []).length > 0 && (
                <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1">
                  {searchQuery.data!.map((r) => (
                    <li key={r.id}>
                      <button onClick={() => handleAdd(r.id)} className="w-full rounded px-2 py-1 text-right text-sm hover:bg-slate-50">
                        {r.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                placeholder="מזהה (UUID)"
                className="input-field"
              />
              <button onClick={() => handleAdd(manualId)} className="btn-secondary text-sm">
                קישור
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
