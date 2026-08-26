import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info, UserPlus, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { LoadingState } from "@/components/LoadingState";

// הוספת משתמש עם הרשאות ישירות ממסך הניהול.
//
// מה שאי אפשר, ולמה: יצירת משתמש ב-Supabase Auth מחייבת מפתח service_role,
// שעוקף את כל ה-RLS. מפתח כזה בדפדפן פירושו שכל אדם שפותח את כלי הפיתוח
// מקבל גישה מלאה לכל הנתונים. גם קביעת סיסמה עבור אדם אחר אינה נכונה -
// סיסמה ששניים מכירים אינה סיסמה.
//
// מה שכן: המנהל קובע כאן אימייל, תפקיד ואזור. כשאותו אדם נרשם בעצמו הוא
// נכנס כשהוא כבר מאושר ועם התפקיד שהוקצה - בלי לעבור ב"ממתין" ובלי
// שהמנהל יחזור לאשר. מבחינת המנהל זו אותה חוויה; ההבדל היחיד הוא שהאדם
// בוחר את סיסמתו.

interface RoleOption {
  key: string;
  label_he: string;
}

interface Invitation {
  id: string;
  email: string;
  default_area: string | null;
  note: string | null;
  created_at: string;
  role: { label_he: string } | null;
}

const AREA_LABEL: Record<string, string> = {
  ops: "תפעול שוטף",
  finance: "כספים ובקרה",
  admin: "ניהול",
};

async function fetchInvitations(): Promise<Invitation[]> {
  const { data, error } = await supabase
    .from("user_invitations")
    .select("id, email, default_area, note, created_at, role:roles(label_he)")
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, role: Array.isArray(r.role) ? r.role[0] ?? null : r.role }));
}

export function InviteUserPanel({ roles }: { roles: RoleOption[] }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState("");
  const [area, setArea] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const invitationsQuery = useQuery({ queryKey: ["user-invitations"], queryFn: fetchInvitations });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["user-invitations"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-profiles"] });
  };

  const invite = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    const { error: rpcError } = await supabase.rpc("admin_invite_user", {
      p_email: email,
      p_role_key: roleKey,
      p_default_area: area || null,
      p_note: note || null,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setDone(`ההזמנה נוצרה. ${email.trim()} ייכנס עם התפקיד שנקבע ברגע שיירשם למערכת.`);
    setEmail("");
    setRoleKey("");
    setArea("");
    setNote("");
    refresh();
  };

  const revoke = async (id: string) => {
    setError(null);
    const { error: rpcError } = await supabase.rpc("admin_revoke_invitation", { p_id: id });
    if (rpcError) setError(rpcError.message);
    refresh();
  };

  const pending = invitationsQuery.data ?? [];

  return (
    <div className="mb-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary flex items-center gap-2" onClick={() => setOpen((v) => !v)}>
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          משתמש חדש
        </button>
        {pending.length > 0 && (
          <span className="text-sm text-ink-muted">
            {pending.length} הזמנות ממתינות להרשמה
          </span>
        )}
      </div>

      {open && (
        <div className="card mb-3 p-4">
          {/* ההסבר הזה אינו קישוט: בלעדיו המנהל ימלא את הטופס, יחפש את
              המשתמש ברשימה, לא ימצא אותו, ויחשוב שמשהו נשבר. */}
          <div className="mb-3 flex items-start gap-2 rounded-control border border-line bg-surface-muted p-3 text-xs text-ink-muted">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" aria-hidden="true" />
            <span>
              התפקיד וההרשאות נקבעים כאן ומראש. המשתמש עצמו נרשם למערכת עם האימייל הזה ובוחר סיסמה —
              וברגע שיירשם הוא ייכנס כבר מאושר, בלי צורך באישור נוסף.{" "}
              <span className="text-ink-subtle">
                המערכת אינה קובעת סיסמה עבור אדם אחר, וזה מכוון: סיסמה ששניים מכירים אינה סיסמה.
              </span>
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="field-label" htmlFor="invite-email">אימייל</label>
              <input
                id="invite-email"
                type="email"
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field text-right"
                placeholder="name@example.com"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="invite-role">תפקיד</label>
              <select id="invite-role" value={roleKey} onChange={(e) => setRoleKey(e.target.value)} className="input-field">
                <option value="">— יש לבחור —</option>
                {roles.map((r) => (
                  <option key={r.key} value={r.key}>{r.label_he}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="invite-area">אזור ברירת מחדל</label>
              <select id="invite-area" value={area} onChange={(e) => setArea(e.target.value)} className="input-field">
                <option value="">— ללא —</option>
                {Object.entries(AREA_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-3">
            <label className="field-label" htmlFor="invite-note">הערה (לא חובה)</label>
            <input id="invite-note" value={note} onChange={(e) => setNote(e.target.value)} className="input-field" />
          </div>

          {error && (
            <div className="mt-3 flex items-start gap-2 text-sm text-danger">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !email.trim() || !roleKey}
              onClick={() => void invite()}
            >
              {busy ? "יוצר…" : "יצירת הזמנה"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              סגירה
            </button>
          </div>
        </div>
      )}

      {done && (
        <div className="mb-3 flex items-start gap-2 rounded-control border border-ok/30 bg-ok-soft p-3 text-sm text-ok-ink">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{done}</span>
        </div>
      )}

      {invitationsQuery.isLoading ? (
        <LoadingState rows={2} />
      ) : (
        pending.length > 0 && (
          <div className="card p-4">
            <p className="mb-2 text-sm font-medium text-ink">הזמנות שממתינות להרשמה</p>
            <ul className="space-y-1 text-sm">
              {pending.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center gap-2">
                  <span className="ltr-num text-ink">{inv.email}</span>
                  <span className="text-ink-muted">
                    · {inv.role?.label_he ?? "—"}
                    {inv.default_area ? ` · ${AREA_LABEL[inv.default_area] ?? inv.default_area}` : ""}
                    {inv.note ? ` · ${inv.note}` : ""}
                  </span>
                  <button
                    type="button"
                    className="link-action flex items-center gap-1 text-xs text-danger"
                    onClick={() => void revoke(inv.id)}
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                    ביטול
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      )}
    </div>
  );
}
