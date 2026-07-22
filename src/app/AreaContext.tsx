import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

// זהו סימולטור תפקידים זמני לשלב 1 בלבד — יוחלף לגמרי ב-Auth/RLS אמיתיים בשלב 2.
// אין להשתמש בקובץ הזה כמנגנון הרשאה אמיתי; הוא קיים כדי לבדוק ניווט וברירות מחדל.
export type MockRole =
  | "system_admin"
  | "operations_manager"
  | "finance_controller"
  | "office_staff"
  | "accountant_readonly"
  | "viewer";

export type Area = "ops" | "finance" | "admin";

export const ROLE_LABELS: Record<MockRole, string> = {
  system_admin: "מנהל מערכת",
  operations_manager: "מנהל תפעול (משה)",
  finance_controller: "כספים ובקרה (אורי)",
  office_staff: "עובד משרד",
  accountant_readonly: "מנהלת חשבונות",
  viewer: "צופה",
};

export const DEFAULT_AREA_FOR_ROLE: Record<MockRole, Area> = {
  system_admin: "admin",
  operations_manager: "ops",
  finance_controller: "finance",
  office_staff: "ops",
  accountant_readonly: "finance",
  viewer: "ops",
};

export const AREAS_FOR_ROLE: Record<MockRole, Area[]> = {
  system_admin: ["ops", "finance", "admin"],
  operations_manager: ["ops"],
  finance_controller: ["finance"],
  office_staff: ["ops"],
  accountant_readonly: ["finance"],
  viewer: ["ops", "finance"],
};

interface AreaContextValue {
  role: MockRole;
  setRole: (role: MockRole) => void;
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

export function AreaProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<MockRole>("system_admin");
  const location = useLocation();
  const navigate = useNavigate();

  const availableAreas = useMemo(() => AREAS_FOR_ROLE[role], [role]);

  // האזור הנוכחי נגזר תמיד מהנתיב בפועל (URL), לא ממצב נפרד —
  // כך ניווט ישיר, רענון או "אחורה" בדפדפן תמיד מציגים sidebar תואם.
  const currentArea = areaFromPathname(location.pathname) ?? DEFAULT_AREA_FOR_ROLE[role];

  const setRole = (nextRole: MockRole) => {
    setRoleState(nextRole);
    navigate(`/${DEFAULT_AREA_FOR_ROLE[nextRole]}`);
  };

  const setCurrentArea = (area: Area) => {
    navigate(`/${area}`);
  };

  return (
    <AreaContext.Provider value={{ role, setRole, currentArea, setCurrentArea, availableAreas }}>
      {children}
    </AreaContext.Provider>
  );
}

export function useArea() {
  const ctx = useContext(AreaContext);
  if (!ctx) throw new Error("useArea must be used within AreaProvider");
  return ctx;
}
