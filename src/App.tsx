import { Navigate, Route, Routes } from "react-router-dom";
import { AreaProvider } from "./app/AreaContext";
import { Layout } from "./app/Layout";
import { SCREENS } from "./app/screens";
import { PlaceholderScreen } from "./components/PlaceholderScreen";
import { OpsDashboard } from "./areas/ops/OpsDashboard";
import { FinanceDashboard } from "./areas/finance/FinanceDashboard";
import { AdminHome } from "./areas/admin/AdminHome";

export default function App() {
  return (
    <AreaProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/ops" replace />} />
          <Route path="/ops" element={<OpsDashboard />} />
          <Route path="/finance" element={<FinanceDashboard />} />
          <Route path="/admin" element={<AdminHome />} />
          {SCREENS.map((s) => (
            <Route
              key={s.path}
              path={s.path}
              element={
                <PlaceholderScreen
                  title={s.title}
                  description={s.description}
                  builtInStage={s.builtInStage}
                />
              }
            />
          ))}
          <Route path="*" element={<Navigate to="/ops" replace />} />
        </Route>
      </Routes>
    </AreaProvider>
  );
}
