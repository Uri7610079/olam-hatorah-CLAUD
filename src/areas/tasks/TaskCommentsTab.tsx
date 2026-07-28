import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip } from "lucide-react";
import {
  addComment,
  deleteAttachment,
  fetchAttachments,
  fetchComments,
  getAttachmentUrl,
  updateComment,
  uploadAttachment,
} from "./api";
import { LoadingState } from "@/components/LoadingState";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";

interface TaskCommentsTabProps {
  taskId: string;
  canEdit: boolean;
  userId: string;
}

// הערות ניתנות לעריכה ללא הגבלת זמן (סעיף 19/22 באפיון) - "נערך" מוצג כש-updated_at
// לא ריק, בלי צורך בעמודה נפרדת. RLS מתיר עריכה למחבר עצמו תמיד, או למי שיש לו tasks.edit.
export function TaskCommentsTab({ taskId, canEdit, userId }: TaskCommentsTabProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newComment, setNewComment] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const commentsQuery = useQuery({ queryKey: ["task-comments", taskId], queryFn: () => fetchComments(taskId) });
  const attachmentsQuery = useQuery({ queryKey: ["task-attachments", taskId], queryFn: () => fetchAttachments(taskId) });

  const refreshComments = () => queryClient.invalidateQueries({ queryKey: ["task-comments", taskId] });
  const refreshAttachments = () => queryClient.invalidateQueries({ queryKey: ["task-attachments", taskId] });

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    await addComment(taskId, userId, newComment.trim());
    setNewComment("");
    refreshComments();
  };

  const startEdit = (id: string, body: string) => {
    setEditingId(id);
    setEditingBody(body);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    await updateComment(editingId, editingBody);
    setEditingId(null);
    refreshComments();
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      await uploadAttachment(taskId, userId, file);
      refreshAttachments();
    } catch (e: any) {
      setError(e.message ?? "שגיאה בהעלאת הקובץ");
    } finally {
      setUploading(false);
    }
  };

  const openAttachment = async (filePath: string) => {
    const url = await getAttachmentUrl(filePath);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  if (commentsQuery.isLoading || attachmentsQuery.isLoading) return <LoadingState rows={3} />;

  const comments = commentsQuery.data ?? [];
  const attachments = attachmentsQuery.data ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">הערות</h3>
        <div className="space-y-2">
          {comments.length === 0 && <EmptyState title="אין הערות עדיין" />}
          {comments.map((c) => (
            <div key={c.id} className="rounded-lg border border-slate-100 p-2.5">
              {editingId === c.id ? (
                <div className="space-y-2">
                  <textarea value={editingBody} onChange={(e) => setEditingBody(e.target.value)} rows={2} className="input-field" />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setEditingId(null)} className="text-xs text-slate-500 underline">
                      ביטול
                    </button>
                    <button onClick={saveEdit} className="link-action text-xs">
                      שמירה
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{c.body}</p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                    <span>{new Date(c.created_at).toLocaleString("he-IL")}</span>
                    {c.updated_at && <span>· נערך</span>}
                    {(c.author_id === userId || canEdit) && (
                      <button onClick={() => startEdit(c.id, c.body)} className="link-action">
                        עריכה
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <input
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddComment()}
              placeholder="הערה חדשה…"
              className="input-field"
            />
            <button onClick={handleAddComment} className="btn-secondary text-sm">
              הוספה
            </button>
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">קבצים מצורפים</h3>
        {error && <ErrorState message={error} />}
        <div className="space-y-1.5">
          {attachments.length === 0 && <EmptyState title="אין קבצים מצורפים" icon={Paperclip} />}
          {attachments.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 p-2 text-sm">
              <button onClick={() => openAttachment(a.file_path)} className="link-action truncate text-right">
                {a.original_filename}
              </button>
              {(a.uploaded_by === userId || canEdit) && (
                <button
                  onClick={async () => {
                    await deleteAttachment(a.id, a.file_path);
                    refreshAttachments();
                  }}
                  className="shrink-0 text-xs text-red-600 underline hover:text-red-800"
                >
                  מחיקה
                </button>
              )}
            </div>
          ))}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
        />
        <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="btn-secondary mt-2 text-sm">
          {uploading ? "מעלה…" : "צירוף קובץ"}
        </button>
      </div>
    </div>
  );
}
