// שיחה עם אתר תלמוד (talmud.edu.gov.il) - כניסה, קוד SMS, והורדת דוחות.
//
// האתר הוא ASP.NET WebForms: כל לחיצה היא שליחת הטופס כולו (__VIEWSTATE וכו')
// עם __EVENTTARGET של הכפתור. כאן הטופס מפוענח מה-HTML ונשלח בחזרה כמו שדפדפן
// היה שולח אותו - בלי דפדפן. הדוחות הם SSRS: אחרי "הפק דו"ח" הדף מכיל כתובת יצוא
// (ExportUrlBase), ו-GET אליה עם Format=CSV מחזיר את הקובץ.
//
// הקובץ בלי תלות ב-Node: אותו קוד רץ בשרת (api/talmud-pull.js) וגם בדפדפן שבו
// מחוברים לתלמוד, לבדיקה. המפה: talmud-worker/TALMUD-REPORTS.md.

export const TALMUD_BASE = "https://talmud.edu.gov.il";

// הדוחות שמושכים. path = השם הקבוע של הדוח בתלמוד (שדה hidPath ברשימת הדוחות) -
// יציב יותר ממיקום השורה ברשימה. format: דוח שהמערכת כבר קולטת יורד באקסל, בדיוק
// כמו שהמשרד מוריד אותו ידנית; דוח חדש - CSV (כותרות קבועות באנגלית).
export const TALMUD_REPORTS = [
  { key: "payment_demand", path: "rptSupportRequestPerStudent", label: "דרישת תשלום - מפורט לפי תלמיד", format: "EXCELOPENXML" },
  { key: "students_list", path: "rptStudentsCountByMonth", label: "רשימת תלמידים למוסד", format: "EXCELOPENXML" },
  { key: "non_entitlement", path: "rptNonEntitlementReasonsDetailed", label: "פירוט סיבות אי זכאות" },
  { key: "institute_payments", path: "rptInstitutePaymentAll", label: "תשלומים למוסד" },
  { key: "bagatz", path: "rptBagatzSuspended", label: "זכאות בעקבות החלטת בג\"ץ" },
  { key: "payment_explanation", path: "rptInstitutePaymentExplanation", label: "הסבר תשלומים וקיזוזים לפי שנה" },
];

// ===== פענוח HTML (מספיק לטפסי WebForms; בלי ספרייה) =====

const decodeEntities = (s) => String(s ?? "")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&amp;/g, "&");

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? "");
  }
  for (const m of tag.matchAll(/\s(checked|selected|disabled)(?=[\s>/])/gi)) out[m[1].toLowerCase()] = out[m[1].toLowerCase()] ?? "true";
  return out;
}

/** הטופס הראשי של הדף: הכתובת, השדות לשליחה, והבחירות עם האפשרויות שלהן. */
export function parseForm(html) {
  const formTag = html.match(/<form\b[^>]*>/i)?.[0] ?? "";
  const action = attrs(formTag).action ?? "";
  const inputs = [];
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) inputs.push(attrs(m[0]));
  const selects = [];
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const a = attrs(`<select ${m[1]}>`);
    const options = [...m[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map((o) => {
      const oa = attrs(`<option ${o[1]}>`);
      return { value: oa.value ?? decodeEntities(o[2]).trim(), text: decodeEntities(o[2]).replace(/\s+/g, " ").trim(), selected: "selected" in oa };
    });
    selects.push({ name: a.name, id: a.id, onchange: a.onchange ?? "", options, disabled: "disabled" in a });
  }
  return { action, inputs, selects };
}

/** השדות כפי שדפדפן היה שולח אותם (בלי כפתורים, בלי תיבות לא מסומנות) */
export function formFields(form) {
  const fields = [];
  for (const i of form.inputs) {
    const type = (i.type ?? "text").toLowerCase();
    if (!i.name || "disabled" in i) continue;
    if (["submit", "button", "image", "reset", "file"].includes(type)) continue;
    if ((type === "checkbox" || type === "radio") && !("checked" in i)) continue;
    fields.push([i.name, i.value ?? (type === "checkbox" ? "on" : "")]);
  }
  for (const s of form.selects) {
    if (!s.name || s.disabled) continue;
    const opt = s.options.find((o) => o.selected) ?? s.options[0];
    if (opt) fields.push([s.name, opt.value]);
  }
  return fields;
}

