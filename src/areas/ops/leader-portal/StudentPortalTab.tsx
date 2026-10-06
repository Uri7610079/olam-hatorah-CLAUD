import { useQuery } from "@tanstack/react-query";
import { MessagesSquare } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { StatusBadge } from "@/components/StatusBadge";
import { REQUEST_KIND_LABEL, REQUEST_STATUS, formatDate, requestChanges, type RequestKind, type RequestStatus } from "@/lib/portalRequests";
import { QuestionCard } from "./LeaderPortalScreen";

// כרטיס תלמיד: כל מה שראש הקבוצה שלח עליו - עדכונים ושאלות - במקום אחד,
// כדי שמי שעונה לטלפון על התלמיד יראה מה כבר נאמר.
export function StudentPortalTab({ studentId }: { studentId: string }) {
  const query = useQuery({
    queryKey: ["student-portal", studentId],
    queryFn: async () => {
      const [requests, questions] = await Promise.all([
        supabase.from("portal_change_requests")
          .select("id, kind, status, payload, previous, decision_note, created_at, leader:group_leaders(full_name)")
          .eq("student_id", studentId).order("created_at", { ascending: false }),
        supabase.from("portal_questions")
          .select("id, body, context, status, answer, answer_attachment_name, answered_at, created_at, attachment_name, task_id, student_id, student:students(full_name, external_id), leader:group_leaders(full_name)")
          .eq("student_id", studentId).order("created_at", { ascending: false }),
      ]);
      if (requests.error) throw requests.error;
      if (questions.error) throw questions.error;
      const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
      return {
        requests: (requests.data ?? []).map((r) => ({ ...r, leader: one(r.leader) })),
        questions: (questions.data ?? []).map((q) => ({ ...q, student: one(q.student), leader: one(q.leader) })),
      };
    },
  });

  if (query.isLoading) return <LoadingState rows={2} />;
  if (query.isError || !query.data) return <EmptyState title="לא ניתן לטעון" icon={MessagesSquare} />;
  const { requests, questions } = query.data;
  if (!requests.length && !questions.length) {
    return <EmptyState title="ראש הקבוצה עוד לא שלח דבר על התלמיד" description="עדכונים ושאלות מפורטל ראשי הקבוצות יופיעו כאן." icon={MessagesSquare} />;
  }

  return (
    <div className="space-y-6">
      {questions.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-ink">שאלות</h3>
          {questions.map((q) => <QuestionCard key={q.id} q={q as Parameters<typeof QuestionCard>[0]["q"]} />)}
        </section>
      )}
      {requests.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">עדכונים</h3>
          {requests.map((r) => {
            const st = REQUEST_STATUS[r.status as RequestStatus];
            return (
              <div key={r.id} className="card p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge severity={st.severity} label={st.label} />
                  <span className="font-semibold">{REQUEST_KIND_LABEL[r.kind as RequestKind]}</span>
                  <span className="text-ink-muted">· {r.leader?.full_name}</span>
                  <span className="ms-auto text-ink-subtle">{formatDate(r.created_at)}</span>
                </div>
                <p className="mt-1">{requestChanges(r.kind as RequestKind, r.payload, r.previous).join(" · ")}</p>
                {r.decision_note && <p className="mt-1 text-ink-muted">{r.decision_note}</p>}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
