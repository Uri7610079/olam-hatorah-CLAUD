import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { hashFile, parseImportFile } from "@/lib/importParsing";
import { STORED_REPORT_LABEL, storedReportRows, type StoredReportKey, type StoredReportRow } from "@/lib/talmudReports";
import { ErrorState } from "@/components/ErrorState";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { Stepper } from "@/components/Stepper";
import { useIsV3 } from "@/lib/uiTheme";
import { formatMonth } from "@/lib/format";

// קליטת "תשלומים למוסד", "זכאות בעקבות בג"ץ" ו"הסבר תשלומים וקיזוזים" (מיגרציה 121).
// מגיע ממשיכה מתלמוד, עם העמותה והחודש. תצוגה מקדימה, ואז קליטה - קליטה חוזרת לאותו
// דוח, עמותה וחודש מחליפה את הקודמת.

interface Props {
  file: File | null;
  reportKey: StoredReportKey | null;
  orgId: string | null;
  month: string | null;
}

const monthText = (iso: string | null) => (iso ? iso.slice(0, 7).split("-").reverse().join("/") : "—");
const money = (n: unknown) => (typeof n === "number" ? n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");

const PREVIEW: Record<StoredReportKey, { label: string; get: (r: StoredReportRow) => string }[]> = {
  institute_payments: [
    { label: "סניף", get: (r) => r.branch_code ?? "" },
    { label: "חודש", get: (r) => String(r.data.report_month ?? "") },
    { label: "סוג תשלום", get: (r) => String(r.data.payment_type ?? "") },
    { label: "זכאים", get: (r) => String(r.data.eligible ?? "") },
    { label: "סכום לתשלום", get: (r) => money(r.data.amount) },
  ],
  bagatz: [
    { label: "סניף", get: (r) => r.branch_code ?? "" },
    { label: "ת.ז./דרכון", get: (r) => r.external_id ?? "" },
    { label: "שם", get: (r) => `${r.data.last_name ?? ""} ${r.data.first_name ?? ""}`.trim() },
    { label: "זכאות", get: (r) => String(r.data.entitlement ?? "") },
    { label: 'השעיית בג"ץ', get: (r) => String(r.data.suspended ?? "—") },
  ],
  payment_explanation: [
    { label: "סניף", get: (r) => r.branch_code ?? "" },
    { label: "חודש דיווח", get: (r) => String(r.data.report_month ?? "") },
    { label: "סוג תשלום", get: (r) => String(r.data.payment_type ?? "") },
    { label: "סכום", get: (r) => money(r.data.amount) },
    { label: "הפרש", get: (r) => money(r.data.diff) },
    { label: "קיזוז", get: (r) => money(r.data.offset_this) },
  ],
};

export function TalmudReportImportPanel({ file, reportKey, orgId, month }: Props) {
  const qc = useQueryClient();
  const isV3 = useIsV3();
  const [rows, setRows] = useState<StoredReportRow[] | null>(null);
  const [hash, setHash] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  const org = useQuery({
    queryKey: ["org-name", orgId],
    enabled: !!orgId,
    queryFn: async () => (await supabase.from("organizations").select("legal_name").eq("id", orgId!).maybeSingle()).data?.legal_name ?? "",
  });

  useEffect(() => {
    setRows(null);
    setParseError(null);
    if (!file || !reportKey) return;
    (async () => {
      try {
        const parsed = await parseImportFile(file);
        setRows(storedReportRows(reportKey, parsed.rows));
        setHash(await hashFile(file));
      } catch (e) {
        setParseError(e instanceof Error ? e.message : "לא ניתן לקרוא את הקובץ");
      }
    })();
  }, [file, reportKey]);

  const run = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("import_talmud_report", {
        p_report_key: reportKey, p_organization_id: orgId, p_month: month, p_file_name: file!.name, p_file_hash: hash, p_rows: rows,
      });
      if (error) throw error;
      return (Array.isArray(data) ? data[0] : data) as { row_count: number; matched_count: number };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["talmud-files-for-import"] });
      qc.invalidateQueries({ queryKey: ["talmud-report-rows"] });
    },
  });

  const branches = useMemo(() => new Set((rows ?? []).map((r) => r.branch_code)).size, [rows]);

  if (!file || !reportKey) {
    return <EmptyState icon={Upload} title="אין קובץ לקליטה" description='הקבצים האלה מגיעים מהלשונית "קבצים מתלמוד".' />;
  }
  if (parseError) return <ErrorState message={parseError} />;
  if (!rows) return <LoadingState rows={3} />;

  const cols = PREVIEW[reportKey];
  return (
    <div className="max-w-5xl space-y-4">
      {isV3 && (
        <Stepper
          steps={[
            { key: "file", label: "קובץ מתלמוד" },
            { key: "preview", label: "תצוגה מקדימה" },
            { key: "done", label: "נקלט" },
          ]}
          currentStep={run.isSuccess ? "done" : "preview"}
        />
      )}
      <div className="card space-y-1 p-4">
        <p className="font-semibold">{STORED_REPORT_LABEL[reportKey]}</p>
        <p className="text-sm text-ink-muted">
          {org.data || "…"} · {isV3 ? formatMonth(month) : `חודש ${monthText(month)}`} · {rows.length} שורות · {branches} סניפים
        </p>
        {isV3 && !run.isSuccess && <p className="text-sm font-semibold text-primary">תצוגה מקדימה - עוד לא נקלט דבר.</p>}
        {reportKey === "bagatz" && <p className="text-xs text-ink-subtle">כל שורה תשויך לתלמיד לפי מספר הזהות, ותופיע בכרטיס שלו.</p>}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-right text-ink-muted v3:text-xs v3:font-medium">
            <tr>{cols.map((c) => <th key={c.label} className="whitespace-nowrap px-3 py-2 font-semibold">{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.slice(0, 12).map((r, i) => (
              <tr key={i} className="border-t border-line">
                {cols.map((c) => <td key={c.label} className="whitespace-nowrap px-3 py-2 tabular">{c.get(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 12 && <p className="px-3 py-2 text-xs text-ink-subtle">ועוד {rows.length - 12} שורות</p>}
      </div>

      {run.isError && <ErrorState message={run.error instanceof Error ? run.error.message : String((run.error as { message?: string })?.message ?? "שגיאה")} />}
      {run.isSuccess ? (
        <p className="flex items-center gap-2 rounded-control bg-ok-soft p-3 text-sm text-ok-ink">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          נקלטו {run.data.row_count} שורות{reportKey === "bagatz" ? `, ${run.data.matched_count} מהן שויכו לתלמידים במערכת` : ""}.
        </p>
      ) : (
        <button onClick={() => run.mutate()} disabled={!orgId || !month || !rows.length || run.isPending} className="btn-primary">
          {run.isPending ? "קולט…" : `קליטה (${rows.length} שורות)`}
        </button>
      )}
    </div>
  );
}
