import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { useIsV3 } from "@/lib/uiTheme";
import { ErrorState } from "@/components/ErrorState";
import { AuthLayout } from "./AuthLayout";
import { PasswordInput } from "./PasswordInput";
import { hebrewAuthError } from "./authErrors";

interface SignUpFormProps {
  onBackToLogin: () => void;
}

// ההרשמה יוצרת auth.users + profiles(status=pending) + access_requests בטריגר בצד השרת
// (migration 002) - אין כאן שום נתיב שמעניק גישה מיידית לאפליקציה.
export function SignUpForm({ onBackToLogin }: SignUpFormProps) {
  const isV3 = useIsV3();
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
      setError(hebrewAuthError(error.message, "שליחת הבקשה נכשלה"));
      return;
    }
    setDone(true);
  };

  if (done) {
    return (
      <AuthLayout title="הבקשה נשלחה">
        <p className="text-sm text-ink-muted">
          {isV3
            ? "הבקשה נקלטה. אם נדרש אימות מייל, יישלח קישור לתיבת הדואר — לאחר מכן החשבון ימתין לאישור מנהל מערכת, ורק אז יהיה אפשר להיכנס."
            : "הבקשה שלך נקלטה. אם נדרש אימות מייל תקבלי קישור לתיבת הדואר — לאחר מכן החשבון ימתין לאישור מנהל מערכת, ורק אז יהיה אפשר להיכנס."}
        </p>
        <button onClick={onBackToLogin} className="link-action mt-4 text-sm">
          חזרה למסך כניסה
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="בקשת גישה למערכת" description="הבקשה תישלח לאישור מנהל מערכת.">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="signup-name" className="field-label">
            שם מלא
          </label>
          <input id="signup-name" required value={fullName} onChange={(e) => setFullName(e.target.value)} className="input-field" />
        </div>
        <div>
          <label htmlFor="signup-email" className="field-label">
            אימייל
          </label>
          <input
            id="signup-email"
            type="email"
            dir="ltr"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input-field text-right"
          />
        </div>
        <div>
          <label htmlFor="signup-password" className="field-label">
            סיסמה
          </label>
          <PasswordInput
            id="signup-password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-field"
          />
        </div>
        <div>
          <label htmlFor="signup-message" className="field-label">
            הערה (לא חובה)
          </label>
          <textarea
            id="signup-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            className="input-field"
          />
        </div>
        {error && <ErrorState message={error} />}
        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? (isV3 ? "בשליחה…" : "שולחת…") : "שליחת בקשה"}
        </button>
      </form>
      <button onClick={onBackToLogin} className="link-action mt-4 text-xs">
        כבר יש לי חשבון — כניסה
      </button>
    </AuthLayout>
  );
}
