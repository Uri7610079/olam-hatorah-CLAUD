import { supabase } from "@/lib/supabase";
import { AuthLayout } from "./AuthLayout";

export function DisabledScreen() {
  return (
    <AuthLayout title="הגישה למערכת הושבתה">
      <p className="text-sm text-slate-600">החשבון הזה הושבת. אם זו טעות, פני למנהל המערכת.</p>
      <button onClick={() => supabase.auth.signOut()} className="link-action mt-4 text-sm">
        התנתקות
      </button>
    </AuthLayout>
  );
}
