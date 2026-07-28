import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type ProfileStatus = "pending" | "approved" | "disabled";
export type Area = "ops" | "finance" | "admin" | "tasks";

export interface Profile {
  id: string;
  full_name: string | null;
  status: ProfileStatus;
  default_area: Area | null;
  role_key: string | null;
  role_label: string | null;
}

interface AuthState {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
}

async function loadProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, status, default_area, role:roles(key, label_he)")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return null;

  const role = Array.isArray(data.role) ? data.role[0] : data.role;
  return {
    id: data.id,
    full_name: data.full_name,
    status: data.status,
    default_area: data.default_area,
    role_key: role?.key ?? null,
    role_label: role?.label_he ?? null,
  };
}

// hook יחיד לכל האפליקציה: session + profile (סטטוס/תפקיד/אזור ברירת מחדל).
// מתעדכן אוטומטית ב-onAuthStateChange (login/logout/refresh) ולא רק בטעינה ראשונית.
export function useAuth(): AuthState & { refreshProfile: () => Promise<void> } {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const refreshProfile = async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      setProfile(await loadProfile(data.session.user.id));
    }
  };

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      setProfile(data.session ? await loadProfile(data.session.user.id) : null);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setProfile(nextSession ? await loadProfile(nextSession.user.id) : null);
      setLoading(false);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return { loading, session, profile, refreshProfile };
}
