import { useState } from "react";
import { normalizeIsraeliPhone } from "@/lib/israeliPhone";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone, Upload, Sparkles, Download } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { safeStorageKey } from "@/lib/storagePath";
import { useHasPermission } from "@/lib/permissions";
import { useLastSelected } from "@/lib/useLastSelected";
import { parseImportFile, hashFile, isLegacyXls, type ParsedFile } from "@/lib/importParsing";
import { exportRowsToExcel } from "@/lib/reportExport";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { Tabs } from "@/components/Tabs";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { HeaderRowConfirm } from "@/components/HeaderRowConfirm";

interface OrgOption {
  id: string;
  legal_name: string;
}

type EntryStatus = "pending" | "matched" | "extra" | "duplicate" | "invalid";
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

interface EntryRow {
  id: string;
  raw_phone: string | null;
  normalized_phone: string | null;
  status: EntryStatus;
  matched_student: { external_id: string; full_name: string } | null;
}

interface MissingStudent {
  student_id: string;
  external_id: string;
  full_name: string;
  phone_normalized: string;
}

const ENTRY_STATUS_LABEL: Record<EntryStatus, string> = { pending: "ממתין", matched: "תואם", extra: "עודף", duplicate: "כפול", invalid: "לא תקין" };
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

async function fetchEntries(importId: string, filter: string): Promise<EntryRow[]> {
  let query = supabase
    .from("phone_list_entries")
    .select("id, raw_phone, normalized_phone, status, matched_student:students(external_id, full_name)")
    .eq("import_id", importId)
    .order("row_number");
  if (filter) query = query.eq("status", filter);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, matched_student: Array.isArray(r.matched_student) ? (r.matched_student[0] ?? null) : r.matched_student }));
}

async function fetchMissing(importId: string): Promise<MissingStudent[]> {
  const { data, error } = await supabase.rpc("get_phone_list_missing_students", { p_import_id: importId });
  if (error) throw error;
  return data ?? [];
}

