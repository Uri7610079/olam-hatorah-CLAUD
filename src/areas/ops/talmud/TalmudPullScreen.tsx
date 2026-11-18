import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, KeyRound, Loader2, MessageSquareText, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { PULL_STATUS_LABEL, encryptTalmudPassword, lastClosedMonth, type PullOrgStatus } from "@/lib/talmudPull";
import { PageHeader } from "@/components/PageHeader";
import { Tabs } from "@/components/Tabs";
import { MonthField } from "@/components/MonthField";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { EmptyState } from "@/components/EmptyState";
import { TalmudCertificatesTab } from "./TalmudCertificatesTab";

// משיכה מתלמוד (מיגרציה 118): המזכיר לוחץ, המערכת נכנסת לתלמוד בשם כל עמותה
// עם הסיסמה השמורה, והוא מקליד רק את קוד ה-SMS. ההתקדמות עצמה נעשית בשרת
// (api/talmud-pull.js), צעד אחד בכל קריאה - והמסך הזה הוא שקורא לצעד הבא כל
// כמה שניות, כל עוד יש משיכה פעילה. לכן צריך להשאיר את המסך פתוח עד הסוף.

type Tab = "pull" | "certificates" | "users";

interface StatusRow {
  job_id: string;
  job_month: string;
  job_status: "active" | "finished" | "cancelled";
  job_org_id: string;
  organization_id: string;
  legal_name: string;
  seq: number;
  status: PullOrgStatus;
  message: string | null;
  code_submitted: boolean;
  files_total: number | null;
  files_done: number;
  job_kind: "reports" | "certificates";
  item_errors: { external_id: string; name: string | null; reason: string }[] | null;
}

interface CredentialRow {
  organization_id: string;
  legal_name: string;
  username: string | null;
  has_password: boolean;
  updated_at: string | null;
  last_login_ok_at: string | null;
  last_login_error: string | null;
}

interface PulledFile {
  id: string;
  legal_name: string;
  report_label: string;
  file_name: string;
  size_bytes: number;
  created_at: string;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "שגיאה לא צפויה");
const monthText = (iso: string) => iso.slice(0, 7).split("-").reverse().join("/");

export function TalmudPullScreen() {
  const [tab, setTab] = useState<Tab>("pull");
  const { hasPermission, isLoading } = useHasPermission("talmud", "pull");
  if (isLoading) return <LoadingState rows={3} />;
  if (!hasPermission) return <ErrorState message="אין לך הרשאה למשיכה מתלמוד." />;
  return (
    <div>
      <PageHeader
        title="משיכה מתלמוד"
        description="המערכת נכנסת לתלמוד בשם כל עמותה ומורידה את הדוחות. צריך רק להקליד את קוד ה-SMS שמגיע."
      />
      <Tabs
        tabs={[{ key: "pull", label: "משיכה" }, { key: "certificates", label: "אישורי לימודים" }, { key: "users", label: "משתמשי תלמוד" }]}
        activeTab={tab}
        onChange={setTab}
        ariaLabel="משיכה מתלמוד"
      />
      {tab === "pull" && <PullTab onNeedUsers={() => setTab("users")} />}
      {tab === "certificates" && <TalmudCertificatesTab onStarted={() => setTab("pull")} />}
      {tab === "users" && <UsersTab />}
    </div>
  );
}

// ===== משיכה =====

