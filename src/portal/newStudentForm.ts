import { isValidIsraeliId } from "@/lib/israeliId";
import { isValidIsraeliPhone } from "@/lib/israeliPhone";

// תלמיד חדש מהפורטל: השדות, התוויות והבדיקות במקום אחד. משמש גם את הטופס
// וגם את קליטת קובץ האקסל, כך ששתי הדרכים חוסמות בדיוק את אותו דבר.
// אותן בדיקות רצות שוב בשרת (מיגרציה 112) - כאן הן כדי להסביר מיד מה חסר.

export type MaritalStatus = "single" | "married";
export type StudyScope = "full_day" | "half_day_morning" | "half_day_afternoon";
export type IdType = "israeli_id" | "passport";

export const MARITAL_LABEL: Record<MaritalStatus, string> = { single: "בחור", married: "נשוי" };
export const SCOPE_LABEL: Record<StudyScope, string> = {
  full_day: "יום שלם",
  half_day_morning: "חצי יום בוקר",
  half_day_afternoon: 'חצי יום אחה"צ',
};
export const ID_TYPE_OPTIONS: Record<IdType, string> = { israeli_id: "תעודת זהות", passport: "דרכון" };

export interface NewStudentInput {
  groupId: string;
  fullName: string;
  idType: IdType | "";
  externalId: string;
  passportCountry: string;
  birthDate: string; // YYYY-MM-DD
  phone: string;
  maritalStatus: MaritalStatus | "";
  studyScope: StudyScope | "";
  bankCode: string;
  bankBranch: string;
  accountNumber: string;
  accountHolder: string;
  street: string;
  houseNumber: string;
  city: string;
  startDate: string;
}

export const EMPTY_NEW_STUDENT: NewStudentInput = {
  groupId: "", fullName: "", idType: "israeli_id", externalId: "", passportCountry: "",
  birthDate: "", phone: "", maritalStatus: "", studyScope: "",
  bankCode: "", bankBranch: "", accountNumber: "", accountHolder: "",
  street: "", houseNumber: "", city: "", startDate: "",
};

export interface Bank { code: string; name: string }
export interface StudyCodeRef { code: string | null; description: string | null }
export type StudyCodeMap = Partial<Record<MaritalStatus | StudyScope, StudyCodeRef>>;

export interface ValidationContext {
  banks: Bank[];
  groupIds: string[];
  requirePhoto: boolean;
  hasPhoto: boolean;
  // קבוצה שהמשרד הגדיר "חשבון בנק אינו חובה" (מיגרציה 115)
  bankOptional?: boolean;
  today?: Date;
}

export type Errors = Partial<Record<keyof NewStudentInput | "photo", string>>;

/** גיל בשנים שלמות - כמו age() של Postgres. */
export function ageOn(birthIso: string, today: Date): number {
  const [y, m, d] = birthIso.split("-").map(Number);
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--;
  return age;
}

export const MIN_AGE = 16;
export const MAX_AGE = 67;

