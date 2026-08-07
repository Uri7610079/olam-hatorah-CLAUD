<#
================================================================================
  bank-scraper-portable.ps1  —  ONE self-provisioning file for a NEW machine.

  Copy just this file to the other computer and run it. On the FIRST run
  (needs internet once) it will, entirely on its own:
     1. install a LOCAL, private copy of Node.js if none is found (no admin),
     2. install the israeli-bank-scrapers library + its headless Chromium,
     3. write out the scraper (scrape-banks.js) next to itself,
     4. create blank secrets templates for you to fill in,
     5. run the scrape.
  After the first run everything is cached locally, so later runs work offline.

  Python is NOT used anywhere.

  HOW TO RUN
     Right-click > Run with PowerShell,   OR from a terminal:
        powershell -ExecutionPolicy Bypass -File .\bank-scraper-portable.ps1
     Options (real PowerShell parameters - note the SINGLE dash):
        ... -File .\bank-scraper-portable.ps1 -Bank hapoalim -Show
        ... -File .\bank-scraper-portable.ps1 -Days 60
        ... -File .\bank-scraper-portable.ps1 -OutDir "C:\Projects-CRM\Torah-World\bank-XL"
     (The old "-- --out ..." form never worked: PowerShell read --out as -out and
      collided with its own -OutVariable/-OutBuffer.)

  WHERE LOGIN DETAILS GO
     On first run it creates  .\secrets\<bank>.json  with the exact fields each
     bank needs. Fill them in and run again. (See the fields list below.)
================================================================================
#>

[CmdletBinding()]
param(
    # תיקיית הפלט. ברירת המחדל: out\report לצד הקובץ הזה.
    [string] $OutDir,
    # בנק בודד (hapoalim / leumi / mizrahi / discount / pagi / mercantile / beinleumi).
    [string] $Bank,
    # כמה ימים אחורה למשוך. ברירת המחדל: 45.
    [ValidateRange(1, 3650)]
    [int] $Days,
    # להציג את הדפדפן - נדרש בהתחברות הראשונה לכל בנק.
    [switch] $Show,
    # מצב אבחון: לוגים מפורטים + צילום-מסך של עמוד הבנק ברגע כשל (out\debug).
    # השם Diag ולא Debug כי -Debug הוא פרמטר מובנה של PowerShell.
    [switch] $Diag,
    # פותח את קובץ ההגדרות בפנקס רשימות ויוצא. קיים כדי שקובץ ה-BAT יישאר
    # באנגלית בלבד - ר' ההערה על chcp למטה.
    [switch] $EditSettings,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $ScraperArgs
)

$ErrorActionPreference = 'Stop'

# בלי זה כל טקסט בעברית שהסקריפט מדפיס (ובעיקר שם הקובץ "הגדרות.txt" בהודעות)
# יוצא ג'יבריש בקונסולה. עטוף ב-try כי במארחים מסוימים אין קונסולה אמיתית.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Runtime = Join-Path $Root 'runtime'
New-Item -ItemType Directory -Force -Path $Runtime | Out-Null

# Keep Chromium + npm cache local to this folder so the whole thing is portable.
$env:PUPPETEER_CACHE_DIR = Join-Path $Runtime 'puppeteer'
$env:npm_config_cache     = Join-Path $Runtime 'npm-cache'

function Write-Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }

# ------------------------------------------------------- תיקיית הפלט ----------
# תיקיית הפלט לא מקובעת בשום מקום בקוד. סדר העדיפויות:
#   1. הפרמטר -OutDir (גובר על הכל, לשימוש חד-פעמי)
#   2. הנתיב שרשום בקובץ "הגדרות.txt" שליד הסקריפט
#   3. ברירת מחדל: out\report לצד הסקריפט
$SettingsFile = Join-Path $Root 'הגדרות.txt'

function Get-ConfiguredOutDir {
    if (-not (Test-Path -LiteralPath $SettingsFile)) { return $null }
    try { $lines = Get-Content -LiteralPath $SettingsFile -Encoding UTF8 } catch { return $null }
    foreach ($line in $lines) {
        # מסירים BOM אם נשמר בתחילת השורה, ומדלגים על הערות ושורות ריקות.
        $t = "$line".Replace([string][char]0xFEFF, '').Trim()
        if ($t -and -not $t.StartsWith('#')) { return $t }
    }
    return $null
}

function New-SettingsFile {
    if (Test-Path -LiteralPath $SettingsFile) { return }
    $default = Join-Path $Root 'out\report'
    $content = @"
# תיקיית הפלט - לאן יישמרו הקבצים שיורדים מהבנק.
#
# שנו את השורה האחרונה לנתיב שתרצו, ושמרו. זהו.
# דוגמה:  C:\Projects-CRM\Torah-World\bank-XL
#
# שורות שמתחילות ב-# הן הערות ואין להן שום השפעה.
# אם תמחקו את השורה לגמרי, הקבצים יישמרו ב-out\report שליד הסקריפט.
#
# הערה: הפעלה עם ‎-OutDir בשורת הפקודה גוברת על מה שרשום כאן.

$default
"@
    # BOM נדרש כדי ש-PowerShell יקרא נכון עברית מהקובץ הזה.
    [System.IO.File]::WriteAllText($SettingsFile, $content, (New-Object System.Text.UTF8Encoding $true))
    Write-Host "  created $SettingsFile - edit it to change where files are saved."
}

