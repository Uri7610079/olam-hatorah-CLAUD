import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Mail, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { Tabs } from "@/components/Tabs";
import { ErrorState } from "@/components/ErrorState";

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
  const [orgId, setOrgId] = useState("");
  const [error, setError] = useState<string | null>(null);

  // מסמכים
  const [showDocForm, setShowDocForm] = useState(false);
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
    setSavingDoc(true);
    setError(null);
    try {
      let filePath: string | null = null;
      if (docFile) {
        filePath = `${orgId}/${crypto.randomUUID()}-${docFile.name}`;
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
        external_link: docForm.external_link || null,
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
    await supabase.from("documents").update({ status: "archived" }).eq("id", id);
    queryClient.invalidateQueries({ queryKey: ["documents", orgId] });
  };

  const openDocument = async (path: string) => {
    const { data, error: err } = await supabase.storage.from("organization-documents").createSignedUrl(path, 60);
    if (!err && data) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
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
    await supabase.from("letters").update({ status: "archived" }).eq("id", selectedLetterId);
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
    { key: "issued", header: "הונפק", className: "tabular", render: (d) => d.issued_date ?? "—" },
    { key: "expiry", header: "תוקף", className: "tabular", render: (d) => (
      <span className="flex items-center gap-2">
        {d.expiry_date ?? "—"}
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
          {d.external_link && (
            <a href={d.external_link} target="_blank" rel="noopener noreferrer" className="link-action text-xs">
              קישור
            </a>
          )}
          {canManageDocs && d.status === "active" && (
            <button onClick={() => archiveDocument(d.id)} className="text-xs text-red-600 underline">
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
    { key: "sent", header: "נשלח", className: "tabular", render: (l) => l.sent_at ?? "—" },
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
        <label className="field-label">עמותה</label>
        <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className="input-field">
          <option value="">— בחרי —</option>
          {(orgsQuery.data ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.legal_name}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="mb-4"><ErrorState message={error} /></div>}

      {tab === "documents" && orgId && (
        <>
          {canManageDocs && (
            <div className="mb-4">
              <button onClick={() => setShowDocForm((v) => !v)} className="btn-primary">
                {showDocForm ? "סגירה" : "מסמך חדש"}
              </button>
            </div>
          )}

          {showDocForm && (
            <form onSubmit={submitDocument} className="card mb-6 max-w-2xl space-y-3 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="field-label">סוג מסמך</label>
                  <input required value={docForm.document_type} onChange={(e) => setDocForm((f) => ({ ...f, document_type: e.target.value }))} className="input-field" placeholder="רישיון עמותה, אישור ניהול תקין..." />
                </div>
                <div>
                  <label className="field-label">כותרת</label>
                  <input required value={docForm.title} onChange={(e) => setDocForm((f) => ({ ...f, title: e.target.value }))} className="input-field" />
                </div>
                <div>
                  <label className="field-label">תאריך הנפקה</label>
                  <input type="date" value={docForm.issued_date} onChange={(e) => setDocForm((f) => ({ ...f, issued_date: e.target.value }))} className="input-field" />
                </div>
                <div>
                  <label className="field-label">תוקף</label>
                  <input type="date" value={docForm.expiry_date} onChange={(e) => setDocForm((f) => ({ ...f, expiry_date: e.target.value }))} className="input-field" />
                </div>
                <div>
                  <label className="field-label">קובץ (פרטי)</label>
                  <input type="file" onChange={(e) => setDocFile(e.target.files?.[0] ?? null)} className="input-field" />
                </div>
                <div>
                  <label className="field-label">או קישור לתיקיית שיתוף</label>
                  <input value={docForm.external_link} onChange={(e) => setDocForm((f) => ({ ...f, external_link: e.target.value }))} className="input-field" placeholder="https://..." />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={docForm.is_sensitive} onChange={(e) => setDocForm((f) => ({ ...f, is_sensitive: e.target.checked }))} />
                מסמך רגיש (גישה מוגבלת)
              </label>
              <button type="submit" disabled={savingDoc} className="btn-primary">
                {savingDoc ? "שומרת…" : "שמירת מסמך"}
              </button>
            </form>
          )}

          <DataTable columns={documentColumns} rows={documentsQuery.data ?? []} rowKey={(d) => d.id} loading={documentsQuery.isLoading} emptyTitle="אין מסמכים" emptyIcon={FileText} />
        </>
      )}

      {tab === "letters" && orgId && (
        <>
          {canManageTemplates && (
            <div className="card mb-6 max-w-2xl space-y-3 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700">תבניות מכתבים</h2>
                <button onClick={() => setShowTemplateForm((v) => !v)} className="btn-secondary text-xs">
                  {showTemplateForm ? "סגירה" : "תבנית חדשה"}
                </button>
              </div>
              {showTemplateForm && (
                <form onSubmit={submitTemplate} className="space-y-2">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input required placeholder="מפתח (key)" value={templateForm.key} onChange={(e) => setTemplateForm((f) => ({ ...f, key: e.target.value }))} className="input-field" />
                    <input required placeholder="תיאור" value={templateForm.label_he} onChange={(e) => setTemplateForm((f) => ({ ...f, label_he: e.target.value }))} className="input-field" />
                  </div>
                  <input required placeholder="נוסח נושא" value={templateForm.subject_template} onChange={(e) => setTemplateForm((f) => ({ ...f, subject_template: e.target.value }))} className="input-field" />
                  <textarea required placeholder="נוסח גוף המכתב" value={templateForm.body_template} onChange={(e) => setTemplateForm((f) => ({ ...f, body_template: e.target.value }))} className="input-field" rows={4} />
                  <button type="submit" disabled={savingTemplate} className="btn-primary text-xs">
                    {savingTemplate ? "שומרת…" : "שמירת תבנית"}
                  </button>
                </form>
              )}
              <ul className="space-y-1 text-sm text-slate-600">
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
                <label className="field-label">תבנית (לא חובה)</label>
                <select value={letterForm.template_id} onChange={(e) => applyTemplate(e.target.value)} className="input-field">
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
                  <label className="field-label">נמען</label>
                  <input required value={letterForm.recipient_name} onChange={(e) => setLetterForm((f) => ({ ...f, recipient_name: e.target.value }))} className="input-field" />
                </div>
                <div>
                  <label className="field-label">פרטי קשר</label>
                  <input value={letterForm.recipient_details} onChange={(e) => setLetterForm((f) => ({ ...f, recipient_details: e.target.value }))} className="input-field" />
                </div>
              </div>
              <div>
                <label className="field-label">נושא</label>
                <input required value={letterForm.subject} onChange={(e) => setLetterForm((f) => ({ ...f, subject: e.target.value }))} className="input-field" />
              </div>
              <div>
                <label className="field-label">טיוטת נוסח</label>
                <textarea required value={letterForm.draft_body} onChange={(e) => setLetterForm((f) => ({ ...f, draft_body: e.target.value }))} className="input-field" rows={6} />
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
            loading={lettersQuery.isLoading}
            emptyTitle="אין מכתבים"
            emptyIcon={Mail}
            onRowClick={selectLetter}
          />

          {selectedLetter && canManageLetters && (
            <div className="card mt-4 max-w-2xl space-y-3 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700">
                  {selectedLetter.recipient_name} · {selectedLetter.subject}
                </h2>
                <StatusBadge severity={LETTER_STATUS_SEVERITY[selectedLetter.status]} label={LETTER_STATUS_LABEL[selectedLetter.status]} />
              </div>

              {selectedLetter.status === "draft" && (
                <>
                  <p className="flex items-start gap-2 text-xs text-amber-700">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    אישור אנושי חובה - יש לערוך את הנוסח הסופי ולאשר לפני שהמכתב ייחשב מוכן לשליחה.
                  </p>
                  <label className="field-label">נוסח סופי</label>
                  <textarea value={finalBodyDraft} onChange={(e) => setFinalBodyDraft(e.target.value)} className="input-field" rows={6} />
                  <button onClick={approveLetter} disabled={!finalBodyDraft.trim() || letterBusy} className="btn-primary text-xs">
                    {letterBusy ? "מאשרת…" : "אישור נוסח סופי"}
                  </button>
                </>
              )}

              {selectedLetter.status === "approved" && (
                <>
                  <p className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-700">{selectedLetter.final_body}</p>
                  <label className="field-label">אופן שליחה</label>
                  <div className="flex gap-2">
                    <input value={sendMethodDraft} onChange={(e) => setSendMethodDraft(e.target.value)} className="input-field" placeholder="דואר / מייל / פקס..." />
                    <button onClick={markSent} disabled={!sendMethodDraft.trim() || letterBusy} className="btn-primary text-xs shrink-0">
                      {letterBusy ? "מסמנת…" : "סימון כנשלח"}
                    </button>
                  </div>
                </>
              )}

              {selectedLetter.status === "sent" && (
                <>
                  <p className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-700">{selectedLetter.final_body}</p>
                  <p className="text-xs text-slate-500">נשלח {selectedLetter.sent_at} · {selectedLetter.send_method}</p>
                  <label className="field-label">רישום תשובה (לא חובה)</label>
                  <textarea value={responseNotesDraft} onChange={(e) => setResponseNotesDraft(e.target.value)} className="input-field" rows={3} />
                  <div className="flex gap-2">
                    <button onClick={recordResponse} disabled={letterBusy} className="btn-primary text-xs">
                      רישום תשובה
                    </button>
                    <button onClick={archiveLetter} className="text-xs text-slate-500 underline">
                      גניזה
                    </button>
                  </div>
                </>
              )}

              {selectedLetter.status === "answered" && (
                <>
                  <p className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-700">{selectedLetter.final_body}</p>
                  <p className="text-xs text-slate-500">נענה {selectedLetter.responded_at}: {selectedLetter.response_notes}</p>
                  <button onClick={archiveLetter} className="text-xs text-slate-500 underline">
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
