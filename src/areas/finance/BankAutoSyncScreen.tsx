import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ErrorState } from "@/components/ErrorState";

interface SyncSetting {
  id: string;
  organization_bank_account_id: string;
  provider: string;
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

const RUN_STATUS_LABEL: Record<RunStatus, string> = { running: "רצה כעת", success: "הצליחה", partial: "הצליחה עם התראה", failed: "נכשלה" };
const RUN_STATUS_SEVERITY: Record<RunStatus, "ok" | "medium" | "critical" | "neutral"> = {
  running: "neutral",
  success: "ok",
  partial: "medium",
  failed: "critical",
};

async function fetchSetting(accountId: string): Promise<SyncSetting | null> {
  const { data, error } = await supabase
    .from("bank_auto_sync_settings")
    .select("id, organization_bank_account_id, provider, is_enabled, last_synced_at, last_synced_execution_date")
    .eq("organization_bank_account_id", accountId)
    .maybeSingle();
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
//
// עד 2026-11-19 היה כאן טופס הגדרה למשיכה דרך API של הבנק (שלב 23) - חיבור שמעולם לא
// התקיים בפועל. הטופס הציג "לאומי" גם לחשבון פאג"י, ושמירה בו הייתה מעבירה את החשבון
// למשיכה הלא-קיימת. התנועות מגיעות מהסקרייפר שבמחשב המשרד (123), והשעה והימים נקבעים
// במסך הניהול - לכן כאן רק המצב וההיסטוריה.
export function BankAutoSyncPanel({ accountId }: { accountId: string }) {
  const queryClient = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("bank_import", "perform");
  const [error, setError] = useState<string | null>(null);

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
    { key: "dup", header: "כבר היו", className: "tabular", render: (r) => r.transactions_duplicate },
    {
      key: "issue",
      header: "התראה",
      render: (r) =>
        r.gap_detected || r.status === "failed" ? (
          <div className="flex items-start gap-2" title={r.gap_detail ?? r.error_message ?? undefined}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
            <span className="text-xs text-ink-muted">{r.gap_detail ?? r.error_message ?? "שגיאה לא ידועה"}</span>
          </div>
        ) : (
          <span title="תקין">
            <CheckCircle2 className="h-4 w-4 text-ok" aria-hidden="true" />
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
          <span className="text-xs text-ink-subtle">טופל</span>
        ) : null,
    },
  ];

  return (
    <div>
      <div className="card mb-6 max-w-2xl space-y-2 p-5 text-sm">
        <p className="font-semibold text-ink">איך החשבון הזה נמשך</p>
        <p className="text-ink-muted">
          התוכנה שבמחשב המשרד נכנסת לאתר הבנק פעם ביום, מושכת את התנועות של 45 הימים האחרונים ושולחת אותן לכאן. תנועה שכבר
          נקלטה לא נקלטת שוב.
        </p>
        <p className="text-ink-muted">
          השעה והימים נקבעים במסך <Link to="/admin/bank-scraper" className="link-action">ניהול ← משיכה אוטומטית מהבנק</Link>.
        </p>
        {settingQuery.isLoading ? null : setting?.last_synced_at ? (
          <p className="text-xs text-ink-subtle">
            קליטה מוצלחת אחרונה: {new Date(setting.last_synced_at).toLocaleString("he-IL")}
            {setting.last_synced_execution_date && ` · התנועה האחרונה מתאריך ${setting.last_synced_execution_date}`}
          </p>
        ) : (
          <p className="text-xs text-ink-subtle">עדיין לא נקלטו תנועות לחשבון הזה.</p>
        )}
      </div>

      {error && <div className="mb-4"><ErrorState message={error} /></div>}
      {setting && (
        <>
          <h2 className="mb-2 mt-2 text-sm font-semibold text-ink-muted">היסטוריית הרצות</h2>
          <DataTable
            columns={runColumns}
            rows={runsQuery.data ?? []}
            rowKey={(r) => r.id}
            loading={runsQuery.isLoading} error={runsQuery.error} onRetry={() => runsQuery.refetch()}
            emptyTitle="עדיין לא בוצעה משיכה אוטומטית עבור חשבון זה"
            emptyIcon={RefreshCw}
          />
        </>
      )}
    </div>
  );
}
