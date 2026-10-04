import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, Inbox, ListTodo } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { Tabs } from "@/components/Tabs";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import {
  REQUEST_KIND_LABEL, REQUEST_STATUS, formatDate, requestChanges,
  type RequestKind, type RequestStatus,
} from "@/lib/portalRequests";

// פורטל ראשי הקבוצות - הצד של המשרד (מיגרציה 111).
//
// ארבעה דברים במקום אחד: מה ממתין לאישור, שאלות שממתינות לתשובה, מי יכול
// להיכנס לפורטל, ומה עודכן. הכל נכתב דרך פונקציות המסד - הן שבודקות
// הרשאה, מחילות את השינוי, ורושמות ביומן.

type Tab = "requests" | "questions" | "access" | "history";

interface RequestRow {
  id: string;
  kind: RequestKind;
  status: RequestStatus;
  payload: Record<string, string | null>;
  previous: Record<string, string | null> | null;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
  student_id: string | null;
  student: { full_name: string; external_id: string } | null;
  leader: { full_name: string } | null;
  group: { name: string } | null;
}

interface QuestionRow {
  id: string;
  body: string;
  context: string | null;
  status: "open" | "answered";
  answer: string | null;
  answered_at: string | null;
  created_at: string;
  attachment_name: string | null;
  task_id: string | null;
  student_id: string | null;
  student: { full_name: string; external_id: string } | null;
  leader: { full_name: string } | null;
}

interface AccessRow {
  group_leader_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  login_identifier: string | null;
  has_password: boolean;
  password_is_default: boolean;
  enabled: boolean;
  locked_until: string | null;
  last_login_at: string | null;
  active_groups: number;
  problem: string | null;
}

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
const errText = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message ?? "הפעולה נכשלה");

const REQUEST_SELECT =
  "id, kind, status, payload, previous, decision_note, created_at, decided_at, student_id, student:students(full_name, external_id), leader:group_leaders(full_name), group:groups(name)";

async function fetchRequests(pending: boolean): Promise<RequestRow[]> {
  let q = supabase.from("portal_change_requests").select(REQUEST_SELECT);
  q = pending ? q.eq("status", "pending").order("created_at") : q.neq("status", "pending").order("created_at", { ascending: false }).limit(300);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, student: one(r.student), leader: one(r.leader), group: one(r.group) })) as RequestRow[];
}

async function fetchQuestions(): Promise<QuestionRow[]> {
  const { data, error } = await supabase
    .from("portal_questions")
    .select("id, body, context, status, answer, answered_at, created_at, attachment_name, task_id, student_id, student:students(full_name, external_id), leader:group_leaders(full_name)")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, student: one(r.student), leader: one(r.leader) })) as QuestionRow[];
}

export function LeaderPortalScreen() {
  const [tab, setTab] = useState<Tab>("requests");
  const pending = useQuery({ queryKey: ["portal-office-requests", "pending"], queryFn: () => fetchRequests(true) });
  const questions = useQuery({ queryKey: ["portal-office-questions"], queryFn: fetchQuestions });
  const openQuestions = (questions.data ?? []).filter((q) => q.status === "open").length;

  return (
    <div>
      <PageHeader
        title="פורטל ראשי קבוצות"
        description="עדכונים שראשי הקבוצות שלחו לאישור, שאלות שלהם למשרד, ומי יכול להיכנס לפורטל."
        primaryAction={<PortalAddress />}
      />
      <Tabs
        tabs={[
          { key: "requests", label: "ממתין לאישור", badge: pending.data?.length || undefined },
          { key: "questions", label: "שאלות", badge: openQuestions || undefined },
          { key: "access", label: "גישה לפורטל" },
          { key: "history", label: "יומן עדכונים" },
        ]}
        activeTab={tab}
        onChange={setTab}
        ariaLabel="פורטל ראשי קבוצות"
      />
      {tab === "requests" && <PendingRequests query={pending} />}
      {tab === "questions" && <QuestionsList query={questions} />}
      {tab === "access" && <AccessList />}
      {tab === "history" && <RequestHistory />}
    </div>
  );
}

