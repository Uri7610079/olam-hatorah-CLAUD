import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

// שמירת "הבחירה האחרונה" (עמותה/חשבון בנק/קבוצה/אחראי וכו') פר-מסך, כדי שלא יהיה צריך
// לבחור מחדש כל פעם - נשמר ב-DB (לא localStorage) כדי שיישמר גם במעבר בין מחשבים,
// אותו עיקרון כמו useSavedFilters. cache מודול-level מונע קריאה חוזרת לאותו מפתח בתוך
// אותה טעינת אפליקציה (כמה מסכים יכולים לבקש את אותו מפתח, למשל "last-org").
const cache = new Map<string, unknown>();
const inFlight = new Map<string, Promise<void>>();

export function useLastSelected<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => (cache.has(key) ? (cache.get(key) as T) : fallback));

  useEffect(() => {
    if (cache.has(key)) {
      setValue(cache.get(key) as T);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data } = await supabase.from("user_ui_preferences").select("pref_value").eq("user_id", auth.user.id).eq("pref_key", key).maybeSingle();
      if (data) cache.set(key, data.pref_value);
    };
    const promise = inFlight.get(key) ?? load();
    inFlight.set(key, promise);
    promise.then(() => {
      inFlight.delete(key);
      if (!cancelled && cache.has(key)) setValue(cache.get(key) as T);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const save = useCallback(
    (next: T) => {
      cache.set(key, next);
      setValue(next);
      (async () => {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) return;
        await supabase.from("user_ui_preferences").upsert({ user_id: auth.user.id, pref_key: key, pref_value: next as never }, { onConflict: "user_id,pref_key" });
      })();
    },
    [key],
  );

  return [value, save] as const;
}