export function validateNewStudent(v: NewStudentInput, ctx: ValidationContext): Errors {
  const e: Errors = {};
  const today = ctx.today ?? new Date();

  if (!v.groupId || !ctx.groupIds.includes(v.groupId)) e.groupId = "יש לבחור קבוצה";
  if (!v.fullName.trim()) e.fullName = "חסר שם מלא";

  const id = v.externalId.trim();
  if (v.idType === "israeli_id") {
    if (!id) e.externalId = "חסר מספר תעודת זהות";
    else if (!/^[0-9]{5,9}$/.test(id) || !isValidIsraeliId(id)) e.externalId = "מספר תעודת הזהות שגוי - כנראה טעות הקלדה (ספרת הביקורת לא מתאימה)";
  } else if (v.idType === "passport") {
    if (!id) e.externalId = "חסר מספר דרכון";
    if (!v.passportCountry.trim()) e.passportCountry = "חסרה ארץ הדרכון";
  } else {
    e.idType = "יש לבחור תעודת זהות או דרכון";
  }

  if (!v.birthDate) e.birthDate = "חסר תאריך לידה";
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(v.birthDate) || Number.isNaN(Date.parse(v.birthDate))) e.birthDate = "תאריך הלידה אינו תקין";
  else {
    const age = ageOn(v.birthDate, today);
    if (age < MIN_AGE || age > MAX_AGE) e.birthDate = `הגיל צריך להיות בין ${MIN_AGE} ל-${MAX_AGE} (לפי התאריך: ${age})`;
  }

  if (!v.phone.trim()) e.phone = "חסר טלפון";
  else if (!isValidIsraeliPhone(v.phone)) e.phone = "מספר הטלפון אינו תקין";

  if (!v.maritalStatus) e.maritalStatus = "יש לבחור בחור או נשוי";
  else if (v.maritalStatus === "married" && !v.studyScope) e.studyScope = "יש לבחור היקף לימוד";

  // בקבוצה שבה בנק אינו חובה אפשר להשאיר הכול ריק. אבל מי שהתחיל למלא - ממלא עד
  // הסוף, כדי שלא יישמר חצי חשבון. שם בעל החשבון לא נחשב "התחיל", כי הטופס ממלא
  // אותו לבד משם התלמיד. אותו כלל בדיוק בשרת (portal_request_new_student).
  if (!ctx.bankOptional || hasBankDetails(v)) {
    if (!ctx.banks.some((b) => b.code === v.bankCode)) e.bankCode = "יש לבחור בנק";
    if (!/^[0-9]{1,4}$/.test(v.bankBranch.trim())) e.bankBranch = v.bankBranch.trim() ? "ספרות בלבד" : "חסר מספר סניף";
    if (!/^[0-9]{2,13}$/.test(v.accountNumber.trim())) e.accountNumber = v.accountNumber.trim() ? "ספרות בלבד" : "חסר מספר חשבון";
    if (!v.accountHolder.trim()) e.accountHolder = "חסר שם בעל החשבון";
  }

  if (ctx.requirePhoto && !ctx.hasPhoto) e.photo = "בקבוצה זו חובה לצרף צילום תעודת זהות";
  return e;
}

/** האם התחילו למלא פרטי בנק (בנק, סניף או מספר חשבון). */
export function hasBankDetails(v: NewStudentInput): boolean {
  return Boolean(v.bankCode || v.bankBranch.trim() || v.accountNumber.trim());
}

/** קוד הלימוד שיירשם, לפי מצב משפחתי והיקף. */
export function studyCodeFor(map: StudyCodeMap, marital: MaritalStatus | "", scope: StudyScope | ""): StudyCodeRef | null {
  if (marital === "single") return map.single ?? null;
  if (marital === "married" && scope) return map[scope] ?? null;
  return null;
}

export const bankLabel = (b: Bank) => `${b.name} - ${b.code}`;

/** הפרמטרים של portal_request_new_student */
export function toRpcArgs(v: NewStudentInput, photo: { name: string; type: string; base64: string } | null) {
  return {
    p_group_id: v.groupId,
    p_full_name: v.fullName.trim(),
    p_id_type: v.idType,
    p_external_id: v.externalId.trim(),
    p_passport_country: v.idType === "passport" ? v.passportCountry.trim() : null,
    p_birth_date: v.birthDate,
    p_phone: v.phone.trim(),
    p_marital_status: v.maritalStatus,
    p_study_scope: v.maritalStatus === "married" ? v.studyScope : null,
    p_bank_code: v.bankCode,
    p_bank_branch: v.bankBranch.trim(),
    p_account_number: v.accountNumber.trim(),
    p_account_holder: v.accountHolder.trim(),
    p_street: v.street.trim() || null,
    p_house_number: v.houseNumber.trim() || null,
    p_city: v.city.trim() || null,
    p_start_date: v.startDate || null,
    p_id_photo_name: photo?.name ?? null,
    p_id_photo_type: photo?.type ?? null,
    p_id_photo_base64: photo?.base64 ?? null,
  };
}