# ---------------------------------------------------------------- Node.js -----
# הדרישה נלקחת מ-"engines" של israeli-bank-scrapers עצמה (">= 22.22.2" בגרסה 6.9.0,
# שאליה נפתר ה-^6.7.5 שב-package.json למטה), ומ-puppeteer ^24 שהיא נשענת עליו.
# npm רק *מזהיר* על engines ולא עוצר, ולכן בלי הבדיקה כאן התקנה על Node ישן הייתה
# עוברת "בהצלחה" ואז נופלת בהמשך בשגיאת דפדפן חסרת פשר.
$MinNodeVersion = [version]'22.22.2'

function Get-NodeVersion($exePath) {
    try { $raw = & $exePath -v 2>$null } catch { return $null }
    if ("$raw".Trim() -match '^v(\d+)\.(\d+)\.(\d+)') {
        return [version]"$($Matches[1]).$($Matches[2]).$($Matches[3])"
    }
    return $null
}

function Install-LocalNode($localNode, $localExe) {
    Write-Step "Installing a local, private Node.js v$MinNodeVersion+ (one-time)"
    $arch = if ($env:PROCESSOR_ARCHITECTURE -match 'ARM64') { 'win-arm64' } else { 'win-x64' }

    try {
        $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
    } catch {
        throw "Could not reach nodejs.org to download Node. Connect to the internet for the first run. ($($_.Exception.Message))"
    }

    # האינדקס מסודר מהחדש לישן, ולכן ה-LTS הראשון שעומד בדרישה הוא גם החדש ביותר.
    # הגרסה הקודמת לקחה עיוורת את ה-LTS הראשון - אם ה-LTS הנוכחי היה ישן מהנדרש,
    # ההתקנה הייתה "מצליחה" ואז נכשלת בהמשך.
    $lts = $null
    foreach ($c in ($index | Where-Object { $_.lts })) {
        if ("$($c.version)" -match '^v(\d+)\.(\d+)\.(\d+)$') {
            if ([version]"$($Matches[1]).$($Matches[2]).$($Matches[3])" -ge $MinNodeVersion) { $lts = $c; break }
        }
    }
    if (-not $lts) {
        throw "No Node LTS at or above v$MinNodeVersion is listed on nodejs.org - cannot satisfy israeli-bank-scrapers' engines requirement."
    }

    $ver  = $lts.version
    $name = "node-$ver-$arch"
    $url  = "https://nodejs.org/dist/$ver/$name.zip"
    $zip  = Join-Path $Runtime "$name.zip"
    $unpacked = Join-Path $Runtime $name

    Write-Host "  downloading $url"
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    Write-Host "  extracting..."
    if (Test-Path $unpacked) { Remove-Item -Recurse -Force $unpacked }
    Expand-Archive -Path $zip -DestinationPath $Runtime -Force
    Remove-Item $zip -Force
    # Move-Item -Force על תיקיית יעד *קיימת* מעביר לתוכה במקום להחליף אותה, ואז node.exe
    # מסתיים בנתיב מקונן ולא נמצא. מוחקים את היעד קודם.
    if (Test-Path $localNode) { Remove-Item -Recurse -Force $localNode }
    Move-Item $unpacked $localNode -Force

    $env:Path = "$localNode;$env:Path"
    $installed = Get-NodeVersion $localExe
    if (-not $installed) { throw "Node install failed - node.exe is not runnable at $localExe" }
    if ($installed -lt $MinNodeVersion) {
        throw "Node install produced v$installed but v$MinNodeVersion or newer is required."
    }
    Write-Host "  installed node: v$installed"
}

function Ensure-Node {
    $localNode = Join-Path $Runtime 'node'
    $localExe  = Join-Path $localNode 'node.exe'

    # 1) Node שמותקן במערכת - נשתמש בו רק אם הוא עומד בדרישה. אנחנו לא נוגעים בו,
    #    לא מעדכנים אותו ולא מסירים אותו: מתקינים לידו עותק פרטי בתוך התיקייה הזו.
    $sys = Get-Command node -ErrorAction SilentlyContinue
    if ($sys) {
        $sysVer = Get-NodeVersion $sys.Source
        if ($sysVer -and $sysVer -ge $MinNodeVersion) {
            Write-Host "  node found: v$sysVer (meets the v$MinNodeVersion+ requirement)"
            return
        }
        $shown = if ($sysVer) { "v$sysVer" } else { 'unreadable' }
        Write-Host "  system node is $shown - too old (v$MinNodeVersion+ required)." -ForegroundColor Yellow
        Write-Host "  a private copy will be used instead; your system Node is left untouched."
    }

    # 2) עותק מקומי מהרצה קודמת - אותה בדיקה, ואם הוא ישן מדי מעדכנים אותו.
    if (Test-Path $localExe) {
        $localVer = Get-NodeVersion $localExe
        if ($localVer -and $localVer -ge $MinNodeVersion) {
            $env:Path = "$localNode;$env:Path"
            Write-Host "  using local node: v$localVer"
            return
        }
        $shown = if ($localVer) { "v$localVer" } else { 'unreadable' }
        Write-Host "  local node is $shown - updating..." -ForegroundColor Yellow
        # node_modules נבנה מול גרסת ה-Node שהייתה בזמן ההתקנה (puppeteer מוריד דפדפן
        # ומקמפל תלויות בהתאם). השארתו אחרי החלפת Node היא בדיוק סוג התקלה חסרת-הפשר
        # שהבדיקה הזו אמורה למנוע - אז מוחקים ומתקינים מחדש.
        $nodeModules = Join-Path $Root 'node_modules'
        if (Test-Path $nodeModules) {
            Write-Host "  removing node_modules so it is rebuilt against the new Node."
            Remove-Item -Recurse -Force $nodeModules
        }
    }

    Install-LocalNode $localNode $localExe
}