function PortalAddress() {
  const url = `${window.location.origin}/portal`;
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
      className="btn-secondary flex items-center gap-2"
      title="הכתובת שראשי הקבוצות נכנסים בה. זהה לכולם."
    >
      <Copy className="h-4 w-4" aria-hidden="true" />
      <span dir="ltr">{copied ? "הועתק" : url.replace(/^https?:\/\//, "")}</span>
    </button>
  );
}

// ===== ממתין לאישור =====
function PendingRequests({ query }: { query: ReturnType<typeof useQuery<RequestRow[]>> }) {
  if (query.isLoading) return <LoadingState rows={3} />;
  if (query.isError) return <ErrorState message={errText(query.error)} />;
  if (!query.data?.length) return <EmptyState title="אין עדכונים שממתינים לאישור" description="עדכון שראש קבוצה ישלח יופיע כאן." icon={Inbox} />;
  return <div className="space-y-3">{query.data.map((r) => <RequestCard key={r.id} r={r} />)}</div>;
}

function RequestCard({ r }: { r: RequestRow }) {
  const qc = useQueryClient();
  const { hasPermission: canDecide } = useHasPermission("students", "manage");
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: async (approve: boolean) => {
      const { error } = await supabase.rpc("portal_decide_request", { p_request_id: r.id, p_approve: approve, p_note: note || null });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-office-requests"] });
      qc.invalidateQueries({ queryKey: ["portal-office-counts"] });
    },
  });

  return (
    <article className="card p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-ink">{REQUEST_KIND_LABEL[r.kind]}</span>
        <span className="text-ink-muted">· מאת {r.leader?.full_name ?? "—"}</span>
        {r.group && <span className="text-ink-muted">· קבוצת {r.group.name}</span>}
        <span className="ms-auto text-ink-subtle">{formatDate(r.created_at)}</span>
      </div>
      {r.student && r.student_id && (
        <p className="mt-1 text-sm">
          <Link to={`/ops/students/${r.student_id}`} className="link-action">{r.student.full_name}</Link>
          <span className="text-ink-muted"> · {r.student.external_id}</span>
        </p>
      )}
      <ul className="mt-2 space-y-0.5 text-sm text-ink">
        {requestChanges(r.kind, r.payload, r.previous).map((line) => <li key={line}>{line}</li>)}
      </ul>

      {canDecide && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          {!rejecting ? (
            <>
              <button onClick={() => decide.mutate(true)} disabled={decide.isPending} className="btn-primary">אישור</button>
              <button onClick={() => setRejecting(true)} disabled={decide.isPending} className="btn-secondary">דחייה</button>
            </>
          ) : (
            <>
              <div className="min-w-[16rem] flex-1">
                <label htmlFor={`note-${r.id}`} className="field-label">סיבת הדחייה (ראש הקבוצה יראה אותה)</label>
                <input id={`note-${r.id}`} value={note} onChange={(e) => setNote(e.target.value)} className="input-field" autoFocus />
              </div>
              <button onClick={() => decide.mutate(false)} disabled={decide.isPending || !note.trim()} className="btn-danger">אישור הדחייה</button>
              <button onClick={() => { setRejecting(false); setNote(""); }} className="btn-secondary">ביטול</button>
            </>
          )}
        </div>
      )}
      {decide.isError && <div className="mt-2"><ErrorState message={errText(decide.error)} /></div>}
    </article>
  );
}

// ===== שאלות =====
function QuestionsList({ query }: { query: ReturnType<typeof useQuery<QuestionRow[]>> }) {
  const [show, setShow] = useState<"open" | "answered">("open");
  if (query.isLoading) return <LoadingState rows={3} />;
  if (query.isError) return <ErrorState message={errText(query.error)} />;
  const rows = (query.data ?? []).filter((q) => q.status === show);
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(["open", "answered"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setShow(k)}
            aria-pressed={show === k}
            className={`rounded-full border px-3 py-1 text-sm ${show === k ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-ink-muted"}`}
          >
            {k === "open" ? "ממתינות לתשובה" : "נענו"}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState title={show === "open" ? "אין שאלות שממתינות לתשובה" : "עדיין לא נענו שאלות"} icon={Inbox} />
      ) : (
        rows.map((q) => <QuestionCard key={q.id} q={q} />)
      )}
    </div>
  );
}

