import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { useHasPermission } from "@/lib/permissions";
import { useLastSelected } from "@/lib/useLastSelected";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/LoadingState";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Tabs, type TabDef } from "@/components/Tabs";
import {
  convertWhatsAppMessageToTask,
  fetchAssignableUsers,
  fetchWhatsAppGroups,
  fetchWhatsAppMessages,
  markWhatsAppMessageNotATask,
} from "./api";
import type { WhatsAppMessage, WhatsAppMessageStatus } from "./types";

// הגנת עומק בצד לקוח - הקישור כבר מסונן ב-DB (ingest_whatsapp_message, רק http/https),
// אבל React לא מנקה href בעצמו, אז נבדק שוב לפני רינדור כ-<a> אמיתי (סעיף 2 בביקורת האבטחה).
function isSafeHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

type StatusTab = WhatsAppMessageStatus;

const TABS: TabDef<StatusTab>[] = [
  { key: "pending", label: "ממתינות לסיווג" },
  { key: "converted", label: "הומרו למשימה" },
  { key: "not_a_task", label: "סומנו כלא משימה" },
];

interface ConvertFormProps {
  message: WhatsAppMessage;
  onDone: () => void;
}

function ConvertForm({ message, onDone }: ConvertFormProps) {
  const [title, setTitle] = useState(message.body?.slice(0, 80) ?? "");
  const [description, setDescription] = useState(message.body ?? "");
  const [dueDate, setDueDate] = useState("");
  // ברירת מחדל = הבחירה האחרונה (נשמר ב-DB דרך useLastSelected), לא ריק - שינוי הבחירה
  // כאן מעדכן את ה-hook, כדי שההמרה הבאה תזכור אותה.
  const [ownerIds, setOwnerIds] = useLastSelected<string[]>("last-task-owners", []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usersQuery = useQuery({ queryKey: ["assignable-users"], queryFn: fetchAssignableUsers });

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError("יש להזין כותרת.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await convertWhatsAppMessageToTask({
        messageId: message.id,
        title: title.trim(),
        description: description.trim() || null,
        dueDate: dueDate || null,
        ownerIds,
        teamIds: [],
      });
      onDone();
    } catch (e: any) {
      setError(e.message ?? "שגיאה בהמרה למשימה");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="כותרת המשימה" className="input-field" />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="input-field" />
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input-field w-auto" />
        <select
          multiple
          value={ownerIds}
          onChange={(e) => setOwnerIds(Array.from(e.target.selectedOptions).map((o) => o.value))}
          className="input-field h-20 w-auto"
        >
          {(usersQuery.data ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.full_name}
            </option>
          ))}
        </select>
      </div>
      {error && <ErrorState message={error} />}
      <button onClick={handleSubmit} disabled={submitting} className="btn-primary text-sm">
        {submitting ? "ממירה…" : "יצירת משימה"}
      </button>
    </div>
  );
}

export function TasksWhatsAppScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canConvert, isLoading: canConvertLoading } = useHasPermission("tasks", "convert_whatsapp");
  const { hasPermission: canManageWhatsApp, isLoading: canManageLoading } = useHasPermission("tasks", "manage_whatsapp");
  const canView = canConvert || canManageWhatsApp;
  const [activeTab, setActiveTab] = useState<StatusTab>("pending");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const messagesQuery = useQuery({ queryKey: ["whatsapp-messages"], queryFn: fetchWhatsAppMessages, enabled: canView });
  const groupsQuery = useQuery({ queryKey: ["whatsapp-groups"], queryFn: fetchWhatsAppGroups, enabled: canView });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["whatsapp-messages"] });

  const groupLabel = (groupId: string) => groupsQuery.data?.find((g) => g.id === groupId)?.label ?? "—";

  const filtered = (messagesQuery.data ?? []).filter((m) => m.status === activeTab);

  if (canConvertLoading || canManageLoading) return <LoadingState rows={4} />;

  if (!canView) {
    return (
      <div>
        <PageHeader title="תיבת WhatsApp" />
        <ErrorState message="אין לך הרשאה לצפות במסך זה." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="תיבת WhatsApp"
        description="הודעות שנקלטו מקבוצות מאושרות. סנכרון הוא רק מ-WhatsApp אל המערכת - שינוי סטטוס לא נשלח חזרה לקבוצה."
      />

      <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} ariaLabel="סינון לפי סטטוס" />

      {messagesQuery.isLoading ? (
        <LoadingState rows={4} />
      ) : filtered.length === 0 ? (
        <EmptyState title="אין הודעות בקטגוריה הזו" icon={MessageSquare} />
      ) : (
        <div className="space-y-2">
          {filtered.map((m) => (
            <div key={m.id} className="card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-slate-400">
                    {groupLabel(m.group_id)} · {m.sender_name ?? "לא ידוע"} · {new Date(m.received_at).toLocaleString("he-IL")}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{m.body ?? "(ללא טקסט)"}</p>
                  {m.attachment_url && isSafeHttpUrl(m.attachment_url) && (
                    <a href={m.attachment_url} target="_blank" rel="noopener noreferrer" className="link-action mt-1 inline-block text-xs">
                      קובץ מצורף
                    </a>
                  )}
                </div>
                {activeTab === "pending" && canConvert && (
                  <div className="flex shrink-0 gap-2 text-xs">
                    <button onClick={() => setExpandedId((id) => (id === m.id ? null : m.id))} className="link-action">
                      הפוך למשימה
                    </button>
                    <button
                      onClick={async () => {
                        await markWhatsAppMessageNotATask(m.id);
                        refresh();
                      }}
                      className="text-slate-500 underline hover:text-slate-700"
                    >
                      לא משימה
                    </button>
                  </div>
                )}
              </div>
              {expandedId === m.id && (
                <ConvertForm
                  message={m}
                  onDone={() => {
                    setExpandedId(null);
                    refresh();
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