# ------------------------------------------------------- library + browser ----
function Ensure-Deps {
    Set-Location $Root
    $marker = Join-Path $Root 'node_modules\israeli-bank-scrapers'
    if (Test-Path $marker) {
        Write-Host "  dependencies already installed."
        return
    }
    Write-Step 'Installing israeli-bank-scrapers + Chromium (one-time, downloads a browser)'
    if (-not (Test-Path (Join-Path $Root 'package.json'))) {
        @'
{
  "name": "bank-scraper-portable",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "dependencies": { "israeli-bank-scrapers": "^6.7.5" }
}
'@ | Out-File -Encoding ascii (Join-Path $Root 'package.json')
    }
    # npm ships inside the Node zip; call it via cmd so the .cmd shim resolves.
    # node קיים אבל npm לא - קורה כשמישהו התקין node.exe בודד ידנית. בלי הבדיקה
    # הזו הכשל היה "cmd: 'npm' is not recognized" בלי הקשר.
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue) -and
        -not (Get-Command npm     -ErrorAction SilentlyContinue)) {
        throw "node was found but npm was not. Install npm, or delete/rename the system node.exe so the script installs its own private copy (which includes npm)."
    }

    # npm חייב לכתוב ישירות למסך. אסור לתפוס את הפלט שלו למשתנה
    # (למשל $out = & cmd /c "npm install ... 2>&1") - הוא כותב פלט התקדמות ברצף,
    # ואם אף אחד לא מרוקן את הצינור npm נחסם על הכתיבה ותוקע לנצח: אפס CPU,
    # אפס חיבורי רשת, ומסך שלא זז. זה קרה בפועל. לכן זיהוי שגיאות התעודה נעשה
    # מקובץ הלוג שnpm כותב בעצמו, ולא מלכידת הפלט.
    $logDir = Join-Path $env:npm_config_cache '_logs'
    $before = @(if (Test-Path $logDir) { Get-ChildItem $logDir -Filter '*.log' })

    & cmd /c "npm install --no-audit --no-fund --loglevel=error"

    function Test-CertFailure {
        $logs = @(if (Test-Path $logDir) { Get-ChildItem $logDir -Filter '*.log' | Sort-Object LastWriteTime -Descending })
        if (-not $logs) { return $false }
        $text = Get-Content -LiteralPath $logs[0].FullName -Raw -ErrorAction SilentlyContinue
        return ("$text" -match 'SELF_SIGNED_CERT|UNABLE_TO_GET_ISSUER|CERT_HAS_EXPIRED|DEPTH_ZERO_SELF_SIGNED')
    }

    # כשל אימות תעודה: משהו ברשת מיירט תעבורה מוצפנת (אנטי-וירוס עם סריקת HTTPS,
    # פיירוול ארגוני או VPN). Node לא משתמש במאגר התעודות של Windows אלא ברשימה
    # מובנית משלו, ולכן הוא נכשל בדיוק במצב שבו הדפדפן עובד כרגיל.
    # --use-system-ca גורם ל-Node לסמוך על אותם שורשים שכבר מותקנים ומהימנים ב-Windows.
    # זה *לא* מבטל אימות - האימות נשאר מלא, רק מול מאגר התעודות של המערכת.
    if ($LASTEXITCODE -ne 0 -and (Test-CertFailure)) {
        Write-Host ""
        Write-Host "  אימות תעודת אבטחה נכשל - מנסה שוב מול מאגר התעודות של Windows..." -ForegroundColor Yellow
        $prevOpts = $env:NODE_OPTIONS
        $env:NODE_OPTIONS = (($prevOpts, '--use-system-ca') | Where-Object { $_ }) -join ' '
        try {
            & cmd /c "npm install --no-audit --no-fund --loglevel=error"
        } finally {
            $env:NODE_OPTIONS = $prevOpts
        }
    }

    if ($LASTEXITCODE -ne 0) {
        if (Test-CertFailure) {
            Write-Host ""
            Write-Host "============================================================" -ForegroundColor Yellow
            Write-Host "ההתקנה נכשלה באימות תעודת אבטחה." -ForegroundColor Yellow
            Write-Host "משהו ברשת מיירט תעבורה מוצפנת - אנטי-וירוס עם סריקת HTTPS,"
            Write-Host "פיירוול ארגוני, או VPN."
            Write-Host ""
            Write-Host "מה לנסות, לפי הסדר:"
            Write-Host "  1. פשוט להריץ שוב. לא פעם זה זמני (VPN שהתחבר, סריקה שרצה)."
            Write-Host "  2. לנתק VPN אם מחובר, או להתחבר לנקודה חמה מהטלפון."
            Write-Host "     די בחיבור נקי אחד - אחריו הכל שמור מקומית ועובד גם בלי אינטרנט."
            Write-Host "  3. אם זה פיירוול ארגוני קבוע - לבקש מהאחראי על המחשבים את"
            Write-Host "     תעודת השורש של הארגון, ולהגדיר NODE_EXTRA_CA_CERTS אליה."
            Write-Host ""
            Write-Host "אל תבטלי את בדיקת התעודות (npm config set strict-ssl false)." -ForegroundColor Red
            Write-Host "זה מכבה את האימות לגמרי, על מחשב שעומד להחזיק סיסמאות בנק." -ForegroundColor Red
            Write-Host "============================================================" -ForegroundColor Yellow
        }
        throw "npm install failed (exit $LASTEXITCODE)."
    }
    if (-not (Test-Path $marker)) { throw "israeli-bank-scrapers did not install." }
}

