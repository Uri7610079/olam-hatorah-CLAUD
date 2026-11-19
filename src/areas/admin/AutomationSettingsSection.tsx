import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useIsV3 } from "@/lib/uiTheme";
import { formatDateTime } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";

interface Setting {
  key: string;
  label_he: string;
  is_enabled: boolean;
}

interface Run {
  id: string;
  kind: string;
  status: "done" | "skipped" | "failed";
  detail: string | null;
  month: string | null;
  created_at: string;
  organization: { legal_name: string } | { legal_name: string }[] | null;
}

const KIND_LABEL: Record<string, string> = {
  auto_commission: "חישוב עמלות",
  bank_auto_approve: "אישור סיווג והתאמות בנק",
  talmud_bank_match: "תשלומי משרד החינוך מול הבנק",
};

// האוטומציות (שלב 42): כל אחת ניתנת לכיבוי, וכל הפעלה נרשמת. כדי שמה שקורה
// לבד יהיה גלוי - ולא קופסה שחורה שאף אחד לא יודע מה היא עשתה.
export function AutomationSettingsSection() {
  const qc = useQueryClient();
  const isV3 = useIsV3();
  const [toggleError, setToggleError] = useState<string | null>(null);
  const settings = useQuery({
    queryKey: ["automation-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("automation_settings").select("key, label_he, is_enabled").order("key");
      if (error) throw error;
      return (data ?? []) as Setting[];
    },
  });
  const runs = useQuery({
    queryKey: ["automation-runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automation_runs")
        .select("id, kind, status, detail, month, created_at, organization:organizations(legal_name)")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as Run[];
    },
  });

  const toggle = async (s: Setting) => {
    const { error } = await supabase.rpc("set_automation_setting", { p_key: s.key, p_enabled: !s.is_enabled });
    // הודעה בתוך המסך במקום חלון קופץ של הדפדפן
    setToggleError(error ? `השינוי לא נשמר (${error.message}).` : null);
    qc.invalidateQueries({ queryKey: ["automation-settings"] });
  };

  return (
    <section className="card mt-6 max-w-4xl space-y-4 p-5">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink v3:text-primary">
          <Bot className="h-4 w-4" aria-hidden="true" />
          פעולות אוטומטיות
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          מה שמגיע מתלמוד ומהבנק ועובר את כל הבדיקות - מעובד לבד. כל פעולה כאן אפשר לכבות, וכל הפעלה נרשמת ביומן למטה.
          שידור מס"ב לבנק לעולם אינו אוטומטי.
        </p>
      </div>

      {settings.error && <p className="text-sm text-danger-ink">לא ניתן לטעון את ההגדרות כרגע. אם זה חוזר - יש לפנות לתמיכה הטכנית.</p>}
      {toggleError && <p role="alert" className="text-sm text-danger-ink">{toggleError}</p>}
      <div className="divide-y divide-line">
        {(settings.data ?? []).map((s) => (
          <label key={s.key} className="flex items-center justify-between gap-3 py-2.5">
            <span className="text-sm text-ink">{s.label_he}</span>
            <input type="checkbox" checked={s.is_enabled} onChange={() => void toggle(s)} className="h-4 w-4" />
          </label>
        ))}
      </div>

      {(runs.data ?? []).length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold text-ink-muted">יומן אחרון</h3>
          <ul className="space-y-1 text-xs">
            {(runs.data ?? []).map((r) => {
              const org = Array.isArray(r.organization) ? r.organization[0] : r.organization;
              return (
                <li key={r.id} className="flex flex-wrap items-start gap-2">
                  <span className="ltr-num text-ink-subtle">
                    {isV3 ? formatDateTime(r.created_at) : new Date(r.created_at).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                  <StatusBadge severity={r.status === "done" ? "ok" : r.status === "failed" ? "critical" : "neutral"} label={r.status === "done" ? "בוצע" : r.status === "failed" ? "נכשל" : "דולג"} />
                  <span className="font-medium">{KIND_LABEL[r.kind] ?? r.kind}</span>
                  {org && <span className="text-ink-muted">· {org.legal_name}</span>}
                  {(!isV3 || r.detail) && <span className="text-ink-muted">· {r.detail}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
