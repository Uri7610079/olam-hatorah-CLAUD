import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";

export interface SavedFilter {
  id: string;
  name: string;
  filters: Record<string, unknown>;
}

async function fetchSavedFilters(screenKey: string): Promise<SavedFilter[]> {
  const { data, error } = await supabase.from("saved_filters").select("id, name, filters").eq("screen_key", screenKey).order("name");
  if (error) throw error;
  return data ?? [];
}

// מסנן שמור הוא נתון אישי בלבד (RLS לפי בעלות) - לא זקוק לבדיקת הרשאה נוספת, בדיוק כמו
// כל העדפת משתמש רגילה.
export function useSavedFilters(screenKey: string) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["saved-filters", screenKey], queryFn: () => fetchSavedFilters(screenKey) });

  const save = async (name: string, filters: Record<string, unknown>) => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    await supabase.from("saved_filters").upsert({ user_id: auth.user.id, screen_key: screenKey, name, filters }, { onConflict: "user_id,screen_key,name" });
    queryClient.invalidateQueries({ queryKey: ["saved-filters", screenKey] });
  };

  const remove = async (id: string) => {
    await supabase.from("saved_filters").delete().eq("id", id);
    queryClient.invalidateQueries({ queryKey: ["saved-filters", screenKey] });
  };

  return { filters: query.data ?? [], isLoading: query.isLoading, save, remove };
}
