import { supabase } from "@/lib/supabase";
import { AuthLayout } from "./AuthLayout";

export function PendingApprovalScreen() {
  return (
    <AuthLayout title="החשבון ממתין לאישור">
      <p className="text-sm text-slate-600">
        הבקשה שלך נקלטה במערכת וממתינה לאישור מנהל מערכת. תקבלי גישה מיד לאחר האישור.
      </p>
      <button onClick={() => supabase.auth.signOut()} className="link-action mt-4 text-sm">
        התנתקות
      </button>
    </AuthLayout>
  );
}
