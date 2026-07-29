import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";

type Frequency = "daily" | "weekly" | "monthly";
// תואם בדיוק לרשימת ה-check constraint על bank_auto_sync_settings.provider (מיגרציה 083) -
// הוספת בנק נוסף בעתיד דורשת גם עדכון כאן וגם במיגרציה, לא רק כאן.
type Provider = "leumi_open_banking" | "mercantile_open_banking" | "pagi_open_banking";

interface SyncSetting {
  id: string;
  organization_bank_account_id: string;
  provider: Provider;
  frequency: Frequency;
  day_of_week: number | null;
  day_of_month: number | null;
  is_enabled: boolean;
  last_synced_at: string | null;
  last_synced_execution_date: string | null;
}

type RunStatus = "running" | "success" | "partial" | "failed";

interface SyncRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: RunStatus;
  transactions_fetched: number;
  transactions_committed: number;
  transactions_duplicate: number;
  gap_detected: boolean;
  gap_detail: string | null;
  error_message: string | null;
  is_resolved: boolean;
}

const PROVIDER_LABEL: Record<Provider, string> = {
  leumi_open_banking: "לאומי",
  mercantile_open_banking: "מרכנתיל",
  pagi_open_banking: 'פאג"י',
};
const FREQUENCY_LABEL: Record<Frequency, string> = { daily: "כל יום", weekly: "כל שבוע", monthly: "כל חודש" };
const DAY_OF_WEEK_LABEL = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const RUN_STATUS_LABEL: Record<RunStatus, string> = { running: "רצה כעת", success: "הצליחה", partial: "הצליחה עם התראה", failed: "נכשלה" };
const RUN_STATUS_SEVERITY: Record<RunStatus, "ok" | "medium" | "critical" | "neutral"> = {
  running: "neutral",
  success: "ok",
  partial: "medium",
  failed: "critical",
};

