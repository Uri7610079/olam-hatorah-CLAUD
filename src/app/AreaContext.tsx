import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useMyPermissions } from "@/lib/permissions";

export type Area = "ops" | "finance" | "admin";

const AREA_PERMISSION: Record<Area, { resource: string; action: string }> = {
  ops: { resource: "area_ops", action: "access" },
  finance: { resource: "area_finance", action: "access" },
  admin: { resource: "area_admin", action: "access" },
};

interface AreaContextValue {
  fullName: string | null;
  roleLabel: string | null;
  currentArea: Area;
  setCurrentArea: (area: Area) => void;
  availableAreas: Area[];
}

const AreaContext = createContext<AreaContextValue | null>(null);

function areaFromPathname(pathname: string): Area | null {
  if (pathname.startsWith("/ops")) return "ops";
  if (pathname.startsWith("/finance")) return "finance";
  if (pathname.startsWith("/admin")) return "admin";
  return null;
}

// AreaProvider רץ רק בתוך AuthGate כש-profile מאושר (ר' App.tsx), אז useAuth/useMyPermissions
// כאן תמיד משקפים משתמש approved אמיתי — לא סימולציה. availableAreas נגזר מהרשאות
// area_ops/area_finance/area_admin האמיתיות (my_permissions), לא מרשימה קבועה לפי תפקיד.
export function AreaProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const { data: permissions } = useMyPermissions(true);
  const location = useLocation();
  const navigate = useNavigate();

  const availableAreas = useMemo<Area[]>(() => {
    if (!permissions) return [];
    return (["ops", "finance", "admin"] as Area[]).filter((area) => {
      const { resource, action } = AREA_PERMISSION[area];
      return permissions.some((p) => p.resource === resource && p.action === action);
    });
  }, [permissions]);

  const preferredArea =
    profile?.default_area && availableAreas.includes(profile.default_area) ? profile.default_area : availableAreas[0];

  const currentArea = areaFromPathname(location.pathname) ?? preferredArea ?? "ops";

  const setCurrentArea = (area: Area) => navigate(`/${area}`);

  return (
    <AreaContext.Provider
      value={{
        fullName: profile?.full_name ?? null,
        roleLabel: profile?.role_label ?? null,
        currentArea,
        setCurrentArea,
        availableAreas,
      }}
    >
      {children}
    </AreaContext.Provider>
  );
}

export function useArea() {
  const ctx = useContext(AreaContext);
  if (!ctx) throw new Error("useArea must be used within AreaProvider");
  return ctx;
}
