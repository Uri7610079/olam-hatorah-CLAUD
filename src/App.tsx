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
import { OrganizationsListScreen } from "./areas/ops/organizations/OrganizationsListScreen";
import { OrganizationDetailScreen } from "./areas/ops/organizations/OrganizationDetailScreen";
import { BranchesGroupsScreen } from "./areas/ops/branches-groups/BranchesGroupsScreen";
import { StudentsListScreen } from "./areas/ops/students/StudentsListScreen";
import { StudentDetailScreen } from "./areas/ops/students/StudentDetailScreen";
import { ImportCenterScreen } from "./areas/ops/import-center/ImportCenterScreen";
import { StudyCodesScreen } from "./areas/admin/StudyCodesScreen";
import { TalmudExportScreen } from "./areas/ops/talmud/TalmudExportScreen";
import { EligibilityScreen } from "./areas/ops/talmud/EligibilityScreen";
import { ErrorsCenterScreen } from "./areas/ops/talmud/ErrorsCenterScreen";
import { RetroScreen } from "./areas/ops/talmud/RetroScreen";
import { QuotasScreen } from "./areas/ops/quotas/QuotasScreen";
import { FinancialPeriodsScreen } from "./areas/finance/FinancialPeriodsScreen";
import { CommissionRulesScreen } from "./areas/finance/CommissionRulesScreen";
import { GroupBalancesScreen } from "./areas/finance/GroupBalancesScreen";
import { DonationsScreen } from "./areas/finance/DonationsScreen";
import { DistributionsScreen } from "./areas/finance/DistributionsScreen";
import { MasavScreen } from "./areas/finance/MasavScreen";
import { ReturnsScreen } from "./areas/finance/ReturnsScreen";
import { BankTransactionsScreen } from "./areas/finance/BankTransactionsScreen";
import { TransactionTypesScreen } from "./areas/admin/TransactionTypesScreen";
import { RecognitionRulesScreen } from "./areas/admin/RecognitionRulesScreen";

// המסכים האלה כבר נבנו בפועל (שלבים 2-7) - לא עוברים דרך מפת ה-placeholder הכללית.
const SCREENS_WITH_REAL_PAGES = new Set([
  "/admin/users",
  "/admin/audit-log",
  "/admin/study-codes",
  "/ops/organizations",
  "/ops/branches-groups",
  "/ops/students",
  "/ops/import-center",
  "/ops/talmud/export",
  "/ops/talmud/eligibility",
  "/ops/talmud/errors",
  "/ops/talmud/retro",
  "/ops/quotas",
  "/finance/months",
  "/finance/commission-rules",
  "/finance/group-balances",
  "/finance/donations",
  "/finance/distributions",
  "/finance/masav",
  "/finance/returns",
  "/finance/bank-transactions",
  "/admin/transaction-types",
  "/admin/recognition-rules",
]);

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
            <Route path="/ops/organizations" element={<OrganizationsListScreen />} />
            <Route path="/ops/organizations/:id" element={<OrganizationDetailScreen />} />
            <Route path="/ops/branches-groups" element={<BranchesGroupsScreen />} />
            <Route path="/ops/students" element={<StudentsListScreen />} />
            <Route path="/ops/students/:id" element={<StudentDetailScreen />} />
            <Route path="/ops/import-center" element={<ImportCenterScreen />} />
            <Route path="/admin/study-codes" element={<StudyCodesScreen />} />
            <Route path="/ops/talmud/export" element={<TalmudExportScreen />} />
            <Route path="/ops/talmud/eligibility" element={<EligibilityScreen />} />
            <Route path="/ops/talmud/errors" element={<ErrorsCenterScreen />} />
            <Route path="/ops/talmud/retro" element={<RetroScreen />} />
            <Route path="/ops/quotas" element={<QuotasScreen />} />
            <Route path="/finance/months" element={<FinancialPeriodsScreen />} />
            <Route path="/finance/commission-rules" element={<CommissionRulesScreen />} />
            <Route path="/finance/group-balances" element={<GroupBalancesScreen />} />
            <Route path="/finance/donations" element={<DonationsScreen />} />
            <Route path="/finance/distributions" element={<DistributionsScreen />} />
            <Route path="/finance/masav" element={<MasavScreen />} />
            <Route path="/finance/returns" element={<ReturnsScreen />} />
            <Route path="/finance/bank-transactions" element={<BankTransactionsScreen />} />
            <Route path="/admin/transaction-types" element={<TransactionTypesScreen />} />
            <Route path="/admin/recognition-rules" element={<RecognitionRulesScreen />} />
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