# --------------------------------------------------- write the scraper JS -----
function Write-Scraper {
    $jsPath = Join-Path $Root 'scrape-banks.js'
    $js = @'
// scrape-banks.js — generated by bank-scraper-portable.ps1. Do not edit here;
// edit the PowerShell file and re-run. Read-only multi-bank scraper built on the
// maintained israeli-bank-scrapers library. Outputs pagi-latest.json-schema JSON
// + CSV per bank into out/report/. Never moves money.
'use strict';
const fs = require('fs');
const path = require('path');
const { createScraper, CompanyTypes } = require('israeli-bank-scrapers');

// ===== הארכת ההמתנה ל-redirect אחרי כניסה =====
// waitForRedirect בספרייה מוגבל ל-20 שניות קבועות (timeout = 20000 בחתימה), והוא
// מתעלם מ-defaultTimeout שאנחנו מגדירים. מול עמוד הכניסה החדש של הפועלים
// (‎/ng-portals/auth/he/‎, פברואר 2026 בערך) 20 שניות לא מספיקות - ובמצב גלוי הן
// לא משאירות לאדם שום סיכוי להשלים ידנית. עוטפים את הפונקציה על אובייקט המודול
// (הסקרייפרים ניגשים אליה דרכו בזמן-קריאה, כך שהעטיפה תופסת) ומאריכים רק כשלא
// הועבר timeout מפורש - קריאות עם ערך מכוון נשארות כמות שהן. בלי לגעת בקבצי
// הספרייה עצמם, כך שההתקנה נשארת נקייה ושדרוג עתידי לא ידרוס כלום.
const _nav = require('israeli-bank-scrapers/lib/helpers/navigation');
let REDIRECT_WAIT_MS = 90000; // headless; במצב גלוי מוארך ל-10 דקות ב-main()
const _origWaitForRedirect = _nav.waitForRedirect;
_nav.waitForRedirect = function (pageOrFrame, timeout, ...rest) {
  return _origWaitForRedirect(pageOrFrame, timeout === undefined ? REDIRECT_WAIT_MS : timeout, ...rest);
};

// ===== which banks to scrape (enable/disable here) =====
const BANKS = {
  hapoalim:   { enabled: true,  company: CompanyTypes.hapoalim,   display: 'Bank Hapoalim',       fields: ['userCode', 'password'] },
  leumi:      { enabled: true,  company: CompanyTypes.leumi,      display: 'Bank Leumi',          fields: ['username', 'password'] },
  mizrahi:    { enabled: true,  company: CompanyTypes.mizrahi,    display: 'Mizrahi-Tefahot',     fields: ['username', 'password'] },
  discount:   { enabled: true,  company: CompanyTypes.discount,   display: 'Israel Discount',     fields: ['id', 'password', 'num'] },
  // PAGI (בנק 52, online.pagi.co.il). ערך נפרד ולא חלק מ-beinleumi, למרות
  // שפאג"י שייך לקבוצת הבינלאומי: לספרייה יש סקרייפר ייעודי משלו, עם כתובת
  // כניסה אחרת (MatafLoginServlet?bankId=PAGIPORTAL). כניסה דרך beinleumi
  // פשוט לא תגיע לחשבון הזה.
  pagi:       { enabled: true,  company: CompanyTypes.pagi,       display: 'PAGI (bank 52)',      fields: ['username', 'password'] },
  // מרכנתיל (בנק 17). מופעל כמו פאג"י - ללקוח יש חשבונות בשני הבנקים האלה.
  mercantile: { enabled: true,  company: CompanyTypes.mercantile, display: 'Mercantile Discount', fields: ['id', 'password', 'num'] },
  beinleumi:  { enabled: false, company: CompanyTypes.beinleumi,  display: 'First Intl (FIBI)',   fields: ['username', 'password'] },
};

// Login details: one JSON file per bank, created blank on first run.
const SECRETS_DIR = path.resolve(__dirname, 'secrets');
const DEFAULT_OUT_DIR = path.resolve(__dirname, 'out', 'report');
const DEFAULT_LOOKBACK_DAYS = 45;
const DEFAULT_TIMEOUT_MS = 120000;
// ===== כניסה ללא SMS - נקודה קריטית =====
// המשתמש נכנס לבנק עם שם משתמש וסיסמה בלבד, בלי קוד אימות. כדי שגם הסקרייפר
// ייכנס כך, כל בנק מקבל פרופיל דפדפן *קבוע* משלו (user-data-dir נפרד תחת
// runtime\profiles). העוגיות ואישור-המכשיר שהבנק שומר נשמרים בין הרצות, ולכן
// הבנק מזהה את אותו "מחשב מוכר" בכל פעם - בדיוק כמו הדפדפן הרגיל בבית.
// דפדפן שנפתח בלי פרופיל (מצב הברירת-מחדל של puppeteer) נראה לבנק כמכשיר חדש
// בכל הרצה - וזה בדיוק מה שגורם לבנקים להקשיח אימות. הפרופיל הקבוע מונע זאת.
const PROFILES_DIR = path.resolve(__dirname, 'runtime', 'profiles');
// עם דפדפן גלוי יש אדם מול המסך שאולי צריך לאשר משהו חד-פעמי בחלון (שאלת
// זיהוי, הודעה מהבנק וכד'). שתי דקות לא מספיקות לעשות זאת בנחת - נותנים עשר.
const INTERACTIVE_TIMEOUT_MS = 600000;

function parseArgs(argv) {
  const a = { bank: null, show: false, days: DEFAULT_LOOKBACK_DAYS, out: DEFAULT_OUT_DIR };
  // ערך שגוי נעצר בשגיאה ברורה. נפילה שקטה לברירת-מחדל מסתירה טעויות הקלדה:
  // '--days שישים' שרץ בשקט עם 45 ימים נראה כאילו הצליח - ומחזיר פחות נתונים
  // ממה שהתבקש בלי שאף אחד יידע.
  const die = (msg) => { console.error('argument error: ' + msg); process.exit(1); };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--show') a.show = true;
    else if (t === '--diag') a.diag = true;
    else if (t === '--bank') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) die('--bank requires a bank name, e.g. --bank hapoalim');
      a.bank = v;
    }
    else if (t === '--out') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) die('--out requires a folder path');
      a.out = path.resolve(v);
    }
    else if (t === '--days') {
      const v = argv[++i];
      const n = Number(v);
      if (!v || !Number.isInteger(n) || n < 1) die("--days requires a whole number >= 1 (got '" + (v || '') + "')");
      a.days = n;
    }
    else if (t === '--help' || t === '-h') a.help = true;
    else die("unknown option '" + t + "'. try --help");
  }
  return a;
}

