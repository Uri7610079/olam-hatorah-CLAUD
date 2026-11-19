import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Link2, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { writeJsonToFolder } from "@/lib/folderAccess";
import { StatusBadge } from "@/components/StatusBadge";

// השם חייב להיות זהה ל-UPLOAD_CONFIG_FILE ב-bank-scraper-portable.ps1
export const SCRAPER_UPLOAD_FILE = "חיבור-למערכת.json";

interface RunRow {
  id: string;
  started_at: string;
  status: "running" | "success" | "partial" | "failed";
  transactions_committed: number;
  transactions_duplicate: number;
  gap_detail: string | null;
  error_message: string | null;
  account: string;
  organization: string;
}

interface UnmatchedRow {
  id: string;
  bank_code: string;
  account_number: string;
  reason: "not_found" | "ambiguous";
  transactions_count: number;
  last_seen_at: string;
}

const STATUS_LABEL: Record<RunRow["status"], { label: string; severity: "ok" | "medium" | "critical" | "neutral" }> = {
  success: { label: "נקלט", severity: "ok" },
  partial: { label: "נקלט - לבדיקה", severity: "medium" },
  failed: { label: "נכשל", severity: "critical" },
  running: { label: "רץ", severity: "neutral" },
};

const fmt = (v: string) => new Date(v).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });

// חיבור הסקרייפר למערכת (מיגרציה 123): התנועות נקלטות מיד אחרי המשיכה, בלי יבוא
// ידני. המפתח נוצר כאן ונכתב ישר לתיקיית הבנק שבמחשב הזה - לא מוצג ולא מועתק ידנית.
// במסד נשמרת רק טביעה שלו, ולכן אי אפשר "לראות" מפתח קיים: רק ליצור חדש.
export function BankScraperConnectionPanel() {
  const { hasPermission: canManage } = useHasPermission("bank_import", "perform");
  const [keyStatus, setKeyStatus] = useState<{ has_key: boolean; created_at: string | null } | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedRow[]>([]);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const [ks, rs, um] = await Promise.all([
      supabase.rpc("bank_scraper_key_status"),
      supabase
        .from("bank_auto_sync_runs")
        .select(
          "id, started_at, status, transactions_committed, transactions_duplicate, gap_detail, error_message, setting:bank_auto_sync_settings!inner(provider, account:organization_bank_accounts(account_number, bank_name, organization:organizations(legal_name)))",
        )
        .eq("setting.provider", "office_scraper")
        .order("started_at", { ascending: false })
        .limit(15),
      supabase
        .from("bank_scraper_unmatched_accounts")
        .select("id, bank_code, account_number, reason, transactions_count, last_seen_at")
        .is("resolved_at", null)
        .is("ignored_at", null)
        .order("last_seen_at", { ascending: false }),
    ]);
    const k = Array.isArray(ks.data) ? ks.data[0] : ks.data;
    setKeyStatus(k ?? { has_key: false, created_at: null });
    const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
    setRuns(
      ((rs.data ?? []) as any[]).map((r) => {
        const acc = one<any>(one<any>(r.setting)?.account);
        return {
          ...r,
          account: acc ? `${acc.bank_name ?? ""} ${acc.account_number ?? ""}`.trim() : "—",
          organization: one<any>(acc?.organization)?.legal_name ?? "—",
        };
      }),
    );
    setUnmatched((um.data ?? []) as UnmatchedRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const ignore = async (u: UnmatchedRow) => {
    if (!window.confirm(`להתעלם מחשבון ${u.account_number}? התנועות שלו לא ייקלטו, והוא לא יופיע יותר כהתראה. אפשר לבטל ברישום החשבון תחת עמותה.`)) return;
    const { error } = await supabase.rpc("set_unmatched_bank_account_ignored", { p_id: u.id, p_ignored: true });
    if (error) setMessage({ kind: "error", text: error.message });
    void load();
  };

  const connect = async () => {
    if (keyStatus?.has_key && !window.confirm("כבר קיים חיבור. חיבור חדש מבטל את הקודם - הסקרייפר ישתמש רק בחדש. להמשיך?")) return;
    setWorking(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.rpc("create_bank_scraper_key");
      if (error || !data) throw new Error(error?.message ?? "יצירת המפתח נכשלה");
      await writeJsonToFolder("bank", SCRAPER_UPLOAD_FILE, {
        _הסבר: "נוצר מהאתר, מסך משיכה אוטומטית מהבנק. הסקרייפר שולח בעזרתו את התנועות למערכת. לא לשתף.",
        url: import.meta.env.VITE_SUPABASE_URL,
        anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        secret: data as string,
        createdAt: new Date().toISOString(),
      });
      setMessage({ kind: "ok", text: "החיבור נוצר ונשמר בתיקיית הבנק. מהמשיכה הבאה, התנועות ייקלטו לבד." });
      void load();
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "שגיאה ביצירת החיבור" });
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="card space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Link2 className="h-4 w-4 text-ink-subtle" aria-hidden="true" />
          קליטה אוטומטית למערכת
        </p>
        <button type="button" onClick={() => void load()} className="btn-secondary flex items-center gap-1.5 text-xs">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          רענון
        </button>
      </div>

      <p className="text-xs text-ink-muted">
        אחרי כל משיכה הסקרייפר שולח את התנועות ישר למערכת, וכל חשבון נקלט לעמותה שלו לפי מספר החשבון. חשבון שלא רשום תחת
        עמותה לא נקלט ומופיע במרכז החריגות. הסיווג וההתאמה לתשלומים נשארים הצעה לפקיד.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        {keyStatus?.has_key ? (
          <StatusBadge severity="ok" label={`מחובר${keyStatus.created_at ? ` מאז ${fmt(keyStatus.created_at)}` : ""}`} />
        ) : (
          <StatusBadge severity="medium" label="לא מחובר - התנועות נשמרות רק כקבצים" />
        )}
        {canManage && (
          <button type="button" onClick={connect} disabled={working} className="btn-primary text-xs">
            {working ? "מחברת…" : keyStatus?.has_key ? "חיבור מחדש" : "חיבור הסקרייפר למערכת"}
          </button>
        )}
      </div>
      <p className="text-xs text-ink-subtle">
        את החיבור עושים <span className="font-medium">במחשב שבו הסקרייפר מותקן</span>: המפתח נשמר בתיקיית הבנק שלו, בקובץ "
        {SCRAPER_UPLOAD_FILE}".
      </p>

      {message && (
        <div
          className={`flex items-start gap-2 rounded-control border p-2.5 text-xs ${
            message.kind === "ok" ? "border-line bg-surface-muted text-ink-muted" : "border-warn bg-warn-soft text-warn-ink"
          }`}
        >
          {message.kind === "ok" ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" aria-hidden="true" />
          ) : (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {unmatched.length > 0 && (
        <div className="space-y-1.5 rounded-control border border-warn bg-warn-soft p-3 text-xs text-warn-ink">
          <p className="font-semibold">חשבונות שנמשכו ולא נקלטו</p>
          {unmatched.map((u) => (
            <p key={u.id}>
              בנק {u.bank_code} · חשבון <span className="ltr-num">{u.account_number || "(ללא מספר)"}</span> · {u.transactions_count} תנועות ·{" "}
              {u.reason === "not_found" ? "לא רשום תחת אף עמותה - יש להוסיף אותו בכרטיס העמותה" : "תואם לכמה חשבונות במערכת"}
              {canManage && (
                <button type="button" onClick={() => void ignore(u)} className="ms-2 underline">
                  להתעלם מהחשבון הזה
                </button>
              )}
            </p>
          ))}
        </div>
      )}

      {runs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line text-ink-subtle">
                <th className="py-1.5 text-start font-medium">מתי</th>
                <th className="py-1.5 text-start font-medium">עמותה</th>
                <th className="py-1.5 text-start font-medium">חשבון</th>
                <th className="py-1.5 text-start font-medium">חדשות</th>
                <th className="py-1.5 text-start font-medium">כבר היו</th>
                <th className="py-1.5 text-start font-medium">מצב</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-line align-top last:border-0">
                  <td className="py-1.5 ltr-num">{fmt(r.started_at)}</td>
                  <td className="py-1.5">{r.organization}</td>
                  <td className="py-1.5 ltr-num">{r.account}</td>
                  <td className="py-1.5 ltr-num">{r.transactions_committed}</td>
                  <td className="py-1.5 ltr-num">{r.transactions_duplicate}</td>
                  <td className="py-1.5">
                    <StatusBadge severity={STATUS_LABEL[r.status].severity} label={STATUS_LABEL[r.status].label} />
                    {(r.gap_detail || r.error_message) && <p className="mt-1 max-w-xs text-ink-muted">{r.gap_detail ?? r.error_message}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