function PullTab({ onNeedUsers }: { onNeedUsers: () => void }) {
  const qc = useQueryClient();
  const [month, setMonth] = useState(lastClosedMonth());
  const [stepError, setStepError] = useState<string | null>(null);

  const credentials = useQuery({
    queryKey: ["talmud-credentials"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("talmud_credentials_list");
      if (error) throw error;
      return (data ?? []) as CredentialRow[];
    },
  });
  const ready = (credentials.data ?? []).filter((c) => c.username && c.has_password);

  const status = useQuery({
    queryKey: ["talmud-pull-status"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("talmud_pull_status", { p_job_id: null });
      if (error) throw error;
      return (data ?? []) as StatusRow[];
    },
    refetchInterval: (q) => ((q.state.data as StatusRow[] | undefined)?.[0]?.job_status === "active" ? 2000 : false),
  });
  const rows = status.data ?? [];
  const active = rows[0]?.job_status === "active";

  // הצעד הבא בשרת - כל 3 שניות, אחד בכל פעם, כל עוד המשיכה פעילה
  const inFlight = useRef(false);
  useEffect(() => {
    if (!active) return;
    const tick = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const res = await fetch("/api/talmud-pull", { method: "POST" });
        const body = await res.json().catch(() => ({}));
        setStepError(res.ok ? null : body.error ?? `השרת החזיר ${res.status}`);
      } catch {
        setStepError("לא ניתן להגיע לשרת המשיכה");
      } finally {
        inFlight.current = false;
        qc.invalidateQueries({ queryKey: ["talmud-pull-status"] });
      }
    };
    void tick();
    const timer = setInterval(tick, 3000);
    return () => clearInterval(timer);
  }, [active, qc]);

  // כל עמותה - כניסה נפרדת עם שם המשתמש והסיסמה שלה, וקוד SMS משלה
  const start = useMutation({
    mutationFn: async (organizationId: string) => {
      const { error } = await supabase.rpc("talmud_start_pull", { p_month: month, p_organization_ids: [organizationId] });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["talmud-pull-status"] }),
  });
  const cancel = useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase.rpc("talmud_cancel_pull", { p_job_id: jobId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["talmud-pull-status"] }),
  });

  if (credentials.isLoading || status.isLoading) return <LoadingState rows={3} />;
  if (credentials.isError) return <ErrorState message={errText(credentials.error)} />;

  return (
    <div className="space-y-5">
      {!active && (
        <section className="card max-w-3xl space-y-4 p-5">
          {ready.length === 0 ? (
            <EmptyState
              title="עוד לא נשמרו משתמשי תלמוד"
              description="כדי למשוך, צריך לשמור לכל עמותה את שם המשתמש והסיסמה שלה בתלמוד."
              icon={KeyRound}
              action={<button onClick={onNeedUsers} className="btn-primary">למשתמשי תלמוד</button>}
            />
          ) : (
            <>
              <MonthField value={month} onChange={setMonth} label="חודש" id="pull-month" className="max-w-xs" />
              <p className="text-sm text-ink-muted">
                כל עמותה נכנסת לתלמוד בנפרד, עם שם המשתמש והסיסמה שלה, ומקבלת SMS משלה. יורדים 6 דוחות:
                דרישת תשלום, רשימת תלמידים, סיבות אי זכאות, תשלומים למוסד, זכאות בעקבות בג"ץ, והסבר תשלומים.
              </p>
              <div className="divide-y divide-line rounded-control border border-line">
                {ready.map((c) => (
                  <div key={c.organization_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span className="font-semibold">{c.legal_name}</span>
                    <span className="text-sm text-ink-muted" dir="ltr">{c.username}</span>
                    <button
                      onClick={() => start.mutate(c.organization_id)}
                      disabled={!month || start.isPending}
                      className="btn-primary ms-auto flex items-center gap-2"
                    >
                      <Download className="h-4 w-4" aria-hidden="true" />
                      {start.isPending && start.variables === c.organization_id ? "מתחיל…" : "משיכה לעמותה זו"}
                    </button>
                  </div>
                ))}
              </div>
              {start.isError && <ErrorState message={errText(start.error)} />}
            </>
          )}
        </section>
      )}

      {rows.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-semibold">
              {active ? "משיכה פעילה" : "המשיכה האחרונה"} · {rows[0].job_kind === "certificates" ? "אישורי לימודים" : `חודש ${monthText(rows[0].job_month)}`}
            </h2>
            {active && (
              <>
                <span className="text-sm text-ink-muted">יש להשאיר את המסך פתוח עד הסוף.</span>
                <button onClick={() => cancel.mutate(rows[0].job_id)} className="btn-secondary ms-auto text-sm">ביטול המשיכה</button>
              </>
            )}
          </div>
          {stepError && <ErrorState message={stepError} />}
          <div className="space-y-2">
            {rows.map((r) => <OrgRow key={r.job_org_id} r={r} />)}
          </div>
          <PulledFiles jobId={rows[0].job_id} refreshKey={rows.reduce((n, r) => n + r.files_done, 0)} autoSave={rows[0].job_kind === "certificates"} />
        </section>
      )}
    </div>
  );
}

