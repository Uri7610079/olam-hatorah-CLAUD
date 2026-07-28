import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileStack } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ErrorState } from "@/components/ErrorState";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import { createTemplate, fetchCategories, fetchTemplates, toggleTemplateActive } from "./api";
import { PRIORITY_LABEL, type TaskPriority, type TaskTemplate } from "./types";
import { PriorityBadge } from "./PriorityBadge";

const EMPTY_FORM = {
  title: "",
  description: "",
  categoryId: "",
  priority: "normal" as TaskPriority,
  dueInDays: "",
  checklist: "",
};

export function TasksTemplatesScreen() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id ?? "";
  const { hasPermission: canManage, isLoading: permissionLoading } = useHasPermission("tasks", "manage_templates");

  const templatesQuery = useQuery({ queryKey: ["all-templates"], queryFn: () => fetchTemplates(false), enabled: canManage });
  const categoriesQuery = useQuery({ queryKey: ["task-categories"], queryFn: fetchCategories, enabled: canManage });

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEscapeToClose(showCreate, () => setShowCreate(false));

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["all-templates"] });
    queryClient.invalidateQueries({ queryKey: ["templates"] });
  };

  const handleCreate = async () => {
    if (!form.title.trim()) {
      setError("יש להזין כותרת.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createTemplate({
        title: form.title.trim(),
        description: form.description.trim() || null,
        category_id: form.categoryId || null,
        priority: form.priority,
        due_in_days: form.dueInDays === "" ? null : Number(form.dueInDays),
        created_by: userId,
        checklistItems: form.checklist.split("\n").map((l) => l.trim()).filter(Boolean),
      });
      setForm(EMPTY_FORM);
      setShowCreate(false);
      refresh();
    } catch (e: any) {
      setError(e.message ?? "שגיאה ביצירת התבנית");
    } finally {
      setSubmitting(false);
    }
  };

  const columns: DataTableColumn<TaskTemplate>[] = [
    { key: "title", header: "כותרת", render: (t) => t.title },
    { key: "priority", header: "עדיפות", render: (t) => <PriorityBadge priority={t.priority} /> },
    { key: "due_in_days", header: "יעד יחסי", render: (t) => (t.due_in_days !== null ? `${t.due_in_days} ימים` : "—") },
    {
      key: "status",
      header: "סטטוס",
      render: (t) => <StatusBadge severity={t.is_active ? "ok" : "neutral"} label={t.is_active ? "פעילה" : "לא פעילה"} />,
    },
    {
      key: "actions",
      header: "",
      render: (t) => (
        <button
          onClick={async () => {
            await toggleTemplateActive(t.id, !t.is_active);
            refresh();
          }}
          className="link-action text-xs"
        >
          {t.is_active ? "השבתה" : "הפעלה"}
        </button>
      ),
    },
  ];

  if (permissionLoading) return null;

  if (!canManage) {
    return (
      <div>
        <PageHeader title="תבניות משימה" />
        <ErrorState message="אין לך הרשאה לצפות במסך זה." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="תבניות משימה"
        description="תבנית מאפשרת יצירה מהירה של משימה עם ערכים קבועים מראש - זמינה לכל מי שיכול ליצור משימה."
        primaryAction={
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            תבנית חדשה
          </button>
        }
      />

      <DataTable
        columns={columns}
        rows={templatesQuery.data ?? []}
        rowKey={(t) => t.id}
        loading={templatesQuery.isLoading}
        emptyTitle="אין תבניות עדיין"
        emptyIcon={FileStack}
      />

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div role="dialog" aria-modal="true" aria-labelledby="new-template-title" className="card max-h-[85vh] w-full max-w-lg overflow-y-auto p-6">
            <h2 id="new-template-title" className="mb-4 text-base font-semibold text-slate-900">
              תבנית חדשה
            </h2>
            <div className="space-y-3">
              <div>
                <label className="field-label">כותרת</label>
                <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="input-field" />
              </div>
              <div>
                <label className="field-label">תיאור</label>
                <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} className="input-field" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">עדיפות</label>
                  <select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as TaskPriority }))} className="input-field">
                    {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_LABEL[p]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label">קטגוריה</label>
                  <select value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))} className="input-field">
                    <option value="">— ללא —</option>
                    {(categoriesQuery.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label_he}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="field-label">יעד יחסי (ימים מרגע היצירה, לא חובה)</label>
                <input type="number" min={0} value={form.dueInDays} onChange={(e) => setForm((f) => ({ ...f, dueInDays: e.target.value }))} className="input-field" />
              </div>
              <div>
                <label className="field-label">Checklist (שורה לכל פריט, לא חובה)</label>
                <textarea value={form.checklist} onChange={(e) => setForm((f) => ({ ...f, checklist: e.target.value }))} rows={3} className="input-field" />
              </div>

              {error && <ErrorState message={error} />}

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setShowCreate(false)} className="btn-secondary text-sm">
                  ביטול
                </button>
                <button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">
                  {submitting ? "יוצרת…" : "יצירה"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
