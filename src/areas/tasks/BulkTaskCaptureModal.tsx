import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import { useLastSelected } from "@/lib/useLastSelected";
import { ErrorState } from "@/components/ErrorState";
import { createTask, fetchAssignableUsers, fetchCategories, fetchTeams } from "./api";
import { guessDueDateFromText, splitFreeTextIntoTasks } from "./dateUtils";
import type { TaskCategory } from "./types";

interface DraftTask {
  id: number;
  title: string;
  categoryId: string;
  dueDate: string;
  included: boolean;
}

interface AiParsedTask {
  title?: string;
  category?: string;
  suggested_date?: string;
}

// התאמה חופשית של הקטגוריה שה-AI הציע (טקסט חופשי) לקטגוריה קיימת במערכת - לא יוצרים
// קטגוריה חדשה מאחורי הקלעים בלי שאדמין הגדיר אותה; אם אין התאמה, פשוט נשאר "כללי".
function matchCategoryId(suggested: string | undefined, categories: TaskCategory[]): string {
  const needle = (suggested ?? "").trim();
  // needle ריק (או קצר מדי, למשל רווח בלבד) היה גורם ל-includes("") להיות true על כל
  // קטגוריה - כל משימה הייתה משויכת בטעות לקטגוריה הראשונה ברשימה. נתפס בביקורת ייעודית.
  if (needle.length < 2) return "";
  const found = categories.find((c) => c.label_he.includes(needle) || needle.includes(c.label_he));
  return found?.id ?? "";
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface BulkTaskCaptureModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

// "פירוק לטקסט" - לפי בקשת Chani, בלי תמלול קולי ובלי קריאה ל-AI חיצוני (שניהם דורשים
// חשבון/API key שאין עדיין). הפיצול הוא היוריסטי בלבד (splitFreeTextIntoTasks) - לכן
// יש תמיד מסך אישור עם עריכה לפני יצירה בפועל, לא שמירה אוטומטית של הניחוש.
export function BulkTaskCaptureModal({ open, onClose, onCreated }: BulkTaskCaptureModalProps) {
  useEscapeToClose(open, onClose);
  const { session } = useAuth();
  const userId = session?.user.id ?? "";

  const [rawText, setRawText] = useState("");
  const [drafts, setDrafts] = useState<DraftTask[]>([]);
  // ברירת מחדל = הבחירה האחרונה (נשמר ב-DB דרך useLastSelected), לא ריק - שינוי הבחירה
  // כאן מעדכן את ה-hook, כדי שהיצירה המרובה הבאה תזכור אותה.
  const [selectedOwners, setSelectedOwners] = useLastSelected<string[]>("last-task-owners", []);
  const [selectedTeams, setSelectedTeams] = useLastSelected<string[]>("last-task-teams", []);
  const [submitting, setSubmitting] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const categoriesQuery = useQuery({ queryKey: ["task-categories"], queryFn: fetchCategories, enabled: open });
  const usersQuery = useQuery({ queryKey: ["assignable-users"], queryFn: fetchAssignableUsers, enabled: open });
  const teamsQuery = useQuery({ queryKey: ["teams"], queryFn: fetchTeams, enabled: open });

  if (!open) return null;

  const reset = () => {
    setRawText("");
    setDrafts([]);
    // אחראים/צוותים לא מתאפסים כאן בכוונה - הם נשמרים דרך useLastSelected (הבחירה
    // האחרונה), כדי שהיצירה המרובה הבאה תתחיל מאותה בחירה במקום מרשימה ריקה.
    setAiNote(null);
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  // פיצול פשוט, תמיד זמין (בלי תלות בהגדרת מפתח AI) - שורות/פסיקים/"ו" בסוף רשימה.
  const handleSimpleSplit = () => {
    const fragments = splitFreeTextIntoTasks(rawText);
    setDrafts(
      fragments.map((title, i) => ({
        id: i,
        title,
        categoryId: "",
        dueDate: guessDueDateFromText(title) ?? "",
        included: true,
      })),
    );
  };

  // פיצול חכם (AI) - קורא ל-Vercel Function שמפעילה OpenAI בצד שרת. אם המפתח עוד לא
  // הוגדר ב-Vercel (או שרצים מקומית בלי endpoint פעיל), נופל אוטומטית לפיצול הפשוט -
  // הפיצ'ר תמיד עובד, רק "חכם" יותר כשה-AI מוגדר.
  const handleAiSplit = async () => {
    setParsing(true);
    setAiNote(null);
    setError(null);
    try {
      const response = await fetch("/api/parse-tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ text: rawText }),
      });
      if (!response.ok) throw new Error("unavailable");
      const data = await response.json();
      const aiTasks: AiParsedTask[] = Array.isArray(data.tasks) ? data.tasks : [];
      if (aiTasks.length === 0) throw new Error("empty");

      setDrafts(
        aiTasks.map((t, i) => ({
          id: i,
          title: (t.title ?? "").trim() || "משימה",
          categoryId: matchCategoryId(t.category, categoriesQuery.data ?? []),
          dueDate: t.suggested_date && ISO_DATE_RE.test(t.suggested_date) ? t.suggested_date : "",
          included: true,
        })),
      );
    } catch {
      setAiNote("פיצול חכם (AI) לא זמין כרגע (ייתכן שמפתח ה-API עוד לא הוגדר) - השתמשתי בפיצול הפשוט במקום.");
      handleSimpleSplit();
    } finally {
      setParsing(false);
    }
  };

  const updateDraft = (id: number, patch: Partial<DraftTask>) => {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  // אם המשימה ה-3 מתוך 5 נכשלת, 1-2 כבר נוצרו בפועל - חייבים להסיר אותן מהרשימה
  // (ולרענן את מסך האב) גם כשיש כשלון, אחרת "אישור" חוזר היה יוצר אותן שוב בכפילות,
  // וההודעה הייתה משתמעת כאילו שום דבר לא נוצר. נתפס בביקורת ייעודית לפני commit.
  const handleConfirm = async () => {
    const toCreate = drafts.filter((d) => d.included && d.title.trim());
    if (toCreate.length === 0) {
      setError("אין משימות לאישור.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const succeededIds = new Set<number>();
    let failure: string | null = null;
    for (const d of toCreate) {
      try {
        await createTask({
          title: d.title.trim(),
          description: null,
          priority: "normal",
          category_id: d.categoryId || null,
          due_date: d.dueDate || null,
          created_by: userId,
          owner_ids: selectedOwners,
          team_ids: selectedTeams,
        });
        succeededIds.add(d.id);
      } catch (e: any) {
        failure = e.message ?? "שגיאה ביצירת המשימות";
        break;
      }
    }
    setSubmitting(false);
    if (succeededIds.size > 0) onCreated();
    if (failure) {
      setDrafts((prev) => prev.filter((d) => !succeededIds.has(d.id)));
      setError(`נוצרו ${succeededIds.size} מתוך ${toCreate.length} משימות. ${failure}`);
      return;
    }
    close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4">
      <div role="dialog" aria-modal="true" aria-labelledby="bulk-capture-title" className="card max-h-[85vh] w-full max-w-xl overflow-y-auto p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="bulk-capture-title" className="text-base font-semibold text-ink">
            יצירה מרובה מטקסט חופשי
          </h2>
          <button onClick={close} aria-label="סגירה" title="סגירת החלון" className="rounded-control p-1.5 text-ink-subtle hover:bg-surface-muted">
            ✕
          </button>
        </div>

        {drafts.length === 0 ? (
          <div className="space-y-3">
            <p className="text-xs text-ink-subtle">
              כתבו או הדביקו טקסט חופשי - כל שורה (או משפט מופרד בפסיק) תהפוך להצעת משימה נפרדת. תהיה הזדמנות לערוך ולאשר לפני היצירה בפועל.
            </p>
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              rows={5}
              placeholder="לדוגמה: צריך להזמין חומרים, לחזור ללקוח, ולשלוח הצעת מחיר עד יום חמישי"
              className="input-field"
              autoFocus
            />
            <div className="flex flex-wrap justify-end gap-2">
              <button onClick={close} className="btn-secondary text-sm">
                ביטול
              </button>
              <button onClick={handleSimpleSplit} disabled={!rawText.trim()} className="btn-secondary text-sm">
                פירוק פשוט
              </button>
              <button
                onClick={handleAiSplit}
                disabled={!rawText.trim() || parsing}
                className="btn-primary flex items-center gap-1.5 text-sm"
                title="שימוש ב-AI לזיהוי חכם יותר של משימות, קטגוריה ותאריך - דורש שמפתח OpenAI יוגדר ב-Vercel"
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                {parsing ? "מפצלת…" : "פירוק חכם (AI)"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-ink-subtle">
              הפיצול הוא הצעה ראשונית בלבד - אפשר לערוך, למחוק שורה, או לבטל סימון של הצעה שלא רלוונטית.
            </p>
            {aiNote && <p className="rounded-control bg-warn-soft p-2 text-xs text-warn-ink">{aiNote}</p>}
            <div className="space-y-2">
              {drafts.map((d) => (
                <div key={d.id} className={`rounded-control border p-2.5 ${d.included ? "border-line" : "border-line opacity-50"}`}>
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={d.included}
                      onChange={(e) => updateDraft(d.id, { included: e.target.checked })}
                      className="mt-2"
                      aria-label="לכלול משימה זו"
                    />
                    <div className="flex-1 space-y-1.5">
                      <input
                        value={d.title}
                        onChange={(e) => updateDraft(d.id, { title: e.target.value })}
                        disabled={!d.included}
                        className="input-field"
                      />
                      <div className="flex gap-2">
                        <select
                          value={d.categoryId}
                          onChange={(e) => updateDraft(d.id, { categoryId: e.target.value })}
                          disabled={!d.included}
                          className="input-field w-auto text-xs"
                        >
                          <option value="">קטגוריה: כללי</option>
                          {(categoriesQuery.data ?? []).map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.label_he}
                            </option>
                          ))}
                        </select>
                        <input
                          type="date"
                          value={d.dueDate}
                          onChange={(e) => updateDraft(d.id, { dueDate: e.target.value })}
                          disabled={!d.included}
                          className="input-field w-auto text-xs"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 border-t border-line pt-3">
              <div>
                <label className="field-label">אחראים (לכל המשימות)</label>
                <div className="max-h-24 space-y-1 overflow-y-auto rounded-control border border-line p-2">
                  {(usersQuery.data ?? []).map((u) => (
                    <label key={u.id} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={selectedOwners.includes(u.id)}
                        onChange={(e) =>
                          setSelectedOwners(e.target.checked ? [...selectedOwners, u.id] : selectedOwners.filter((id) => id !== u.id))
                        }
                      />
                      {u.full_name}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="field-label">צוותים (לכל המשימות)</label>
                <div className="max-h-24 space-y-1 overflow-y-auto rounded-control border border-line p-2">
                  {(teamsQuery.data ?? []).map((t) => (
                    <label key={t.id} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={selectedTeams.includes(t.id)}
                        onChange={(e) =>
                          setSelectedTeams(e.target.checked ? [...selectedTeams, t.id] : selectedTeams.filter((id) => id !== t.id))
                        }
                      />
                      {t.label_he}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {error && <ErrorState message={error} />}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => {
                  setDrafts([]);
                  setAiNote(null);
                }}
                className="btn-secondary text-sm"
              >
                חזרה לעריכת הטקסט
              </button>
              <button onClick={handleConfirm} disabled={submitting} className="btn-primary text-sm">
                {submitting ? "יוצרת…" : `אישור ויצירת ${drafts.filter((d) => d.included).length} משימות`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
