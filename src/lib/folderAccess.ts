// גישה לתיקייה מקומית במחשב, דרך File System Access API של הדפדפן.
//
// מגבלה שחשוב להכיר, והיא של הדפדפן ולא של המערכת: אי אפשר לקרוא תיקייה ברקע
// כשהתוכנה סגורה. הדפדפן דורש "מגע אנושי" לפני שהוא נותן לאתר גישה לקבצים, וזו
// הגנה נכונה. לכן הסריקה מתרחשת כשהתוכנה פתוחה - בפועל לחיצה אחת בפתיחת הדפדפן,
// ואחריה שקט. ריצה אמיתית ללא נוכחות דורשת תוכנית מותקנת על המחשב, וזו הייתה
// ההחלטה המודעת לא ללכת לשם בשלב הזה (ר' התוכנית שאושרה).
//
// נתמך ב-Chrome וב-Edge (אומת מול המשתמשת שאלה הדפדפנים במשרד). ב-Firefox/Safari
// אין תמיכה, ולכן isFolderAccessSupported() חייבת להיבדק לפני כל שימוש.

const DB_NAME = "olam-folder-access";
const STORE = "handles";

export type FolderKey = "general" | "bank";

export const FOLDER_LABEL: Record<FolderKey, string> = {
  general: "תיקייה כללית",
  bank: "תיקיית תנועות בנק",
};

export function isFolderAccessSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ה-handle נשמר ב-IndexedDB ולא ב-localStorage: הוא אובייקט חי של הדפדפן ולא
// מחרוזת, ורק IndexedDB יודע לשמר אותו בין טעינות. השמירה עצמה אינה מעניקה
// הרשאה - היא רק חוסכת למשתמשת לבחור את התיקייה מחדש בכל פעם.
async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(key);
    request.onsuccess = () => resolve((request.result as T) ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export type FolderPermission = "granted" | "prompt" | "denied" | "missing" | "unsupported";

export interface FolderStatus {
  key: FolderKey;
  name: string | null;
  permission: FolderPermission;
}

// readwrite ולא read: אחרי הטיפול הקובץ עובר לתת-תיקייה "נקלטו" או "שגיאות", וזה
// מה שנותן למשתמשת תשובה ברורה לשאלה "מה כבר נקלט ומה לא" בלי לזכור כלום. המחיר
// הוא שהדפדפן מבקש אישור מפורש לכתיבה, וזה נכון שיהיה מפורש.
const MODE: FileSystemPermissionMode = "readwrite";

export async function getFolderHandle(key: FolderKey): Promise<FileSystemDirectoryHandle | null> {
  if (!isFolderAccessSupported()) return null;
  return idbGet<FileSystemDirectoryHandle>(key);
}

export async function getFolderStatus(key: FolderKey): Promise<FolderStatus> {
  if (!isFolderAccessSupported()) return { key, name: null, permission: "unsupported" };
  const handle = await getFolderHandle(key);
  if (!handle) return { key, name: null, permission: "missing" };
  const permission = (await handle.queryPermission({ mode: MODE })) as FolderPermission;
  return { key, name: handle.name, permission };
}

// בחירת תיקייה - חייבת לצאת מלחיצה של המשתמשת (הדפדפן חוסם אחרת).
export async function pickFolder(key: FolderKey): Promise<FolderStatus> {
  const handle = await window.showDirectoryPicker({ mode: MODE, id: `olam-${key}` });
  await idbSet(key, handle);
  return { key, name: handle.name, permission: "granted" };
}

export async function forgetFolder(key: FolderKey): Promise<void> {
  await idbDelete(key);
}

// בקשת הרשאה מחדש. הדפדפן "שוכח" את ההרשאה בין הפעלות מטעמי אבטחה, ולכן זו
// הלחיצה היחידה שנדרשת ביום עבודה רגיל. גם היא חייבת לצאת מלחיצה של המשתמשת.
export async function ensureFolderPermission(key: FolderKey): Promise<FolderPermission> {
  const handle = await getFolderHandle(key);
  if (!handle) return "missing";
  const current = await handle.queryPermission({ mode: MODE });
  if (current === "granted") return "granted";
  return (await handle.requestPermission({ mode: MODE })) as FolderPermission;
}

export interface FolderFile {
  name: string;
  file: File;
  lastModified: number;
  size: number;
}

const SUPPORTED_EXTENSIONS = [".csv", ".xlsx", ".xls"];

// קבצים זמניים של Excel ושל העתקה בתהליך. הראשון קריטי: כשקובץ פתוח באקסל,
// אקסל יוצר לידו קובץ נעול בשם ‎~$שם‎ - בלי הסינון הזה המערכת הייתה מנסה לקלוט אותו.
function isIgnoredFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (name.startsWith("~$") || name.startsWith(".")) return true;
  if (lower.endsWith(".tmp") || lower.endsWith(".part") || lower.endsWith(".crdownload")) return true;
  return !SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// קובץ שעדיין נכתב (העתקה גדולה, או הורדה של הסקרייפר באמצע) ייקרא חלקית ויקלט
// שגוי. לכן נמדדים גודל ותאריך פעמיים בהפרש קצר, וקובץ שהשתנה בינתיים מדולג עד
// הסריקה הבאה במקום להיקלט חצי.
//
// ההמתנה היא אחת לכל הסריקה ולא אחת לכל קובץ: מדידה ראשונה לכולם, המתנה, מדידה
// שנייה לכולם. אחרת תיקייה עם 20 קבצים הייתה נסרקת 25 שניות במקום שנייה וקצת.
const SETTLE_MS = 1200;

export interface ScanResult {
  files: FolderFile[];
  skippedUnsettled: string[];
}

export async function scanFolder(key: FolderKey): Promise<ScanResult> {
  const handle = await getFolderHandle(key);
  if (!handle) return { files: [], skippedUnsettled: [] };

  const candidates: { name: string; handle: FileSystemFileHandle; size: number; lastModified: number }[] = [];

  for await (const entry of (handle as any).values() as AsyncIterable<FileSystemHandle>) {
    if (entry.kind !== "file") continue;
    if (isIgnoredFile(entry.name)) continue;
    const fileHandle = entry as FileSystemFileHandle;
    const first = await fileHandle.getFile();
    candidates.push({ name: entry.name, handle: fileHandle, size: first.size, lastModified: first.lastModified });
  }

  if (candidates.length === 0) return { files: [], skippedUnsettled: [] };

  await new Promise((r) => setTimeout(r, SETTLE_MS));

  const files: FolderFile[] = [];
  const skippedUnsettled: string[] = [];

  for (const candidate of candidates) {
    let file: File;
    try {
      file = await candidate.handle.getFile();
    } catch {
      // הקובץ נעלם או ננעל בין שתי המדידות - בדיוק המצב שהבדיקה נועדה לתפוס.
      skippedUnsettled.push(candidate.name);
      continue;
    }
    if (file.size !== candidate.size || file.lastModified !== candidate.lastModified) {
      skippedUnsettled.push(candidate.name);
      continue;
    }
    files.push({ name: candidate.name, file, lastModified: file.lastModified, size: file.size });
  }

  files.sort((a, b) => b.lastModified - a.lastModified);
  return { files, skippedUnsettled };
}

export const DONE_DIR = "נקלטו";
export const FAILED_DIR = "שגיאות";

// שני קבצי הקשר בין המערכת לסקרייפר שיושב על מחשב הלקוח. הם נמצאים בתיקיית
// הפלט של הסקרייפר (אותה תיקייה שממנה נקלטות תנועות הבנק), כדי ששני הצדדים
// יגיעו לאותו מקום בלי שהמשתמשת תצטרך להגדיר תיקייה נוספת.
// השמות חייבים להיות זהים למה שכתוב ב-bank-scraper/scheduler.ps1.
export const SCRAPER_CONFIG_FILE = "תזמון-סקרייפר.json";
export const SCRAPER_STATUS_FILE = "סטטוס-סקרייפר.json";

export async function readJsonFromFolder<T>(key: FolderKey, fileName: string): Promise<T | null> {
  const root = await getFolderHandle(key);
  if (!root) return null;
  try {
    const handle = await root.getFileHandle(fileName);
    const text = await (await handle.getFile()).text();
    // PowerShell נוטה לכתוב UTF-8 עם BOM, ו-BOM בתחילת JSON מפיל את JSON.parse.
    // הסקריפט שלנו כותב בלי BOM במפורש, אבל אם מישהו יערוך את הקובץ בפנקס
    // רשימות הוא כן יתווסף - ואין סיבה שהמסך ייפול בגלל זה.
    const clean = text.replace(/^﻿/, "").trim();
    if (!clean) return null;
    return JSON.parse(clean) as T;
  } catch {
    return null;
  }
}

export async function writeJsonToFolder(key: FolderKey, fileName: string, value: unknown): Promise<void> {
  const root = await getFolderHandle(key);
  if (!root) throw new Error("התיקייה לא מוגדרת");
  const handle = await root.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(value, null, 2));
  await writable.close();
}

