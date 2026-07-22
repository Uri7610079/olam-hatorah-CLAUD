import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { ErrorState } from "@/components/ErrorState";
import { AuthLayout } from "./AuthLayout";

interface ForgotPasswordFormProps {
  onBackToLogin: () => void;
}

export function ForgotPasswordForm({ onBackToLogin }: ForgotPasswordFormProps) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDone(true);
  };

  if (done) {
    return (
      <AuthLayout title="נשלח מייל לאיפוס סיסמה">
        <p className="text-sm text-slate-600">אם הכתובת קיימת במערכת, נשלח אליה קישור לאיפוס סיסמה.</p>
        <button onClick={onBackToLogin} className="mt-4 text-sm text-blue-600 underline hover:text-blue-800">
          חזרה למסך כניסה
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="שכחתי סיסמה">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="forgot-email" className="mb-1 block text-sm font-medium text-slate-700">
            אימייל
          </label>
          <input
            id="forgot-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500"
          />
        </div>
        {error && <ErrorState message={error} />}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "שולחת…" : "שליחת קישור איפוס"}
        </button>
      </form>
      <button onClick={onBackToLogin} className="mt-4 text-xs text-blue-600 underline hover:text-blue-800">
        חזרה למסך כניסה
      </button>
    </AuthLayout>
  );
}