function OrgRow({ r }: { r: StatusRow }) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const submit = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("talmud_submit_sms", { p_job_org_id: r.job_org_id, p_code: code });
      if (error) throw error;
    },
    onSuccess: () => { setCode(""); qc.invalidateQueries({ queryKey: ["talmud-pull-status"] }); },
  });

  const icon = r.status === "done" ? <CheckCircle2 className="h-5 w-5 text-ok" aria-hidden="true" />
    : r.status === "failed" || r.status === "cancelled" ? <XCircle className="h-5 w-5 text-danger" aria-hidden="true" />
    : r.status === "waiting_sms" ? <MessageSquareText className="h-5 w-5 text-brand-600" aria-hidden="true" />
    : r.status === "queued" ? <span className="h-5 w-5" />
    : <Loader2 className="h-5 w-5 animate-spin text-ink-muted" aria-hidden="true" />;

  return (
    <div className={`card p-4 ${r.status === "waiting_sms" ? "border-brand-500 ring-1 ring-brand-500" : ""}`}>
      <div className="flex flex-wrap items-center gap-3">
        {icon}
        <span className="font-semibold">{r.legal_name}</span>
        <span className="text-sm text-ink-muted">
          {r.status === "downloading" && r.files_total
            ? `${r.job_kind === "certificates" ? "מוריד אישורים" : "מוריד קבצים"} (${r.files_done} מתוך ${r.files_total})`
            : PULL_STATUS_LABEL[r.status]}
        </span>
        {r.message && r.status !== "waiting_sms" && (
          <span className={`text-sm ${r.status === "failed" ? "text-danger-ink" : "text-ink-subtle"}`}>· {r.message}</span>
        )}
      </div>
      {(r.item_errors?.length ?? 0) > 0 && (
        <p className="mt-2 text-sm text-warn-ink">
          לא נמצאו בתלמוד בעמותה הזו: {r.item_errors!.map((e) => `${e.name || ""} ${e.external_id}`.trim()).join(" · ")}
        </p>
      )}
      {r.status === "waiting_sms" && (
        r.code_submitted ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> הקוד נשלח לתלמוד…</p>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); submit.mutate(); }} className="mt-3 flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor={`sms-${r.job_org_id}`} className="field-label">הקוד שהגיע ב-SMS</label>
              <input
                id={`sms-${r.job_org_id}`}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                dir="ltr"
                className="input-field w-40 text-center text-lg tracking-widest"
              />
            </div>
            <button type="submit" disabled={!/^\d{4,8}$/.test(code.trim()) || submit.isPending} className="btn-primary">שליחה</button>
            {submit.isError && <p className="w-full text-sm text-danger-ink">{errText(submit.error)}</p>}
          </form>
        )
      )}
    </div>
  );
}

// אישורי לימודים נשמרים לבד בתיקיית ההורדות ברגע שהם מגיעים. מה כבר נשמר נזכר
// בדפדפן (לנוחות בלבד), כדי שרענון של המסך לא יוריד את אותו אישור שוב.
const savedKey = (jobId: string) => `talmud-saved-${jobId}`;
function loadSaved(jobId: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(savedKey(jobId)) ?? "[]")); } catch { return new Set(); }
}
function rememberSaved(jobId: string, ids: Set<string>) {
  try { localStorage.setItem(savedKey(jobId), JSON.stringify([...ids])); } catch { /* בלי זיכרון - לא נורא */ }
}

