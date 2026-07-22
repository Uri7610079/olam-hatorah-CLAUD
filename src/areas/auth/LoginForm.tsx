import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { ErrorState } from "@/components/ErrorState";
import { AuthLayout } from "./AuthLayout";

interface LoginFormProps {
  onSignUp: () => void;
  onForgot: () => void;
}

export function LoginForm({ onSignUp, onForgot }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    // הודעה מכוונת ולא ספציפית: לא לחשוף אם הבעיה היא אימייל לא קיים, סיסמה שגויה, או חשבון pending/disabled.
    if (error) setError("אימייל או סיסמה שגויים, או שהחשבון עדיין לא אושר להתחברות.");
  };

  return (
    <AuthLayout title="כניסה למערכת">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="login-email" className="field-label">
            אימייל
          </label>
          <input
            id="login-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input-field"
          />
        </div>
        <div>
          <label htmlFor="login-password" className="field-label">
            סיסמה
          </label>
          <input
            id="login-password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-field"
          />
        </div>
        {error && <ErrorState message={error} />}
        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? "מתחברת…" : "כניסה"}
        </button>
      </form>
      <div className="mt-5 flex justify-between text-xs">
        <button onClick={onForgot} className="link-action">
          שכחתי סיסמה
        </button>
        <button onClick={onSignUp} className="link-action">
          בקשת גישה למערכת
        </button>
      </div>
    </AuthLayout>
  );
}