function loadCreds(key, cfg) {
  fs.mkdirSync(SECRETS_DIR, { recursive: true });
  const file = path.join(SECRETS_DIR, key + '.json');
  if (!fs.existsSync(file)) {
    const template = {};
    for (const f of cfg.fields) template[f] = '';
    fs.writeFileSync(file, JSON.stringify(template, null, 2) + '\n', 'utf8');
    console.log('  [setup] created blank ' + file + ' — fill in ' + cfg.fields.join(' + ') + ' and re-run.');
    return null;
  }
  let creds;
  try {
    // מסירים BOM אם קיים: פנקס רשימות עלול להוסיף אותו בשמירה, ואז JSON.parse נופל
    // ב-"Unexpected token" - שגיאה שאין שום דרך לנחש ממנה שהבעיה היא בקידוד הקובץ.
    creds = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  }
  catch (e) { console.log('  [skip] ' + file + ' is not valid JSON: ' + e.message); return null; }
  const missing = cfg.fields.filter((f) => !creds[f] || String(creds[f]).trim() === '');
  if (missing.length) { console.log('  [skip] ' + key + ': fill in ' + missing.join(', ') + ' in ' + file); return null; }
  const out = {};
  for (const f of cfg.fields) out[f] = creds[f];
  return out;
}

