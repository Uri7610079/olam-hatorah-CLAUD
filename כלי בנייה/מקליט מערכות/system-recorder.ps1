#Requires -Version 5.1
<#
================================================================================
  system-recorder.ps1 — מקליט מערכות. כלי בנייה, לא כלי הפעלה.

  לשם מה
  -------
  לפני שאפשר לבנות סקרייפר למערכת כלשהי, צריך לדעת איך היא בנויה: לאילו
  כתובות היא פונה, אילו שדות יש בטפסים, ומה חוזר מהשרת. הכלי הזה עונה על
  כך בלי לנחש - נכנסים למערכת ידנית, והוא רושם ברקע את מה שנדרש.

  הכלי אינו קשור למערכת מסוימת. הוא מקבל רשימת מערכות מקובץ "מערכות.json",
  ושומר לכל אחת הקלטות ופרופיל דפדפן נפרדים. הוספת מערכת = שורה בקובץ.

  ===== מה *לא* נרשם, בשום מצב =====
  זו נקודת התכנון המרכזית. מערכות כאלה מכילות נתונים אישיים של אלפי אנשים,
  והקובץ שנוצר נועד להישלח. לכן, מעצם הבנייה:

     * ערכים שהוקלדו לא נרשמים לעולם - לא סיסמאות ולא שום דבר אחר.
       נרשם רק "הוקלדו 9 תווים בשדה X".
     * תוכן התשובות מהשרת לא נרשם. נרשמים רק *שמות* השדות, סוגיהם ומספר
       השורות: "{Students: [2 × {Id: string, Name: string}]}".
     * כל רצף של 5 ספרות ומעלה מוחלף ב-<מספר>, בכל מקום - בכתובות, בטקסט
       ובשמות שדות. תעודת זהות היא 9 ספרות ומספר עמותה 9; שתיהן נחסמות.
       חמש היא סף מחמיר בכוונה: עדיף למסך גם מספר סמל מוסד מאשר להחמיץ
       תעודת זהות אחת.
     * צילומי מסך כבויים כברירת מחדל. ‎-WithScreenshots‎ מפעיל אותם, והם
       נשמרים מקומית בלבד.

  הפלט נכתב כטקסט קריא במפורש, כדי שאפשר יהיה לעבור עליו לפני שליחה.

  שימוש:
     לחיצה כפולה על "הקלטת מערכת.bat"          (בוחרים מערכת מתפריט)
     .\system-recorder.ps1 -System talmud
     .\system-recorder.ps1 -System talmud -Url "https://..." -Name "עמותה-א"
================================================================================
#>

[CmdletBinding()]
param(
    # מפתח המערכת מתוך "מערכות.json". אם לא ניתן - מוצג תפריט.
    [string] $System,
    # כתובת פתיחה. גוברת על מה שרשום ברישום המערכות.
    [string] $Url,
    # תווית להקלטה, להבדלה בין הרצות (למשל שם עמותה). אופציונלי.
    [string] $Name,
    # צילומי מסך בכל ניווט. מקומי בלבד - צילום מסך מכיל נתונים אמיתיים.
    [switch] $WithScreenshots
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Runtime = Join-Path $Root 'runtime'
$SystemsFile = Join-Path $Root 'מערכות.json'
New-Item -ItemType Directory -Force -Path $Runtime | Out-Null

function Write-Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }

# --------------------------------------------------------- רישום המערכות ----
# קובץ ולא רשימה בקוד: הוספת מערכת חדשה היא שורה, לא עריכת סקריפט.
function New-SystemsFile {
    if (Test-Path -LiteralPath $SystemsFile) { return }
    $default = [ordered]@{
        _הסבר  = 'רשימת המערכות להקלטה. מפתח = שם באנגלית בלי רווחים, משמש לשמות תיקיות.'
        מערכות = @(
            [ordered]@{ מפתח = 'talmud'; שם = 'מערכת תלמוד'; כתובת = '' },
            [ordered]@{ מפתח = 'bimot';  שם = 'בימות המשיח'; כתובת = '' }
        )
    }
    $json = $default | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText($SystemsFile, $json, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "  נוצר קובץ המערכות: $SystemsFile"
}

function Get-Systems {
    New-SystemsFile
    try {
        $raw = Get-Content -LiteralPath $SystemsFile -Raw -Encoding UTF8
        $raw = "$raw".Replace([string][char]0xFEFF, '').Trim()
        $obj = $raw | ConvertFrom-Json
    } catch {
        throw "קובץ המערכות אינו תקין ($SystemsFile): $($_.Exception.Message)"
    }
    $list = @($obj.מערכות | Where-Object { $_ -and $_.מפתח })
    if (-not $list.Count) { throw "אין אף מערכת רשומה ב-$SystemsFile" }
    return $list
}

$systems = Get-Systems

if (-not $System) {
    Write-Host ''
    Write-Host 'איזו מערכת להקליט?' -ForegroundColor Cyan
    for ($i = 0; $i -lt $systems.Count; $i++) {
        Write-Host ("  {0}. {1}  ({2})" -f ($i + 1), $systems[$i].שם, $systems[$i].מפתח)
    }
    Write-Host ''
    $choice = Read-Host 'מספר'
    $idx = 0
    if (-not [int]::TryParse($choice, [ref] $idx) -or $idx -lt 1 -or $idx -gt $systems.Count) {
        Write-Host 'בחירה לא תקינה. לא הופעל כלום.' -ForegroundColor Red
        exit 1
    }
    $chosen = $systems[$idx - 1]
} else {
    $chosen = $systems | Where-Object { $_.מפתח -eq $System } | Select-Object -First 1
    if (-not $chosen) {
        Write-Host "אין מערכת בשם '$System'. מערכות רשומות: $(($systems | ForEach-Object { $_.מפתח }) -join ', ')" -ForegroundColor Red
        exit 1
    }
}

$SysKey = "$($chosen.מפתח)"
$SysName = if ($chosen.שם) { "$($chosen.שם)" } else { $SysKey }
$StartUrl = if ($Url) { $Url } elseif ($chosen.כתובת) { "$($chosen.כתובת)" } else { $null }

$Recordings = Join-Path (Join-Path $Root 'הקלטות') $SysKey
New-Item -ItemType Directory -Force -Path $Recordings | Out-Null

# ------------------------------------------------------------------ Node -----
# אותה דרישת גרסה כמו בסקרייפר הבנקאי, מאותה סיבה: puppeteer ^24 דורש Node
# חדש, ו-npm רק מזהיר על engines ולא עוצר - כך שהתקנה על Node ישן "מצליחה"
# ואז נופלת בהמשך בשגיאת דפדפן חסרת פשר.
$MinNodeVersion = [version]'22.22.2'

function Get-NodeVersion($exePath) {
    try { $raw = & $exePath -v 2>$null } catch { return $null }
    if ("$raw".Trim() -match '^v(\d+)\.(\d+)\.(\d+)') { return [version]"$($Matches[1]).$($Matches[2]).$($Matches[3])" }
    return $null
}

# מחפשים Node שכבר קיים לפני שמורידים. אם סקרייפר הבנק הותקן על המחשב הזה,
# יש בו Node ודפדפן מוכנים - ואין סיבה להוריד 150 מגה פעם שנייה. החיפוש עולה
# עד שתי רמות, כדי לתפוס גם מבנה של "כלי בנייה\מקליט מערכות" לצד הסקרייפר.
function Get-SearchRoots {
    $roots = @()
    $p = $Root
    for ($i = 0; $i -lt 3 -and $p; $i++) {
        $p = Split-Path -Parent $p
        if ($p) { $roots += $p }
    }
    return $roots
}

function Find-InSiblings([string] $relative) {
    foreach ($base in (Get-SearchRoots)) {
        foreach ($dir in (Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue)) {
            $c = Join-Path $dir.FullName $relative
            if (Test-Path -LiteralPath $c) { return $c }
        }
    }
    return $null
}

function Find-ExistingNode {
    $own = Join-Path $Runtime 'node\node.exe'
    if (Test-Path -LiteralPath $own) {
        $v = Get-NodeVersion $own
        if ($v -and $v -ge $MinNodeVersion) { return $own }
    }
    $sibling = Find-InSiblings 'runtime\node\node.exe'
    if ($sibling) {
        $v = Get-NodeVersion $sibling
        if ($v -and $v -ge $MinNodeVersion) { return $sibling }
    }
    $sys = Get-Command node -ErrorAction SilentlyContinue
    if ($sys) {
        $v = Get-NodeVersion $sys.Source
        if ($v -and $v -ge $MinNodeVersion) { return $sys.Source }
    }
    return $null
}

function Install-LocalNode {
    Write-Step 'מתקין Node.js מקומי (פעם אחת, דורש אינטרנט)'
    $arch = if ($env:PROCESSOR_ARCHITECTURE -match 'ARM64') { 'win-arm64' } else { 'win-x64' }
    try { $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing }
    catch { throw "לא ניתן להגיע ל-nodejs.org. נדרש אינטרנט בהרצה הראשונה. ($($_.Exception.Message))" }

    $lts = $null
    foreach ($c in ($index | Where-Object { $_.lts })) {
        if ("$($c.version)" -match '^v(\d+)\.(\d+)\.(\d+)$') {
            if ([version]"$($Matches[1]).$($Matches[2]).$($Matches[3])" -ge $MinNodeVersion) { $lts = $c; break }
        }
    }
    if (-not $lts) { throw "אין גרסת Node LTS בגרסה $MinNodeVersion ומעלה באתר nodejs.org." }

    $name = "node-$($lts.version)-$arch"
    $zip = Join-Path $Runtime "$name.zip"
    $unpacked = Join-Path $Runtime $name
    $localNode = Join-Path $Runtime 'node'

    Write-Host "  מוריד $($lts.version)..."
    Invoke-WebRequest -Uri "https://nodejs.org/dist/$($lts.version)/$name.zip" -OutFile $zip -UseBasicParsing
    if (Test-Path $unpacked) { Remove-Item -Recurse -Force $unpacked }
    Expand-Archive -Path $zip -DestinationPath $Runtime -Force
    Remove-Item $zip -Force
    # מוחקים את היעד לפני ההעברה: Move-Item -Force על תיקייה קיימת מעביר
    # *לתוכה*, ואז node.exe מסתיים בנתיב מקונן ולא נמצא.
    if (Test-Path $localNode) { Remove-Item -Recurse -Force $localNode }
    Move-Item $unpacked $localNode -Force
    $exe = Join-Path $localNode 'node.exe'
    if (-not (Get-NodeVersion $exe)) { throw "התקנת Node נכשלה - node.exe אינו רץ ב-$exe" }
    return $exe
}

$NodeExe = Find-ExistingNode
if ($NodeExe) { Write-Host "  Node: $NodeExe  (v$(Get-NodeVersion $NodeExe))" }
else { $NodeExe = Install-LocalNode }
$env:Path = (Split-Path -Parent $NodeExe) + ";$env:Path"
$NpmCmd = Join-Path (Split-Path -Parent $NodeExe) 'npm.cmd'
if (-not (Test-Path -LiteralPath $NpmCmd)) { $NpmCmd = 'npm' }

# --------------------------------------------------------------- puppeteer ---
$env:npm_config_cache = Join-Path $Runtime 'npm-cache'

# הדפדפן הוא ההורדה הכבדה כאן (כ-150 מגה). אם כבר קיים במחשב - משתמשים בו.
$ownCache = Join-Path $Runtime 'puppeteer'
if (Test-Path -LiteralPath $ownCache) {
    $env:PUPPETEER_CACHE_DIR = $ownCache
} else {
    $shared = Find-InSiblings 'runtime\puppeteer'
    if ($shared) {
        Write-Host "  משתמש בדפדפן שכבר הותקן: $shared"
        $env:PUPPETEER_CACHE_DIR = $shared
    } else {
        $env:PUPPETEER_CACHE_DIR = $ownCache
    }
}

$pkgJson = Join-Path $Root 'package.json'
if (-not (Test-Path -LiteralPath $pkgJson)) {
    '{ "name": "system-recorder", "private": true, "dependencies": { "puppeteer": "^24.0.0" } }' |
        Set-Content -Path $pkgJson -Encoding UTF8
}

if (-not (Test-Path -LiteralPath (Join-Path $Root 'node_modules\puppeteer'))) {
    Write-Step 'מתקין puppeteer (פעם אחת)'
    Push-Location $Root
    try {
        # ‎$ErrorActionPreference='Continue'‎ סביב npm: הוא כותב אזהרות ל-stderr
        # גם בהתקנה מוצלחת, ותחת 'Stop' כל אזהרה כזו הופכת לשגיאה עוצרת.
        # אותו לקח בדיוק מהמתזמן של סקרייפר הבנק.
        $prev = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        & $NpmCmd install --no-audit --no-fund 2>&1 | ForEach-Object { Write-Host "  $_" }
        $code = $LASTEXITCODE
        $ErrorActionPreference = $prev
        if ($code -ne 0) { throw "npm install נכשל (קוד $code)" }
    } finally { Pop-Location }
}

# הורדת הדפדפן עצמו. במקרים מסוימים npm חוסם סקריפטי התקנה, ואז החבילה
# מותקנת אך הדפדפן חסר - וזה מתגלה רק בהרצה, בשגיאה שאינה מרמזת על הסיבה.
if (-not (Test-Path -LiteralPath (Join-Path $env:PUPPETEER_CACHE_DIR 'chrome'))) {
    Write-Step 'מוריד את הדפדפן (פעם אחת, כ-150 מגה)'
    $installer = Join-Path $Root 'node_modules\puppeteer\install.mjs'
    if (Test-Path -LiteralPath $installer) {
        $prev = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        & $NodeExe $installer 2>&1 | ForEach-Object { Write-Host "  $_" }
        $ErrorActionPreference = $prev
    }
}

# ------------------------------------------------------------- recorder.js ---
# נכתב מכאן ולא נשמר כקובץ נפרד, בדיוק כמו בסקרייפר הבנקאי: קובץ אחד לערוך,
# ואין סיכון שגרסת ה-JS תיפרד מגרסת ה-PS1.
$RecorderJs = Join-Path $Root 'recorder.js'
$js = @'
'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const args = { url: null, shots: false, name: '', out: null, profile: null, system: '' };
for (let i = 2; i < process.argv.length; i++) {
  const t = process.argv[i];
  if (t === '--url') args.url = process.argv[++i];
  else if (t === '--shots') args.shots = true;
  else if (t === '--name') args.name = process.argv[++i] || '';
  else if (t === '--system') args.system = process.argv[++i] || '';
  else if (t === '--out') args.out = process.argv[++i];
  else if (t === '--profile') args.profile = process.argv[++i];
}

// ===== מיסוך - הלב של הכלי הזה =====
// כל טקסט שנרשם עובר כאן. רצף של 5 ספרות ומעלה מוחלף: תעודת זהות היא 9
// ספרות, מספר עמותה 9, מספר חשבון 10. חמש היא סף מחמיר בכוונה - עדיף
// למסך גם סמל מוסד מאשר להחמיץ תעודת זהות אחת. שנים (4 ספרות) נשארות,
// והן שימושיות לזיהוי פרמטרים.
function mask(v) {
  if (v == null) return '';
  return String(v).replace(/\d{5,}/g, '<מספר>');
}
function clip(v, n) {
  const s = mask(v).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

const events = [];
function add(kind, data) {
  events.push(Object.assign({ t: new Date().toISOString().slice(11, 19), kind: kind }, data));
}

// ===== מה שמוזרק לדף =====
// רושם לחיצות והקלדות. הערך שהוקלד לא עוזב את הדפדפן - נשלח רק אורכו.
const PAGE_HOOK = `
(function () {
  if (window.__sysRecHooked) return;
  window.__sysRecHooked = true;
  function describe(el) {
    if (!el || !el.tagName) return {};
    var cls = (el.className && el.className.toString ? el.className.toString() : '').slice(0, 60);
    var txt = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '');
    return {
      tag: el.tagName, id: el.id || '',
      name: el.getAttribute('name') || '',
      type: el.getAttribute('type') || '',
      cls: cls, text: String(txt).slice(0, 60)
    };
  }
  document.addEventListener('click', function (e) {
    try {
      var el = e.target;
      // עולים עד לאלמנט לחיץ אמיתי - לחיצה נוחתת לרוב על span שבתוך הכפתור.
      for (var i = 0; i < 4 && el && el.tagName && !/^(A|BUTTON|INPUT|SELECT)$/.test(el.tagName); i++) el = el.parentElement;
      window.__sysRec(JSON.stringify({ k: 'click', el: describe(el || e.target) }));
    } catch (err) {}
  }, true);
  document.addEventListener('change', function (e) {
    try {
      var el = e.target;
      var d = describe(el);
      // *** הערך עצמו לעולם אינו נשלח - רק אורכו. ***
      d.text = '';
      window.__sysRec(JSON.stringify({ k: 'input', el: d, len: (el.value || '').length }));
    } catch (err) {}
  }, true);
  document.addEventListener('submit', function (e) {
    try { window.__sysRec(JSON.stringify({ k: 'submit', el: describe(e.target) })); } catch (err) {}
  }, true);
})();
`;

// שמות השדות וסוגיהם בלבד, לעולם לא הערכים. זה כל מה שדרוש כדי לדעת איך
// לפרק את התשובה בסקרייפר, וזה גם כל מה שבטוח לשלוח.
function shapeOf(value, depth) {
  depth = depth || 0;
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    if (depth > 3) return '[…]';
    return '[' + value.length + ' × ' + shapeOf(value[0], depth + 1) + ']';
  }
  if (typeof value === 'object') {
    if (depth > 3) return '{…}';
    const keys = Object.keys(value).slice(0, 25);
    return '{' + keys.map((k) => k + ': ' + shapeOf(value[k], depth + 1)).join(', ') + '}';
  }
  return typeof value;
}

async function main() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized', '--user-data-dir=' + args.profile],
  });

  const pages = await browser.pages();
  const page = pages.length ? pages[0] : await browser.newPage();

  await page.exposeFunction('__sysRec', (raw) => {
    try {
      const e = JSON.parse(raw);
      const el = e.el || {};
      const d = {
        tag: el.tag, id: mask(el.id), name: mask(el.name), type: el.type,
        cls: clip(el.cls, 60), text: clip(el.text, 60),
      };
      if (e.k === 'input') { d.chars = e.len; }
      add(e.k, d);
    } catch (err) {}
  });
  await page.evaluateOnNewDocument(PAGE_HOOK);

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) add('ניווט', { url: mask(frame.url()) });
  });

  page.on('request', (req) => {
    try {
      const rt = req.resourceType();
      if (rt !== 'xhr' && rt !== 'fetch' && req.method() === 'GET') return;
      if (/\.(js|css|png|jpe?g|svg|gif|woff2?|ico|map)(\?|$)/i.test(req.url())) return;
      const rec = { method: req.method(), url: mask(req.url().split('?')[0]) };
      const q = req.url().split('?')[1];
      if (q) rec.params = mask(q).slice(0, 200);
      const body = req.postData();
      if (body) {
        // גוף הבקשה מכיל סיסמאות. נרשמים שמות השדות בלבד.
        try { rec.bodyFields = Object.keys(JSON.parse(body)).join(', '); }
        catch (e) { rec.bodyFields = body.split('&').map((p) => p.split('=')[0]).slice(0, 20).join(', '); }
      }
      add('בקשה', rec);
    } catch (err) {}
  });

  page.on('response', async (res) => {
    try {
      const req = res.request();
      const rt = req.resourceType();
      if (rt !== 'xhr' && rt !== 'fetch') return;
      const ct = String((res.headers() || {})['content-type'] || '').split(';')[0];
      const rec = { status: res.status(), type: ct, url: mask(res.url().split('?')[0]) };
      if (/json/i.test(ct)) {
        try { rec.shape = clip(shapeOf(await res.json()), 600); }
        catch (e) { rec.shape = '(לא ניתן לקרוא)'; }
      }
      add('תשובה', rec);
    } catch (err) {}
  });

  let shot = 0;
  if (args.shots) {
    page.on('framenavigated', async (frame) => {
      if (frame !== page.mainFrame()) return;
      try {
        shot++;
        const dir = path.join(args.out, 'צילומים');
        fs.mkdirSync(dir, { recursive: true });
        await new Promise((r) => setTimeout(r, 1200));
        await page.screenshot({ path: path.join(dir, String(shot).padStart(3, '0') + '.png'), fullPage: false });
      } catch (e) {}
    });
  }

  if (args.url) { try { await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 120000 }); } catch (e) {} }

  console.log('');
  console.log('  הדפדפן פתוח. היכנסו למערכת ועברו במסכים שמעניינים.');
  console.log('  כשתסיימו - פשוט סגרו את חלון הדפדפן, והקובץ ייכתב.');
  console.log('');

  await new Promise((resolve) => browser.on('disconnected', resolve));

  // ---- כתיבת הפלט ----
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const base = 'הקלטה-' + stamp + (args.name ? '-' + args.name.replace(/[\\/:*?"<>|]/g, '_') : '');
  fs.mkdirSync(args.out, { recursive: true });
  fs.writeFileSync(path.join(args.out, base + '.json'), JSON.stringify(events, null, 2), 'utf8');

  const lines = [];
  lines.push('הקלטת מערכת' + (args.system ? ': ' + args.system : ''));
  lines.push('='.repeat(60));
  lines.push('נרשמו ' + events.length + ' אירועים.');
  lines.push('');
  lines.push('מה שנרשם:    כתובות, שמות שדות, ומבנה התשובות.');
  lines.push('מה שלא נרשם: ערכים שהוקלדו, סיסמאות, ותוכן התשובות.');
  lines.push('כל רצף של 5 ספרות ומעלה הוחלף ב-<מספר>.');
  lines.push('');
  lines.push('-'.repeat(60));
  for (const e of events) {
    if (e.kind === 'ניווט') lines.push(`[${e.t}] ניווט → ${e.url}`);
    else if (e.kind === 'click') lines.push(`[${e.t}] לחיצה  <${e.tag}> ${e.id ? '#' + e.id : ''} ${e.text ? '"' + e.text + '"' : ''}`);
    else if (e.kind === 'input') lines.push(`[${e.t}] הקלדה  <${e.tag}> ${e.id ? '#' + e.id : ''} ${e.name ? 'name=' + e.name : ''} type=${e.type} (${e.chars} תווים)`);
    else if (e.kind === 'submit') lines.push(`[${e.t}] שליחת טופס  ${e.id ? '#' + e.id : ''}`);
    else if (e.kind === 'בקשה') lines.push(`[${e.t}] ${String(e.method).padEnd(5)} ${e.url}${e.params ? '  ?' + e.params : ''}${e.bodyFields ? '  שדות: ' + e.bodyFields : ''}`);
    else if (e.kind === 'תשובה') {
      lines.push(`[${e.t}]  ↳ ${e.status} ${e.type} ${e.url}`);
      if (e.shape) lines.push(`            מבנה: ${e.shape}`);
    }
  }
  const txtPath = path.join(args.out, base + '.txt');
  fs.writeFileSync(txtPath, '﻿' + lines.join('\r\n'), 'utf8');

  console.log('');
  console.log('  ההקלטה נשמרה:');
  console.log('    ' + txtPath);
  console.log('    ' + path.join(args.out, base + '.json'));
  if (args.shots) console.log('    ' + path.join(args.out, 'צילומים') + '   (מקומי בלבד)');
}

main().catch((e) => { console.error('FATAL: ' + (e && e.message ? e.message : e)); process.exitCode = 1; });
'@
Set-Content -Path $RecorderJs -Value $js -Encoding UTF8

# ------------------------------------------------------------------ הרצה -----
# פרופיל דפדפן נפרד לכל מערכת, מאותה סיבה כמו בסקרייפר הבנק: המערכת מזהה
# "מחשב מוכר" ולא דורשת אימות נוסף, ועוגיות של מערכת אחת אינן זולגות לאחרת.
$Profile = Join-Path (Join-Path $Runtime 'profiles') $SysKey
New-Item -ItemType Directory -Force -Path $Profile | Out-Null

$argList = @($RecorderJs, '--out', $Recordings, '--profile', $Profile, '--system', $SysName)
if ($StartUrl) { $argList += @('--url', $StartUrl) }
if ($Name) { $argList += @('--name', $Name) }
if ($WithScreenshots) {
    $argList += '--shots'
    Write-Host ''
    Write-Host '  צילומי מסך מופעלים. הם נשמרים מקומית בלבד ואינם מיועדים לשליחה -' -ForegroundColor Yellow
    Write-Host '  צילום מסך מכיל נתונים אמיתיים.' -ForegroundColor Yellow
}

Write-Step "מקליט: $SysName"
& $NodeExe @argList
$code = $LASTEXITCODE

Write-Host ''
Write-Host '============================================================'
Write-Host "ההקלטות של '$SysName' נשמרות ב:"
Write-Host "  $Recordings"
Write-Host ''
Write-Host 'לפני שליחה - אפשר ורצוי לפתוח את קובץ ה-TXT ולעבור עליו.'
Write-Host 'הוא נכתב כטקסט קריא בדיוק בשביל זה.'
Write-Host '============================================================'

exit $code
