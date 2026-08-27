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
import { GuideScreen } from "./areas/admin/GuideScreen";
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
import { AuditsScreen } from "./areas/ops/audits/AuditsScreen";
import { PhoneListsScreen } from "./areas/ops/phone-lists/PhoneListsScreen";
import { DocumentsScreen } from "./areas/ops/documents/DocumentsScreen";
import { ExceptionsCenterScreen } from "./areas/shared/ExceptionsCenterScreen";
import { ReportsScreen } from "./areas/finance/ReportsScreen";
import { GroupLeadersScreen } from "./areas/finance/GroupLeadersScreen";
import { FinancialPeriodsScreen } from "./areas/finance/FinancialPeriodsScreen";
import { CommissionRulesScreen } from "./areas/finance/CommissionRulesScreen";
import { GroupBalancesScreen } from "./areas/finance/GroupBalancesScreen";
import { DonationsScreen } from "./areas/finance/DonationsScreen";
import { DistributionsScreen } from "./areas/finance/DistributionsScreen";
import { MasavScreen } from "./areas/finance/MasavScreen";
import { ReturnsScreen } from "./areas/finance/ReturnsScreen";
import { BankScreen } from "./areas/finance/BankScreen";
import { BankClassificationScreen } from "./areas/admin/BankClassificationScreen";
import { DemoDataScreen } from "./areas/admin/DemoDataScreen";
import { AppearanceScreen } from "./areas/admin/AppearanceScreen";
import { FoldersScreen } from "./areas/admin/FoldersScreen";
import { BankScraperScreen } from "./areas/admin/BankScraperScreen";
import { UnassignedBulkAssignScreen } from "./areas/ops/students/UnassignedBulkAssignScreen";
import { TasksHomeScreen } from "./areas/tasks/TasksHomeScreen";
import { TasksAllScreen } from "./areas/tasks/TasksAllScreen";
import { TasksWhatsAppScreen } from "./areas/tasks/TasksWhatsAppScreen";
import { TasksSettingsScreen } from "./areas/tasks/TasksSettingsScreen";

// המסכים האלה כבר נבנו בפועל (שלבים 2-7) - לא עוברים דרך מפת ה-placeholder הכללית.
const SCREENS_WITH_REAL_PAGES = new Set([
  "/admin/users",
  "/admin/audit-log",
  "/admin/guide",
  "/admin/study-codes",
  "/ops/organizations",
  "/ops/branches-groups",
  "/ops/students",
  "/ops/students/unassigned",
  "/ops/import-center",
  "/ops/talmud/export",
  "/ops/talmud/eligibility",
  "/ops/talmud/errors",
  "/ops/talmud/retro",
  "/ops/quotas",
  "/ops/audits",
  "/ops/phone-lists",
  "/ops/documents",
  "/ops/exceptions",
  "/finance/exceptions",
  "/finance/reports",
  "/finance/months",
  "/finance/commission-rules",
  "/finance/group-balances",
  "/finance/donations",
  "/finance/distributions",
  "/finance/masav",
  "/finance/returns",
  "/finance/bank-transactions",
  "/finance/bank-matching",
  "/finance/bank-auto-sync",
  "/finance/documents",
  "/finance/group-leaders",
  "/admin/bank-classification",
  "/admin/demo-data",
  "/admin/appearance",
  "/admin/folders",
  "/admin/bank-scraper",
  "/tasks",
  "/tasks/all",
  "/tasks/whatsapp",
  "/tasks/settings",
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
            <Route path="/admin/guide" element={<GuideScreen />} />
            <Route path="/ops/organizations" element={<OrganizationsListScreen />} />
            <Route path="/ops/organizations/:id" element={<OrganizationDetailScreen />} />
            <Route path="/ops/branches-groups" element={<BranchesGroupsScreen />} />
            <Route path="/ops/students" element={<StudentsListScreen />} />
            <Route path="/ops/students/unassigned" element={<UnassignedBulkAssignScreen />} />
            <Route path="/ops/students/:id" element={<StudentDetailScreen />} />
            <Route path="/ops/import-center" element={<ImportCenterScreen />} />
            <Route path="/admin/study-codes" element={<StudyCodesScreen />} />
            <Route path="/ops/talmud/export" element={<TalmudExportScreen />} />
            <Route path="/ops/talmud/eligibility" element={<EligibilityScreen />} />
            <Route path="/ops/talmud/errors" element={<ErrorsCenterScreen />} />
            <Route path="/ops/talmud/retro" element={<RetroScreen />} />
            <Route path="/ops/quotas" element={<QuotasScreen />} />
            <Route path="/ops/audits" element={<AuditsScreen />} />
            <Route path="/ops/phone-lists" element={<PhoneListsScreen />} />
            <Route path="/ops/documents" element={<DocumentsScreen />} />
            <Route path="/ops/exceptions" element={<ExceptionsCenterScreen />} />
            <Route path="/finance/exceptions" element={<ExceptionsCenterScreen />} />
            <Route path="/finance/reports" element={<ReportsScreen />} />
            <Route path="/finance/group-leaders" element={<GroupLeadersScreen />} />
            <Route path="/finance/months" element={<FinancialPeriodsScreen />} />
            <Route path="/finance/commission-rules" element={<CommissionRulesScreen />} />
            <Route path="/finance/group-balances" element={<GroupBalancesScreen />} />
            <Route path="/finance/donations" element={<DonationsScreen />} />
            <Route path="/finance/distributions" element={<DistributionsScreen />} />
            <Route path="/finance/masav" element={<MasavScreen />} />
            <Route path="/finance/returns" element={<ReturnsScreen />} />
            {/* מסך "בנק" מאוחד (תנועות/התאמות/משיכה אוטומטית) - שלושת הנתיבים הישנים
                נשמרים בכוונה (קישורים/כרטיסי חריגה קיימים) ורק בוחרים טאב פתיחה שונה. */}
            <Route path="/finance/bank-transactions" element={<BankScreen initialTab="transactions" />} />
            <Route path="/finance/bank-matching" element={<BankScreen initialTab="matching" />} />
            <Route path="/finance/bank-auto-sync" element={<BankScreen initialTab="auto-sync" />} />
            <Route path="/finance/documents" element={<DocumentsScreen />} />
            <Route path="/admin/bank-classification" element={<BankClassificationScreen />} />
            <Route path="/admin/demo-data" element={<DemoDataScreen />} />
            <Route path="/admin/appearance" element={<AppearanceScreen />} />
            <Route path="/admin/folders" element={<FoldersScreen />} />
            <Route path="/admin/bank-scraper" element={<BankScraperScreen />} />
            <Route path="/tasks" element={<TasksHomeScreen />} />
            <Route path="/tasks/all" element={<TasksAllScreen />} />
            <Route path="/tasks/whatsapp" element={<TasksWhatsAppScreen />} />
            <Route path="/tasks/settings" element={<TasksSettingsScreen />} />
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