export function QuestionCard({ q }: { q: QuestionRow }) {
  const qc = useQueryClient();
  const { hasPermission: canAnswer } = useHasPermission("students", "manage");
  const { hasPermission: canTask } = useHasPermission("tasks", "create");
  const [answer, setAnswer] = useState("");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["portal-office-questions"] });
    qc.invalidateQueries({ queryKey: ["portal-office-counts"] });
    qc.invalidateQueries({ queryKey: ["student-portal"] });
  };
  const send = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("portal_answer_question", { p_question_id: q.id, p_answer: answer });
      if (error) throw error;
    },
    onSuccess: refresh,
  });
  const toTask = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("portal_question_to_task", { p_question_id: q.id });
      if (error) throw error;
    },
    onSuccess: refresh,
  });
  const download = async () => {
    const { data, error } = await supabase.rpc("portal_question_attachment", { p_question_id: q.id });
    const file = Array.isArray(data) ? data[0] : data;
    if (error || !file) return;
    const bytes = Uint8Array.from(atob(file.file_base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: file.file_type || "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = file.file_name || "קובץ";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <article className="card p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-ink">{q.leader?.full_name ?? "—"}</span>
        {q.student && q.student_id ? (
          <span className="text-ink-muted">
            · על <Link to={`/ops/students/${q.student_id}`} className="link-action">{q.student.full_name}</Link> ({q.student.external_id})
          </span>
        ) : (
          <span className="text-ink-muted">· שאלה כללית</span>
        )}
        <span className="ms-auto text-ink-subtle">{formatDate(q.created_at)}</span>
      </div>
      {q.context && <p className="mt-1 text-xs text-ink-muted">{q.context}</p>}
      <p className="mt-2 whitespace-pre-line text-sm text-ink">{q.body}</p>
      {q.attachment_name && (
        <button onClick={download} className="link-action mt-2 flex items-center gap-1 text-sm">
          <Download className="h-4 w-4" aria-hidden="true" />
          {q.attachment_name}
        </button>
      )}

      {q.answer ? (
        <p className="mt-3 rounded-control bg-ok-soft p-3 text-sm text-ok-ink">
          <span className="font-semibold">התשובה ({formatDate(q.answered_at)}):</span> {q.answer}
        </p>
      ) : canAnswer ? (
        <div className="mt-3 space-y-2">
          <label htmlFor={`ans-${q.id}`} className="field-label">תשובה לראש הקבוצה</label>
          <textarea id={`ans-${q.id}`} rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} className="input-field" />
          <button onClick={() => send.mutate()} disabled={send.isPending || !answer.trim()} className="btn-primary">שליחת תשובה</button>
        </div>
      ) : null}

      <div className="mt-2 flex items-center gap-3 text-sm">
        {q.task_id ? (
          <Link to="/tasks/all" className="link-action flex items-center gap-1"><ListTodo className="h-4 w-4" aria-hidden="true" />נוצרה משימה</Link>
        ) : canTask ? (
          <button onClick={() => toTask.mutate()} disabled={toTask.isPending} className="link-action flex items-center gap-1">
            <ListTodo className="h-4 w-4" aria-hidden="true" />
            העברה למשימה
          </button>
        ) : null}
      </div>
      {(send.isError || toTask.isError) && <div className="mt-2"><ErrorState message={errText(send.error ?? toTask.error)} /></div>}
    </article>
  );
}