// תאריך בלבד (YYYY-MM-DD) בלי הסטת אזור-זמן. חשוב: new Date(x).toISOString().slice(0,10)
// היה מזיז תנועה של 00:30 בלילה בשעון ישראל (UTC+2/+3) ליום הקודם, ומכיוון שהתאריך נכנס
// לגיבוב הדדופ - אותה תנועה בדיוק הייתה מקבלת טביעת-אצבע אחרת בין משיכה למשיכה.
function toDateOnly(v) {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// מיפוי לחוזה של ingest_bank_transactions_batch() בסופאבייס (מיגרציה 083). שמות השדות
// כאן חייבים להיות מדויקים - הפונקציה קוראת אותם ב-t.value->>'...' ומה שלא תואם נופל
// בשקט ל-null.
//
// הקריטי מכולם: bank_transaction_id. compute_bank_fingerprint() מעדיפה אותו על פני הכל
// ומייצרת 'bankid:<id>' - מזהה יציב שלא משתנה לעולם. רק בהיעדרו היא נופלת לגיבוב SHA-256
// של תאריך/סכום/תיאור, שהבנק *כן* משנה בין משיכות (ממתין→סופי, memo שמתווסף) - וכל שינוי
// כזה = אותה תנועה נכנסת שוב כאילו היא חדשה. הגרסה הקודמת שמה את t.identifier בתוך
// reference ולא שלחה bank_transaction_id כלל, כך שהמנגנון החזק מעולם לא הופעל.
// חשוב: כל שורה נושאת את account_number שלה. חיבור בנק אחד מחזיר לעתים קרובות כמה
// חשבונות (לעמותה ממוצעת כאן - בהחלט), והגרסה הקודמת שטחה את כולם לרשימה אחת בלי לציין
// מאיזה חשבון כל תנועה הגיעה. שתי תקלות נפרדות נבעו מזה:
//   1. אי אפשר לדעת לאיזה חשבון לשייך את התנועה - ingest_bank_transactions_batch מקבל
//      חשבון אחד בכל קריאה, כך שכל התנועות היו נכנסות לחשבון הראשון.
//   2. גרוע יותר - identifier של הבנק ייחודי *לכל חשבון*, לא לכל הבנק, והאילוץ בדאטהבייס
//      הוא unique (organization_bank_account_id, fingerprint). מיזוג החשבונות גורם לשתי
//      תנועות אמיתיות מחשבונות שונים עם אותו identifier לקבל אותה טביעת אצבע - והשנייה
//      נדחית בשקט ככפילות. זו אבידת נתונים, לא כפילות.
function toRows(accounts, skipped) {
  const rows = [];
  for (const acc of accounts) {
    for (const t of acc.txns || []) {
      // תנועות ממתינות עוד ישתנו אצל הבנק כשייסלקו בפועל (תאריך, תיאור, ולעתים אין להן
      // identifier בכלל) - קליטה שלהן עכשיו מבטיחה כפילות במשיכה הבאה.
      if (t.status && t.status !== 'completed') { skipped.pending++; continue; }

      const signed = typeof t.chargedAmount === 'number' ? t.chargedAmount : t.originalAmount;
      if (typeof signed !== 'number' || !isFinite(signed) || signed === 0) { skipped.noAmount++; continue; }

      // bank_transactions.amount הוא numeric(12,2) עם check (amount > 0), והכיוון נשמר
      // בשדה נפרד - לכן סכום מוחלט + direction, לא סכום עם סימן.
      const currency = t.chargedCurrency || t.originalCurrency || 'ILS';
      if (currency !== 'ILS' && currency !== 'NIS' && currency !== '₪') { skipped.foreignCurrency++; continue; }

      const executionDate = toDateOnly(t.date);
      if (!executionDate) { skipped.noDate++; continue; }

      rows.push({
        account_number: acc.accountNumber != null ? String(acc.accountNumber) : null,
        execution_date: executionDate,
        value_date: toDateOnly(t.processedDate),
        direction: signed < 0 ? 'debit' : 'credit',
        amount: Math.round(Math.abs(signed) * 100) / 100,
        description: [t.description, t.memo].filter(Boolean).join(' - ') || null,
        // reference נשאר ריק במכוון: לספרייה אין שדה אסמכתא נפרד מ-identifier, וה-identifier
        // כבר במקומו הנכון למטה. שכפול שלו לשני השדות רק היה מבלבל בממשק.
        reference: null,
        operation_type: t.type || null,
        bank_balance_after: null,
        bank_transaction_id: t.identifier != null && String(t.identifier).trim() !== '' ? String(t.identifier) : null,
      });
    }
  }
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  rows.sort((a, b) => cmp(a.account_number || '', b.account_number || '') || cmp(a.execution_date, b.execution_date));
  return rows;
}

function toPacket(display, accounts) {
  const skipped = { pending: 0, foreignCurrency: 0, noAmount: 0, noDate: 0 };
  const rows = toRows(accounts, skipped);
  let balance = null;
  for (const acc of accounts) {
    if (typeof acc.balance === 'number') balance = (balance || 0) + acc.balance;
  }
  const withBankId = rows.filter((r) => r.bank_transaction_id).length;
  // פירוט לפי חשבון - כדי שיהיה גלוי לעין שהחיבור החזיר יותר מחשבון אחד, ושכל תנועה
  // יודעת לאן היא שייכת. ריכוז הכל למספר אחד הוא בדיוק מה שהסתיר את הבעיה קודם.
  const byAccount = accounts.map((a) => {
    const num = a.accountNumber != null ? String(a.accountNumber) : null;
    return {
      account_number: num,
      balance: a.balance == null ? null : a.balance,
      raw_txns: (a.txns || []).length,
      imported: rows.filter((r) => r.account_number === num).length,
    };
  });
  return {
    source: display,
    scraped_at: new Date().toISOString(),
    bank_balance: balance,
    by_account: byAccount,
    // המערך הזה הוא בדיוק מה ש-ingest_bank_transactions_batch מקבל ב-p_transactions.
    bank_transactions: rows,
    skipped: skipped,
    // דיווח גלוי: כמה תנועות יקבלו דדופ חזק ('bankid:') וכמה ייפלו לגיבוב החלש. אם המספר
    // הזה נמוך אצל בנק מסוים, זה אומר שהבנק לא מספק מזהה משלו - עובדה שעדיף לדעת עליה
    // מראש ולא לגלות אותה דרך תנועות כפולות בדוחות.
    dedup: { strong_bank_id: withBankId, weak_hash_fallback: rows.length - withBankId },
    card_charges: [],
    clearing_future: [],
  };
}

function writeOutputs(outDir, key, packet) {
  fs.mkdirSync(outDir, { recursive: true });
  const jpath = path.join(outDir, key + '-latest.json');
  fs.writeFileSync(jpath, JSON.stringify(packet, null, 2), 'utf8');
  const cpath = path.join(outDir, key + '-latest.csv');
  // מירכוב לאקסל: גם ; וגם טאב/שורה חדשה חייבים מרכאות. אקסל בעברית (רשימה מופרדת בפסיק
  // לפי הגדרות אזוריות) עלול לפצל על ; ולשבור שורה שלמה בשקט אם לא ניתקל בזה כאן.
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",;\t\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const cols = ['account_number', 'execution_date', 'value_date', 'direction', 'amount', 'description', 'operation_type', 'bank_transaction_id'];
  const lines = [cols.join(',')];
  for (const t of packet.bank_transactions) {
    lines.push(cols.map((c) => esc(t[c])).join(','));
  }
  // BOM בתחילת הקובץ - בלעדיו אקסל פותח עברית כג'יבריש.
  // \uFEFF מפורש ולא תו BOM גולמי בקוד - תו בלתי-נראה נמחק בשקט בעריכה עתידית.
  fs.writeFileSync(cpath, '\uFEFF' + lines.join('\r\n') + '\r\n', 'utf8');
  return { jpath, cpath };
}

async function scrapeOne(key, cfg, creds, args) {
  const startDate = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);
  const timeout = args.show ? INTERACTIVE_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
  if (args.show) {
    // במצב גלוי גם ההמתנה ל-redirect מוארכת לעשר דקות - כך שאפשר להשלים את
    // הכניסה *ידנית* בחלון אם המילוי האוטומטי לא הסתדר עם עמוד הבנק.
    REDIRECT_WAIT_MS = INTERACTIVE_TIMEOUT_MS;
    console.log('  [show] דפדפן גלוי. ההתחברות היא בשם משתמש וסיסמה בלבד.');
    console.log('  [show] אם הטופס לא מולא או לא נשלח לבד - השלימו את הכניסה ידנית בחלון;');
    console.log('  [show] ברגע שהכניסה מצליחה, המשיכה ממשיכה אוטומטית. ממתין עד ' + (timeout / 60000) + ' דקות.');
  }
  // פרופיל קבוע פר-בנק: הבנק רואה את אותו מכשיר בכל הרצה (ר' ההערה ליד PROFILES_DIR).
  // פרופיל נפרד לכל בנק - כדי שעוגיות של בנק אחד לא יזלגו לאחר.
  const profileDir = path.join(PROFILES_DIR, key);
  fs.mkdirSync(profileDir, { recursive: true });
  const opts = {
    companyId: cfg.company,
    startDate,
    showBrowser: args.show,
    verbose: !!args.diag,
    defaultTimeout: timeout,
    args: ['--user-data-dir=' + profileDir],
  };
  if (args.diag) {
    // צילום-מסך של מה שהבנק הציג ברגע הכשל - סוף לניחושים.
    const diagDir = path.join(__dirname, 'out', 'debug');
    fs.mkdirSync(diagDir, { recursive: true });
    opts.storeFailureScreenShotPath = path.join(diagDir, key + '-fail.png');
    console.log('  [diag] בכשל יישמר צילום-מסך אל ' + opts.storeFailureScreenShotPath);
  }
  const scraper = createScraper(opts);
  const result = await scraper.scrape(creds);
  if (!result.success) { throw new Error(result.errorType + (result.errorMessage ? ' - ' + result.errorMessage : '')); }
  return result.accounts || [];
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log('usage: node scrape-banks.js [--bank <key>] [--show] [--days N] [--out <folder>]'); console.log('banks:', Object.keys(BANKS).join(', ')); return; }
  if (args.bank && !BANKS[args.bank]) { console.error("unknown bank '" + args.bank + "'. known: " + Object.keys(BANKS).join(', ')); process.exitCode = 1; return; }
  // --bank גובר במכוון על דגל enabled (נוח להרצה חד-פעמית של בנק כבוי בלי לערוך
  // את הקובץ) - אבל אומרים זאת בקול רם במקום לרוץ בשקט.
  if (args.bank && !BANKS[args.bank].enabled) {
    console.log("note: '" + args.bank + "' is disabled in BANKS, running it anyway because --bank was given explicitly.");
  }
  const targets = Object.entries(BANKS).filter(([k, v]) => (args.bank ? k === args.bank : v.enabled));
  if (!targets.length) { console.error('no banks enabled.'); process.exitCode = 1; return; }
  const combined = {}; const summary = []; let hadError = false; let createdTemplate = false;
  for (const [key, cfg] of targets) {
    console.log('==== ' + cfg.display + ' (' + key + ') ====');
    const creds = loadCreds(key, cfg);
    if (!creds) { createdTemplate = true; continue; }
    try {
      const accounts = await scrapeOne(key, cfg, creds, args);
      const packet = toPacket(cfg.display, accounts);
      const { jpath, cpath } = writeOutputs(args.out, key, packet);
      combined[key] = packet;
      summary.push([cfg.display, packet.bank_transactions.length, packet.bank_balance, null, packet.dedup, packet.skipped, packet.by_account]);
      console.log('  -> ' + jpath); console.log('  -> ' + cpath);
    } catch (e) { hadError = true; summary.push([cfg.display, 0, null, e.message, null, null, null]); console.error('  ERROR: ' + e.message); }
  }
  if (Object.keys(combined).length) {
    fs.mkdirSync(args.out, { recursive: true });
    fs.writeFileSync(path.join(args.out, 'all-banks-latest.json'), JSON.stringify(combined, null, 2), 'utf8');
  }
  console.log('\n==== summary ' + new Date().toISOString().slice(0, 10) + ' ====');
  for (const [disp, n, bal, err, dedup, skipped, byAccount] of summary) {
    const b = bal == null ? 'n/a' : bal.toFixed(2);
    console.log('  ' + disp.padEnd(24) + ' ' + String(n).padStart(4) + ' txns   balance ' + b + (err ? '   ERROR: ' + err : ''));
    if (byAccount && byAccount.length > 1) {
      // אזהרה מפורשת: יותר מחשבון אחד בחיבור אחד. כל שורה בקובץ נושאת account_number,
      // וחייבים לפצל לפיו לפני קליטה - חשבון אחד בכל יבוא.
      console.log('      ' + byAccount.length + ' accounts in this login - split the file by account_number before importing:');
      for (const a of byAccount) console.log('        ' + String(a.account_number || '(unknown)').padEnd(20) + String(a.imported).padStart(4) + ' txns');
    }
    if (dedup) {
      console.log('      dedup: ' + dedup.strong_bank_id + ' by bank id, ' + dedup.weak_hash_fallback + ' by hash fallback');
      if (dedup.weak_hash_fallback > 0) {
        console.log('      NOTE: rows without a bank id rely on the weak hash - re-check for duplicates after the next run.');
      }
    }
    if (skipped) {
      const parts = Object.entries(skipped).filter(([, v]) => v > 0).map(([k, v]) => k + '=' + v);
      if (parts.length) console.log('      skipped: ' + parts.join(', '));
    }
  }
  // ההודעה הקודמת טענה תמיד ש"נוצרו תבניות ריקות", גם כשהקבצים כבר היו קיימים
  // ופשוט לא מולאו - מבלבל, כי זה נשמע כאילו משהו נמחק ונוצר מחדש.
  if (createdTemplate) { console.log('\n[action] יש בנקים שדולגו כי פרטי ההתחברות שלהם חסרים ב-' + SECRETS_DIR + '. זה תקין אם אינך משתמשת בהם.'); }
  if (hadError) process.exitCode = 2;
}

