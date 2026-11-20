import { safeHttpUrl } from "@/lib/safeUrl";
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Mail, AlertTriangle, Download, FileSpreadsheet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { safeStorageKey } from "@/lib/storagePath";
import { useHasPermission } from "@/lib/permissions";
import { useLastSelected } from "@/lib/useLastSelected";
import { exportRowsToExcel, logReportExport } from "@/lib/reportExport";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { Tabs } from "@/components/Tabs";
import { ErrorState } from "@/components/ErrorState";
import { DocumentsImportPanel } from "./DocumentsImportPanel";
import { ActionsMenu } from "@/components/ActionsMenu";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useIsV3 } from "@/lib/uiTheme";
import { formatDate, formatNumber } from "@/lib/format";

interface OrgOption {
  id: string;
  legal_name: string;
}

interface DocumentRow {
  id: string;
  document_type: string;
  title: string;
  issued_date: string | null;
  expiry_date: string | null;
  version: number;
  file_path: string | null;
  external_link: string | null;
  is_sensitive: boolean;
  status: "active" | "archived";
}

type LetterStatus = "draft" | "approved" | "sent" | "answered" | "archived";

interface LetterTemplate {
  id: string;
  key: string;
  label_he: string;
  subject_template: string;
  body_template: string;
  is_active: boolean;
}

interface LetterRow {
  id: string;
  recipient_name: string;
  recipient_details: string | null;
  subject: string;
  draft_body: string;
  final_body: string | null;
  status: LetterStatus;
  send_method: string | null;
  sent_at: string | null;
  response_notes: string | null;
  responded_at: string | null;
}

const LETTER_STATUS_LABEL: Record<LetterStatus, string> = { draft: "טיוטה", approved: "מאושר", sent: "נשלח", answered: "נענה", archived: "נגנז" };
const LETTER_STATUS_SEVERITY: Record<LetterStatus, "neutral" | "medium" | "ok"> = { draft: "neutral", approved: "medium", sent: "ok", answered: "ok", archived: "neutral" };

// ימים עד התפוגה - אותו חישוב בדיוק כמו בתג שלמטה (משמש גם לספירה שבראש הרשימה ב-v3)
function daysToExpiry(expiryDate: string): number {
  const todayUtc = new Date(new Date().toLocaleDateString("en-CA"));
  return Math.round((new Date(expiryDate).getTime() - todayUtc.getTime()) / 86400000);
}

function expiryBadge(expiryDate: string | null) {
  if (!expiryDate) return null;
  // expiryDate ("YYYY-MM-DD") מפורש כ-UTC חצות - "היום" חייב להיות מפורש באותה שיטה
  // בדיוק, אחרת פער אזור הזמן המקומי (למשל UTC+3 בישראל) מזיז את הספירה ביום שלם.
  const todayUtc = new Date(new Date().toLocaleDateString("en-CA"));
  const days = Math.round((new Date(expiryDate).getTime() - todayUtc.getTime()) / 86400000);
  if (days < 0) return <StatusBadge severity="critical" label="פג תוקף" />;
  if (days <= 7) return <StatusBadge severity="critical" label={`פג בעוד ${days} ימים`} />;
  if (days <= 14) return <StatusBadge severity="high" label={`פג בעוד ${days} ימים`} />;
  if (days <= 30) return <StatusBadge severity="medium" label={`פג בעוד ${days} ימים`} />;
  return null;
}

