import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Paperclip } from "lucide-react";
import { PhoneField } from "@/components/PhoneField";
import { StatusBadge } from "@/components/StatusBadge";
import { israeliIdWarning } from "@/lib/israeliId";
import { ELIGIBILITY, ID_TYPE_LABEL, monthLabel } from "@/lib/portalRequests";
import { fileToBase64, portalRpc, type PortalStudent } from "./portalApi";

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        dir="rtl"
        className="card my-6 w-full max-w-2xl p-6 text-[17px]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <h2 className="text-2xl font-bold">{title}</h2>
          <button onClick={onClose} aria-label="סגירה" className="rounded-control p-2 text-ink-subtle hover:bg-surface-muted">
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-5">
      <h3 className="text-lg font-bold">{title}</h3>
      {hint && <p className="mb-3 text-sm text-ink-muted">{hint}</p>}
      {children}
    </section>
  );
}

export function Feedback({ error, done }: { error?: string | null; done?: string | null }) {
  if (error) return <p role="alert" className="mt-3 rounded-control bg-danger-soft p-3 text-base text-danger-ink">{error}</p>;
  if (done) return <p role="status" className="mt-3 rounded-control bg-ok-soft p-3 text-base text-ok-ink">{done}</p>;
  return null;
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : "הפעולה נכשלה");

