import { QueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

// הנתונים שנטענו שייכים למשתמש המחובר. ביציאה, או כשמשתמש אחר נכנס באותה לשונית, הם
// נמחקים כולם - עד היום נמחקו רק ההרשאות, והמשתמש הבא יכול היה לראות לרגע רשימות
// שנטענו למשתמש הקודם (ביקורת 20.11.2026).
let currentUserId: string | null | undefined;
supabase.auth.onAuthStateChange((_event, session) => {
  const uid = session?.user.id ?? null;
  if (currentUserId !== undefined && uid !== currentUserId) queryClient.clear();
  currentUserId = uid;
});
