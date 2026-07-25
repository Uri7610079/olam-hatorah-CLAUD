import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { Tabs } from "@/components/Tabs";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { MasterDataImportWizard } from "./MasterDataImportWizard";

interface DemoBatchRow {
  id: string;
  label: string;
  description: string | null;
  created_at: string;
}

interface TableCountRow {
  table_name: string;
  row_count: number;
}

const TABLE_LABEL_HE: Record<string, string> = {
  group_ledger_entries: "רשומות ספר תנועות",
  bank_matches: "התאמות בנק",
  payment_returns: "החזרות תשלום",
  bank_transactions: "תנועות בנק",
  masav_lines: 'שורות מס"ב',
  masav_batches: 'אצוות מס"ב',
  distribution_lines: "שורות חלוקה",
  distribution_batches: "אצוות חלוקה",
  donations: "תרומות",
  eligibility_financial_results: "תוצאות זכאות/עמלה",
  monthly_eligibility: "זכאות חודשית",
  financial_periods: "תקופות כספיות",
  student_bank_accounts: "חשבונות בנק לתלמיד",
  student_assignments: "שיוכי תלמידים",
  students: "תלמידים",
  groups: "קבוצות",
  branches: "סניפים",
  organization_bank_accounts: "חשבונות בנק לעמותה",
  organizations: "עמותות",
};