// ===== תלמיד: פרטים, טלפון וכתובת, שם ות.ז, עזיבה =====
export function StudentDialog({ student, month, onClose, onAsk }: {
  student: PortalStudent; month: string; onClose: () => void; onAsk: () => void;
}) {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["portal-students"] });
    qc.invalidateQueries({ queryKey: ["portal-requests"] });
  };
  const el = ELIGIBILITY[student.eligibility];

  // טלפון וכתובת - נכנס מיד
  const [contact, setContact] = useState({
    phone: student.phone ?? "", street: student.address_street ?? "",
    house: student.address_house_number ?? "", city: student.address_city ?? "",
  });
  const saveContact = useMutation({
    mutationFn: () => portalRpc<{ changed: boolean }>("portal_update_contact", {
      p_student_id: student.student_id, p_phone: contact.phone, p_street: contact.street,
      p_house_number: contact.house, p_city: contact.city,
    }),
    onSuccess: refresh,
  });

  // שם ות.ז - באישור המשרד
  const [identity, setIdentity] = useState({ name: student.full_name, idType: student.id_type, id: student.external_id });
  const idWarning = israeliIdWarning(identity.id, identity.idType as "israeli_id");
  const sendIdentity = useMutation({
    mutationFn: () => portalRpc("portal_request_identity", {
      p_student_id: student.student_id, p_full_name: identity.name, p_external_id: identity.id, p_id_type: identity.idType,
    }),
    onSuccess: refresh,
  });

  // עזיבה - באישור המשרד
  const [left, setLeft] = useState({ date: new Date().toISOString().slice(0, 10), reason: "" });
  const [confirmLeft, setConfirmLeft] = useState(false);
  const sendLeft = useMutation({
    mutationFn: () => portalRpc("portal_request_student_left", {
      p_student_id: student.student_id, p_exit_date: left.date, p_reason: left.reason,
    }),
    onSuccess: refresh,
  });

  return (
    <Dialog title={student.full_name} onClose={onClose}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="tabular-nums text-ink-muted">{ID_TYPE_LABEL[student.id_type] ?? "מזהה"}: {student.external_id}</span>
          <span className="text-ink-muted">· {student.group_name}</span>
          <span className="ms-auto flex items-center gap-2 text-sm text-ink-muted">
            {monthLabel(month)}:
            <StatusBadge severity={el.severity} label={el.label} />
          </span>
        </div>
        {student.eligibility === "not_eligible" && (
          <p className="rounded-control bg-danger-soft p-3 text-base text-danger-ink">
            הסיבה: {student.reasons.length ? student.reasons.join(" · ") : "טרם התקבלה מתלמוד"}
          </p>
        )}
        <button onClick={onAsk} className="btn-secondary h-11 px-4 text-base">שאלה למשרד על התלמיד</button>

        <Section title="טלפון וכתובת" hint="נשמר מיד, בלי אישור.">
          <form
            onSubmit={(e) => { e.preventDefault(); saveContact.mutate(); }}
            className="grid gap-3 sm:grid-cols-2"
          >
            <PhoneField id="st-phone" label="טלפון" value={contact.phone} onChange={(v) => setContact((c) => ({ ...c, phone: v }))} />
            <div>
              <label htmlFor="st-city" className="field-label">עיר</label>
              <input id="st-city" value={contact.city} onChange={(e) => setContact((c) => ({ ...c, city: e.target.value }))} className="input-field h-11 text-base" />
            </div>
            <div>
              <label htmlFor="st-street" className="field-label">רחוב</label>
              <input id="st-street" value={contact.street} onChange={(e) => setContact((c) => ({ ...c, street: e.target.value }))} className="input-field h-11 text-base" />
            </div>
            <div>
              <label htmlFor="st-house" className="field-label">מספר בית</label>
              <input id="st-house" value={contact.house} onChange={(e) => setContact((c) => ({ ...c, house: e.target.value }))} className="input-field h-11 text-base" />
            </div>
            <div className="sm:col-span-2">
              <button type="submit" disabled={saveContact.isPending} className="btn-primary h-11 px-6 text-base">
                {saveContact.isPending ? "שומר…" : "שמירה"}
              </button>
              <Feedback
                error={saveContact.isError ? errText(saveContact.error) : null}
                done={saveContact.isSuccess ? (saveContact.data?.changed ? "נשמר." : "לא שונה דבר.") : null}
              />
            </div>
          </form>
        </Section>

        <Section title="שם ותעודת זהות" hint="שינוי נשלח למשרד, ונכנס אחרי אישור.">
          <form
            onSubmit={(e) => { e.preventDefault(); sendIdentity.mutate(); }}
            className="grid gap-3 sm:grid-cols-3"
          >
            <div className="sm:col-span-3">
              <label htmlFor="st-name" className="field-label">שם מלא</label>
              <input id="st-name" value={identity.name} onChange={(e) => setIdentity((v) => ({ ...v, name: e.target.value }))} className="input-field h-11 text-base" />
            </div>
            <div>
              <label htmlFor="st-idtype" className="field-label">סוג מזהה</label>
              <select id="st-idtype" value={identity.idType} onChange={(e) => setIdentity((v) => ({ ...v, idType: e.target.value }))} className="input-field h-11 text-base">
                {Object.entries(ID_TYPE_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="st-id" className="field-label">מספר</label>
              <input id="st-id" dir="ltr" value={identity.id} onChange={(e) => setIdentity((v) => ({ ...v, id: e.target.value }))} className="input-field h-11 text-right text-base tabular-nums" />
              {idWarning && <p className="mt-1 text-sm text-warn-ink">{idWarning}</p>}
            </div>
            <div className="sm:col-span-3">
              <button type="submit" disabled={sendIdentity.isPending || sendIdentity.isSuccess} className="btn-secondary h-11 px-5 text-base">
                {sendIdentity.isPending ? "שולח…" : "שליחה לאישור המשרד"}
              </button>
              <Feedback
                error={sendIdentity.isError ? errText(sendIdentity.error) : null}
                done={sendIdentity.isSuccess ? "נשלח. התיקון ייכנס אחרי אישור המשרד." : null}
              />
            </div>
          </form>
        </Section>

        <Section title="התלמיד עזב" hint="נשלח למשרד. אחרי האישור התלמיד יורד מהרשימה.">
          {sendLeft.isSuccess ? (
            <Feedback done="נשלח למשרד לאישור." />
          ) : !confirmLeft ? (
            <button onClick={() => setConfirmLeft(true)} className="btn-secondary h-11 px-5 text-base">דיווח שהתלמיד עזב</button>
          ) : (
            <form onSubmit={(e: FormEvent) => { e.preventDefault(); sendLeft.mutate(); }} className="grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="st-left-date" className="field-label">מתאריך</label>
                <input id="st-left-date" type="date" required value={left.date} onChange={(e) => setLeft((v) => ({ ...v, date: e.target.value }))} className="input-field h-11 text-base" />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="st-left-reason" className="field-label">סיבה (לא חובה)</label>
                <input id="st-left-reason" value={left.reason} onChange={(e) => setLeft((v) => ({ ...v, reason: e.target.value }))} className="input-field h-11 text-base" placeholder="עבר לישיבה אחרת" />
              </div>
              <div className="flex gap-2 sm:col-span-3">
                <button type="submit" disabled={sendLeft.isPending} className="btn-danger h-11 px-5 text-base">
                  {sendLeft.isPending ? "שולח…" : "שליחה לאישור המשרד"}
                </button>
                <button type="button" onClick={() => setConfirmLeft(false)} className="btn-secondary h-11 px-5 text-base">ביטול</button>
              </div>
              <div className="sm:col-span-3"><Feedback error={sendLeft.isError ? errText(sendLeft.error) : null} /></div>
            </form>
          )}
        </Section>
      </div>
    </Dialog>
  );
}

// ===== שאלה למשרד: כללית, או על תלמיד =====
export function AskDialog({ student, month, onClose, onSent }: {
  student?: PortalStudent; month?: string; onClose: () => void; onSent?: () => void;
}) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const send = useMutation({
    mutationFn: async () => portalRpc("portal_ask", {
      p_student_id: student?.student_id ?? null,
      p_month: student ? month ?? null : null,
      p_body: body,
      p_file_name: file?.name ?? null,
      p_file_type: file?.type ?? null,
      p_file_base64: file ? await fileToBase64(file) : null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-questions"] });
      qc.invalidateQueries({ queryKey: ["portal-students"] });
    },
  });

  return (
    <Dialog title={student ? `שאלה על ${student.full_name}` : "שאלה למשרד"} onClose={onClose}>
      {send.isSuccess ? (
        <div className="space-y-4">
          <Feedback done="השאלה נשלחה. התשובה תופיע בלשונית &quot;השאלות שלי&quot;." />
          <button onClick={() => { onSent?.(); onClose(); }} className="btn-primary h-11 px-6 text-base">סגירה</button>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); send.mutate(); }} className="space-y-4">
          {student && (
            <p className="rounded-control bg-surface-muted p-3 text-base text-ink-muted">
              המשרד יראה שהשאלה על {student.full_name}
              {student.eligibility === "not_eligible" ? ", ואת סיבת אי-הזכאות." : "."}
            </p>
          )}
          <div>
            <label htmlFor="ask-body" className="field-label text-base">השאלה</label>
            <textarea id="ask-body" required rows={5} value={body} onChange={(e) => setBody(e.target.value)} className="input-field text-base" />
          </div>
          <div>
            <label htmlFor="ask-file" className="field-label text-base">צירוף קובץ (לא חובה, עד 5MB)</label>
            <label htmlFor="ask-file" className="btn-secondary inline-flex h-11 cursor-pointer items-center gap-2 px-4 text-base">
              <Paperclip className="h-5 w-5" aria-hidden="true" />
              {file ? file.name : "בחירת קובץ"}
            </label>
            <input id="ask-file" type="file" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <button type="submit" disabled={send.isPending} className="btn-primary h-11 px-6 text-base">
            {send.isPending ? "שולח…" : "שליחה"}
          </button>
          <Feedback error={send.isError ? errText(send.error) : null} />
        </form>
      )}
    </Dialog>
  );
}
