#Requires -Version 5.1
<#
================================================================================
  scheduler.ps1 — מריץ את הסקרייפר לפי התזמון שנקבע במסך ההגדרות של המערכת.

  למה זה קיים
  ------------
  אתר אינטרנט לא יכול להפעיל תוכנה על המחשב, ולא יכול לרוץ כשהדפדפן סגור -
  הדפדפן חוסם את זה בכוונה, וזו הגנה נכונה. לכן החיבור בין המערכת לסקרייפר
  נעשה דרך קובץ משותף בתיקיית הפלט:

     המערכת כותבת  ->  תזמון-סקרייפר.json   <-  הקובץ הזה קורא
     המערכת קוראת  <-  סטטוס-סקרייפר.json   <-  הקובץ הזה כותב

  מנגנון המשימות המתוזמנות של Windows מריץ את הקובץ הזה כל 15 דקות. ברוב
  ההרצות הוא רק בודק "האם הגיע הזמן", לא מוצא מה לעשות, ומסיים תוך שבריר
  שנייה. ההרצה עצמה קורית פעם ביום, בשעה שנקבעה.

  התקנה: לחיצה כפולה על "התקנת תזמון.bat" (פעם אחת).
================================================================================
#>

[CmdletBinding()]
param(
    # התעלמות מהתזמון והרצה מיידית. לשימוש בבדיקה ידנית בלבד.
    [switch] $Force,
    # בדיקה בלבד: מדפיס מה היה קורה, בלי להריץ את הסקרייפר ובלי לכתוב סטטוס.
    [switch] $WhatIfOnly
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Scraper = Join-Path $Root 'bank-scraper-portable.ps1'
$SettingsFile = Join-Path $Root 'הגדרות.txt'

$CONFIG_NAME = 'תזמון-סקרייפר.json'
$STATUS_NAME = 'סטטוס-סקרייפר.json'
$LOCK_NAME = 'סקרייפר-רץ.lock'
$STALE_LOCK_HOURS = 3

function Write-Log($m) { Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) }

# כתיבת UTF-8 בלי BOM. ‎Out-File -Encoding utf8‎ ב-PowerShell 5.1 מוסיף BOM, ו-BOM
# בתחילת קובץ JSON מפיל את JSON.parse בדפדפן. לכן כותבים דרך .NET במפורש.
function Write-Utf8NoBom([string] $Path, [string] $Text) {
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding $false))
}

function Read-JsonFile([string] $Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    try {
        $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
        $raw = "$raw".Replace([string][char]0xFEFF, '').Trim()
        if (-not $raw) { return $null }
        return $raw | ConvertFrom-Json
    } catch {
        Write-Log "קובץ לא תקין ($([System.IO.Path]::GetFileName($Path))): $($_.Exception.Message)"
        return $null
    }
}

# אותה לוגיקה בדיוק כמו בסקרייפר עצמו: השורה הראשונה שאינה הערה ואינה ריקה.
# חשוב שתישאר זהה - אחרת המתזמן יחפש את קובץ התזמון בתיקייה אחרת מזו שהסקרייפר
# כותב אליה, והשניים לא ייפגשו לעולם.
function Get-ConfiguredOutDir {
    if (-not (Test-Path -LiteralPath $SettingsFile)) { return $null }
    try { $lines = Get-Content -LiteralPath $SettingsFile -Encoding UTF8 } catch { return $null }
    foreach ($line in $lines) {
        $t = "$line".Replace([string][char]0xFEFF, '').Trim()
        if ($t -and -not $t.StartsWith('#')) { return $t }
    }
    return $null
}

function Get-Prop($obj, [string] $name, $default) {
    if ($null -eq $obj) { return $default }
    $p = $obj.PSObject.Properties[$name]
    if ($null -eq $p -or $null -eq $p.Value) { return $default }
    return $p.Value
}

# ------------------------------------------------------------------ התחלה ----

if (-not (Test-Path -LiteralPath $Scraper)) {
    Write-Log "לא נמצא bank-scraper-portable.ps1 לצד הקובץ הזה. אין מה להריץ."
    exit 1
}

$outDir = Get-ConfiguredOutDir
if (-not $outDir) {
    Write-Log "לא הוגדרה תיקיית פלט ב'הגדרות.txt'. המתזמן לא יכול לדעת היכן לחפש את קובץ התזמון."
    exit 1
}
if (-not (Test-Path -LiteralPath $outDir)) {
    Write-Log "תיקיית הפלט לא קיימת: $outDir"
    exit 1
}

$configPath = Join-Path $outDir $CONFIG_NAME
$statusPath = Join-Path $outDir $STATUS_NAME
$lockPath = Join-Path $outDir $LOCK_NAME

$now = Get-Date
$cfg = Read-JsonFile $configPath
$status = Read-JsonFile $statusPath

$enabled = [bool](Get-Prop $cfg 'enabled' $false)
$timeText = [string](Get-Prop $cfg 'time' '07:30')
$days = @(Get-Prop $cfg 'days' @(0, 1, 2, 3, 4))
$lookback = [int](Get-Prop $cfg 'lookbackDays' 45)
$runNowAt = [string](Get-Prop $cfg 'runNowRequestedAt' '')
$handledRunNow = [string](Get-Prop $status 'handledRunNowAt' '')

# ---------------------------------------------------- האם הגיע הזמן להריץ ----

$reason = $null

