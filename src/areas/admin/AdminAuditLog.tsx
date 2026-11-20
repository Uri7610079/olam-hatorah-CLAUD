import { useMemo, useState } from "react";
import { MultiSelect } from "@/components/MultiSelect";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { useIsV3 } from "@/lib/uiTheme";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { AUDIT_ACTION_LABEL, AUDIT_RESOURCE_LABEL } from "./adminLabels";

interface AuditEventRow {
  id: string;
  actor_id: string | null;
  action: string;
  resource: string;
  resource_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

const AUDIT_EVENTS_LIMIT = 200;

async function fetchAuditEvents(): Promise<AuditEventRow[]> {
  const { data, error } = await supabase
    .from("audit_events")
    .select("id, actor_id, action, resource, resource_id, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(AUDIT_EVENTS_LIMIT);
  if (error) throw error;
  return data ?? [];
}

const actionLabel = (a: string) => AUDIT_ACTION_LABEL[a] ?? a;
const resourceLabel = (r: string) => AUDIT_RESOURCE_LABEL[r] ?? r;

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// שינוי בטבלה נרשם כ-{before, after} (טריגר audit_table_change). לתצוגה בלבד:
// השדות שהערך שלהם השתנה, כדי שלא יצטרכו להשוות שני גושי JSON בעין.
function changedFields(detail: Record<string, unknown> | null): { field: string; before: unknown; after: unknown }[] | null {
  if (!detail || !isPlainObject(detail.before) || !isPlainObject(detail.after)) return null;
  const before = detail.before;
  const after = detail.after;
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  return keys
    .filter((k) => k !== "updated_at" && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => ({ field: k, before: before[k], after: after[k] }));
}

const showValue = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

// v3: פרטי האירוע במגירה - במקום JSON גזור לשלוש שורות בתוך הטבלה.
function AuditDetailDrawer({ row, onClose }: { row: AuditEventRow | null; onClose: () => void }) {
  useEscapeToClose(row !== null, onClose);
  if (!row) return null;
  const changes = changedFields(row.detail);
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button aria-label="סגור" className="flex-1 bg-ink/40" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="פרטי אירוע" className="h-full w-full max-w-xl overflow-y-auto bg-surface p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-primary">
            {actionLabel(row.action)} · {resourceLabel(row.resource)}
          </h2>
          <button onClick={onClose} aria-label="סגור" className="rounded-control p-1.5 text-ink-subtle transition hover:bg-surface-muted">
            ✕
          </button>
        </div>
        <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-ink-muted">מועד</dt>
          <dd className="tabular text-ink">{formatDateTime(row.created_at)}</dd>
          <dt className="text-ink-muted">פעולה</dt>
          <dd className="text-ink">{actionLabel(row.action)}</dd>
          <dt className="text-ink-muted">אזור</dt>
          <dd className="text-ink">{resourceLabel(row.resource)}</dd>
          {row.resource_id && (
            <>
              <dt className="text-ink-muted">מזהה רשומה</dt>
              <dd className="ltr-num break-all text-ink-subtle">{row.resource_id}</dd>
            </>
          )}
          <dt className="text-ink-muted">בוצע ע"י</dt>
          <dd className="ltr-num break-all text-ink-subtle">{row.actor_id ?? "המערכת (פעולה אוטומטית)"}</dd>
        </dl>

        {changes && (
          <div className="mb-4">
            <h3 className="mb-1.5 text-sm font-semibold text-ink">מה השתנה</h3>
            {changes.length === 0 ? (
              <p className="text-sm text-ink-muted">לא השתנה אף שדה מלבד מועד העדכון.</p>
            ) : (
              <div className="overflow-x-auto rounded-control border border-line">
                <table className="w-full text-xs">
                  <thead className="bg-surface-muted text-ink-muted">
                    <tr>
                      <th className="px-2 py-1.5 text-start font-medium">שדה</th>
                      <th className="px-2 py-1.5 text-start font-medium">לפני</th>
                      <th className="px-2 py-1.5 text-start font-medium">אחרי</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changes.map((c) => (
                      <tr key={c.field} className="border-t border-line align-top">
                        <td className="px-2 py-1.5 font-mono text-ink-muted" dir="ltr">{c.field}</td>
                        <td className="break-all px-2 py-1.5 text-ink-muted">{showValue(c.before)}</td>
                        <td className="break-all px-2 py-1.5 text-ink">{showValue(c.after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {row.detail ? (
          <details open={!changes}>
            <summary className="cursor-pointer text-sm font-medium text-ink-muted">הנתונים המלאים שנרשמו</summary>
            <pre dir="ltr" className="mt-2 max-h-[60vh] overflow-auto whitespace-pre-wrap break-all rounded-control bg-surface-muted p-3 text-xs text-ink">
              {JSON.stringify(row.detail, null, 2)}
            </pre>
          </details>
        ) : (
          <p className="text-sm text-ink-muted">לא נרשמו פרטים נוספים לאירוע הזה.</p>
        )}
      </div>
    </div>
  );
}

export function AdminAuditLog() {
  const isV3 = useIsV3();
  const { hasPermission, isLoading: permissionLoading } = useHasPermission("audit", "view");
  const query = useQuery({ queryKey: ["audit-events"], queryFn: fetchAuditEvents, enabled: hasPermission });
  const [resourceFilter, setResourceFilter] = useState<string[]>([]);
  const [openRow, setOpenRow] = useState<AuditEventRow | null>(null);

  const resourceOptions = useMemo(
    () => Array.from(new Set((query.data ?? []).map((r) => r.resource))).sort(),
    [query.data],
  );

  const filteredRows = useMemo(() => {
    if (resourceFilter.length === 0) return query.data ?? [];
    return (query.data ?? []).filter((r) => resourceFilter.includes(r.resource));
  }, [query.data, resourceFilter]);

  if (permissionLoading) return <LoadingState rows={4} />;

  if (!hasPermission) {
    return (
      <div>
        <PageHeader title="יומן פעילות" />
        <ErrorState message="אין לך הרשאה לצפות במסך זה." />
      </div>
    );
  }

  const columns: DataTableColumn<AuditEventRow>[] = isV3
    ? [
        {
          key: "created_at",
          header: "מועד",
          className: "tabular whitespace-nowrap",
          render: (r) => formatDateTime(r.created_at),
          sortValue: (r) => r.created_at,
        },
        { key: "action", header: "פעולה", render: (r) => actionLabel(r.action) },
        { key: "resource", header: "אזור", render: (r) => resourceLabel(r.resource) },
        {
          key: "detail",
          header: "פרטים",
          filterable: false,
          render: (r) => (
            <button type="button" onClick={() => setOpenRow(r)} className="link-action text-xs">
              הצגת פרטים
            </button>
          ),
        },
      ]
    : [
        {
          key: "created_at",
          header: "מועד",
          className: "tabular",
          render: (r) => new Date(r.created_at).toLocaleString("he-IL"),
        },
        { key: "action", header: "פעולה", render: (r) => r.action },
        { key: "resource", header: "משאב", render: (r) => `${r.resource}${r.resource_id ? ` / ${r.resource_id}` : ""}` },
        {
          key: "detail",
          header: "פרטים",
          // JSON גולמי באורך בלתי צפוי. בלי grow הוא מותח את הטבלה לרוחב
          // של 5,000 פיקסל ומכריח גלילה אופקית בכל שורה; איתו הוא סופג את
          // הרוחב הפנוי ונשבר לשורות רק כשצריך.
          grow: true,
          className: "whitespace-normal break-all",
          // גזירה לשלוש שורות: אירוע בודד יכול להכיל JSON ארוך מאוד, ושורה
          // אחת בגובה 265 פיקסל הופכת את כל היומן לבלתי קריא. הערך המלא
          // נשאר זמין בריחוף, ולכן שום מידע לא הולך לאיבוד.
          render: (r) =>
            r.detail ? (
              <code className="line-clamp-3 text-xs" title={JSON.stringify(r.detail)}>
                {JSON.stringify(r.detail)}
              </code>
            ) : (
              "—"
            ),
        },
      ];

  return (
    <div>
      <PageHeader title="יומן פעילות" description={`${AUDIT_EVENTS_LIMIT} האירועים האחרונים בלבד.`} />
      <div className="mb-4 max-w-xs">
        <MultiSelect
          options={resourceOptions.map((r) => ({ value: r, label: isV3 ? resourceLabel(r) : r }))}
          value={resourceFilter}
          onChange={setResourceFilter}
          label={isV3 ? "אזור" : "משאב"}
          emptyMeaning="— הכול —"
        />
      </div>
      {/* עד היום שגיאת טעינה הוצגה כ"אין רשומות ביומן" - כאילו היומן ריק */}
      {query.isError && (
        <div className="mb-4">
          <ErrorState message="לא ניתן לטעון את יומן הפעילות. נסו לרענן את הדף." />
        </div>
      )}
      <DataTable
        columns={columns}
        rows={filteredRows}
        rowKey={(r) => r.id}
        loading={query.isLoading} error={query.error} onRetry={() => query.refetch()}
        emptyTitle="אין רשומות ביומן"
        emptyIcon={History}
        onRowClick={isV3 ? setOpenRow : undefined}
      />
      {isV3 && <AuditDetailDrawer row={openRow} onClose={() => setOpenRow(null)} />}
    </div>
  );
}
