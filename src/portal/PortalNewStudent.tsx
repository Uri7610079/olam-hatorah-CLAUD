import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Paperclip, Upload, CheckCircle2, XCircle } from "lucide-react";
import { PhoneField } from "@/components/PhoneField";
import { PASSPORT_COUNTRIES } from "@/lib/passportCountries";
import { Dialog, Feedback, errText } from "./PortalDialogs";
import { fileToBase64, portalRpc, type PortalGroup, type PortalReference } from "./portalApi";
import {
  EMPTY_NEW_STUDENT, ID_TYPE_OPTIONS, MARITAL_LABEL, MAX_AGE, MIN_AGE, SCOPE_LABEL, bankLabel, studyCodeFor, toRpcArgs,
  validateNewStudent, type Errors, type MaritalStatus, type NewStudentInput, type StudyCodeMap, type StudyScope,
} from "./newStudentForm";
import { downloadTemplate, groupLabels, parseTemplate, type ParsedRow } from "./portalExcel";

type Photo = { name: string; type: string; base64: string };

export function useReference() {
  return useQuery({ queryKey: ["portal-reference"], queryFn: () => portalRpc<PortalReference>("portal_reference"), staleTime: 10 * 60_000 });
}

const yearsAgo = (y: number) => { const d = new Date(); d.setFullYear(d.getFullYear() - y); return d.toISOString().slice(0, 10); };

function Field({ id, label, required, error, children, wide }: {
  id: string; label: string; required?: boolean; error?: string; children: ReactNode; wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <label htmlFor={id} className="field-label text-base">
        {label}{required && <span className="text-danger"> *</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-sm text-danger-ink" role="alert">{error}</p>}
    </div>
  );
}

function Choice<K extends string>({ value, options, onChange, codes, name }: {
  value: K | ""; options: Record<K, string>; onChange: (k: K) => void; codes?: Partial<Record<K, string | null>>; name: string;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-2">
      {(Object.keys(options) as K[]).map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          onClick={() => onChange(k)}
          className={`rounded-control border px-4 py-2 text-base transition ${
            value === k ? "border-brand-500 bg-brand-50 font-semibold text-brand-700" : "border-line bg-surface hover:border-brand-500"
          }`}
        >
          {options[k]}
          {codes?.[k] && <span className="ms-2 text-sm font-normal text-ink-muted">קוד {codes[k]}</span>}
        </button>
      ))}
    </div>
  );
}

