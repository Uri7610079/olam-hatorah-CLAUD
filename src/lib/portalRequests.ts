import type { Severity } from "@/components/StatusBadge";
import { TALMUD_VISA_TYPES } from "@/lib/talmudCodes";

// בקשות מראשי קבוצות (מיגרציה 111) - התוויות והתיאור במקום אחד, כדי
// שראש הקבוצה והמשרד יראו את אותה בקשה באותן מילים.

export type RequestKind = "contact" | "identity" | "new_student" | "student_left";
export type RequestStatus = "pending" | "applied" | "approved" | "rejected" | "cancelled";

export const REQUEST_KIND_LABEL: Record<RequestKind, string> = {
  contact: "טלפון וכתובת",
  identity: "שם ותעודת זהות",
  new_student: "תלמיד חדש",
  student_left: "תלמיד שעזב",
};

export const REQUEST_STATUS: Record<RequestStatus, { label: string; severity: Severity }> = {
  pending: { label: "ממתין לאישור", severity: "medium" },
  applied: { label: "עודכן", severity: "ok" },
  approved: { label: "אושר", severity: "ok" },
  rejected: { label: "נדחה", severity: "high" },
  cancelled: { label: "בוטל", severity: "neutral" },
};

export const ID_TYPE_LABEL: Record<string, string> = {
  israeli_id: "תעודת זהות",
  passport: "דרכון",
  other: "אחר",
};

type Payload = Record<string, string | null | undefined>;

const MARITAL_TEXT: Record<string, string> = { single: "בחור", married: "נשוי" };
const SCOPE_TEXT: Record<string, string> = { full_day: "יום שלם", half_day_morning: "חצי יום בוקר", half_day_afternoon: 'חצי יום אחה"צ' };

const FIELD_LABEL: Record<string, string> = {
  phone: "טלפון",
  address_street: "רחוב",
  address_house_number: "מספר בית",
  address_city: "עיר",
  full_name: "שם",
  external_id: "מספר זהות",
  id_type: "סוג מזהה",
};

const show = (key: string, v: string | null | undefined) =>
  !v ? "(ריק)" : key === "id_type" ? ID_TYPE_LABEL[v] ?? v : v;

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function monthLabel(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("he-IL", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** שורות "לפני ← אחרי" לבקשה, רק לשדות שהשתנו. */
export function requestChanges(kind: RequestKind, payload: Payload, previous: Payload | null): string[] {
  if (kind === "new_student") {
    const country = payload.passport_country ? ` (${payload.passport_country})` : "";
    const lines = [`${payload.full_name} · ${show("id_type", payload.id_type)} ${payload.external_id}${country}`];
    if (payload.first_name && payload.last_name) lines.push(`שם משפחה: ${payload.last_name} · שם פרטי: ${payload.first_name}`);
    if (payload.visa_number || payload.visa_type || payload.visa_expiry) {
      const visa = TALMUD_VISA_TYPES.find((t) => String(t.code) === String(payload.visa_type));
      lines.push(["אשרה:", visa?.label ?? payload.visa_type, payload.visa_number && `מספר ${payload.visa_number}`,
        payload.visa_expiry && `בתוקף עד ${formatDate(payload.visa_expiry)}`].filter(Boolean).join(" "));
    }
    if (payload.birth_date) lines.push(`תאריך לידה: ${formatDate(payload.birth_date)}`);
    if (payload.phone) lines.push(`טלפון: ${payload.phone}`);
    if (payload.marital_status) {
      const scope = payload.study_scope ? ` · ${SCOPE_TEXT[payload.study_scope] ?? payload.study_scope}` : "";
      const code = payload.study_code ? ` · קוד לימוד ${payload.study_code}` : "";
      lines.push(`${MARITAL_TEXT[payload.marital_status] ?? payload.marital_status}${scope}${code}`);
    }
    if (payload.account_number) {
      lines.push(`בנק: ${payload.bank_name ?? ""} (${payload.bank_code}) · סניף ${payload.bank_branch} · חשבון ${payload.account_number} · ${payload.account_holder}`);
    }
    const addr = [payload.address_street, payload.address_house_number, payload.address_city].filter(Boolean).join(" ");
    if (addr) lines.push(`כתובת: ${addr}`);
    if (payload.start_date) lines.push(`מתאריך: ${formatDate(payload.start_date)}`);
    return lines;
  }
  if (kind === "student_left") {
    const lines = [`עזב בתאריך ${formatDate(payload.exit_date)}`];
    if (payload.reason) lines.push(`סיבה: ${payload.reason}`);
    return lines;
  }
  return Object.keys(payload)
    .filter((k) => (payload[k] ?? null) !== (previous?.[k] ?? null))
    .map((k) => `${FIELD_LABEL[k] ?? k}: ${show(k, previous?.[k])} ← ${show(k, payload[k])}`);
}

export const ELIGIBILITY: Record<string, { label: string; severity: Severity }> = {
  eligible: { label: "זכאי", severity: "ok" },
  not_eligible: { label: "לא זכאי", severity: "high" },
  no_data: { label: "אין נתון", severity: "neutral" },
};