export function PhoneListsScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canPerform } = useHasPermission("phone_lists", "perform");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });

  const [orgId, setOrgId] = useLastSelected<string>("last-org", "");
  const [showImport, setShowImport] = useState(false);
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
  const [entryFilter, setEntryFilter] = useState("");
  const [showMissing, setShowMissing] = useState(false);

  const importsQuery = useQuery({ queryKey: ["phone-list-imports", orgId], queryFn: () => fetchImports(orgId), enabled: !!orgId });
  const entriesQuery = useQuery({ queryKey: ["phone-list-entries", selectedImportId, entryFilter], queryFn: () => fetchEntries(selectedImportId!, entryFilter), enabled: !!selectedImportId });
  const missingQuery = useQuery({ queryKey: ["phone-list-missing", selectedImportId], queryFn: () => fetchMissing(selectedImportId!), enabled: !!selectedImportId && showMissing });

  const selectedImport = importsQuery.data?.find((i) => i.id === selectedImportId) ?? null;

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
      setShowImport(false);
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
    queryClient.invalidateQueries({ queryKey: ["phone-list-entries", selectedImportId, entryFilter] });
  };

  const localPending = (localRows ?? []).filter((r) => r.status === "pending");
  const localDuplicate = (localRows ?? []).filter((r) => r.status === "duplicate");
  const localInvalid = (localRows ?? []).filter((r) => r.status === "invalid");

  const handleExportEntries = () => {
    if (!selectedImport) return;
    exportRowsToExcel(
      (entriesQuery.data ?? []).map((r) => ({
        "טלפון גולמי": r.raw_phone ?? "",
        "מנורמל": r.normalized_phone ?? "",
        "סטטוס": ENTRY_STATUS_LABEL[r.status],
        "תלמיד תואם": r.matched_student ? `${r.matched_student.full_name} (${r.matched_student.external_id})` : "",
      })),
      "רשימת טלפונים",
      `phone-list-${selectedImport.file_name.replace(/\.[^.]+$/, "")}-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  };

  const localCols: DataTableColumn<LocalRow>[] = [
    { key: "num", header: "#", className: "tabular", render: (r) => r.rowNumber },
    { key: "raw", header: "טלפון גולמי", render: (r) => r.rawPhone || "—" },
    { key: "norm", header: "מנורמל", className: "tabular", render: (r) => r.normalizedPhone || "—" },
    { key: "note", header: "הערה", render: (r) => r.errorMessage ?? "—" },
  ];

  return (
    <div>
      <PageHeader
        title="רשימות בימות המשיח"
        description='יבוא רשימת טלפונים והשוואה לתלמידים פעילים: חסר / עודף / כפול / לא תקין / תואם. אין API וללא סנכרון אוטומטי - קובץ בלבד. "נייד מול קווי" נשאר כלל הגדרה פתוח - אין אימות פורמט מעבר לבדיקת ספרות.'
        primaryAction={
          orgId &&
          canPerform && (
            <button onClick={() => setShowImport((v) => !v)} className="btn-secondary">
              {showImport ? "סגירה" : "יבוא רשימה"}
            </button>
          )
        }
      />

      <div className="mb-4 max-w-sm">
        <label className="field-label">עמותה</label>
        <select
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

      {showImport && orgId && (
        <div className="card mb-6 max-w-2xl space-y-4 p-5">
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
              <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)} className="input-field" />
              {analyzing && <LoadingState rows={2} />}
              {duplicateFileId && (
                <div className="space-y-2">
                  <ErrorState message="הקובץ הזה כבר יובא בעבר." />
                  <button onClick={() => setSelectedImportId(duplicateFileId)} className="link-action text-xs">
                    פתיחת הייבוא הקיים
                  </button>
                </div>
              )}
              {legacyWarning && <p className="text-xs text-warn-ink">קובץ XLS ישן - מומלץ להמיר ל-XLSX/CSV.</p>}
              {error && <ErrorState message={error} />}
              {localRows && !duplicateFileId && (
                <>
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

      {orgId && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-ink-muted">היסטוריית ייבוא</h2>
          <DataTable
            columns={[
              { key: "file", header: "קובץ", render: (i: ImportSummary) => i.file_name },
              { key: "count", header: "שורות", className: "tabular", render: (i: ImportSummary) => i.row_count },
              { key: "matched", header: "תואם / עודף / כפול / לא תקין", className: "tabular", render: (i: ImportSummary) => `${i.matched_count} / ${i.extra_count} / ${i.duplicate_count} / ${i.invalid_count}` },
              { key: "status", header: "סטטוס", render: (i: ImportSummary) => <StatusBadge severity={i.status === "committed" ? "ok" : i.status === "rejected" ? "neutral" : "medium"} label={IMPORT_STATUS_LABEL[i.status]} /> },
              { key: "date", header: "תאריך", className: "tabular", render: (i: ImportSummary) => new Date(i.created_at).toLocaleDateString("he-IL") },
            ]}
            rows={importsQuery.data ?? []}
            rowKey={(i: ImportSummary) => i.id}
            loading={importsQuery.isLoading}
            emptyTitle="אין עדיין ייבואים"
            emptyIcon={Phone}
            onRowClick={(i: ImportSummary) => setSelectedImportId(i.id === selectedImportId ? null : i.id)}
          />
        </>
      )}

      {selectedImport && (
        <div className="card mt-4 max-w-4xl space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink-muted">{selectedImport.file_name}</h2>
            <div className="flex items-center gap-2">
              <StatusBadge severity={selectedImport.status === "committed" ? "ok" : "medium"} label={IMPORT_STATUS_LABEL[selectedImport.status]} />
              <button
                onClick={handleExportEntries}
                disabled={!(entriesQuery.data && entriesQuery.data.length > 0)}
                className="btn-secondary flex items-center gap-2 text-xs"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                ייצוא לאקסל
              </button>
              {selectedImport.status === "uploaded" && canPerform && (
                <button onClick={commit} disabled={committing} className="btn-primary flex items-center gap-2 text-xs">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  {committing ? "מתאימה…" : "הרצת התאמה"}
                </button>
              )}
            </div>
          </div>

          {error && <ErrorState message={error} />}

          <Tabs
            tabs={[
              { key: "", label: "הכול" },
              { key: "matched", label: "תואם" },
              { key: "extra", label: "עודף" },
              { key: "duplicate", label: "כפול" },
              { key: "invalid", label: "לא תקין" },
            ]}
            activeTab={entryFilter}
            onChange={setEntryFilter}
            ariaLabel="סינון שורות"
          />
          <DataTable
            columns={[
              { key: "raw", header: "טלפון גולמי", className: "ltr-num", render: (r: EntryRow) => r.raw_phone ?? "—" },
              { key: "norm", header: "מנורמל", className: "tabular ltr-num", render: (r: EntryRow) => r.normalized_phone ?? "—" },
              { key: "status", header: "סטטוס", render: (r: EntryRow) => <StatusBadge severity={r.status === "matched" ? "ok" : r.status === "extra" ? "medium" : "neutral"} label={ENTRY_STATUS_LABEL[r.status]} /> },
              { key: "student", header: "תלמיד תואם", render: (r: EntryRow) => (r.matched_student ? `${r.matched_student.full_name} (${r.matched_student.external_id})` : "—") },
            ]}
            rows={entriesQuery.data ?? []}
            rowKey={(r: EntryRow) => r.id}
            loading={entriesQuery.isLoading}
            emptyTitle="אין שורות"
          />

          {selectedImport.status === "committed" && (
            <div className="space-y-2 border-t border-line pt-4">
              <button onClick={() => setShowMissing((v) => !v)} className="link-action text-xs">
                {showMissing ? "הסתרת תלמידים חסרים ברשימה" : "הצגת תלמידים פעילים שלא הופיעו ברשימה (חסר)"}
              </button>
              {showMissing && (
                <DataTable
                  columns={[
                    { key: "id", header: "מזהה", className: "tabular ltr-num", render: (s: MissingStudent) => s.external_id },
                    { key: "name", header: "שם", render: (s: MissingStudent) => s.full_name },
                    { key: "phone", header: "טלפון במערכת", className: "tabular ltr-num", render: (s: MissingStudent) => s.phone_normalized },
                  ]}
                  rows={missingQuery.data ?? []}
                  rowKey={(s: MissingStudent) => s.student_id}
                  loading={missingQuery.isLoading}
                  emptyTitle="כל התלמידים הפעילים בעלי טלפון מופיעים ברשימה"
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