const setField = (fields, name, value) => {
  const i = fields.findIndex(([n]) => n === name);
  if (i >= 0) fields[i] = [name, value]; else fields.push([name, value]);
};

// ===== חיבור: עוגיות והפניות =====

/**
 * fetchImpl: fetch רגיל. בשרת - manualCookies: true, והחיבור (עוגיות) נשמר כאן
 * כדי שאפשר יהיה להמשיך אותו בצעד הבא. בדפדפן - הדפדפן מנהל את העוגיות לבד.
 */
export function createSession({ fetchImpl = fetch, manualCookies = false, cookies = {} } = {}) {
  const jar = { ...cookies };
  const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
  const absorb = (res) => {
    if (!manualCookies) return;
    const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean);
    for (const c of list) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    }
  };

  async function request(url, { method = "GET", fields = null, binary = false, extraHeaders = {} } = {}) {
    let target = new URL(url, TALMUD_BASE).href;
    let body = fields ? new URLSearchParams(fields).toString() : undefined;
    let m = method;
    for (let hop = 0; hop < 6; hop++) {
      const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", ...extraHeaders };
      if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
      if (manualCookies && Object.keys(jar).length) headers.Cookie = cookieHeader();
      const res = await fetchImpl(target, { method: m, headers, body, redirect: manualCookies ? "manual" : "follow", credentials: "include" });
      absorb(res);
      if (manualCookies && res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        target = new URL(res.headers.get("location"), target).href;
        m = "GET"; body = undefined;
        continue;
      }
      if (binary) return { url: res.url || target, status: res.status, headers: res.headers, bytes: new Uint8Array(await res.arrayBuffer()) };
      return { url: res.url || target, status: res.status, html: await res.text() };
    }
    throw new Error("יותר מדי הפניות מתלמוד");
  }

  /**
   * לחיצה על פקד בדף: שולחת את הטופס עם __EVENTTARGET (או כפתור submit).
   * asyncPanel: לחיצה בתוך UpdatePanel (בקשת רקע של ASP.NET AJAX). התשובה היא
   * "delta" ולא דף - למשל window.open לדף הבא.
   */
  async function postBack(page, { target = "", submit = null, set = [], asyncPanel = null } = {}) {
    const form = parseForm(page.html);
    const fields = formFields(form);
    for (const [n, v] of set) setField(fields, n, v);
    setField(fields, "__EVENTTARGET", target);
    setField(fields, "__EVENTARGUMENT", "");
    if (submit) fields.push(submit);
    let extraHeaders = {};
    if (asyncPanel) {
      setField(fields, asyncPanel.scriptManager, `${asyncPanel.panel}|${target}`);
      setField(fields, "__ASYNCPOST", "true");
      extraHeaders = { "X-MicrosoftAjax": "Delta=true", "X-Requested-With": "XMLHttpRequest" };
    }
    const action = form.action ? new URL(form.action, page.url).href : page.url;
    return request(action, { method: "POST", fields, extraHeaders });
  }

  return { request, postBack, cookies: () => ({ ...jar }) };
}

// ===== זיהוי המסך =====
//
// מסך הכניסה של תלמוד (נבדק 2026-11-18): txtUserName + txtPassword ו"כניסה"
// (LoginButton). אחרי סיסמה נכונה תלמוד שולח SMS עם קוד בן 5 ספרות, וחלון קטן
// באותו דף (pnlPopMFASendSMS) מבקש אותו: txtMFACode ו"זה הקוד" (btnMFAVerifySMS).
// אחרי קוד נכון הדף קורא ל-Login(), שלוחץ על כפתור נסתר (btnLog) - ורק אז נכנסים.

export const isLoggedIn = (html) => /ucLogOut|lnkLogOut/.test(html);

const spanText = (html, id) => {
  const m = html.match(new RegExp(`<span[^>]*\\bid=["']${id}["'][^>]*>([^<]*)<`));
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : "";
};

