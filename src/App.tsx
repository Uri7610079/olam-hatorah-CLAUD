import { Navigate, Route, Routes } from "react-router-dom";
import { AreaProvider } from "./app/AreaContext";
import { AuthGate } from "./areas/auth/AuthGate";
import { Layout } from "./app/Layout";
import { SCREENS } from "./app/screens";
import { PlaceholderScreen } from "./components/PlaceholderScreen";
import { OpsDashboard } from "./areas/ops/OpsDashboard";
import { FinanceDashboard } from "./areas/finance/FinanceDashboard";
import { AdminHome } from "./areas/admin/AdminHome";
import { AdminUsers } from "./areas/admin/AdminUsers";
import { AdminAuditLog } from "./areas/admin/AdminAuditLog";

// שני מסכי ה-admin האלה כבר נבנו בפועל בשלב 2 - לא עוברים דרך מפת ה-placeholder הכללית.
const SCREENS_WITH_REAL_PAGES = new Set(["/admin/users", "/admin/audit-log"]);

export default function App() {
  return (
    <AuthGate>
      <AreaProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/ops" replace />} />
            <Route path="/ops" element={<OpsDashboard />} />
            <Route path="/finance" element={<FinanceDashboard />} />
            <Route path="/admin" element={<AdminHome />} />
            <Route path="/admin/users" element={<AdminUsers />} />
            <Route path="/admin/audit-log" element={<AdminAuditLog />} />
            {SCREENS.filter((s) => !SCREENS_WITH_REAL_PAGES.has(s.path)).map((s) => (
              <Route
                key={s.path}
                path={s.path}
                element={
                  <PlaceholderScreen title={s.title} description={s.description} builtInStage={s.builtInStage} />
                }
              />
            ))}
            <Route path="*" element={<Navigate to="/ops" replace />} />
          </Route>
        </Routes>
      </AreaProvider>
    </AuthGate>
  );
}
