import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { ErrorState } from "@/components/ErrorState";
import { AuthLayout } from "./AuthLayout";

// מסך "סיסמה חדשה": מופיע אחרי לחיצה על הקישור שנשלח ב"שכחתי סיסמה".
// הקישור כבר פתח session זמני, ולכן כאן רק קובעים את הסיסמה (updateUser).
function hebrewError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("different from the old")) return "הסיסמה החדשה חייבת להיות שונה מהסיסמה הקודמת.";
  if (m.includes("at least")) return "הסיסמה קצרה מדי. צריך לפחות 8 תווים.";
  if (m.includes("weak")) return "הסיסמה חלשה מדי. כדאי לשלב אותיות, מספרים וסימנים.";
  if (m.includes("session") || m.includes("expired") || m.includes("jwt")) return "הקישור פג תוקף. צריך לבקש קישור חדש ב\"שכחתי סיסמה\".";
  return `שמירת הסיסמה נכשלה (${message}).`;
}

export function SetNewPasswordForm({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("הסיסמה קצרה מדי. צריך לפחות 8 תווים.");
    if (password !== confirm) return setError("שתי הסיסמאות אינן זהות.");
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (error) return setError(hebrewError(error.message));
    setDone(true);
  };

  if (done) {
    return (
      <AuthLayout title="הסיסמה עודכנה">
        <p className="text-sm text-ink-muted">מעכשיו נכנסים עם הסיסמה החדשה.</p>
        <button onClick={onDone} className="btn-primary mt-4 w-full">
          כניסה למערכת
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="קביעת סיסמה חדשה" description="לפחות 8 תווים.">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="new-password" className="field-label">
            סיסמה חדשה
          </label>
          <input
            id="new-password"
            type="password"
            dir="ltr"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-field text-right"
          />
        </div>
        <div>
          <label htmlFor="new-password-confirm" className="field-label">
            הסיסמה שוב, לאימות
          </label>
          <input
            id="new-password-confirm"
            type="password"
            dir="ltr"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="input-field text-right"
          />
        </div>
        {error && <ErrorState message={error} />}
        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? "שומר…" : "שמירת הסיסמה"}
        </button>
      </form>
    </AuthLayout>
  );
}
