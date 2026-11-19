import { useEffect, useState } from "react";
import { normalizeIsraeliPhone } from "@/lib/israeliPhone";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { safeStorageKey } from "@/lib/storagePath";
import { useHasPermission } from "@/lib/permissions";
import { useLastSelected } from "@/lib/useLastSelected";
import { parseImportFile, hashFile, isLegacyXls, type ParsedFile } from "@/lib/importParsing";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { Tabs } from "@/components/Tabs";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { HeaderRowConfirm } from "@/components/HeaderRowConfirm";
import { Stepper } from "@/components/Stepper";
import { DuplicateFileNotice } from "@/components/ImportV3Parts";
import { useIsV3 } from "@/lib/uiTheme";
import { formatDate, formatNumber, formatPhone } from "@/lib/format";

// שלבי היבוא כפי שהם קיימים כאן בפועל (v3): קובץ ← תצוגה מקדימה ← שמירה והרצת התאמה ← הותאם
const PHONE_IMPORT_STEPS = [
  { key: "file", label: "בחירת קובץ" },
  { key: "preview", label: "תצוגה מקדימה" },
  { key: "match", label: "שמירה והתאמה" },
  { key: "done", label: "הותאם" },
];

interface OrgOption {
  id: string;
  legal_name: string;
}

type ImportStatus = "uploaded" | "committed" | "rejected";

interface LocalRow {
  rowNumber: number;
  rawPhone: string;
  normalizedPhone: string;
  status: "pending" | "duplicate" | "invalid";
  errorMessage: string | null;
}

interface ImportSummary {
  id: string;
  file_name: string;
  status: ImportStatus;
  row_count: number;
  matched_count: number;
  extra_count: number;
  duplicate_count: number;
  invalid_count: number;
  created_at: string;
}

const IMPORT_STATUS_LABEL: Record<ImportStatus, string> = { uploaded: "הועלה", committed: "נקלט", rejected: "בוטל" };

function buildLocalRows(parsed: ParsedFile): LocalRow[] {
  const phoneKey = parsed.headers.find((h) => h.includes("טלפון")) ?? parsed.headers[0];
  const seen = new Set<string>();
  return parsed.rows.map((raw, index) => {
    const rowNumber = index + 1;
    const rawPhone = (raw[phoneKey] ?? "").trim();
    const normalizedPhone = normalizeIsraeliPhone(rawPhone);
    if (!normalizedPhone) {
      return { rowNumber, rawPhone, normalizedPhone, status: "invalid", errorMessage: "אין ספרות בטלפון" };
    }
    if (seen.has(normalizedPhone)) {
      return { rowNumber, rawPhone, normalizedPhone, status: "duplicate", errorMessage: "טלפון זה כבר הופיע בקובץ" };
    }
    seen.add(normalizedPhone);
    return { rowNumber, rawPhone, normalizedPhone, status: "pending", errorMessage: null };
  });
}

