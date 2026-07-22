import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { useInvalidatePermissions } from "@/lib/permissions";
import { LoadingState } from "@/components/LoadingState";
import { LoginForm } from "./LoginForm";
import { SignUpForm } from "./SignUpForm";
import { ForgotPasswordForm } from "./ForgotPasswordForm";
import { PendingApprovalScreen } from "./PendingApprovalScreen";
import { DisabledScreen } from "./DisabledScreen";

type AuthMode = "login" | "signup" | "forgot";

// שער הכניסה היחיד לאפליקציה: לפני session - מסכי כניסה/הרשמה/שכחתי סיסמה.
// עם session אבל pending/disabled - מסך המתנה/השבתה, בלי גישה לשום מסך עסקי.
// רק approved מגיע ל-children (מעטפת האפליקציה האמיתית).
export function AuthGate({ children }: { children: ReactNode }) {
  const { loading, session, profile } = useAuth();
  const [mode, setMode] = useState<AuthMode>("login");
  const invalidatePermissions = useInvalidatePermissions();
  const hadSession = useRef(false);

  useEffect(() => {
    if (hadSession.current && !session) invalidatePermissions();
    hadSession.current = Boolean(session);
  }, [session, invalidatePermissions]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <LoadingState rows={3} />
        </div>
      </div>
    );
  }

  if (!session) {
    if (mode === "signup") return <SignUpForm onBackToLogin={() => setMode("login")} />;
    if (mode === "forgot") return <ForgotPasswordForm onBackToLogin={() => setMode("login")} />;
    return <LoginForm onSignUp={() => setMode("signup")} onForgot={() => setMode("forgot")} />;
  }

  if (!profile || profile.status === "pending") {
    return <PendingApprovalScreen />;
  }

  if (profile.status === "disabled") {
    return <DisabledScreen />;
  }

  return <>{children}</>;
}