if ($Force) {
    $reason = 'הרצה ידנית (Force)'
} elseif ($null -eq $cfg) {
    $reason = $null
    Write-Log "אין עדיין קובץ תזמון ($CONFIG_NAME). קובעים תזמון במסך ההגדרות של המערכת."
} elseif (-not $enabled) {
    Write-Log 'התזמון כבוי בהגדרות.'
} elseif ($runNowAt -and $runNowAt -ne $handledRunNow) {
    # "הרצה עכשיו" מהמסך. מזוהה לפי חותמת זמן ולא לפי דגל בוליאני, כדי שהמתזמן
    # לא יצטרך לכתוב בחזרה לקובץ ההגדרות ולהתנגש עם המערכת שכותבת אליו.
    $reason = 'בקשת הרצה מיידית מהמערכת'
} else {
    $todayIndex = [int] $now.DayOfWeek   # ראשון=0 ... שבת=6
    if ($days -notcontains $todayIndex) {
        Write-Log "היום ($todayIndex) לא נכלל בימי ההרצה."
    } else {
        $scheduled = $null
        try { $scheduled = [datetime]::ParseExact($timeText, 'HH:mm', $null) } catch { }
        if ($null -eq $scheduled) {
            Write-Log "שעה לא תקינה בהגדרות: '$timeText'"
        } elseif ($now.TimeOfDay -lt $scheduled.TimeOfDay) {
            Write-Log "עדיין לפני השעה שנקבעה ($timeText)."
        } else {
            # ריצה אחת ליום: אם כבר רצנו היום אחרי השעה שנקבעה, לא רצים שוב.
            $lastRunText = [string](Get-Prop $status 'lastRunAt' '')
            $ranToday = $false
            if ($lastRunText) {
                try { $ranToday = ([datetime] $lastRunText).Date -eq $now.Date } catch { $ranToday = $false }
            }
            if ($ranToday) { Write-Log 'כבר רץ היום.' }
            else { $reason = "הגיע הזמן ($timeText)" }
        }
    }
}

# מעדכנים "נבדק לאחרונה" גם כשאין מה להריץ - כך המסך יכול להראות שהמתזמן חי
# ומותקן, במקום להשאיר את המשתמשת לנחש אם המשימה בכלל נרשמה ב-Windows.
if (-not $WhatIfOnly) {
    $check = [ordered]@{
        lastCheckAt      = $now.ToString('o')
        lastRunAt        = Get-Prop $status 'lastRunAt' $null
        lastResult       = Get-Prop $status 'lastResult' $null
        lastError        = Get-Prop $status 'lastError' $null
        lastOutput       = Get-Prop $status 'lastOutput' $null
        lastExitCode     = Get-Prop $status 'lastExitCode' $null
        handledRunNowAt  = Get-Prop $status 'handledRunNowAt' $null
        scraperFolder    = $Root
        outputFolder     = $outDir
    }
    Write-Utf8NoBom $statusPath (($check | ConvertTo-Json -Depth 5))
}

if (-not $reason) { Write-Log 'אין מה לעשות.'; exit 0 }
if ($WhatIfOnly) { Write-Log "היה רץ עכשיו: $reason"; exit 0 }

# --------------------------------------------------------------- נעילה -------
# המשימה מתעוררת כל 15 דקות, ומשיכה מכמה בנקים יכולה להימשך יותר. בלי נעילה
# היו נפתחות שתי הרצות במקביל שנכנסות לאותו פרופיל דפדפן ודורסות אותם קבצים.
if (Test-Path -LiteralPath $lockPath) {
    $lockAge = $now - (Get-Item -LiteralPath $lockPath).LastWriteTime
    if ($lockAge.TotalHours -lt $STALE_LOCK_HOURS) {
        Write-Log "הרצה קודמת עדיין פעילה (התחילה לפני $([int]$lockAge.TotalMinutes) דקות). מדלגים."
        exit 0
    }
    Write-Log 'נמצאה נעילה ישנה משעות קודמות - כנראה הרצה שנקטעה. ממשיכים.'
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}
Write-Utf8NoBom $lockPath ("pid=$PID started=$($now.ToString('o'))")

# --------------------------------------------------------------- הרצה --------

Write-Log "מריץ את הסקרייפר: $reason"
$runStart = Get-Date
$output = ''
$exitCode = -1
$errorText = $null

try {
    $output = & powershell.exe -ExecutionPolicy Bypass -NoProfile -File $Scraper -Days $lookback 2>&1 | Out-String
    $exitCode = $LASTEXITCODE
    if ($null -eq $exitCode) { $exitCode = 0 }
} catch {
    $errorText = $_.Exception.Message
    $exitCode = -1
} finally {
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}

# הפלט המלא ארוך ורובו רעש התקנה. שומרים את הזנב, שם נמצא הסיכום שמעניין.
$tail = ''
if ($output) {
    $lines = @($output -split "`r?`n")
    $take = [Math]::Min(40, $lines.Count)
    $tail = ($lines[($lines.Count - $take)..($lines.Count - 1)] -join "`n").Trim()
}

$succeeded = ($exitCode -eq 0 -and -not $errorText)
if (-not $succeeded -and -not $errorText) { $errorText = "הסקרייפר הסתיים עם קוד שגיאה $exitCode" }

$result = [ordered]@{
    lastCheckAt     = (Get-Date).ToString('o')
    lastRunAt       = $runStart.ToString('o')
    lastResult      = $(if ($succeeded) { 'success' } else { 'failed' })
    lastError       = $(if ($succeeded) { $null } else { $errorText })
    lastOutput      = $tail
    lastExitCode    = $exitCode
    lastDurationSec = [int]((Get-Date) - $runStart).TotalSeconds
    handledRunNowAt = $(if ($runNowAt) { $runNowAt } else { $handledRunNow })
    scraperFolder   = $Root
    outputFolder    = $outDir
}
Write-Utf8NoBom $statusPath (($result | ConvertTo-Json -Depth 5))

if ($succeeded) { Write-Log 'הסתיים בהצלחה.'; exit 0 }
Write-Log "נכשל: $errorText"
exit 1