// שם פנוי בתיקיית היעד. בלי זה, קליטה של שני קבצים באותו שם (למשל הורדה חוזרת של
// הסקרייפר) הייתה דורסת בשקט את הקודם בארכיון.
async function freeName(dir: FileSystemDirectoryHandle, name: string): Promise<string> {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let candidate = name;
  for (let i = 1; i < 100; i++) {
    try {
      await dir.getFileHandle(candidate);
    } catch {
      return candidate; // לא קיים - פנוי
    }
    candidate = `${base} (${i})${ext}`;
  }
  return `${base} (${Date.now()})${ext}`;
}

// העברת קובץ לתת-תיקיית ארכיון. אין ל-API פעולת "העבר", ולכן זה העתקה ואז מחיקה -
// ובסדר הזה דווקא: אם המחיקה תיכשל ייווצר כפל, ואילו בסדר ההפוך היה נמחק קובץ
// שלא הועתק. כפל הוא מטרד; אובדן קובץ הוא נזק.
export async function archiveFile(
  key: FolderKey,
  fileName: string,
  outcome: "done" | "failed",
): Promise<{ moved: boolean; error?: string }> {
  const root = await getFolderHandle(key);
  if (!root) return { moved: false, error: "התיקייה לא מוגדרת" };

  try {
    const source = await root.getFileHandle(fileName);
    const file = await source.getFile();
    const dir = await root.getDirectoryHandle(outcome === "done" ? DONE_DIR : FAILED_DIR, { create: true });
    const target = await dir.getFileHandle(await freeName(dir, fileName), { create: true });
    const writable = await target.createWritable();
    await writable.write(file);
    await writable.close();
    await root.removeEntry(fileName);
    return { moved: true };
  } catch (e) {
    return { moved: false, error: e instanceof Error ? e.message : "שגיאה בהעברת הקובץ" };
  }
}