// ===== תלמיד חדש: טופס =====
export function NewStudentDialog({ groups, onClose }: { groups: PortalGroup[]; onClose: () => void }) {
  const qc = useQueryClient();
  const ref = useReference();
  const blank = { ...EMPTY_NEW_STUDENT, groupId: groups.length === 1 ? groups[0].id : "", startDate: new Date().toISOString().slice(0, 10) };
  const [v, setV] = useState<NewStudentInput>(blank);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const set = <K extends keyof NewStudentInput>(k: K) => (val: NewStudentInput[K]) => setV((f) => ({ ...f, [k]: val }));

  const banks = ref.data?.banks ?? [];
  const codes = (ref.data?.study_codes ?? {}) as StudyCodeMap;
  const group = groups.find((g) => g.id === v.groupId);
  const errors: Errors = validateNewStudent(v, {
    banks, groupIds: groups.map((g) => g.id), requirePhoto: !!group?.require_id_photo, hasPhoto: !!photo,
  });
  const shown = (k: keyof Errors) => (submitted ? errors[k] : undefined);
  const code = studyCodeFor(codes, v.maritalStatus, v.studyScope);

  const send = useMutation({
    mutationFn: () => portalRpc("portal_request_new_student", toRpcArgs(v, photo)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-requests"] }),
  });

  const submit = () => {
    setSubmitted(true);
    if (Object.keys(errors).length) {
      // לשדה הראשון שחסר - כדי שלא יצטרכו לחפש מה לא בסדר
      setTimeout(() => document.querySelector<HTMLElement>("[role=dialog] [role=alert]")?.scrollIntoView({ block: "center", behavior: "smooth" }), 0);
      return;
    }
    send.mutate();
  };

  if (send.isSuccess) {
    return (
      <Dialog title="הוספת תלמיד חדש" onClose={onClose}>
        <div className="space-y-4">
          <Feedback done={`${v.fullName} נשלח למשרד. התלמיד יופיע ברשימה אחרי האישור.`} />
          <div className="flex gap-2">
            <button onClick={() => { setV(blank); setPhoto(null); setSubmitted(false); send.reset(); }} className="btn-primary h-11 px-6 text-base">הוספת תלמיד נוסף</button>
            <button onClick={onClose} className="btn-secondary h-11 px-6 text-base">סגירה</button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="הוספת תלמיד חדש" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate className="grid gap-4 sm:grid-cols-2">
        <p className="text-sm text-ink-muted sm:col-span-2">שדות עם <span className="text-danger">*</span> הם חובה. התלמיד ייכנס אחרי אישור המשרד.</p>

        <Field id="ns-group" label="קבוצה" required error={shown("groupId")} wide>
          <select id="ns-group" value={v.groupId} onChange={(e) => set("groupId")(e.target.value)} className="input-field h-11 text-base">
            <option value="">— בחירת קבוצה —</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{[g.name, g.branch, g.organization].filter(Boolean).join(" · ")}</option>)}
          </select>
        </Field>

        <Field id="ns-name" label="שם מלא" required error={shown("fullName")} wide>
          <input
            id="ns-name" value={v.fullName} className="input-field h-11 text-base"
            onChange={(e) => set("fullName")(e.target.value)}
            onBlur={() => { if (!v.accountHolder.trim() && v.fullName.trim()) set("accountHolder")(v.fullName.trim()); }}
          />
        </Field>

        <Field id="ns-idtype" label="סוג מזהה" required error={shown("idType")}>
          <Choice name="סוג מזהה" value={v.idType} options={ID_TYPE_OPTIONS} onChange={(k) => set("idType")(k)} />
        </Field>
        <Field id="ns-id" label={v.idType === "passport" ? "מספר דרכון" : "מספר תעודת זהות"} required error={shown("externalId")}>
          <input id="ns-id" dir="ltr" inputMode={v.idType === "passport" ? "text" : "numeric"} value={v.externalId}
            onChange={(e) => set("externalId")(e.target.value)} className="input-field h-11 text-right text-base tabular-nums" />
          {!submitted && v.externalId.length >= 8 && errors.externalId && <p className="mt-1 text-sm text-warn-ink">{errors.externalId}</p>}
        </Field>

        {v.idType === "passport" && (
          <Field id="ns-country" label="ארץ הדרכון" required error={shown("passportCountry")} wide>
            <input id="ns-country" list="ns-countries" value={v.passportCountry} onChange={(e) => set("passportCountry")(e.target.value)}
              className="input-field h-11 text-base" placeholder="הקלדה או בחירה מהרשימה" />
            <datalist id="ns-countries">{PASSPORT_COUNTRIES.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
        )}

        <Field id="ns-birth" label={`תאריך לידה (גיל ${MIN_AGE} עד ${MAX_AGE})`} required error={shown("birthDate")}>
          <input id="ns-birth" type="date" value={v.birthDate} min={yearsAgo(MAX_AGE + 1)} max={yearsAgo(MIN_AGE)}
            onChange={(e) => set("birthDate")(e.target.value)} className="input-field h-11 text-base" />
        </Field>
        <div>
          <PhoneField id="ns-phone" label="טלפון *" value={v.phone} onChange={set("phone")} />
          {shown("phone") && <p className="mt-1 text-sm text-danger-ink" role="alert">{errors.phone}</p>}
        </div>

        <Field id="ns-marital" label="מצב משפחתי" required error={shown("maritalStatus")} wide>
          <Choice<MaritalStatus> name="מצב משפחתי" value={v.maritalStatus} options={MARITAL_LABEL}
            codes={{ single: codes.single?.code ?? null }}
            onChange={(k) => setV((f) => ({ ...f, maritalStatus: k, studyScope: k === "single" ? "" : f.studyScope }))} />
        </Field>
        {v.maritalStatus === "married" && (
          <Field id="ns-scope" label="היקף לימוד" required error={shown("studyScope")} wide>
            <Choice<StudyScope> name="היקף לימוד" value={v.studyScope} options={SCOPE_LABEL}
              codes={{ full_day: codes.full_day?.code, half_day_morning: codes.half_day_morning?.code, half_day_afternoon: codes.half_day_afternoon?.code }}
              onChange={(k) => set("studyScope")(k)} />
          </Field>
        )}
        {code?.code && (
          <p className="rounded-control bg-surface-muted p-3 text-base sm:col-span-2">
            קוד לימוד: <span className="font-semibold tabular-nums">{code.code}</span>{code.description && <span className="text-ink-muted"> · {code.description}</span>}
          </p>
        )}

        <div className="border-t border-line pt-4 sm:col-span-2"><h3 className="text-lg font-bold">חשבון בנק</h3></div>
        <Field id="ns-bank" label="בנק" required error={shown("bankCode")} wide>
          <div className="flex items-center gap-3">
            <select id="ns-bank" value={v.bankCode} onChange={(e) => set("bankCode")(e.target.value)} className="input-field h-11 flex-1 text-base">
              <option value="">— בחירת בנק —</option>
              {banks.map((b) => <option key={b.code} value={b.code}>{bankLabel(b)}</option>)}
            </select>
            {v.bankCode && <span className="whitespace-nowrap rounded-control bg-surface-muted px-3 py-2 text-base tabular-nums">בנק {v.bankCode}</span>}
          </div>
        </Field>
        <Field id="ns-branch" label="מספר סניף" required error={shown("bankBranch")}>
          <input id="ns-branch" dir="ltr" inputMode="numeric" value={v.bankBranch} onChange={(e) => set("bankBranch")(e.target.value)} className="input-field h-11 text-right text-base tabular-nums" />
        </Field>
        <Field id="ns-account" label="מספר חשבון" required error={shown("accountNumber")}>
          <input id="ns-account" dir="ltr" inputMode="numeric" value={v.accountNumber} onChange={(e) => set("accountNumber")(e.target.value)} className="input-field h-11 text-right text-base tabular-nums" />
        </Field>
        <Field id="ns-holder" label="שם בעל החשבון" required error={shown("accountHolder")} wide>
          <input id="ns-holder" value={v.accountHolder} onChange={(e) => set("accountHolder")(e.target.value)} className="input-field h-11 text-base" />
        </Field>

        {group?.require_id_photo && (
          <Field id="ns-photo" label="צילום תעודת זהות" required error={shown("photo") ?? photoError ?? undefined} wide>
            <label htmlFor="ns-photo" className="btn-secondary inline-flex h-11 cursor-pointer items-center gap-2 px-4 text-base">
              <Paperclip className="h-5 w-5" aria-hidden="true" />
              {photo ? photo.name : "בחירת קובץ (תמונה או PDF)"}
            </label>
            <input id="ns-photo" type="file" accept="image/*,application/pdf" className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0]; setPhotoError(null);
                if (!f) return;
                try { setPhoto({ name: f.name, type: f.type, base64: await fileToBase64(f) }); }
                catch (err) { setPhoto(null); setPhotoError(errText(err)); }
              }} />
          </Field>
        )}

        <div className="border-t border-line pt-4 sm:col-span-2"><h3 className="text-lg font-bold">כתובת <span className="text-sm font-normal text-ink-muted">(לא חובה)</span></h3></div>
        <Field id="ns-street" label="רחוב"><input id="ns-street" value={v.street} onChange={(e) => set("street")(e.target.value)} className="input-field h-11 text-base" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="ns-house" label="מספר בית"><input id="ns-house" value={v.houseNumber} onChange={(e) => set("houseNumber")(e.target.value)} className="input-field h-11 text-base" /></Field>
          <Field id="ns-city" label="עיר"><input id="ns-city" value={v.city} onChange={(e) => set("city")(e.target.value)} className="input-field h-11 text-base" /></Field>
        </div>
        <Field id="ns-start" label="לומד בקבוצה מתאריך">
          <input id="ns-start" type="date" value={v.startDate} onChange={(e) => set("startDate")(e.target.value)} className="input-field h-11 text-base" />
        </Field>

        <div className="sm:col-span-2">
          {submitted && Object.keys(errors).length > 0 && (
            <p className="mb-3 rounded-control bg-danger-soft p-3 text-base text-danger-ink">חסרים או שגויים {Object.keys(errors).length} פרטים - מסומנים באדום.</p>
          )}
          <button type="submit" disabled={send.isPending || ref.isLoading} className="btn-primary h-11 px-6 text-base">
            {send.isPending ? "שולח…" : "שליחה לאישור המשרד"}
          </button>
          <Feedback error={send.isError ? errText(send.error) : null} />
        </div>
      </form>
    </Dialog>
  );
}

