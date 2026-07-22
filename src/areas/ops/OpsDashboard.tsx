import { PageHeader } from "@/components/PageHeader";
import { ExceptionGrid } from "@/components/ExceptionGrid";
import { OPS_EXCEPTIONS } from "@/lib/demoData";

export function OpsDashboard() {
  return (
    <div>
      <PageHeader
        title="דשבורד תפעולי"
        description="מה דורש טיפול כרגע — ללא סכומים כספיים ונתונים רגישים."
      />
      <ExceptionGrid items={OPS_EXCEPTIONS} />
    </div>
  );
}