function PulledFiles({ jobId, refreshKey, autoSave }: { jobId: string; refreshKey: number; autoSave: boolean }) {
  const files = useQuery({
    queryKey: ["talmud-pulled-files", jobId, refreshKey],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("talmud_pulled_files_list", { p_job_id: jobId });
      if (error) throw error;
      return (data ?? []) as PulledFile[];
    },
  });
  const download = async (f: PulledFile) => {
    const { data, error } = await supabase.rpc("talmud_pulled_file", { p_file_id: f.id });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) return;
    const bytes = Uint8Array.from(atob(row.file_base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: row.file_type || "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = row.file_name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const saved = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!autoSave || !files.data?.length) return;
    saved.current ??= loadSaved(jobId);
    const fresh = files.data.filter((f) => !saved.current!.has(f.id));
    if (!fresh.length) return;
    (async () => {
      for (const f of fresh) {
        saved.current!.add(f.id);
        await download(f);
        await new Promise((r) => setTimeout(r, 400)); // דפדפן חוסם הרבה הורדות בבת אחת
      }
      rememberSaved(jobId, saved.current!);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSave, files.data, jobId]);

  if (!files.data?.length) return null;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-muted text-right text-ink-muted">
          <tr>
            <th className="px-3 py-2 font-semibold">עמותה</th>
            <th className="px-3 py-2 font-semibold">דוח</th>
            <th className="px-3 py-2 font-semibold">קובץ</th>
            <th className="px-3 py-2"><span className="sr-only">הורדה</span></th>
          </tr>
        </thead>
        <tbody>
          {files.data.map((f) => (
            <tr key={f.id} className="border-t border-line">
              <td className="px-3 py-2">{f.legal_name}</td>
              <td className="px-3 py-2">{f.report_label}</td>
              <td className="px-3 py-2 text-ink-muted" dir="ltr">{f.file_name} · {Math.max(1, Math.round(f.size_bytes / 1024))}KB</td>
              <td className="px-3 py-2">
                <button onClick={() => download(f)} className="link-action inline-flex items-center gap-1">
                  <Download className="h-4 w-4" aria-hidden="true" /> הורדה
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ===== משתמשי תלמוד =====

function UsersTab() {
  const credentials = useQuery({
    queryKey: ["talmud-credentials"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("talmud_credentials_list");
      if (error) throw error;
      return (data ?? []) as CredentialRow[];
    },
  });
  if (credentials.isLoading) return <LoadingState rows={3} />;
  if (credentials.isError) return <ErrorState message={errText(credentials.error)} />;
  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-ink-muted">
        לכל עמותה יש בתלמוד שם משתמש וסיסמה משלה. הסיסמה מוצפנת עוד במחשב הזה, לפני שהיא נשמרת,
        ואי אפשר לראות אותה שוב - רק להחליף. כשמשנים בתלמוד את הסיסמה, צריך לעדכן אותה גם כאן.
      </p>
      <div className="space-y-2">
        {(credentials.data ?? []).map((c) => <CredentialCard key={c.organization_id} c={c} />)}
      </div>
    </div>
  );
}

function CredentialCard({ c }: { c: CredentialRow }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState(c.username ?? "");
  const [password, setPassword] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      const encrypted = password ? await encryptTalmudPassword(password) : null;
      const { error } = await supabase.rpc("talmud_set_credentials", {
        p_organization_id: c.organization_id, p_username: username.trim(), p_password_encrypted: encrypted,
      });
      if (error) throw error;
    },
    onSuccess: () => { setPassword(""); setEditing(false); qc.invalidateQueries({ queryKey: ["talmud-credentials"] }); },
  });
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("talmud_delete_credentials", { p_organization_id: c.organization_id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["talmud-credentials"] }),
  });
  const saved = c.username && c.has_password;

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-semibold">{c.legal_name}</span>
        {saved ? (
          <span className="text-sm text-ink-muted">משתמש: <span dir="ltr">{c.username}</span> · סיסמה שמורה</span>
        ) : (
          <span className="text-sm text-ink-subtle">לא הוגדר</span>
        )}
        {c.last_login_ok_at && <span className="text-sm text-ok-ink">· כניסה אחרונה הצליחה {new Date(c.last_login_ok_at).toLocaleDateString("he-IL")}</span>}
        {c.last_login_error && <span className="text-sm text-danger-ink">· הכניסה האחרונה נכשלה: {c.last_login_error}</span>}
        {!editing && (
          <button onClick={() => setEditing(true)} className="btn-secondary ms-auto text-sm">{saved ? "עדכון" : "הגדרה"}</button>
        )}
      </div>
      {editing && (
        <form
          onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
          className="mt-3 flex flex-wrap items-end gap-3"
          autoComplete="off"
        >
          <div>
            <label htmlFor={`u-${c.organization_id}`} className="field-label">שם משתמש בתלמוד</label>
            <input id={`u-${c.organization_id}`} value={username} onChange={(e) => setUsername(e.target.value)} dir="ltr" autoComplete="off" className="input-field w-56" />
          </div>
          <div>
            <label htmlFor={`p-${c.organization_id}`} className="field-label">{saved ? "סיסמה חדשה (ריק = בלי שינוי)" : "סיסמה בתלמוד"}</label>
            <input id={`p-${c.organization_id}`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" autoComplete="new-password" className="input-field w-56" />
          </div>
          <button type="submit" disabled={!username.trim() || (!saved && !password) || save.isPending} className="btn-primary">
            {save.isPending ? "שומר…" : "שמירה"}
          </button>
          <button type="button" onClick={() => { setEditing(false); setPassword(""); setUsername(c.username ?? ""); }} className="btn-secondary">ביטול</button>
          {saved && (
            <button type="button" onClick={() => remove.mutate()} className="link-action text-sm text-danger-ink">מחיקת המשתמש</button>
          )}
          {(save.isError || remove.isError) && <p className="w-full text-sm text-danger-ink">{errText(save.error ?? remove.error)}</p>}
        </form>
      )}
    </div>
  );
}
