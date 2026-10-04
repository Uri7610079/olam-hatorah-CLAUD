import { createClient } from "@supabase/supabase-js";

// הפורטל של ראשי הקבוצות מדבר עם המסד בלי חשבון Supabase: כל קריאה היא
// פונקציה שמקבלת אסימון ובודקת אותו בעצמה (מיגרציה 111). לכן לקוח נפרד,
// שלא שומר ולא מחדש חיבור של משתמש - גם אם באותו דפדפן מחובר עובד משרד,
// הפורטל לא יירש את ההרשאות שלו.
const client = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "olam-portal" },
});

const TOKEN_KEY = "olam-portal-token";

export const portalToken = {
  get(): string | null {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set(token: string) {
    try { localStorage.setItem(TOKEN_KEY, token); } catch { /* מצב פרטי - החיבור יחזיק רק עד רענון */ }
  },
  clear() {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* אין מה לנקות */ }
  },
};

export class PortalSessionExpired extends Error {
  constructor() { super("החיבור הסתיים"); }
}

export async function portalRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.rpc(fn, { p_token: portalToken.get(), ...args });
  if (error) {
    if (error.message.includes("portal_session_expired")) {
      portalToken.clear();
      throw new PortalSessionExpired();
    }
    throw new Error(error.message);
  }
  return data as T;
}

const LOGIN_ERROR: Record<string, string> = {
  missing: "יש להקליד מייל (או טלפון) וסיסמה.",
  bad_credentials: "המייל (או הטלפון) או הסיסמה אינם נכונים.",
  blocked: "הגישה שלך חסומה. לפרטים יש להתקשר למשרד.",
  no_password: "עדיין לא נקבעה לך סיסמה. יש להתקשר למשרד.",
  no_groups: "אין כרגע קבוצות פעילות על שמך. לפרטים יש להתקשר למשרד.",
};

export async function portalLogin(identifier: string, password: string): Promise<{ name: string }> {
  const { data, error } = await client.rpc("portal_login", { p_identifier: identifier, p_password: password });
  if (error) throw new Error("לא ניתן להתחבר כרגע. נסו שוב בעוד כמה דקות.");
  const r = data as { ok: boolean; token?: string; name?: string; error?: string; minutes?: number };
  if (!r.ok) {
    if (r.error === "locked") {
      throw new Error(`הכניסה ננעלה ל-${r.minutes ?? 15} דקות אחרי 5 ניסיונות שגויים. אפשר לנסות שוב אחר כך, או להתקשר למשרד.`);
    }
    throw new Error(LOGIN_ERROR[r.error ?? ""] ?? "הכניסה נכשלה.");
  }
  portalToken.set(r.token!);
  return { name: r.name ?? "" };
}

export async function portalLogout() {
  try { await client.rpc("portal_logout", { p_token: portalToken.get() }); } catch { /* יוצאים בכל מקרה */ }
  portalToken.clear();
}

export interface PortalGroup { id: string; name: string; branch: string | null; organization: string }
export interface PortalMe { name: string; groups: PortalGroup[] }

export interface PortalStudent {
  student_id: string;
  full_name: string;
  external_id: string;
  id_type: string;
  phone: string | null;
  address_street: string | null;
  address_house_number: string | null;
  address_city: string | null;
  group_id: string;
  group_name: string;
  branch_name: string | null;
  organization_name: string;
  eligibility: "eligible" | "not_eligible" | "no_data";
  reasons: string[];
  has_bank_account: boolean;
  pending_requests: number;
  open_questions: number;
}

export interface PortalRequest {
  id: string;
  kind: "contact" | "identity" | "new_student" | "student_left";
  student_name: string | null;
  status: "pending" | "applied" | "approved" | "rejected" | "cancelled";
  payload: Record<string, string | null>;
  previous: Record<string, string | null> | null;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface PortalQuestion {
  id: string;
  student_name: string | null;
  context: string | null;
  body: string;
  attachment_name: string | null;
  status: "open" | "answered";
  answer: string | null;
  answered_at: string | null;
  created_at: string;
}

/** קובץ ל-base64, בלי הקידומת data:. עד 5MB - המגבלה זהה במסד. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > 5 * 1024 * 1024) { reject(new Error("הקובץ גדול מ-5MB")); return; }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("לא ניתן לקרוא את הקובץ"));
    reader.readAsDataURL(file);
  });
}