async function fetchOrgs(): Promise<OrgOption[]> {
  const { data, error } = await supabase.from("organizations").select("id, legal_name").eq("status", "active").order("legal_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchImports(orgId: string): Promise<ImportSummary[]> {
  const { data, error } = await supabase
    .from("phone_list_imports")
    .select("id, file_name, status, row_count, matched_count, extra_count, duplicate_count, invalid_count, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

interface PhoneListsImportPanelProps {
  // קובץ שהגיע מלשונית "זיהוי אוטומטי" - נבחר שם כבר, ולכן נכנס לניתוח כאילו נבחר כאן.
  initialFile?: File | null;
}

// פאנל יבוא רשימות טלפוניות עבור מרכז היבוא - אותה לוגיקה בדיוק כמו PhoneListsScreen
// (parseImportFile + נרמול טלפון מקומי + commit_phone_list_import), בלי טבלת השורות
// המפורטת/חסרים שאינה חלק מפעולת היבוא. המסך המקורי נשאר כפי שהוא.
export function PhoneListsImportPanel({ initialFile }: PhoneListsImportPanelProps) {
  const queryClient = useQueryClient();
  const isV3 = useIsV3();
  const { hasPermission: canPerform, isLoading: permLoading } = useHasPermission("phone_lists", "perform");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });

  const [orgId, setOrgId] = useLastSelected<string>("last-org", "");
  const [file, setFile] = useState<File | null>(null);
  const [localRows, setLocalRows] = useState<LocalRow[] | null>(null);
  const [previewTab, setPreviewTab] = useState<"pending" | "duplicate" | "invalid">("pending");
  const [legacyWarning, setLegacyWarning] = useState(false);
  const [duplicateFileId, setDuplicateFileId] = useState<string | null>(null);
  const [headerConfirm, setHeaderConfirm] = useState<{ file: File; previewRows: string[][]; detectedIndex: number } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);

  const importsQuery = useQuery({ queryKey: ["phone-list-imports", orgId], queryFn: () => fetchImports(orgId), enabled: !!orgId });

  const resetForm = () => {
    setFile(null);
    setLocalRows(null);
    setLegacyWarning(false);
    setDuplicateFileId(null);
    setHeaderConfirm(null);
    setError(null);
  };

  const handleFileChange = async (selected: File | null) => {
    resetForm();
    if (!selected || !orgId) return;
    setFile(selected);
    setAnalyzing(true);
    try {
      const hash = await hashFile(selected);
      const { data: existing } = await supabase.from("phone_list_imports").select("id").eq("file_hash", hash).maybeSingle();
      if (existing) {
        setDuplicateFileId(existing.id);
        return;
      }
      setLegacyWarning(isLegacyXls(selected));
      const parsed = await parseImportFile(selected);
      if (parsed.headerConfidence === "low") {
        setHeaderConfirm({ file: selected, previewRows: parsed.previewRows, detectedIndex: parsed.headerRowIndex });
        return;
      }
      setLocalRows(buildLocalRows(parsed));
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בניתוח הקובץ");
    } finally {
      setAnalyzing(false);
    }
  };

  // קובץ שהועבר מהזיהוי האוטומטי נכנס לניתוח בדיוק כמו קובץ שנבחר ידנית. כאן הניתוח דורש
  // עמותה נבחרת (ר' handleFileChange), ולכן אם עוד לא נבחרה - הקובץ ממתין, ומנותח מיד
  // כשהיא נבחרת. עד אז מוצגת הודעה שהקובץ מחכה, כדי שלא ייעלם בשקט.
  useEffect(() => {
    if (initialFile && orgId) void handleFileChange(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile, orgId]);

  const handleHeaderConfirm = async (chosenIndex: number) => {
    if (!headerConfirm) return;
    setAnalyzing(true);
    try {
      const parsed = await parseImportFile(headerConfirm.file, chosenIndex);
      setLocalRows(buildLocalRows(parsed));
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בניתוח הקובץ");
    } finally {
      setHeaderConfirm(null);
      setAnalyzing(false);
    }
  };

  const handleHeaderCancel = () => {
    setHeaderConfirm(null);
    resetForm();
  };

  const submitImport = async () => {
    if (!file || !localRows || !orgId) return;
    setUploading(true);
    setError(null);
    try {
      const hash = await hashFile(file);
      const path = `${orgId}/${safeStorageKey(file.name)}`;
      const { error: uploadError } = await supabase.storage.from("phone-list-files").upload(path, file);
      if (uploadError) throw new Error(`העלאת הקובץ נכשלה: ${uploadError.message}`);

      const { data: imp, error: impError } = await supabase
        .from("phone_list_imports")
        .insert({
          organization_id: orgId,
          file_path: path,
          file_name: file.name,
          file_hash: hash,
          row_count: localRows.length,
          duplicate_count: localRows.filter((r) => r.status === "duplicate").length,
          invalid_count: localRows.filter((r) => r.status === "invalid").length,
        })
        .select("id")
        .single();
      if (impError || !imp) throw new Error(impError?.message ?? "יצירת הייבוא נכשלה");

      const { error: entriesError } = await supabase.from("phone_list_entries").insert(
        localRows.map((r) => ({
          import_id: imp.id,
          row_number: r.rowNumber,
          raw_phone: r.rawPhone,
          normalized_phone: r.status === "pending" ? r.normalizedPhone : null,
          status: r.status,
        })),
      );
      if (entriesError) throw new Error(entriesError.message);

      resetForm();
      queryClient.invalidateQueries({ queryKey: ["phone-list-imports", orgId] });
      setSelectedImportId(imp.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה לא צפויה");
    } finally {
      setUploading(false);
    }
  };

  const commit = async () => {
    if (!selectedImportId) return;
    setCommitting(true);
    setError(null);
    const { error: err } = await supabase.rpc("commit_phone_list_import", { p_import_id: selectedImportId });
    setCommitting(false);
    if (err) {
      setError(err.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["phone-list-imports", orgId] });
  };

  if (permLoading) return <LoadingState rows={4} />;
  if (!canPerform) return <ErrorState message="אין לך הרשאה ליבוא רשימות טלפוניות." />;

  const localPending = (localRows ?? []).filter((r) => r.status === "pending");
  const localDuplicate = (localRows ?? []).filter((r) => r.status === "duplicate");
  const localInvalid = (localRows ?? []).filter((r) => r.status === "invalid");
  const selectedStatus = importsQuery.data?.find((i) => i.id === selectedImportId)?.status;
  const phoneStep = selectedStatus === "committed" ? "done" : selectedStatus === "uploaded" ? "match" : localRows && !duplicateFileId ? "preview" : "file";

  const localCols: DataTableColumn<LocalRow>[] = [
    { key: "num", header: "#", className: "tabular", render: (r) => r.rowNumber },
    { key: "raw", header: "טלפון גולמי", render: (r) => r.rawPhone || "—" },
    { key: "norm", header: "מנורמל", className: "tabular", render: (r) => (isV3 && r.normalizedPhone ? <span className="ltr-num">{formatPhone(r.normalizedPhone) || r.normalizedPhone}</span> : r.normalizedPhone || "—") },
    { key: "note", header: "הערה", render: (r) => r.errorMessage ?? "—" },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        יבוא רשימת טלפונים והשוואה לתלמידים פעילים. אין API וללא סנכרון אוטומטי - קובץ בלבד.
      </p>

      <div className="max-w-sm">
        <label htmlFor="plip-1" className="field-label">עמותה</label>
        <select id="plip-1"
          value={orgId}
          onChange={(e) => {
            setOrgId(e.target.value);
            setSelectedImportId(null);
          }}
          className="input-field"
        >
          <option value="">— בחרי —</option>
          {(orgsQuery.data ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.legal_name}
            </option>
          ))}
        </select>
      </div>

      {initialFile && !orgId && (
        <div className="rounded-md border border-warn/30 bg-warn-soft p-3 text-sm text-warn-ink">
          הקובץ "{initialFile.name}" מוכן ומחכה. בחרי עמותה למעלה כדי להמשיך ביבוא.
        </div>
      )}

      {orgId && (
        <div className="card max-w-2xl space-y-4 p-5">
          {isV3 && <Stepper steps={PHONE_IMPORT_STEPS} currentStep={phoneStep} />}
          {headerConfirm ? (
            <HeaderRowConfirm
              previewRows={headerConfirm.previewRows}
              detectedIndex={headerConfirm.detectedIndex}
              onConfirm={handleHeaderConfirm}
              onCancel={handleHeaderCancel}
            />
          ) : (
            <>
              <p className="text-xs text-ink-subtle">עמודה נדרשת: עמודה שמכילה "טלפון" בכותרת (אם לא נמצאה - העמודה הראשונה בקובץ).</p>
              <input type="file" aria-label="קובץ רשימה טלפונית" accept=".csv,.xlsx,.xls" onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)} className="input-field" />
              {analyzing && <LoadingState rows={2} />}
              {duplicateFileId && (
                <div className="space-y-2">
                  <DuplicateFileNotice />
                  <button onClick={() => setSelectedImportId(duplicateFileId)} className="link-action text-xs">
                    פתיחת הייבוא הקיים
                  </button>
                </div>
              )}
              {legacyWarning && <p className="text-xs text-warn-ink">קובץ XLS ישן - מומלץ להמיר ל-XLSX/CSV.</p>}
              {error && <ErrorState message={error} />}
              {localRows && !duplicateFileId && (
                <>
                  {isV3 && (
                    <p className="text-sm text-ink">
                      <span className="font-semibold text-primary">תצוגה מקדימה - עוד לא נשמר דבר.</span> בקובץ{" "}
                      <span className="font-semibold text-ok-ink">{formatNumber(localPending.length)} מספרים להתאמה</span>
                      {localDuplicate.length > 0 && <> · {formatNumber(localDuplicate.length)} כפולים (לא יותאמו פעמיים)</>}
                      {localInvalid.length > 0 && <> · <span className="font-semibold text-danger-ink">{formatNumber(localInvalid.length)} לא תקינים</span></>}
                    </p>
                  )}
                  <Tabs
                    tabs={[
                      { key: "pending", label: "ממתין", badge: localPending.length },
                      { key: "duplicate", label: "כפול", badge: localDuplicate.length },
                      { key: "invalid", label: "לא תקין", badge: localInvalid.length },
                    ]}
                    activeTab={previewTab}
                    onChange={setPreviewTab}
                    ariaLabel="תצוגה מקדימה"
                  />
                  <DataTable
                    columns={localCols}
                    rows={previewTab === "pending" ? localPending : previewTab === "duplicate" ? localDuplicate : localInvalid}
                    rowKey={(r) => String(r.rowNumber)}
                    emptyTitle="אין שורות"
                  />
                  <button onClick={submitImport} disabled={uploading || localPending.length === 0} className="btn-primary flex items-center gap-2">
                    <Upload className="h-4 w-4" aria-hidden="true" />
                    {uploading ? "מעלה…" : "יצירת ייבוא"}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {selectedImportId && importsQuery.data?.find((i) => i.id === selectedImportId)?.status === "uploaded" && (
        <div className="card max-w-2xl space-y-3 p-4">
          <p className="text-sm text-ink-muted">הקובץ נשמר. הריצי התאמה כדי לסמן תואם/עודף/כפול מול התלמידים הפעילים.</p>
          {error && <ErrorState message={error} />}
          <button onClick={commit} disabled={committing} className="btn-primary">
            {committing ? "מתאימה…" : "הרצת התאמה"}
          </button>
        </div>
      )}

      {orgId && (
        <>
          <h2 className="mb-2 mt-2 text-sm font-semibold text-ink-muted">היסטוריית ייבוא</h2>
          <DataTable
            columns={[
              { key: "file", header: "קובץ", truncate: isV3, render: (i: ImportSummary) => i.file_name },
              { key: "count", header: "שורות", className: "tabular", render: (i: ImportSummary) => i.row_count },
              {
                key: "matched",
                header: isV3 ? "תוצאת ההתאמה" : "תואם / עודף / כפול / לא תקין",
                className: "tabular",
                render: (i: ImportSummary) =>
                  isV3
                    ? i.status === "uploaded"
                      ? "טרם הותאם"
                      : [
                        `${formatNumber(i.matched_count)} תואמים`,
                        `${formatNumber(i.extra_count)} עודפים`,
                        i.duplicate_count > 0 ? `${formatNumber(i.duplicate_count)} כפולים` : null,
                        i.invalid_count > 0 ? `${formatNumber(i.invalid_count)} לא תקינים` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : `${i.matched_count} / ${i.extra_count} / ${i.duplicate_count} / ${i.invalid_count}`,
              },
              {
                key: "status",
                header: "סטטוס",
                render: (i: ImportSummary) => (
                  <StatusBadge severity={i.status === "committed" ? "ok" : i.status === "rejected" ? "neutral" : "medium"} label={IMPORT_STATUS_LABEL[i.status]} />
                ),
              },
              { key: "date", header: "תאריך", className: "tabular", sortValue: isV3 ? (i: ImportSummary) => i.created_at : undefined, render: (i: ImportSummary) => (isV3 ? formatDate(i.created_at) : new Date(i.created_at).toLocaleDateString("he-IL")) },
            ]}
            rows={importsQuery.data ?? []}
            rowKey={(i: ImportSummary) => i.id}
            loading={importsQuery.isLoading}
            emptyTitle="אין עדיין ייבואים"
            onRowClick={(i: ImportSummary) => setSelectedImportId(i.id === selectedImportId ? null : i.id)}
            selectedKey={isV3 ? selectedImportId : undefined}
          />
          <p className="text-xs text-ink-subtle">
            לפירוט מלא של שורות (תואם/עודף/כפול/לא תקין) ולתלמידים חסרים ברשימה - עברי למסך "רשימות בימות המשיח".
          </p>
        </>
      )}
    </div>
  );
}
