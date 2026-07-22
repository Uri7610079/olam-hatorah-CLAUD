import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { ErrorState } from "@/components/ErrorState";
import { AuthLayout } from "./AuthLayout";

interface SignUpFormProps {
  onBackToLogin: () => void;
}

// ההרשמה יוצרת auth.users + profiles(status=pending) + access_requests בטריגר בצד השרת
// (migration 002) - אין כאן שום נתיב שמעניק גישה מיידית לאפליקציה.
export function SignUpForm({ onBackToLogin }: SignUpFormProps) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, request_message: message || null } },
    });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDone(true);
  };

  if (done) {
    return (
      <AuthLayout title="הבקשה נשלחה">
        <p className="text-sm text-slate-600">
          הבקשה שלך נקלטה. אם נדרש אימות מייל תקבלי קישור לתיבת הדואר — לאחר מכן החשבון ימתין
          לאישור מנהל מערכת, ורק אז יהיה אפשר להיכנס.
        </p>
        <button onClick={onBackToLogin} className="mt-4 text-sm text-blue-600 underline hover:text-blue-800">
          חזרה למסך כניסה
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="בקשת גישה למערכת" description="הבקשה תישלח לאישור מנהל מערכת.">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="signup-name" className="mb-1 block text-sm font-medium text-slate-700">
            שם מלא
          </label>
          <input
            id="signup-name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500"
          />
        </div>
        <div>
          <label htmlFor="signup-email" className="mb-1 block text-sm font-medium text-slate-700">
            אימייל
          </label>
          <input
            id="signup-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500"
          />
        </div>
        <div>
          <label htmlFor="signup-password" className="mb-1 block text-sm font-medium text-slate-700">
            סיסמה
          </label>
          <input
            id="signup-password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500"
          />
        </div>
        <div>
          <label htmlFor="signup-message" className="mb-1 block text-sm font-medium text-slate-700">
            הערה (לא חובה)
          </label>
          <textarea
            id="signup-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500"
          />
        </div>
        {error && <ErrorState message={error} />}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "שולחת…" : "שליחת בקשה"}
        </button>
      </form>
      <button onClick={onBackToLogin} className="mt-4 text-xs text-blue-600 underline hover:text-blue-800">
        כבר יש לי חשבון — כניסה
      </button>
    </AuthLayout>
  );
}
