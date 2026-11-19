import { supabase } from "@/lib/supabase";
import { AuthLayout } from "./AuthLayout";
import { useIsV3 } from "@/lib/uiTheme";

export function PendingApprovalScreen() {
  const isV3 = useIsV3();
  return (
    <AuthLayout title="החשבון ממתין לאישור">
      <p className="text-sm text-ink-muted">
        {isV3
          ? "הבקשה נקלטה במערכת וממתינה לאישור מנהל מערכת. הגישה תיפתח מיד לאחר האישור."
          : "הבקשה שלך נקלטה במערכת וממתינה לאישור מנהל מערכת. תקבלי גישה מיד לאחר האישור."}
      </p>
      <button onClick={() => supabase.auth.signOut()} className="link-action mt-4 text-sm">
        התנתקות
      </button>
    </AuthLayout>
  );
}