main().catch((err) => { console.error('FATAL:', err && err.message ? err.message : err); process.exitCode = 1; });
'@
    Set-Content -Path $jsPath -Value $js -Encoding UTF8
    return $jsPath
}

# ------------------------------------------------------------------ run -------
try {
    if ($EditSettings) {
        New-SettingsFile
        Write-Host ""
        Write-Host "פותח את קובץ ההגדרות: $SettingsFile"
        Write-Host "שנו את השורה האחרונה לנתיב שתרצו, שמרו (Ctrl+S) וסגרו."
        Start-Process notepad.exe -ArgumentList $SettingsFile
        exit 0
    }

    Write-Step 'Bank scraper — self-provisioning bootstrap'
    Write-Host "  working folder: $Root"
    New-SettingsFile
    Ensure-Node
    Ensure-Deps
    $jsPath = Write-Scraper

    Write-Step 'Running scraper'
    # בונים את שורת הפקודה ל-node מפרמטרים אמיתיים של PowerShell במקום להעביר "--" גולמי.
    # הצורה הישנה (-- --out ...) פשוט לא עבדה: PowerShell מפרש --out כ--out ומתנגש עם
    # -OutVariable/-OutBuffer המובנים ("parameter name 'out' is ambiguous"), והסקריפט נפל
    # לפני שהגיע לבנק בכלל.
    $argList = @()
    if ($Bank)   { $argList += @('--bank', $Bank) }
    if ($Days)   { $argList += @('--days', "$Days") }
    if ($Show)   { $argList += '--show' }
    if ($Diag)   {
        $argList += '--diag'
        # לוגים מפורטים של הספרייה עצמה (איזה שלב, איזה selector) - לצד צילום המסך.
        $env:DEBUG = 'israeli-bank-scrapers:*'
    }
    # -OutDir גובר; אחרת מה שרשום בהגדרות.txt; אחרת ברירת המחדל שבתוך ה-JS.
    $effectiveOut = $OutDir
    $outSource = 'the -OutDir parameter'
    if (-not $effectiveOut) {
        $effectiveOut = Get-ConfiguredOutDir
        $outSource = 'הגדרות.txt'
    }

    if ($effectiveOut) {
        # נתיב יחסי נפתר מול תיקיית הסקריפט (לא מול תיקיית העבודה) - כך התוצאה זהה בין
        # הרצה בקליק-ימני לבין הרצה מטרמינל. Resolve-Path .ProviderPath מחזיר נתיב
        # קובץ נקי; בלעדיו PowerShell עלול להחזיר נתיב עם קידומת ספק שנוד לא מבין.
        $resolved = if ([System.IO.Path]::IsPathRooted($effectiveOut)) { $effectiveOut } else { Join-Path $Root $effectiveOut }
        try {
            New-Item -ItemType Directory -Force -Path $resolved | Out-Null
            $resolved = (Resolve-Path -LiteralPath $resolved).ProviderPath
        } catch {
            # נתיב שגוי בהגדרות.txt הוא טעות הקלדה סבירה לגמרי. עוצרים בהודעה ברורה
            # במקום ליפול בשגיאה סתומה או - גרוע יותר - לשמור בשקט במקום אחר.
            throw "Cannot use the output folder '$resolved' (from $outSource): $($_.Exception.Message)"
        }
        $argList += @('--out', $resolved)
        Write-Host "  output folder: $resolved   (from $outSource)"
    }
    if ($ScraperArgs) { $argList += $ScraperArgs }

    if ($argList.Count) { & node $jsPath @argList } else { & node $jsPath }
    $code = $LASTEXITCODE

    # ההסברים האלה היו פעם בתוך קובץ ה-BAT, אבל cmd.exe הורס קובץ אצווה שמערבב
    # chcp 65001 עם תווים רב-בתיים (הוא סופר מיקום בבתים וממשיך לקרוא מאמצע שורה).
    # לכן כל טקסט בעברית מודפס מכאן, וקובץ ה-BAT נשאר באנגלית בלבד.
    Write-Host ""
    Write-Host "============================================================"
    if ($effectiveOut) { Write-Host "הקבצים נשמרו ב: $effectiveOut" }
    else { Write-Host "הקבצים נשמרו ב: $(Join-Path $Root 'out\report')" }
    Write-Host "לשינוי המיקום: הריצו את 'שינוי תיקיית הפלט.bat'"
    Write-Host "פרטי התחברות : $(Join-Path $Root 'secrets')  (קובץ JSON לכל בנק)"
    Write-Host ""
    Write-Host "בסיכום שלמעלה, שימו לב לשורת dedup:"
    Write-Host "  'by bank id'       = זיהוי כפילויות אמין"
    Write-Host "  'by hash fallback' = הבנק לא סיפק מזהה, כדאי לעבור ידנית"
    Write-Host "ואם מופיעה שורת 'accounts in this login' - חובה לפצל את הקובץ"
    Write-Host "לפי העמודה account_number לפני קליטה, חשבון אחד בכל יבוא."
    Write-Host "============================================================"
    exit $code
}
catch {
    Write-Host ""
    Write-Host "SETUP/RUN FAILED: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
