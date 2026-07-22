import { PageHeader } from "@/components/PageHeader";
import { ExceptionGrid } from "@/components/ExceptionGrid";
import { FINANCE_EXCEPTIONS } from "@/lib/demoData";

export function FinanceDashboard() {
  return (
    <div>
      <PageHeader
        title="דשבורד כספי"
        description="סטטוס החודש, חריגות ופעולות נדרשות — נגיש לכספים ובקרה בלבד."
      />
      <ExceptionGrid items={FINANCE_EXCEPTIONS} />
    </div>
  );
}
