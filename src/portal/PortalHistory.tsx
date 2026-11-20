import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Paperclip } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { REQUEST_KIND_LABEL, REQUEST_STATUS, formatDate, requestChanges } from "@/lib/portalRequests";
import { portalRpc, type PortalQuestion, type PortalRequest } from "./portalApi";
import { downloadBase64 } from "@/lib/safeFile";

export function PortalRequests() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["portal-requests"], queryFn: () => portalRpc<PortalRequest[]>("portal_my_requests") });
  const cancel = useMutation({
    mutationFn: (id: string) => portalRpc("portal_cancel_request", { p_request_id: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-requests"] }),
  });
  // ביטול בקשה עובר דרך אישור - עד היום לחיצה אחת ביטלה מיד
  const [cancelId, setCancelId] = useState<string | null>(null);

  if (q.isLoading) return <p className="py-10 text-center text-ink-muted">טוען…</p>;
  // עד היום שגיאת טעינה הוצגה כ"עדיין לא שלחת עדכונים" - כאילו הרשימה ריקה
  if (q.isError) return <p className="rounded-control bg-danger-soft p-4 text-danger-ink">לא ניתן לטעון את העדכונים. נסו לרענן את הדף.</p>;
  if (!q.data?.length) {
    return <p className="card p-8 text-center text-ink-muted">עדיין לא שלחת עדכונים. עדכון פרטים נעשה מתוך "פרטים ועדכון" ליד כל תלמיד.</p>;
  }

  return (
    <div className="space-y-3">
      {cancel.isError && (
        <p role="alert" className="rounded-control bg-danger-soft p-3 text-base text-danger-ink">ביטול הבקשה לא הצליח. נסו שוב.</p>
      )}
      {q.data.map((r) => {
        const st = REQUEST_STATUS[r.status];
        return (
          <article key={r.id} className="card p-5">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge severity={st.severity} label={st.label} />
              <span className="font-bold">{REQUEST_KIND_LABEL[r.kind]}</span>
              {r.student_name && <span className="text-ink-muted">· {r.student_name}</span>}
              <span className="ms-auto text-sm text-ink-muted">{formatDate(r.created_at)}</span>
            </div>
            <ul className="mt-3 space-y-1 text-base">
              {requestChanges(r.kind, r.payload, r.previous).map((line) => <li key={line}>{line}</li>)}
            </ul>
            {r.decision_note && (
              <p className={`mt-3 rounded-control p-3 text-base ${r.status === "rejected" ? "bg-danger-soft text-danger-ink" : "bg-surface-muted"}`}>
                המשרד: {r.decision_note}
              </p>
            )}
            {r.status === "pending" && (
              <button
                onClick={() => setCancelId(r.id)}
                disabled={cancel.isPending}
                className="mt-3 text-sm text-ink-muted underline hover:text-danger"
              >
                ביטול הבקשה
              </button>
            )}
          </article>
        );
      })}
      <ConfirmDialog
        open={cancelId !== null}
        title="ביטול הבקשה"
        description="הבקשה תבוטל ולא תגיע לטיפול המשרד. אפשר לשלוח בקשה חדשה בכל עת."
        confirmLabel="ביטול הבקשה"
        cancelLabel="חזרה"
        danger
        onCancel={() => setCancelId(null)}
        onConfirm={() => {
          if (cancelId) cancel.mutate(cancelId);
          setCancelId(null);
        }}
      />
    </div>
  );
}

// הקובץ שהמשרד צירף לתשובה. פונקציית המסד מחזירה אותו רק לראש הקבוצה ששאל.
async function downloadAnswerFile(questionId: string) {
  const rows = await portalRpc<{ file_name: string | null; file_type: string | null; file_base64: string }[]>(
    "portal_answer_attachment_for_leader", { p_question_id: questionId });
  const file = rows?.[0];
  if (!file) return;
  downloadBase64(file.file_base64, file.file_name);
}

export function PortalQuestions({ onAsk }: { onAsk: () => void }) {
  const q = useQuery({ queryKey: ["portal-questions"], queryFn: () => portalRpc<PortalQuestion[]>("portal_my_questions") });
  const [downloadError, setDownloadError] = useState<string | null>(null);

  if (q.isLoading) return <p className="py-10 text-center text-ink-muted">טוען…</p>;
  if (q.isError) return <p className="rounded-control bg-danger-soft p-4 text-danger-ink">לא ניתן לטעון את השאלות. נסו לרענן את הדף.</p>;
  if (!q.data?.length) {
    return (
      <div className="card space-y-4 p-8 text-center">
        <p className="text-ink-muted">עדיין לא שלחת שאלות.</p>
        <button onClick={onAsk} className="btn-primary h-11 px-6 text-base">שאלה למשרד</button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {downloadError && <p role="alert" className="rounded-control bg-danger-soft p-3 text-base text-danger-ink">{downloadError}</p>}
      {q.data.map((item) => (
        <article key={item.id} className="card p-5">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge
              severity={item.status === "answered" ? "ok" : "medium"}
              label={item.status === "answered" ? "נענתה" : "ממתינה לתשובה"}
            />
            <span className="font-bold">{item.student_name ? `על ${item.student_name}` : "שאלה כללית"}</span>
            <span className="ms-auto text-sm text-ink-muted">{formatDate(item.created_at)}</span>
          </div>
          {item.context && <p className="mt-2 text-sm text-ink-muted">{item.context}</p>}
          <p className="mt-3 whitespace-pre-line text-base">{item.body}</p>
          {item.attachment_name && (
            <p className="mt-2 flex items-center gap-1 text-sm text-ink-muted">
              <Paperclip className="h-4 w-4" aria-hidden="true" />
              {item.attachment_name}
            </p>
          )}
          {item.status === "answered" && (
            <div className="mt-4 rounded-control bg-ok-soft p-4 text-ok-ink">
              <p className="text-sm font-semibold">תשובת המשרד · {formatDate(item.answered_at)}</p>
              {item.answer && <p className="mt-1 whitespace-pre-line text-base">{item.answer}</p>}
              {item.answer_attachment_name && (
                <button
                  onClick={() => {
                    setDownloadError(null);
                    // עד היום כישלון בהורדה נבלע - הכפתור פשוט "לא עשה כלום"
                    downloadAnswerFile(item.id).catch(() => setDownloadError("הורדת הקובץ לא הצליחה. נסו שוב."));
                  }} className="mt-2 inline-flex items-center gap-2 rounded-control border border-ok/40 bg-surface px-3 py-2 text-base text-ok-ink hover:bg-ok-soft">
                  <Download className="h-5 w-5" aria-hidden="true" />
                  הורדת הקובץ: {item.answer_attachment_name}
                </button>
              )}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