// ===== גישה לפורטל =====
function AccessList() {
  const qc = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("groups", "manage");
  const query = useQuery({
    queryKey: ["portal-office-access"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("portal_leader_access_list");
      if (error) throw error;
      return (data ?? []) as AccessRow[];
    },
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const setPw = useMutation({
    mutationFn: async ({ id, pw }: { id: string; pw: string | null }) => {
      const { error } = await supabase.rpc("portal_set_leader_password", { p_leader_id: id, p_password: pw });
      if (error) throw error;
      return pw;
    },
    onSuccess: (pw) => {
      setDone(pw ? "הסיסמה נקבעה." : "הסיסמה אופסה ל-4 הספרות האחרונות של הטלפון.");
      setEditing(null);
      setPassword("");
      qc.invalidateQueries({ queryKey: ["portal-office-access"] });
    },
  });
  const setAccess = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase.rpc("portal_set_leader_access", { p_leader_id: id, p_enabled: enabled });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-office-access"] }),
  });

  if (query.isLoading) return <LoadingState rows={4} />;
  if (query.isError) return <ErrorState message={errText(query.error)} />;

  const status = (a: AccessRow) =>
    !a.enabled ? { label: "חסום", severity: "high" as const }
    : a.locked_until ? { label: `נעול עד ${new Date(a.locked_until).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}`, severity: "medium" as const }
    : a.problem ? { label: "דורש טיפול", severity: "medium" as const }
    : { label: "פעיל", severity: "ok" as const };

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">
        ראש קבוצה נכנס עם המייל שלו, ומי שאין לו מייל - עם הטלפון. הסיסמה הראשונית היא 4 הספרות האחרונות של הטלפון.
        המשרד יכול לקבוע סיסמה אחרת או לאפס אותה; את הסיסמה הקיימת לא רואים, כי היא שמורה מוצפנת.
      </p>
      {done && <p className="rounded-control bg-ok-soft p-2 text-sm text-ok-ink">{done}</p>}
      {(setPw.isError || setAccess.isError) && <ErrorState message={errText(setPw.error ?? setAccess.error)} />}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-right text-ink-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">ראש קבוצה</th>
              <th className="px-3 py-2 font-semibold">נכנס עם</th>
              <th className="px-3 py-2 font-semibold">קבוצות</th>
              <th className="px-3 py-2 font-semibold">כניסה אחרונה</th>
              <th className="px-3 py-2 font-semibold">מצב</th>
              <th className="px-3 py-2"><span className="sr-only">פעולות</span></th>
            </tr>
          </thead>
          <tbody>
            {(query.data ?? []).map((a) => {
              const st = status(a);
              return (
                <tr key={a.group_leader_id} className="border-t border-line align-top">
                  <td className="px-3 py-2 font-medium">
                    {a.full_name}
                    {a.problem && <div className="text-xs font-normal text-danger-ink">{a.problem}</div>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2" dir="ltr">{a.login_identifier ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums">{a.active_groups}</td>
                  <td className="whitespace-nowrap px-3 py-2">{a.last_login_at ? formatDate(a.last_login_at) : "טרם נכנס"}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <StatusBadge severity={st.severity} label={st.label} />
                    {a.has_password && <div className="mt-1 text-xs text-ink-muted">{a.password_is_default ? "סיסמת ברירת מחדל" : "סיסמה שנקבעה במשרד"}</div>}
                  </td>
                  <td className="px-3 py-2">
                    {canManage && (editing === a.group_leader_id ? (
                      <form
                        onSubmit={(e) => { e.preventDefault(); setPw.mutate({ id: a.group_leader_id, pw: password }); }}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <input
                          aria-label={`סיסמה חדשה ל${a.full_name}`}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="input-field h-8 w-36"
                          placeholder="לפחות 4 תווים"
                          autoFocus
                        />
                        <button type="submit" disabled={password.trim().length < 4 || setPw.isPending} className="btn-primary h-8">שמירה</button>
                        <button type="button" onClick={() => setEditing(null)} className="btn-secondary h-8">ביטול</button>
                      </form>
                    ) : (
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        <button onClick={() => { setDone(null); setEditing(a.group_leader_id); setPassword(""); }} className="link-action">קביעת סיסמה</button>
                        {a.phone && (
                          <button onClick={() => { setDone(null); setPw.mutate({ id: a.group_leader_id, pw: null }); }} className="link-action">איפוס ל-4 ספרות</button>
                        )}
                        <button onClick={() => setAccess.mutate({ id: a.group_leader_id, enabled: !a.enabled })} className="link-action">
                          {a.enabled ? "חסימת גישה" : "ביטול החסימה"}
                        </button>
                      </div>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ===== יומן =====
function RequestHistory() {
  const query = useQuery({ queryKey: ["portal-office-requests", "history"], queryFn: () => fetchRequests(false) });
  if (query.isLoading) return <LoadingState rows={4} />;
  if (query.isError) return <ErrorState message={errText(query.error)} />;
  if (!query.data?.length) return <EmptyState title="עדיין אין עדכונים" icon={Inbox} />;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-muted text-right text-ink-muted">
          <tr>
            <th className="px-3 py-2 font-semibold">תאריך</th>
            <th className="px-3 py-2 font-semibold">ראש קבוצה</th>
            <th className="px-3 py-2 font-semibold">תלמיד</th>
            <th className="px-3 py-2 font-semibold">סוג</th>
            <th className="px-3 py-2 font-semibold">שינוי</th>
            <th className="px-3 py-2 font-semibold">מצב</th>
          </tr>
        </thead>
        <tbody>
          {query.data.map((r) => (
            <tr key={r.id} className="border-t border-line align-top">
              <td className="whitespace-nowrap px-3 py-2">{formatDate(r.created_at)}</td>
              <td className="px-3 py-2">{r.leader?.full_name ?? "—"}</td>
              <td className="px-3 py-2">
                {r.student && r.student_id ? <Link to={`/ops/students/${r.student_id}`} className="link-action">{r.student.full_name}</Link> : r.payload.full_name ?? "—"}
              </td>
              <td className="whitespace-nowrap px-3 py-2">{REQUEST_KIND_LABEL[r.kind]}</td>
              <td className="px-3 py-2">{requestChanges(r.kind, r.payload, r.previous).join(" · ")}</td>
              <td className="whitespace-nowrap px-3 py-2">
                <StatusBadge severity={REQUEST_STATUS[r.status].severity} label={REQUEST_STATUS[r.status].label} />
                {r.decision_note && <div className="mt-1 text-xs text-ink-muted">{r.decision_note}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
