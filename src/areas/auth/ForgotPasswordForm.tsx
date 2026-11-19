import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { useIsV3 } from "@/lib/uiTheme";
import { ErrorState } from "@/components/ErrorState";
import { AuthLayout } from "./AuthLayout";
import { hebrewAuthError } from "./authErrors";

interface ForgotPasswordFormProps {
  onBackToLogin: () => void;
}

export function ForgotPasswordForm({ onBackToLogin }: ForgotPasswordFormProps) {
  const isV3 = useIsV3();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    // הקישור במייל חוזר לאותו אתר שממנו ביקשו (גם בסביבת פיתוח).
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    setSubmitting(false);
    if (error) {
      setError(hebrewAuthError(error.message, "שליחת הקישור נכשלה"));
      return;
    }
    setDone(true);
  };

  if (done) {
    return (
      <AuthLayout title="נשלח מייל לאיפוס סיסמה">
        <p className="text-sm text-ink-muted">אם הכתובת קיימת במערכת, נשלח אליה קישור לאיפוס סיסמה.</p>
        <button onClick={onBackToLogin} className="link-action mt-4 text-sm">
          חזרה למסך כניסה
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="שכחתי סיסמה">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="forgot-email" className="field-label">
            אימייל
          </label>
          <input
            id="forgot-email"
            type="email"
            dir="ltr"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input-field text-right"
          />
        </div>
        {error && <ErrorState message={error} />}
        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? (isV3 ? "בשליחה…" : "שולחת…") : "שליחת קישור איפוס"}
        </button>
      </form>
      <button onClick={onBackToLogin} className="link-action mt-4 text-xs">
        חזרה למסך כניסה
      </button>
    </AuthLayout>
  );
}
