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
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="login-email" className="mb-1 block text-sm font-medium text-slate-700">
            אימייל
          </label>
          <input
            id="login-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500"
          />
        </div>
        <div>
          <label htmlFor="login-password" className="mb-1 block text-sm font-medium text-slate-700">
            סיסמה
          </label>
          <input
            id="login-password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500"
          />
        </div>
        {error && <ErrorState message={error} />}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "מתחברת…" : "כניסה"}
        </button>
      </form>
      <div className="mt-4 flex justify-between text-xs">
        <button onClick={onForgot} className="text-blue-600 underline hover:text-blue-800">
          שכחתי סיסמה
        </button>
        <button onClick={onSignUp} className="text-blue-600 underline hover:text-blue-800">
          בקשת גישה למערכת
        </button>
      </div>
    </AuthLayout>
  );
}