async function fetchDemoBatches(): Promise<DemoBatchRow[]> {
  const { data, error } = await supabase.from("demo_batches").select("id, label, description, created_at").order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export function DemoDataScreen() {
  const { hasPermission, isLoading: permissionLoading } = useHasPermission("demo_data", "manage");
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"demo" | "real">("demo");

  const batchesQuery = useQuery({ queryKey: ["demo-batches"], queryFn: fetchDemoBatches, enabled: hasPermission && tab === "demo" });

  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [previewBatchId, setPreviewBatchId] = useState<string | null>(null);
  const [previewLabel, setPreviewLabel] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<TableCountRow[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<TableCountRow[] | null>(null);
  const latestPreviewRequestRef = useRef<string | null>(null);

  const createBatch = async () => {
    if (!label.trim()) return;
    setCreating(true);
    setError(null);
    const { error: err } = await supabase.rpc("create_demo_batch", { p_label: label.trim(), p_description: description.trim() || null });
    setCreating(false);
    if (err) {
      setError(err.message);
      return;
    }
    setLabel("");
    setDescription("");
    queryClient.invalidateQueries({ queryKey: ["demo-batches"] });
  };

  const openPreview = async (batchId: string, batchLabel: string) => {
    latestPreviewRequestRef.current = batchId;
    setPreviewBatchId(batchId);
    setPreviewLabel(batchLabel);
    setPreviewRows(null);
    setDeleteResult(null);
    setConfirmText("");
    setPreviewLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("preview_demo_batch_deletion", { p_batch_id: batchId });
    // אם המשתמש כבר לחצה על "בדיקה ומחיקה" של חבילה אחרת לפני שהתשובה הזו חזרה - זו
    // תשובה מיושנת (לחבילה שכבר לא מוצגת) ואסור לה להציג ספירות של חבילה אחת בזמן
    // שמוצג label של אחרת, ממש לפני אישור מחיקה בלתי הפיכה.
    if (latestPreviewRequestRef.current !== batchId) return;
    setPreviewLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    setPreviewRows(data ?? []);
  };

  const closePreview = () => {
    setPreviewBatchId(null);
    setPreviewLabel(null);
    setPreviewRows(null);
    setDeleteResult(null);
    setConfirmText("");
  };

  const confirmDelete = async () => {
    if (!previewBatchId || !previewLabel || confirmText.trim() !== previewLabel) return;
    const batchId = previewBatchId;
    setDeleting(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("delete_demo_batch", { p_batch_id: batchId });
    setDeleting(false);
    if (err) {
      // אם המשתמש כבר עברה לתצוגה מקדימה של חבילה אחרת, לא מציגים כאן שגיאה על חבילה
      // שכבר לא זו שמוצגת - אך setDeleting(false) למעלה עדיין חייב לרוץ תמיד, אחרת דגל
      // הטעינה נשאר תקוע ל-true לצמיתות וחוסם גם את כפתור האישור של החבילה הבאה.
      if (latestPreviewRequestRef.current === batchId) setError(err.message);
      return;
    }
    // המחיקה עצמה קרתה בפועל (לחבילה הנכונה) בכל מקרה - הרשימה האמיתית חייבת להתעדכן
    // תמיד, גם אם המשתמש כבר עברה הלאה לתצוגה מקדימה של חבילה אחרת.
    queryClient.invalidateQueries({ queryKey: ["demo-batches"] });
    if (latestPreviewRequestRef.current !== batchId) return;
    setDeleteResult(data ?? []);
    setPreviewRows(null);
  };

  const batchColumns: DataTableColumn<DemoBatchRow>[] = [
    { key: "label", header: "תווית", render: (b) => b.label },
    { key: "description", header: "תיאור", render: (b) => b.description ?? "—" },
    { key: "created", header: "נוצר", className: "tabular", render: (b) => new Date(b.created_at).toLocaleString("he-IL") },
    {
      key: "actions",
      header: "",
      render: (b) => (
        <button onClick={() => openPreview(b.id, b.label)} className="link-action text-xs">
          בדיקה ומחיקה
        </button>
      ),
    },
  ];

  if (permissionLoading) return <LoadingState rows={4} />;

  if (!hasPermission) {
    return (
      <div>
        <PageHeader title="ניהול נתוני דמו" />
        <ErrorState message="אין לך הרשאה לצפות במסך זה." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="ניהול נתוני דמו" description='יצירה ומחיקה מבוקרת של נתוני דמו לצורך הדגמה, ואשף מעבר לנתוני אמת. זמין למנהל מערכת בלבד.' />

      <Tabs
        tabs={[
          { key: "demo", label: "נתוני דמו" },
          { key: "real", label: "מעבר לנתוני אמת" },
        ]}
        activeTab={tab}
        onChange={setTab}
        ariaLabel="ניהול נתוני דמו"
      />

      {error && (
        <div className="mb-4">
          <ErrorState message={error} />
        </div>
      )}

      {tab === "demo" && (
        <>
          <div className="card mb-6 max-w-xl space-y-3 p-4">
            <h2 className="text-sm font-semibold text-slate-700">יצירת חבילת דמו חדשה</h2>
            <p className="text-xs text-slate-500">
              יוצרת שרשרת נתונים סינתטית שלמה תחת עמותת "DEMO" נפרדת: סניף, 2 קבוצות, 3 תלמידים, זכאות ועמלה, תרומה וחלוקה, מס"ב, התאמת בנק והחזרה פתוחה - לצורך הדגמה בלבד. לא מתערבב בנתוני אמת של אף עמותה אחרת.
            </p>
            <div>
              <label className="field-label">תווית</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)} className="input-field" placeholder="לדוגמה: הדגמה ליום עיון" />
            </div>
            <div>
              <label className="field-label">תיאור (לא חובה)</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} className="input-field" />
            </div>
            <button onClick={createBatch} disabled={!label.trim() || creating} className="btn-primary text-xs">
              {creating ? "יוצרת…" : "יצירת חבילת דמו"}
            </button>
          </div>

          <DataTable
            columns={batchColumns}
            rows={batchesQuery.data ?? []}
            rowKey={(b) => b.id}
            loading={batchesQuery.isLoading}
            emptyTitle="אין חבילות דמו"
            emptyIcon={FlaskConical}
          />

          {previewBatchId && previewLabel && (
            <div className="card mt-4 max-w-xl space-y-3 p-4">
              <h2 className="text-sm font-semibold text-slate-700">מחיקת חבילת דמו: {previewLabel}</h2>

              {previewLoading && <LoadingState rows={3} />}

              {deleteResult ? (
                <>
                  <p className="text-sm text-emerald-700">החבילה נמחקה בהצלחה.</p>
                  <ul className="space-y-1 text-xs text-slate-600">
                    {deleteResult
                      .filter((r) => r.row_count > 0)
                      .map((r) => (
                        <li key={r.table_name}>
                          {TABLE_LABEL_HE[r.table_name] ?? r.table_name}: {r.row_count}
                        </li>
                      ))}
                  </ul>
                  <button onClick={closePreview} className="btn-secondary text-xs">
                    סגירה
                  </button>
                </>
              ) : (
                previewRows && (
                  <>
                    <p className="text-xs text-slate-500">השורות הבאות יימחקו לצמיתות - פעולה בלתי הפיכה:</p>
                    <ul className="space-y-1 text-xs text-slate-600">
                      {previewRows
                        .filter((r) => r.row_count > 0)
                        .map((r) => (
                          <li key={r.table_name}>
                            {TABLE_LABEL_HE[r.table_name] ?? r.table_name}: {r.row_count}
                          </li>
                        ))}
                    </ul>
                    <label className="field-label">כדי לאשר, הקלידי את תווית החבילה בדיוק: {previewLabel}</label>
                    <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="input-field" />
                    <div className="flex gap-2">
                      <button
                        onClick={confirmDelete}
                        disabled={confirmText.trim() !== previewLabel || deleting}
                        className="text-xs text-red-600 underline hover:text-red-800 disabled:text-slate-300 disabled:no-underline"
                      >
                        {deleting ? "מוחקת…" : "אישור מחיקה סופית"}
                      </button>
                      <button onClick={closePreview} className="text-xs text-slate-500 underline">
                        ביטול
                      </button>
                    </div>
                  </>
                )
              )}
            </div>
          )}
        </>
      )}

      {tab === "real" && <MasterDataImportWizard />}
    </div>
  );
}