async function fetchSetting(accountId: string): Promise<SyncSetting | null> {
  const { data, error } = await supabase.from("bank_auto_sync_settings").select("*").eq("organization_bank_account_id", accountId).maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchRuns(settingId: string): Promise<SyncRun[]> {
  const { data, error } = await supabase
    .from("bank_auto_sync_runs")
    .select("id, started_at, finished_at, status, transactions_fetched, transactions_committed, transactions_duplicate, gap_detected, gap_detail, error_message, is_resolved")
    .eq("setting_id", settingId)
    .order("started_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  return data ?? [];
}

// accountId מגיע מהמסך המאחד (BankScreen.tsx).
export function BankAutoSyncPanel({ accountId }: { accountId: string }) {
  const queryClient = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("bank_import", "perform");

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [provider, setProvider] = useState<Provider>("leumi_open_banking");
  const [frequency, setFrequency] = useState<Frequency>("daily");
  const [dayOfWeek, setDayOfWeek] = useState(0);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [isEnabled, setIsEnabled] = useState(true);
  const [formTouched, setFormTouched] = useState(false);

  const settingQuery = useQuery({
    queryKey: ["bank-auto-sync-setting", accountId],
    queryFn: () => fetchSetting(accountId),
    enabled: !!accountId,
  });
  const setting = settingQuery.data ?? null;
  const runsQuery = useQuery({
    queryKey: ["bank-auto-sync-runs", setting?.id],
    queryFn: () => fetchRuns(setting!.id),
    enabled: !!setting?.id,
  });

  const loadFormFromSetting = (s: SyncSetting | null) => {
    setProvider(s?.provider ?? "leumi_open_banking");
    setFrequency(s?.frequency ?? "daily");
    setDayOfWeek(s?.day_of_week ?? 0);
    setDayOfMonth(s?.day_of_month ?? 1);
    setIsEnabled(s?.is_enabled ?? true);
    setFormTouched(false);
  };

  useEffect(() => {
    if (settingQuery.data !== undefined) loadFormFromSetting(settingQuery.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingQuery.data]);

  const saveSetting = async () => {
    if (!accountId) return;
    setSaving(true);
    setError(null);
    const payload = {
      organization_bank_account_id: accountId,
      provider,
      frequency,
      day_of_week: frequency === "weekly" ? dayOfWeek : null,
      day_of_month: frequency === "monthly" ? dayOfMonth : null,
      is_enabled: isEnabled,
    };
    const { error: err } = setting
      ? await supabase.from("bank_auto_sync_settings").update(payload).eq("id", setting.id)
      : await supabase.from("bank_auto_sync_settings").insert({ ...payload, created_by: (await supabase.auth.getUser()).data.user?.id });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setFormTouched(false);
    queryClient.invalidateQueries({ queryKey: ["bank-auto-sync-setting", accountId] });
  };

  const acknowledgeRun = async (runId: string) => {
    const { error: err } = await supabase.rpc("acknowledge_bank_sync_run", { p_run_id: runId });
    if (err) {
      setError(err.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["bank-auto-sync-runs", setting?.id] });
  };

  const runColumns: DataTableColumn<SyncRun>[] = [
    { key: "started", header: "התחלה", className: "tabular", render: (r) => new Date(r.started_at).toLocaleString("he-IL") },
    { key: "status", header: "סטטוס", render: (r) => <StatusBadge severity={RUN_STATUS_SEVERITY[r.status]} label={RUN_STATUS_LABEL[r.status]} /> },
    { key: "fetched", header: "נמשכו", className: "tabular", render: (r) => r.transactions_fetched },
    { key: "committed", header: "נקלטו", className: "tabular", render: (r) => r.transactions_committed },
    { key: "dup", header: "כפילויות", className: "tabular", render: (r) => r.transactions_duplicate },
    {
      key: "issue",
      header: "התראה",
      render: (r) =>
        r.gap_detected || r.status === "failed" ? (
          <div className="flex items-start gap-2" title={r.gap_detail ?? r.error_message ?? undefined}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
            <span className="text-xs text-slate-600">{r.gap_detail ?? r.error_message ?? "שגיאה לא ידועה"}</span>
          </div>
        ) : (
          <span title="תקין">
            <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden="true" />
          </span>
        ),
    },
    {
      key: "ack",
      header: "",
      render: (r) =>
        (r.gap_detected || r.status === "failed") && !r.is_resolved && canManage ? (
          <button onClick={() => acknowledgeRun(r.id)} className="link-action text-xs">
            סימון כטופל
          </button>
        ) : r.is_resolved ? (
          <span className="text-xs text-slate-400">טופל</span>
        ) : null,
    },
  ];

  return (
    <div>
      <p className="mb-4 text-xs text-slate-500 max-w-2xl">
        משיכת תנועות בנק אוטומטית בכל לילה/שבוע/חודש (לפי ההגדרה כאן), סיווג וההצלבה עם מס״ב נעשים אוטומטית - אישור סופי עדיין נעשה בטאבים "תנועות"/"התאמות" של מסך זה.
      </p>

      {error && <div className="mb-4"><ErrorState message={error} /></div>}

      {accountId && (
        settingQuery.isLoading ? (
          <LoadingState rows={3} />
        ) : (
          <div className="card mb-6 max-w-2xl space-y-4 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">הגדרות משיכה</h2>
              {setting && (
                <button
                  onClick={() => loadFormFromSetting(setting)}
                  className="text-xs text-slate-500 underline"
                  title="ביטול השינויים שלא נשמרו וטעינה מחדש מהערכים השמורים"
                >
                  איפוס טופס
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="sync-enabled"
                checked={isEnabled}
                onChange={(e) => {
                  setIsEnabled(e.target.checked);
                  setFormTouched(true);
                }}
                disabled={!canManage}
              />
              <label htmlFor="sync-enabled" className="text-sm text-slate-700" title="כשכבוי, המשיכה האוטומטית לא תרוץ בכלל עבור חשבון זה">
                משיכה אוטומטית פעילה
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="field-label" title="הבנק שדרכו נמשכות התנועות אוטומטית - קובע דרך איזה API בפועל מתחברים">
                  בנק
                </label>
                <select
                  value={provider}
                  onChange={(e) => {
                    setProvider(e.target.value as Provider);
                    setFormTouched(true);
                  }}
                  className="input-field"
                  disabled={!canManage}
                >
                  {(Object.keys(PROVIDER_LABEL) as Provider[]).map((p) => (
                    <option key={p} value={p}>
                      {PROVIDER_LABEL[p]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" title="תדירות ההרצה - נבדקת כל יום, אבל מתבצעת בפועל רק לפי הבחירה כאן">
                  תדירות
                </label>
                <select
                  value={frequency}
                  onChange={(e) => {
                    setFrequency(e.target.value as Frequency);
                    setFormTouched(true);
                  }}
                  className="input-field"
                  disabled={!canManage}
                >
                  {(Object.keys(FREQUENCY_LABEL) as Frequency[]).map((f) => (
                    <option key={f} value={f}>
                      {FREQUENCY_LABEL[f]}
                    </option>
                  ))}
                </select>
              </div>
              {frequency === "weekly" && (
                <div>
                  <label className="field-label">יום בשבוע</label>
                  <select
                    value={dayOfWeek}
                    onChange={(e) => {
                      setDayOfWeek(Number(e.target.value));
                      setFormTouched(true);
                    }}
                    className="input-field"
                    disabled={!canManage}
                  >
                    {DAY_OF_WEEK_LABEL.map((label, i) => (
                      <option key={i} value={i}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {frequency === "monthly" && (
                <div>
                  <label className="field-label">יום בחודש</label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={dayOfMonth}
                    onChange={(e) => {
                      const raw = Number(e.target.value);
                      setDayOfMonth(Number.isFinite(raw) ? Math.min(31, Math.max(1, raw)) : 1);
                      setFormTouched(true);
                    }}
                    className="input-field"
                    disabled={!canManage}
                  />
                </div>
              )}
            </div>

            {setting?.last_synced_at && (
              <p className="text-xs text-slate-500">
                משיכה אחרונה: {new Date(setting.last_synced_at).toLocaleString("he-IL")}
                {setting.last_synced_execution_date && ` · תנועה אחרונה שנקלטה מתאריך ${setting.last_synced_execution_date}`}
              </p>
            )}

            {canManage && (
              <button onClick={saveSetting} disabled={saving || !formTouched} className="btn-primary flex items-center gap-2 text-xs">
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                {saving ? "שומרת…" : setting ? "שמירת שינויים" : "הפעלת משיכה אוטומטית"}
              </button>
            )}

            <p className="text-xs text-slate-400" title="חיבור בפועל ל-API של הבנק מוגדר ע״י מי שמתקין את המערכת, לא כאן">
              החיבור הטכני בפועל אל הבנק (מפתח/הרשאת API) מוגדר פעם אחת בהגדרות השרת, לא במסך הזה - כאן קובעים רק את התדירות ורואים את היסטוריית ההרצות.
            </p>
          </div>
        )
      )}

      {setting && (
        <>
          <h2 className="mb-2 mt-2 text-sm font-semibold text-slate-700">היסטוריית הרצות</h2>
          <DataTable
            columns={runColumns}
            rows={runsQuery.data ?? []}
            rowKey={(r) => r.id}
            loading={runsQuery.isLoading}
            emptyTitle="עדיין לא בוצעה משיכה אוטומטית עבור חשבון זה"
            emptyIcon={RefreshCw}
          />
        </>
      )}
    </div>
  );
}