async function fetchOrgs(): Promise<OrgOption[]> {
  const { data, error } = await supabase.from("organizations").select("id, legal_name").eq("status", "active").order("legal_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchDocuments(orgId: string): Promise<DocumentRow[]> {
  const { data, error } = await supabase
    .from("documents")
    .select("id, document_type, title, issued_date, expiry_date, version, file_path, external_link, is_sensitive, status")
    .eq("organization_id", orgId)
    .order("expiry_date", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

async function fetchTemplates(): Promise<LetterTemplate[]> {
  const { data, error } = await supabase.from("letter_templates").select("id, key, label_he, subject_template, body_template, is_active").order("label_he");
  if (error) throw error;
  return data ?? [];
}

async function fetchLetters(orgId: string): Promise<LetterRow[]> {
  const { data, error } = await supabase
    .from("letters")
    .select("id, recipient_name, recipient_details, subject, draft_body, final_body, status, send_method, sent_at, response_notes, responded_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export function DocumentsScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canManageDocs } = useHasPermission("documents", "manage");
  const { hasPermission: canManageLetters } = useHasPermission("letters", "manage");
  const { hasPermission: canManageTemplates } = useHasPermission("letter_templates", "manage");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });

  const [tab, setTab] = useState<"documents" | "letters">("documents");
  const [orgId, setOrgId] = useLastSelected<string>("last-org", "");
  const [error, setError] = useState<string | null>(null);

  // מסמכים
  const [showDocForm, setShowDocForm] = useState(false);
  const [showDocImport, setShowDocImport] = useState(false);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docForm, setDocForm] = useState({ document_type: "", title: "", issued_date: "", expiry_date: "", external_link: "", is_sensitive: false });
  const [savingDoc, setSavingDoc] = useState(false);

  // מכתבים
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [templateForm, setTemplateForm] = useState({ key: "", label_he: "", subject_template: "", body_template: "" });
  const [savingTemplate, setSavingTemplate] = useState(false);

  const [showLetterForm, setShowLetterForm] = useState(false);
  const [letterForm, setLetterForm] = useState({ template_id: "", recipient_name: "", recipient_details: "", subject: "", draft_body: "" });
  const [savingLetter, setSavingLetter] = useState(false);
  const [selectedLetterId, setSelectedLetterId] = useState<string | null>(null);
  const [finalBodyDraft, setFinalBodyDraft] = useState("");
  const [sendMethodDraft, setSendMethodDraft] = useState("");
  const [responseNotesDraft, setResponseNotesDraft] = useState("");
  const [letterBusy, setLetterBusy] = useState(false);
  const isV3 = useIsV3();
  // גניזה - אין במסך דרך להחזיר, ולכן מאשרים קודם
  const [confirmArchiveDoc, setConfirmArchiveDoc] = useState<DocumentRow | null>(null);
  const [confirmArchiveLetter, setConfirmArchiveLetter] = useState(false);

  const documentsQuery = useQuery({ queryKey: ["documents", orgId], queryFn: () => fetchDocuments(orgId), enabled: !!orgId && tab === "documents" });
  const templatesQuery = useQuery({ queryKey: ["letter-templates"], queryFn: fetchTemplates, enabled: tab === "letters" });
  const lettersQuery = useQuery({ queryKey: ["letters", orgId], queryFn: () => fetchLetters(orgId), enabled: !!orgId && tab === "letters" });

  const selectedLetter = lettersQuery.data?.find((l) => l.id === selectedLetterId) ?? null;

  const submitDocument = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId || !docForm.document_type.trim() || !docForm.title.trim()) return;
    if (!docFile && !docForm.external_link.trim()) {
      setError("יש לצרף קובץ או להזין קישור לתיקיית שיתוף");
      return;
    }
    if (docForm.external_link.trim() && !safeHttpUrl(docForm.external_link)) {
      setError("הקישור צריך להתחיל ב-https:// (או http://).");
      return;
    }
    setSavingDoc(true);
    setError(null);
    try {
      let filePath: string | null = null;
      if (docFile) {
        filePath = `${orgId}/${safeStorageKey(docFile.name)}`;
        const { error: uploadError } = await supabase.storage.from("organization-documents").upload(filePath, docFile);
        if (uploadError) throw new Error(`העלאת הקובץ נכשלה: ${uploadError.message}`);
      }
      const { error: err } = await supabase.from("documents").insert({
        organization_id: orgId,
        document_type: docForm.document_type,
        title: docForm.title,
        issued_date: docForm.issued_date || null,
        expiry_date: docForm.expiry_date || null,
        file_path: filePath,
        external_link: safeHttpUrl(docForm.external_link),
        is_sensitive: docForm.is_sensitive,
      });
      if (err) throw new Error(err.message);
      setDocForm({ document_type: "", title: "", issued_date: "", expiry_date: "", external_link: "", is_sensitive: false });
      setDocFile(null);
      setShowDocForm(false);
      queryClient.invalidateQueries({ queryKey: ["documents", orgId] });
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "שגיאה לא צפויה");
    } finally {
      setSavingDoc(false);
    }
  };

  const archiveDocument = async (id: string) => {
    const { error: err } = await supabase.from("documents").update({ status: "archived" }).eq("id", id);
    // עד היום כשל כאן נבלע בשקט
    if (err) setError(`גניזת המסמך נכשלה: ${err.message}`);
    queryClient.invalidateQueries({ queryKey: ["documents", orgId] });
  };

  const openDocument = async (path: string) => {
    const { data, error: err } = await supabase.storage.from("organization-documents").createSignedUrl(path, 60);
    if (!err && data) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    // עד היום כשל בפתיחת הקובץ נבלע בשקט - הלחיצה פשוט לא עשתה כלום
    else setError(`פתיחת הקובץ נכשלה${err ? `: ${err.message}` : ""}`);
  };

  // ייצוא מטא-דאטה בלבד (כותרת/סוג/תאריכים/קישור) - לעולם לא תוכן הקובץ עצמו, גם אם
  // file_path קיים (מסמכים אישיים לא נשלחים כקובץ בתוך גיליון האקסל).
  const exportDocuments = async () => {
    const rows = documentsQuery.data ?? [];
    exportRowsToExcel(
      rows.map((d) => ({
        "סוג מסמך": d.document_type,
        כותרת: d.title,
        "תאריך הנפקה": d.issued_date ?? "",
        "תאריך תפוגה": d.expiry_date ?? "",
        "קישור חיצוני": d.external_link ?? "",
        רגיש: d.is_sensitive ? "כן" : "לא",
        סטטוס: d.status === "active" ? "פעיל" : "נגנז",
      })),
      "מסמכים",
      "מסמכים.xlsx",
    );
    await logReportExport("documents", { organization_id: orgId }, rows.length);
  };

  const submitTemplate = async (e: FormEvent) => {
    e.preventDefault();
    setSavingTemplate(true);
    setError(null);
    const { error: err } = await supabase.from("letter_templates").insert(templateForm);
    setSavingTemplate(false);
    if (err) {
      setError(err.message);
      return;
    }
    setTemplateForm({ key: "", label_he: "", subject_template: "", body_template: "" });
    setShowTemplateForm(false);
    queryClient.invalidateQueries({ queryKey: ["letter-templates"] });
  };

  const applyTemplate = (templateId: string) => {
    const t = templatesQuery.data?.find((x) => x.id === templateId);
    setLetterForm((f) => ({ ...f, template_id: templateId, subject: t?.subject_template ?? f.subject, draft_body: t?.body_template ?? f.draft_body }));
  };

  const submitLetter = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId || !letterForm.recipient_name.trim() || !letterForm.subject.trim() || !letterForm.draft_body.trim()) return;
    setSavingLetter(true);
    setError(null);
    const { error: err } = await supabase.from("letters").insert({
      organization_id: orgId,
      template_id: letterForm.template_id || null,
      recipient_name: letterForm.recipient_name,
      recipient_details: letterForm.recipient_details || null,
      subject: letterForm.subject,
      draft_body: letterForm.draft_body,
    });
    setSavingLetter(false);
    if (err) {
      setError(err.message);
      return;
    }
    setLetterForm({ template_id: "", recipient_name: "", recipient_details: "", subject: "", draft_body: "" });
    setShowLetterForm(false);
    queryClient.invalidateQueries({ queryKey: ["letters", orgId] });
  };

  const selectLetter = (l: LetterRow) => {
    setSelectedLetterId(l.id === selectedLetterId ? null : l.id);
    setFinalBodyDraft(l.final_body ?? l.draft_body);
    setSendMethodDraft(l.send_method ?? "");
    setResponseNotesDraft(l.response_notes ?? "");
  };

  const approveLetter = async () => {
    if (!selectedLetterId || !finalBodyDraft.trim()) return;
    setLetterBusy(true);
    setError(null);
    const { error: err } = await supabase.from("letters").update({ final_body: finalBodyDraft, status: "approved" }).eq("id", selectedLetterId);
    setLetterBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["letters", orgId] });
  };

  const markSent = async () => {
    if (!selectedLetterId || !sendMethodDraft.trim()) return;
    setLetterBusy(true);
    setError(null);
    const { error: err } = await supabase.from("letters").update({ status: "sent", send_method: sendMethodDraft }).eq("id", selectedLetterId);
    setLetterBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["letters", orgId] });
  };

  const recordResponse = async () => {
    if (!selectedLetterId) return;
    setLetterBusy(true);
    setError(null);
    const { error: err } = await supabase.from("letters").update({ status: "answered", response_notes: responseNotesDraft || null }).eq("id", selectedLetterId);
    setLetterBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["letters", orgId] });
  };

  const archiveLetter = async () => {
    if (!selectedLetterId) return;
    const { error: err } = await supabase.from("letters").update({ status: "archived" }).eq("id", selectedLetterId);
    if (err) setError(`גניזת המכתב נכשלה: ${err.message}`);
    queryClient.invalidateQueries({ queryKey: ["letters", orgId] });
  };

  const documentColumns: DataTableColumn<DocumentRow>[] = [
    { key: "type", header: "סוג", render: (d) => d.document_type },
    { key: "title", header: "כותרת", render: (d) => (
      <span className="flex items-center gap-2">
        {d.title}
        {d.is_sensitive && <StatusBadge severity="high" label="רגיש" />}
      </span>
    ) },
    { key: "issued", header: "הונפק", className: "tabular", sortValue: isV3 ? (d) => d.issued_date : undefined, render: (d) => (isV3 ? formatDate(d.issued_date) : d.issued_date ?? "—") },
    { key: "expiry", header: "תוקף", className: "tabular", sortValue: isV3 ? (d) => d.expiry_date : undefined, render: (d) => (
      <span className="flex items-center gap-2">
        {isV3 ? formatDate(d.expiry_date) : d.expiry_date ?? "—"}
        {d.status === "active" && expiryBadge(d.expiry_date)}
      </span>
    ) },
    { key: "status", header: "סטטוס", render: (d) => <StatusBadge severity={d.status === "active" ? "ok" : "neutral"} label={d.status === "active" ? "פעיל" : "נגנז"} /> },
    {
      key: "actions",
      header: "",
      render: (d) => (
        <div className="flex gap-2">
          {d.file_path && (
            <button onClick={() => openDocument(d.file_path!)} className="link-action text-xs">
              פתיחת קובץ
            </button>
          )}
          {d.external_link && (safeHttpUrl(d.external_link) ? (
            <a href={safeHttpUrl(d.external_link)!} target="_blank" rel="noopener noreferrer" className="link-action text-xs">
              קישור
            </a>
          ) : (
            <span className="text-xs text-ink-subtle" title={d.external_link}>קישור לא תקין</span>
          ))}
          {canManageDocs && d.status === "active" && (
            <button onClick={() => setConfirmArchiveDoc(d)} className="text-xs text-danger underline">
              גניזה
            </button>
          )}
        </div>
      ),
    },
  ];

  const letterColumns: DataTableColumn<LetterRow>[] = [
    { key: "recipient", header: "נמען", render: (l) => l.recipient_name },
    { key: "subject", header: "נושא", render: (l) => l.subject },
    { key: "status", header: "סטטוס", render: (l) => <StatusBadge severity={LETTER_STATUS_SEVERITY[l.status]} label={LETTER_STATUS_LABEL[l.status]} /> },
    { key: "sent", header: "נשלח", className: "tabular", sortValue: isV3 ? (l) => l.sent_at : undefined, render: (l) => (isV3 ? formatDate(l.sent_at) : l.sent_at ?? "—") },
    { key: "method", header: "אופן שליחה", render: (l) => l.send_method ?? "—" },
  ];

  return (
    <div>
      <PageHeader
        title="מסמכים ומכתבים"
        description="מסמכי עמותה עם התראות תפוגה, ותבניות/מכתבים עם אישור אנושי חובה לפני שליחה. אין שליחה אוטומטית ואין חיבור דוא״ל - סימון 'נשלח' הוא ידני לאחר שליחה בפועל מחוץ למערכת."
      />

      <Tabs
        tabs={[
          { key: "documents", label: "מסמכים" },
          { key: "letters", label: "מכתבים" },
        ]}
        activeTab={tab}
        onChange={setTab}
        ariaLabel="מסמכים ומכתבים"
      />

      <div className="mb-4 max-w-sm">
        <label htmlFor="doc-1" className="field-label">עמותה</label>
        <select id="doc-1" value={orgId} onChange={(e) => setOrgId(e.target.value)} className="input-field">
          <option value="">— בחרי —</option>
          {(orgsQuery.data ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.legal_name}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="mb-4"><ErrorState message={error} /></div>}

      <ConfirmDialog
        open={!!confirmArchiveDoc}
        title="לגנוז את המסמך?"
        description={confirmArchiveDoc ? `"${confirmArchiveDoc.title}" יסומן כנגנז ולא יופיעו לו עוד התראות תפוגה. אין במסך הזה דרך להחזיר אותו לפעיל.` : undefined}
        confirmLabel="גניזה"
        danger
        onCancel={() => setConfirmArchiveDoc(null)}
        onConfirm={() => {
          const d = confirmArchiveDoc;
          setConfirmArchiveDoc(null);
          if (d) void archiveDocument(d.id);
        }}
      />
      <ConfirmDialog
        open={confirmArchiveLetter}
        title="לגנוז את המכתב?"
        description="המכתב יסומן כנגנז. אין במסך הזה דרך להחזיר אותו."
        confirmLabel="גניזה"
        danger
        onCancel={() => setConfirmArchiveLetter(false)}
        onConfirm={() => {
          setConfirmArchiveLetter(false);
          void archiveLetter();
        }}
      />

      {tab === "documents" && orgId && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {canManageDocs && (
              <button onClick={() => setShowDocForm((v) => !v)} className="btn-primary">
                {showDocForm ? "סגירה" : "מסמך חדש"}
              </button>
            )}
            {/* v3: מסמך חדש - הפעולה הראשית; יבוא וייצוא בתפריט */}
            {isV3 ? (
              <ActionsMenu
                actions={[
                  ...(canManageDocs
                    ? [{ key: "import", label: showDocImport ? "סגירת יבוא" : "יבוא מסמכים מאקסל", icon: FileSpreadsheet, onSelect: () => setShowDocImport((v) => !v) }]
                    : []),
                  { key: "export", label: "ייצוא לאקסל", icon: Download, disabled: !documentsQuery.data?.length, onSelect: () => void exportDocuments() },
                ]}
              />
            ) : (
              <>
                {canManageDocs && (
                  <button onClick={() => setShowDocImport((v) => !v)} className="btn-secondary flex items-center gap-2 text-xs">
                    <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
                    {showDocImport ? "סגירת יבוא" : "יבוא מסמכים מאקסל"}
                  </button>
                )}
                <button onClick={exportDocuments} disabled={!documentsQuery.data?.length} className="btn-secondary flex items-center gap-2 text-xs disabled:opacity-50">
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  ייצוא לאקסל
                </button>
              </>
            )}
          </div>

          {/* v3: כמה מסמכים פעילים פגו או יפוגו בקרוב - מהרשימה שכבר נטענה, באותו חישוב של התג בטבלה */}
          {isV3 && (() => {
            const active = (documentsQuery.data ?? []).filter((d) => d.status === "active" && d.expiry_date);
            const expired = active.filter((d) => daysToExpiry(d.expiry_date!) < 0).length;
            const soon = active.filter((d) => {
              const n = daysToExpiry(d.expiry_date!);
              return n >= 0 && n <= 30;
            }).length;
            if (!expired && !soon) return null;
            return (
              <p className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-control border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn-ink">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {expired > 0 && <span><span className="tabular font-semibold">{formatNumber(expired)}</span> מסמכים פגו</span>}
                {soon > 0 && <span><span className="tabular font-semibold">{formatNumber(soon)}</span> יפוגו ב-30 הימים הקרובים</span>}
              </p>
            );
          })()}

          {showDocImport && <DocumentsImportPanel orgId={orgId} />}

          {showDocForm && (
            <form onSubmit={submitDocument} className="card mb-6 max-w-2xl space-y-3 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="doc-2" className="field-label">סוג מסמך</label>
                  <input id="doc-2" required value={docForm.document_type} onChange={(e) => setDocForm((f) => ({ ...f, document_type: e.target.value }))} className="input-field" placeholder="רישיון עמותה, אישור ניהול תקין..." />
                </div>
                <div>
                  <label htmlFor="doc-3" className="field-label">כותרת</label>
                  <input id="doc-3" required value={docForm.title} onChange={(e) => setDocForm((f) => ({ ...f, title: e.target.value }))} className="input-field" />
                </div>
                <div>
                  <label htmlFor="doc-4" className="field-label">תאריך הנפקה</label>
                  <input id="doc-4" type="date" value={docForm.issued_date} onChange={(e) => setDocForm((f) => ({ ...f, issued_date: e.target.value }))} className="input-field" />
                </div>
                <div>
                  <label htmlFor="doc-5" className="field-label">תוקף</label>
                  <input id="doc-5" type="date" value={docForm.expiry_date} onChange={(e) => setDocForm((f) => ({ ...f, expiry_date: e.target.value }))} className="input-field" />
                </div>
                <div>
                  <label htmlFor="doc-6" className="field-label">קובץ (פרטי)</label>
                  <input id="doc-6" type="file" onChange={(e) => setDocFile(e.target.files?.[0] ?? null)} className="input-field" />
                </div>
                <div>
                  <label htmlFor="doc-7" className="field-label">או קישור לתיקיית שיתוף</label>
                  <input id="doc-7" value={docForm.external_link} onChange={(e) => setDocForm((f) => ({ ...f, external_link: e.target.value }))} className="input-field" placeholder="https://..." />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-ink-muted">
                <input type="checkbox" checked={docForm.is_sensitive} onChange={(e) => setDocForm((f) => ({ ...f, is_sensitive: e.target.checked }))} />
                מסמך רגיש (גישה מוגבלת)
              </label>
              <button type="submit" disabled={savingDoc} className="btn-primary">
                {savingDoc ? "שומרת…" : "שמירת מסמך"}
              </button>
            </form>
          )}

          <DataTable columns={documentColumns} rows={documentsQuery.data ?? []} rowKey={(d) => d.id} loading={documentsQuery.isLoading} error={documentsQuery.error} onRetry={() => documentsQuery.refetch()} emptyTitle="אין מסמכים" emptyIcon={FileText} />
        </>
      )}

      {tab === "letters" && orgId && (
        <>
          {canManageTemplates && (
            <div className="card mb-6 max-w-2xl space-y-3 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink-muted">תבניות מכתבים</h2>
                <button onClick={() => setShowTemplateForm((v) => !v)} className="btn-secondary text-xs">
                  {showTemplateForm ? "סגירה" : "תבנית חדשה"}
                </button>
              </div>
              {showTemplateForm && (
                <form onSubmit={submitTemplate} className="space-y-2">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input required placeholder="מפתח (key)" aria-label="מפתח התבנית" value={templateForm.key} onChange={(e) => setTemplateForm((f) => ({ ...f, key: e.target.value }))} className="input-field" />
                    <input required placeholder="תיאור" aria-label="תיאור התבנית" value={templateForm.label_he} onChange={(e) => setTemplateForm((f) => ({ ...f, label_he: e.target.value }))} className="input-field" />
                  </div>
                  <input required placeholder="נוסח נושא" aria-label="נוסח נושא" value={templateForm.subject_template} onChange={(e) => setTemplateForm((f) => ({ ...f, subject_template: e.target.value }))} className="input-field" />
                  <textarea required placeholder="נוסח גוף המכתב" aria-label="נוסח גוף המכתב" value={templateForm.body_template} onChange={(e) => setTemplateForm((f) => ({ ...f, body_template: e.target.value }))} className="input-field" rows={4} />
                  <button type="submit" disabled={savingTemplate} className="btn-primary text-xs">
                    {savingTemplate ? "שומרת…" : "שמירת תבנית"}
                  </button>
                </form>
              )}
              <ul className="space-y-1 text-sm text-ink-muted">
                {(templatesQuery.data ?? []).map((t) => (
                  <li key={t.id}>{t.label_he}</li>
                ))}
              </ul>
            </div>
          )}

          {canManageLetters && (
            <div className="mb-4">
              <button onClick={() => setShowLetterForm((v) => !v)} className="btn-primary">
                {showLetterForm ? "סגירה" : "מכתב חדש"}
              </button>
            </div>
          )}

          {showLetterForm && (
            <form onSubmit={submitLetter} className="card mb-6 max-w-2xl space-y-3 p-4">
              <div>
                <label htmlFor="doc-8" className="field-label">תבנית (לא חובה)</label>
                <select id="doc-8" value={letterForm.template_id} onChange={(e) => applyTemplate(e.target.value)} className="input-field">
                  <option value="">— ללא תבנית —</option>
                  {(templatesQuery.data ?? []).filter((t) => t.is_active).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label_he}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="doc-9" className="field-label">נמען</label>
                  <input id="doc-9" required value={letterForm.recipient_name} onChange={(e) => setLetterForm((f) => ({ ...f, recipient_name: e.target.value }))} className="input-field" />
                </div>
                <div>
                  <label htmlFor="doc-10" className="field-label">פרטי קשר</label>
                  <input id="doc-10" value={letterForm.recipient_details} onChange={(e) => setLetterForm((f) => ({ ...f, recipient_details: e.target.value }))} className="input-field" />
                </div>
              </div>
              <div>
                <label htmlFor="doc-11" className="field-label">נושא</label>
                <input id="doc-11" required value={letterForm.subject} onChange={(e) => setLetterForm((f) => ({ ...f, subject: e.target.value }))} className="input-field" />
              </div>
              <div>
                <label htmlFor="doc-draft" className="field-label">טיוטת נוסח</label>
                <textarea id="doc-draft" required value={letterForm.draft_body} onChange={(e) => setLetterForm((f) => ({ ...f, draft_body: e.target.value }))} className="input-field" rows={6} />
              </div>
              <button type="submit" disabled={savingLetter} className="btn-primary">
                {savingLetter ? "שומרת…" : "שמירת טיוטה"}
              </button>
            </form>
          )}

          <DataTable
            columns={letterColumns}
            rows={lettersQuery.data ?? []}
            rowKey={(l) => l.id}
            loading={lettersQuery.isLoading} error={lettersQuery.error} onRetry={() => lettersQuery.refetch()}
            emptyTitle="אין מכתבים"
            emptyIcon={Mail}
            onRowClick={selectLetter}
          />

          {selectedLetter && canManageLetters && (
            <div className="card mt-4 max-w-2xl space-y-3 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink-muted">
                  {selectedLetter.recipient_name} · {selectedLetter.subject}
                </h2>
                <StatusBadge severity={LETTER_STATUS_SEVERITY[selectedLetter.status]} label={LETTER_STATUS_LABEL[selectedLetter.status]} />
              </div>

              {selectedLetter.status === "draft" && (
                <>
                  <p className="flex items-start gap-2 text-xs text-warn-ink">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    אישור אנושי חובה - יש לערוך את הנוסח הסופי ולאשר לפני שהמכתב ייחשב מוכן לשליחה.
                  </p>
                  <label htmlFor="doc-final" className="field-label">נוסח סופי</label>
                  <textarea id="doc-final" value={finalBodyDraft} onChange={(e) => setFinalBodyDraft(e.target.value)} className="input-field" rows={6} />
                  <button onClick={approveLetter} disabled={!finalBodyDraft.trim() || letterBusy} className="btn-primary text-xs">
                    {letterBusy ? "מאשרת…" : "אישור נוסח סופי"}
                  </button>
                </>
              )}

              {selectedLetter.status === "approved" && (
                <>
                  <p className="whitespace-pre-wrap rounded-md bg-surface-muted p-3 text-sm text-ink-muted">{selectedLetter.final_body}</p>
                  <label htmlFor="doc-send-method" className="field-label">אופן שליחה</label>
                  <div className="flex gap-2">
                    <input id="doc-send-method" value={sendMethodDraft} onChange={(e) => setSendMethodDraft(e.target.value)} className="input-field" placeholder="דואר / מייל / פקס..." />
                    <button onClick={markSent} disabled={!sendMethodDraft.trim() || letterBusy} className="btn-primary text-xs shrink-0">
                      {letterBusy ? "מסמנת…" : "סימון כנשלח"}
                    </button>
                  </div>
                </>
              )}

              {selectedLetter.status === "sent" && (
                <>
                  <p className="whitespace-pre-wrap rounded-md bg-surface-muted p-3 text-sm text-ink-muted">{selectedLetter.final_body}</p>
                  <p className="text-xs text-ink-subtle">נשלח {isV3 ? formatDate(selectedLetter.sent_at) : selectedLetter.sent_at} · {selectedLetter.send_method}</p>
                  <label htmlFor="doc-response" className="field-label">רישום תשובה (לא חובה)</label>
                  <textarea id="doc-response" value={responseNotesDraft} onChange={(e) => setResponseNotesDraft(e.target.value)} className="input-field" rows={3} />
                  <div className="flex gap-2">
                    <button onClick={recordResponse} disabled={letterBusy} className="btn-primary text-xs">
                      רישום תשובה
                    </button>
                    <button onClick={() => setConfirmArchiveLetter(true)} className="text-xs text-ink-subtle underline">
                      גניזה
                    </button>
                  </div>
                </>
              )}

              {selectedLetter.status === "answered" && (
                <>
                  <p className="whitespace-pre-wrap rounded-md bg-surface-muted p-3 text-sm text-ink-muted">{selectedLetter.final_body}</p>
                  <p className="text-xs text-ink-subtle">נענה {isV3 ? formatDate(selectedLetter.responded_at) : selectedLetter.responded_at}: {selectedLetter.response_notes}</p>
                  <button onClick={() => setConfirmArchiveLetter(true)} className="text-xs text-ink-subtle underline">
                    גניזה
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
