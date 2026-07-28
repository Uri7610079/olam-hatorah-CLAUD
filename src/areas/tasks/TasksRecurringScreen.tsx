import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Repeat } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ErrorState } from "@/components/ErrorState";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import {
  createRecurrenceRule,
  fetchAssignableUsers,
  fetchCategories,
  fetchRecurrenceRules,
  fetchTeams,
  toggleRecurrenceRuleActive,
} from "./api";
import {
  DAY_OF_WEEK_LABEL,
  FREQUENCY_LABEL,
  PRIORITY_LABEL,
  type RecurrenceFrequency,
  type TaskPriority,
  type TaskRecurrenceRule,
} from "./types";

const EMPTY_FORM = {
  title: "",
  description: "",
  categoryId: "",
  priority: "normal" as TaskPriority,
  frequency: "weekly" as RecurrenceFrequency,
  dayOfWeek: 0,
  dayOfMonth: 1,
  intervalDays: 7,
  startDate: new Date().toISOString().slice(0, 10),
  endDate: "",
  createNextEvenIfPreviousIncomplete: false,
  reminderDaysBeforeDue: "",
  ownerIds: [] as string[],
  teamIds: [] as string[],
};

export function TasksRecurringScreen() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id ?? "";
  const { hasPermission: canManage, isLoading: permissionLoading } = useHasPermission("tasks", "manage_settings");

  const rulesQuery = useQuery({ queryKey: ["recurrence-rules"], queryFn: fetchRecurrenceRules, enabled: canManage });
  const categoriesQuery = useQuery({ queryKey: ["task-categories"], queryFn: fetchCategories, enabled: canManage });
  const usersQuery = useQuery({ queryKey: ["assignable-users"], queryFn: fetchAssignableUsers, enabled: canManage });
  const teamsQuery = useQuery({ queryKey: ["teams"], queryFn: fetchTeams, enabled: canManage });

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEscapeToClose(showCreate, () => setShowCreate(false));

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["recurrence-rules"] });

  const handleCreate = async () => {
    if (!form.title.trim()) {
      setError("יש להזין כותרת.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createRecurrenceRule({
        title: form.title.trim(),
        description: form.description.trim() || null,
        category_id: form.categoryId || null,
        priority: form.priority,
        frequency: form.frequency,
        day_of_week: form.frequency === "weekly" ? form.dayOfWeek : null,
        day_of_month: form.frequency === "monthly" ? form.dayOfMonth : null,
        interval_days: form.frequency === "custom" ? form.intervalDays : null,
        start_date: form.startDate,
        end_date: form.endDate || null,
        create_next_even_if_previous_incomplete: form.createNextEvenIfPreviousIncomplete,
        reminder_days_before_due: form.reminderDaysBeforeDue === "" ? null : Number(form.reminderDaysBeforeDue),
        created_by: userId,
        owner_ids: form.ownerIds,
        team_ids: form.teamIds,
      });
      setForm(EMPTY_FORM);
      setShowCreate(false);
      refresh();
    } catch (e: any) {
      setError(e.message ?? "שגיאה ביצירת הכלל");
    } finally {
      setSubmitting(false);
    }
  };

  const columns: DataTableColumn<TaskRecurrenceRule>[] = [
    { key: "title", header: "כותרת", render: (r) => r.title },
    { key: "frequency", header: "תדירות", render: (r) => FREQUENCY_LABEL[r.frequency] },
    { key: "priority", header: "עדיפות", render: (r) => PRIORITY_LABEL[r.priority] },
    { key: "start_date", header: "התחלה", className: "tabular", render: (r) => r.start_date },
    { key: "last_generated", header: "מופע אחרון שנוצר", className: "tabular", render: (r) => r.last_generated_date ?? "טרם נוצר" },
    {
      key: "status",
      header: "סטטוס",
      render: (r) => <StatusBadge severity={r.is_active ? "ok" : "neutral"} label={r.is_active ? "פעיל" : "מושהה"} />,
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <button
          onClick={async () => {
            await toggleRecurrenceRuleActive(r.id, !r.is_active);
            refresh();
          }}
          className="link-action text-xs"
        >
          {r.is_active ? "השהיה" : "הפעלה"}
        </button>
      ),
    },
  ];

  if (permissionLoading) return null;

  if (!canManage) {
    return (
      <div>
        <PageHeader title="משימות חוזרות" />
        <ErrorState message="אין לך הרשאה לצפות במסך זה." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="משימות חוזרות"
        description="כללים ליצירת משימה חדשה אוטומטית לפי לוח זמנים - לא לצורך מדידת ביצוע."
        primaryAction={
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            כלל חדש
          </button>
        }
      />

      <DataTable
        columns={columns}
        rows={rulesQuery.data ?? []}
        rowKey={(r) => r.id}
        loading={rulesQuery.isLoading}
        emptyTitle="אין כללי חזרה עדיין"
        emptyIcon={Repeat}
      />

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div role="dialog" aria-modal="true" aria-labelledby="new-recurrence-title" className="card max-h-[85vh] w-full max-w-lg overflow-y-auto p-6">
            <h2 id="new-recurrence-title" className="mb-4 text-base font-semibold text-slate-900">
              כלל חזרה חדש
            </h2>
            <div className="space-y-3">
              <div>
                <label className="field-label">כותרת המשימה שתיווצר</label>
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
                <label className="field-label">תדירות</label>
                <select value={form.frequency} onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as RecurrenceFrequency }))} className="input-field">
                  {(Object.keys(FREQUENCY_LABEL) as RecurrenceFrequency[]).map((freq) => (
                    <option key={freq} value={freq}>
                      {FREQUENCY_LABEL[freq]}
                    </option>
                  ))}
                </select>
              </div>

              {form.frequency === "weekly" && (
                <div>
                  <label className="field-label">יום בשבוע</label>
                  <select value={form.dayOfWeek} onChange={(e) => setForm((f) => ({ ...f, dayOfWeek: Number(e.target.value) }))} className="input-field">
                    {DAY_OF_WEEK_LABEL.map((label, i) => (
                      <option key={i} value={i}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {form.frequency === "monthly" && (
                <div>
                  <label className="field-label">יום בחודש</label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={form.dayOfMonth}
                    onChange={(e) => setForm((f) => ({ ...f, dayOfMonth: Number(e.target.value) }))}
                    className="input-field"
                  />
                </div>
              )}
              {form.frequency === "custom" && (
                <div>
                  <label className="field-label">כל כמה ימים</label>
                  <input
                    type="number"
                    min={1}
                    value={form.intervalDays}
                    onChange={(e) => setForm((f) => ({ ...f, intervalDays: Number(e.target.value) }))}
                    className="input-field"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">תאריך התחלה</label>
                  <input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} className="input-field" />
                </div>
                <div>
                  <label className="field-label">תאריך סיום (לא חובה)</label>
                  <input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} className="input-field" />
                </div>
              </div>

              <div>
                <label className="field-label">תזכורת (ימים לפני היעד, לא חובה)</label>
                <input
                  type="number"
                  min={0}
                  value={form.reminderDaysBeforeDue}
                  onChange={(e) => setForm((f) => ({ ...f, reminderDaysBeforeDue: e.target.value }))}
                  className="input-field"
                />
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.createNextEvenIfPreviousIncomplete}
                  onChange={(e) => setForm((f) => ({ ...f, createNextEvenIfPreviousIncomplete: e.target.checked }))}
                />
                ליצור מופע חדש גם אם הקודם טרם הושלם
              </label>

              <div>
                <label className="field-label">אחראים</label>
                <div className="max-h-28 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                  {(usersQuery.data ?? []).map((u) => (
                    <label key={u.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.ownerIds.includes(u.id)}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            ownerIds: e.target.checked ? [...f.ownerIds, u.id] : f.ownerIds.filter((id) => id !== u.id),
                          }))
                        }
                      />
                      {u.full_name}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="field-label">צוותים</label>
                <div className="space-y-1 rounded-lg border border-slate-200 p-2">
                  {(teamsQuery.data ?? []).map((t) => (
                    <label key={t.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.teamIds.includes(t.id)}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            teamIds: e.target.checked ? [...f.teamIds, t.id] : f.teamIds.filter((id) => id !== t.id),
                          }))
                        }
                      />
                      {t.label_he}
                    </label>
                  ))}
                </div>
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
