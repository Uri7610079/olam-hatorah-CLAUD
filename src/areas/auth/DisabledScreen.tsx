import { supabase } from "@/lib/supabase";
import { AuthLayout } from "./AuthLayout";
import { useIsV3 } from "@/lib/uiTheme";

export function DisabledScreen() {
  const isV3 = useIsV3();
  return (
    <AuthLayout title="הגישה למערכת הושבתה">
      <p className="text-sm text-ink-muted">
        {isV3 ? "החשבון הזה הושבת. אם זו טעות, אפשר לפנות למנהל המערכת." : "החשבון הזה הושבת. אם זו טעות, פני למנהל המערכת."}
      </p>
      <button onClick={() => supabase.auth.signOut()} className="link-action mt-4 text-sm">
        התנתקות
      </button>
    </AuthLayout>
  );
}