/**
 * הודעת השגיאה של תלמוד. רק מהתוויות שמראות שגיאה בפועל - בדף יש גם הודעות
 * מוסתרות שקיימות תמיד (למשל "שם משתמש יכול להכיל אותיות באנגלית ומספרים בלבד").
 */
function pageError(html) {
  return spanText(html, "lblError") || spanText(html, "lblMFAError") || null;
}

/** תלמוד שלח SMS ומחכה לקוד: מספר הטלפון מולא בהודעה, או שנשמר מזהה לאימות */
const isSmsStep = (html) => {
  const phone = spanText(html, "lblPhone");
  return (phone && !phone.includes("@@@")) || /name="hidMFAUserID"[^>]*value="[^"]+"/.test(html);
};

/** הדף ביקש להשלים את הכניסה (קריאה ל-Login() או ל-cLogin(), לא ההגדרה שלהן) */
const callsLogin = (html) => /(?<!function\s+)\bc?Login\(\)\s*;/.test(html);

/** השלמת כניסה אחרי שהדף ביקש: הכפתור הנסתר btnLog */
async function completeLogin(session, page) {
  for (let i = 0; i < 2 && !isLoggedIn(page.html) && callsLogin(page.html); i++) {
    page = await session.postBack(page, { submit: ["btnLog", ""] });
  }
  return page;
}

// ===== כניסה =====

/**
 * @returns {{ step: "sms" | "in" | "error", page?: {url,html}, message?: string }}
 */
export async function login(session, username, password) {
  const loginPage = await session.request("/Login.aspx");
  const fields = parseForm(loginPage.html).inputs.map((i) => i.name);
  if (!fields.includes("txtUserName") || !fields.includes("txtPassword")) {
    return { step: "error", message: "דף הכניסה של תלמוד השתנה - צריך לעדכן את המתכון" };
  }
  let page = await session.postBack(loginPage, {
    target: "LoginButton", set: [["txtUserName", username.trim()], ["txtPassword", password]],
  });
  if (isSmsStep(page.html)) return { step: "sms", page };
  page = await completeLogin(session, page);
  if (isLoggedIn(page.html)) return { step: "in", page };
  if (isSmsStep(page.html)) return { step: "sms", page };
  return { step: "error", message: pageError(page.html) ?? "תלמוד לא אישר את הכניסה (שם משתמש או סיסמה)" };
}

/** @returns {{ ok: boolean, page?: {url,html}, message?: string }} */
export async function submitSmsCode(session, smsPage, code) {
  let page = await session.postBack(smsPage, { target: "btnMFAVerifySMS", set: [["txtMFACode", String(code).trim()]] });
  page = await completeLogin(session, page);
  if (isLoggedIn(page.html)) return { ok: true, page };
  return { ok: false, message: pageError(page.html) ?? "תלמוד דחה את הקוד" };
}

// ===== הורדת דוח =====

const MONTH_RE = /^(\d{2})\/(\d{4})$/;
// "<Select a Value>" או "-בחר-" = לא נבחר. "בחירה לפי תז / דרכון" היא בחירה אמיתית.
const isPlaceholder = (o) => !o || /select a value|^-?בחר-?$/i.test(o.text);

/** מה לבחור בשדה של הדוח. null = להשאיר. month null = בלי חודש (אישור לימודים). */
function chooseOption(select, month) {
  const [y, m] = (month ?? "").split("-");
  const monthText = `${m}/${y}`;
  const real = select.options.filter((o) => !isPlaceholder(o));
  const current = select.options.find((o) => o.selected) ?? select.options[0];
  if (real.some((o) => MONTH_RE.test(o.text))) return month ? real.find((o) => o.text === monthText) ?? null : null;
  if (!isPlaceholder(current)) return null;
  // שדה חובה שלא נבחר: "כל ..." (כל הסניפים / כל החודש), שנה, או האפשרות היחידה
  return real.find((o) => /^כל /.test(o.text))
    ?? real.find((o) => o.text === y)
    ?? (real.length === 1 ? real[0] : null);
}

// ===== עדכון הדף אחרי בקשת רקע (כמו שהדפדפן עושה) =====

