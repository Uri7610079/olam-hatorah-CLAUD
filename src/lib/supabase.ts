import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "חסרים VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY — יש להעתיק .env.example ל-.env.local ולמלא ערכים מ-Supabase Settings → API.",
  );
}

// לקוח יחיד לכל האפליקציה. אין secrets/service_role כאן - רק המפתח הציבורי לצד לקוח.
export const supabase = createClient(url, anonKey);
