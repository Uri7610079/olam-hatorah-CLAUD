import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";

export interface PermissionRow {
  resource: string;
  action: string;
}

const MY_PERMISSIONS_KEY = ["my-permissions"];

async function fetchMyPermissions(): Promise<PermissionRow[]> {
  const { data, error } = await supabase.rpc("my_permissions");
  if (error) throw error;
  return data ?? [];
}

// שולף פעם אחת את כל ההרשאות האפקטיביות של המשתמש המחובר (my_permissions() ב-SQL, שכבר
// מחילה חריגות ברמת משתמש) ומטמין ב-react-query - כדי שבדיקת הרשאה במסך תהיה חיפוש
// ברשימה בזיכרון, לא קריאת רשת נפרדת לכל בדיקה.
export function useMyPermissions(enabled: boolean) {
  return useQuery({
    queryKey: MY_PERMISSIONS_KEY,
    queryFn: fetchMyPermissions,
    enabled,
    staleTime: 60_000,
  });
}

export function useHasPermission(resource: string, action: string, enabled = true) {
  const { data, isLoading } = useMyPermissions(enabled);
  const hasPermission = data?.some((p) => p.resource === resource && p.action === action) ?? false;
  return { hasPermission, isLoading };
}

// יש לקרוא לזה בהתנתקות/החלפת משתמש - אחרת המטמון של המשתמש הקודם עלול "לדלוף" למשתמש הבא.
export function useInvalidatePermissions() {
  const queryClient = useQueryClient();
  return () => queryClient.removeQueries({ queryKey: MY_PERMISSIONS_KEY });
}