/** תשובת רקע של ASP.NET AJAX: רשומות "אורך|סוג|מזהה|תוכן|" */
export function parseDelta(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const a = text.indexOf("|", i);
    if (a < 0) break;
    const len = Number(text.slice(i, a));
    if (Number.isNaN(len)) break;
    const b = text.indexOf("|", a + 1);
    const c = text.indexOf("|", b + 1);
    out.push({ type: text.slice(a + 1, b), id: text.slice(b + 1, c), content: text.substr(c + 1, len) });
    i = c + 1 + len + 1;
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** מחליף את התוכן של אלמנט לפי id (עם ספירת תגיות מקוננות מאותו סוג) */
export function replaceInnerById(html, id, content) {
  const open = html.match(new RegExp(`<(\\w+)\\b[^>]*\\bid=["']${escapeRe(id)}["'][^>]*>`, "i"));
  if (!open) return html;
  const tag = open[1].toLowerCase();
  const start = open.index + open[0].length;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = start;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(0, start) + content + html.slice(m.index);
  }
  return html;
}

/** קובע ערך לשדה input בדף (או מוסיף שדה נסתר אם אין) */
function setInputInHtml(html, name, value, { check = false } = {}) {
  const re = new RegExp(`<input\\b[^>]*\\bname=["']${escapeRe(name)}["'][^>]*>`, "i");
  const esc = String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  if (!re.test(html)) {
    return html.replace(/<\/form>/i, `<input type="hidden" name="${name}" value="${esc}" /></form>`);
  }
  return html.replace(re, (tag) => {
    let t = /\bvalue=/.test(tag) ? tag.replace(/\bvalue=("[^"]*"|'[^']*'|[^\s>]*)/, `value="${esc}"`) : tag.replace(/\s*\/?>$/, ` value="${esc}" />`);
    if (check && !/\schecked/.test(t)) t = t.replace(/\s*\/?>$/, " checked />");
    return t;
  });
}

function applyDelta(html, delta) {
  let out = html;
  for (const e of delta) {
    if (e.type === "updatePanel") out = replaceInnerById(out, e.id, e.content);
    else if (e.type === "hiddenField") out = setInputInHtml(out, e.id, e.content);
  }
  return out;
}

/**
 * מה שהדפדפן משנה לפני שליחה, ובלעדיו השרת דוחה את הבקשה בשקט:
 * טקסט "סימן מים" ("<מספרים בלבד>") נשלח ריק, ותאריך במסכה נשלח בלי השעה.
 */
function browserLikeFields(form) {
  const fields = formFields(form).map(([k, v]) => {
    let value = String(v);
    if (/^<[^>]*>$/.test(value)) value = "";
    const date = value.match(/^(\d{1,2}\/\d{1,2}\/\d{4}) 0:00:00$/);
    if (date) value = date[1];
    if (/CollapsiblePanelExtender\d*_ClientState$/.test(k) && value === "") value = "false";
    return [k, value];
  });
  fields.push(["hiddenInputToUpdateATBuffer_CommonToolkitScripts", "1"]);
  return fields;
}

/** בקשת רקע לפקד בתוך UpdatePanel. מחזירה את הדף אחרי העדכון, ואת התשובה. */
async function asyncPostBack(session, page, { panel, target = "", submit = null }) {
  const fields = browserLikeFields(parseForm(page.html))
    .filter(([k]) => !["__EVENTTARGET", "__EVENTARGUMENT", "__ASYNCPOST", "ctl00$ScriptManager1"].includes(k));
  fields.push(["ctl00$ScriptManager1", `${panel}|${target || submit?.[0]}`], ["__EVENTTARGET", target], ["__EVENTARGUMENT", ""], ["__ASYNCPOST", "true"]);
  if (submit) fields.push(submit);
  const res = await session.request(page.url, {
    method: "POST", fields, extraHeaders: { "X-MicrosoftAjax": "Delta=true", "X-Requested-With": "XMLHttpRequest" },
  });
  const delta = parseDelta(res.html);
  return { page: { url: page.url, html: applyDelta(page.html, delta) }, delta, raw: res.html };
}

/** פותח את מסך הדוח (ReportWin.aspx) של הדוח שברשימה */
async function openReportWindow(session, report) {
  let page = await session.request("/Reports/ReportResult.aspx");
  if (!isLoggedIn(page.html)) throw new Error("החיבור לתלמוד נותק");
  // תיבת הסימון של הדוח: באותה שורה כמו hidPath עם שם הדוח
  const findBox = (html) => {
    const form = parseForm(html);
    const hid = form.inputs.find((i) => i.name?.endsWith("$hidPath") && i.value === report.path);
    if (!hid) return null;
    return form.inputs.find((i) => i.name === `${hid.name.slice(0, -"hidPath".length)}grdRdo`) ?? null;
  };
  let box = findBox(page.html);
  if (!box) {
    // הרשימה מקופלת - פותחים את "דוחות למוסדות"
    page = await session.postBack(page, { target: "ctl00$ContentPlaceHolder1$gvTest$ctl02$BtnShowReportList" });
    box = findBox(page.html);
  }
  if (!box?.name) throw new Error(`הדוח "${report.label}" לא נמצא ברשימת הדוחות`);

  // סימון הדוח, כמו fnCheckUnCheck בדף: תיבת הסימון, שני שדות נסתרים, ולחיצה
  // (ברקע) על btnCheckRpt. התשובה ממלאת את מספר הדוח בשדות נסתרים בדף.
  let html = setInputInHtml(page.html, box.name, box.value ?? "0", { check: true });
  html = setInputInHtml(html, "ctl00$ContentPlaceHolder1$HdnTopicRow", box.value ?? "0");
  html = setInputInHtml(html, "ctl00$ContentPlaceHolder1$hidIsChecked", "true");
  ({ page } = await asyncPostBack(session, { url: page.url, html }, {
    panel: "ctl00$ContentPlaceHolder1$UpbtnCheckRpt", submit: ["ctl00$ContentPlaceHolder1$btnCheckRpt", ""],
  }));

  // "הפק דו"ח" - התשובה פותחת את ReportWin.aspx, שזוכר את הדוח שנבחר
  const generated = await asyncPostBack(session, page, {
    panel: "ctl00$ContentPlaceHolder1$UPbtnReportGenerate", target: "ctl00$ContentPlaceHolder1$btnReportGenerate",
  });
  if (!/ReportWin\.aspx/.test(generated.raw)) throw new Error(`מסך הדוח "${report.label}" לא נפתח`);
  page = await session.request("/Reports/ReportWin.aspx");
  if (!/ReportViewer1/.test(page.html)) throw new Error(`מסך הדוח "${report.label}" לא נפתח`);
  return page;
}

/**
 * ממלא את שדות הדוח ומפיק אותו. מחזיר את כתובת היצוא (בלי הפורמט).
 * month: לבחירת החודש בשדות החודש. text: ערכים לשדות טקסט לפי שם השדה.
 */
async function viewReport(session, page, report, { month = null, text = {} } = {}) {
  // השדות לפי הסדר. שדה עם postback אוטומטי (עמותה → סניפים) נשלח מיד, כדי
  // שהשדות שתלויים בו יתמלאו כמו בדפדפן.
  for (let pass = 0; pass < 12; pass++) {
    const f = parseForm(page.html);
    const next = f.selects.find((s) => s.name?.startsWith("ReportViewer1$ctl00$") && !s.disabled && (() => {
      const choice = chooseOption(s, month);
      const current = s.options.find((o) => o.selected) ?? s.options[0];
      return choice && choice.value !== current?.value;
    })());
    if (!next) break;
    const choice = chooseOption(next, month);
    if (/__doPostBack/.test(next.onchange)) {
      page = await session.postBack(page, { target: next.name, set: [[next.name, choice.value]] });
    } else {
      // בלי postback: מסמנים בטופס עצמו, ונשלח עם "הפק דו"ח"
      page = { ...page, html: page.html.replace(new RegExp(`(<select[^>]*name="${escapeRe(next.name)}"[\\s\\S]*?</select>)`), (block) =>
        block.replace(/\sselected(="selected")?/g, "").replace(new RegExp(`(<option[^>]*value="${escapeRe(choice.value)}")`), "$1 selected")) };
    }
  }

  const missing = parseForm(page.html).selects.filter((s) => s.name?.startsWith("ReportViewer1$ctl00$") && !s.disabled
    && isPlaceholder(s.options.find((o) => o.selected) ?? s.options[0]));
  if (missing.length) throw new Error(`בדוח "${report.label}" נשאר שדה בלי בחירה - צריך לעדכן את המתכון`);

  let html = page.html;
  for (const [name, value] of Object.entries(text)) {
    if (!parseForm(html).inputs.some((i) => i.name === name)) throw new Error(`בדוח "${report.label}" חסר השדה ${name} - צריך לעדכן את המתכון`);
    html = setInputInHtml(html, name, value);
  }

  const viewBtn = parseForm(html).inputs.find((i) => i.name === "ReportViewer1$ctl00$ctl00");
  const viewed = await session.postBack({ ...page, html }, { submit: ["ReportViewer1$ctl00$ctl00", viewBtn?.value ?? "View Report"] });

  // כתובת היצוא מופיעה בדף כמחרוזת בתוך הסקריפט של ReportViewer
  const m = viewed.html.match(/["'](\/Reserved\.ReportViewerWebControl\.axd\?[^"']*OpType=Export[^"']*)["']/);
  if (!m) throw new Error(`הדוח "${report.label}" לא הופק (אין כתובת יצוא)`);
  return m[1].split("\\u0026").join("&").split("&amp;").join("&");
}

async function exportFile(session, exportBase, format, label) {
  const file = await session.request(exportBase + format, { binary: true });
  if (file.status !== 200 || !file.bytes.length) throw new Error(`יצוא "${label}" נכשל (${file.status})`);
  return file;
}

/**
 * מוריד דוח אחד לחודש month (YYYY-MM-01).
 * @returns {{ fileName: string, bytes: Uint8Array, contentType: string }}
 */
export async function downloadReport(session, report, month) {
  const page = await openReportWindow(session, report);
  const exportBase = await viewReport(session, page, report, { month });
  const format = report.format ?? "CSV";
  const ext = format === "EXCELOPENXML" ? "xlsx" : "csv";
  const file = await exportFile(session, exportBase, format, report.label);
  const disp = file.headers.get("content-disposition") ?? "";
  const name = disp.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1] ?? `${report.key}.${ext}`;
  const [y, mm] = month.split("-");
  return {
    fileName: `${decodeURIComponent(name).replace(/\.\w+$/, "")}-${y}-${mm}.${ext}`,
    bytes: file.bytes,
    contentType: ext === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

// ===== אישור לימודים לתלמוד אחד =====

// "הפקת אישורי לימודים": שם התלמיד נשאר "בחירה לפי תז / דרכון", והמספר בשדה הטקסט
export const STUDY_APPROVAL = {
  key: "study_approval",
  path: "rptStudyApprovalMultiple",
  label: "אישור לימודים",
  idField: "ReportViewer1$ctl00$ctl13$txtValue",
};

const safeName = (s) => String(s ?? "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * אישור לימודים (PDF) לתלמיד אחד. תלמיד שאינו בעמותה הזו בתלמוד - found: false
 * (היצוא מגיע ריק: CSV עם שורת כותרות בלבד), בלי לשמור אישור ריק.
 */
export async function downloadCertificate(session, externalId, name) {
  const page = await openReportWindow(session, STUDY_APPROVAL);
  const exportBase = await viewReport(session, page, STUDY_APPROVAL, { text: { [STUDY_APPROVAL.idField]: externalId } });
  const csv = new TextDecoder().decode((await exportFile(session, exportBase, "CSV", STUDY_APPROVAL.label)).bytes);
  if (csv.split(/\r?\n/).filter((l) => l.trim()).length <= 1) return { found: false };
  const pdf = await exportFile(session, exportBase, "PDF", STUDY_APPROVAL.label);
  const who = safeName(name) || externalId;
  return {
    found: true,
    fileName: `אישור לימודים - ${who} - ${safeName(externalId)}.pdf`,
    bytes: pdf.bytes,
    contentType: "application/pdf",
  };
}