// ===== הוספה מקובץ אקסל =====

// עברית: 1 הוא "שורה אחת", לא "1 שורות"
const rowsText = (n: number, suffix: string) => (n === 1 ? `שורה אחת ${suffix}` : `${n} שורות ${suffix}`);
const readyText = (n: number) => (n === 1 ? "שורה אחת מוכנה לשליחה" : `${n} מוכנות לשליחה`);
const fixText = (n: number) => (n === 1 ? "שורה אחת דורשת תיקון" : `${n} דורשות תיקון`);
type SendState = { status: "sent" } | { status: "failed"; message: string };

export function ExcelUploadDialog({ groups, onClose }: { groups: PortalGroup[]; onClose: () => void }) {
  const qc = useQueryClient();
  const ref = useReference();
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Record<number, Photo>>({});
  const [results, setResults] = useState<Record<number, SendState>>({});
  // מספרי זהות שכבר נשלחו בחלון הזה - נשמרים גם אחרי העלאה חוזרת של קובץ מתוקן
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const banks = useMemo(() => ref.data?.banks ?? [], [ref.data]);
  const labels = groupLabels(groups);

  // השגיאות מחושבות מחדש בכל ציור - צירוף צילום מסיר מיד את השגיאה שלו
  const checked = (rows ?? []).map((r) => ({
    ...r,
    errors: validateNewStudent(r.input, {
      banks, groupIds: groups.map((g) => g.id), requirePhoto: r.requirePhoto, hasPhoto: !!photos[r.rowNumber],
    }),
  }));
  const idKey = (r: ParsedRow) => r.input.externalId.trim().replace(/^0+/, "").toUpperCase();
  const alreadySent = (r: ParsedRow) => sentIds.has(idKey(r));
  const ready = checked.filter((r) => Object.keys(r.errors).length === 0 && !alreadySent(r));

  const onFile = async (file: File | undefined) => {
    setFileError(null); setRows(null); setResults({}); setPhotos({});
    if (!file) return;
    try { setRows(await parseTemplate(file, { groups, banks, hasPhoto: () => false })); }
    catch (e) { setFileError(errText(e)); }
  };

  const sendAll = async () => {
    setSending(true);
    for (const r of ready) {
      try {
        await portalRpc("portal_request_new_student", toRpcArgs(r.input, photos[r.rowNumber] ?? null));
        setResults((x) => ({ ...x, [r.rowNumber]: { status: "sent" } }));
        setSentIds((x) => new Set(x).add(idKey(r)));
      } catch (e) {
        setResults((x) => ({ ...x, [r.rowNumber]: { status: "failed", message: errText(e) } }));
      }
    }
    setSending(false);
    qc.invalidateQueries({ queryKey: ["portal-requests"] });
  };

  const sentCount = checked.filter(alreadySent).length;

  return (
    <Dialog title="הוספת תלמידים מקובץ אקסל" onClose={onClose}>
      <div className="space-y-5">
        <ol className="space-y-3 text-base">
          <li className="flex flex-wrap items-center gap-3">
            <span className="font-semibold">1.</span> מורידים את התבנית, וממלאים שורה לכל תלמיד:
            <button
              type="button"
              disabled={!ref.data || preparing}
              onClick={async () => { setPreparing(true); try { await downloadTemplate(groups, banks, (ref.data?.study_codes ?? {}) as StudyCodeMap); } finally { setPreparing(false); } }}
              className="btn-secondary flex h-11 items-center gap-2 px-4 text-base"
            >
              <Download className="h-5 w-5" aria-hidden="true" />
              {preparing ? "מכין…" : "הורדת תבנית"}
            </button>
          </li>
          <li className="flex flex-wrap items-center gap-3">
            <span className="font-semibold">2.</span> מעלים את הקובץ שמולא:
            <label htmlFor="xl-file" className="btn-primary flex h-11 cursor-pointer items-center gap-2 px-4 text-base">
              <Upload className="h-5 w-5" aria-hidden="true" />
              העלאת קובץ
            </label>
            <input id="xl-file" type="file" accept=".xlsx,.xls" className="sr-only" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
          </li>
        </ol>

        {fileError && <Feedback error={fileError} />}

        {rows && rows.length === 0 && <Feedback error="לא נמצאו בקובץ שורות עם תלמידים." />}

        {checked.length > 0 && (
          <>
            <p className="text-base">
              {rowsText(checked.length, "בקובץ")} · <span className="font-semibold text-ok-ink">{readyText(ready.length)}</span>
              {checked.length - ready.length - sentCount > 0 && <> · <span className="font-semibold text-danger-ink">{fixText(checked.length - ready.length - sentCount)}</span></>}
            </p>
            <div className="max-h-[50vh] overflow-auto rounded-control border border-line">
              <table className="w-full text-base">
                <thead className="sticky top-0 bg-surface-muted text-right text-sm text-ink-muted">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-2">שם קבוצה</th>
                    <th className="px-3 py-2">שם</th>
                    <th className="px-3 py-2">שורה</th>
                    <th className="px-3 py-2">מה צריך</th>
                  </tr>
                </thead>
                <tbody>
                  {checked.map((r) => {
                    const result = results[r.rowNumber];
                    const errs = Object.values(r.errors);
                    return (
                      <tr key={r.rowNumber} className="border-t border-line align-top">
                        <td className="whitespace-nowrap px-3 py-2">{labels.get(r.input.groupId) ?? "—"}</td>
                        <td className="px-3 py-2 font-semibold">{r.input.fullName || "—"}</td>
                        <td className="px-3 py-2 tabular-nums text-ink-muted">{r.rowNumber}</td>
                        <td className="px-3 py-2">
                          {result?.status === "sent" || alreadySent(r) ? (
                            <span className="flex items-center gap-1 text-ok-ink"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />נשלח למשרד</span>
                          ) : result?.status === "failed" ? (
                            <span className="flex items-start gap-1 text-danger-ink"><XCircle className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />{result.message}</span>
                          ) : errs.length === 0 ? (
                            <span className="text-ok-ink">מוכן</span>
                          ) : (
                            <ul className="space-y-0.5 text-sm text-danger-ink">{errs.map((m) => <li key={m}>{m}</li>)}</ul>
                          )}
                          {r.requirePhoto && !alreadySent(r) && (
                            <label className="link-action mt-1 inline-flex cursor-pointer items-center gap-1 text-sm">
                              <Paperclip className="h-4 w-4" aria-hidden="true" />
                              {photos[r.rowNumber] ? `צילום: ${photos[r.rowNumber].name}` : "צירוף צילום ת״ז"}
                              <input type="file" accept="image/*,application/pdf" className="sr-only"
                                onChange={async (e) => {
                                  const f = e.target.files?.[0]; if (!f) return;
                                  try { const p = { name: f.name, type: f.type, base64: await fileToBase64(f) }; setPhotos((x) => ({ ...x, [r.rowNumber]: p })); }
                                  catch (err) { setResults((x) => ({ ...x, [r.rowNumber]: { status: "failed", message: errText(err) } })); }
                                }} />
                            </label>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-ink-muted">שורה שדורשת תיקון לא נשלחת. אפשר לתקן אותה בקובץ ולהעלות שוב - תלמידים שכבר נשלחו לא יישלחו שוב.</p>
            <button type="button" onClick={sendAll} disabled={sending || ready.length === 0} className="btn-primary h-11 px-6 text-base">
              {sending ? "שולח…" : ready.length === 1 ? "שליחת תלמיד אחד לאישור המשרד" : ready.length ? `שליחת ${ready.length} תלמידים לאישור המשרד` : "אין שורות מוכנות לשליחה"}
            </button>
            {sentCount > 0 && !sending && <Feedback done={sentCount === 1 ? "תלמיד אחד נשלח למשרד. הוא יופיע ברשימה אחרי האישור." : `${sentCount} תלמידים נשלחו למשרד. הם יופיעו ברשימה אחרי האישור.`} />}
          </>
        )}
      </div>
    </Dialog>
  );
}
