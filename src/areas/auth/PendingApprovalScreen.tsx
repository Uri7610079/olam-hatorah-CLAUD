import { supabase } from "@/lib/supabase";
import { AuthLayout } from "./AuthLayout";

export function PendingApprovalScreen() {
  return (
    <AuthLayout title="החשבון ממתין לאישור">
      <p className="text-sm text-slate-600">
        הבקשה שלך נקלטה במערכת וממתינה לאישור מנהל מערכת. תקבלי גישה מיד לאחר האישור.
      </p>
      <button
        onClick={() => supabase.auth.signOut()}
        className="mt-4 text-sm text-blue-600 underline hover:text-blue-800"
      >
        התנתקות
      </button>
    </AuthLayout>
  );
}
