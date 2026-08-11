#Requires -Version 5.1
<#
================================================================================
  build-handover-package.ps1 — אורז את הסקרייפר למסירה ללקוח.

  למה סקריפט ולא העתקה ידנית: התיקייה שרצה בפועל מכילה את secrets (סיסמאות בנק
  בטקסט גלוי), את runtime (מאות מגה-בייט, כולל פרופילי דפדפן ששייכים למי
  שהתחבר כאן), ואת out (תנועות בנק אמיתיות). העתקה ידנית של "כל התיקייה" תיקח
  את שלושתם. הסקריפט מעתיק רק את מה שצריך, וסופר מה הושמט.

  שימוש:
     .\build-handover-package.ps1                      -> יוצר .\מסירה-ללקוח\
     .\build-handover-package.ps1 -Destination D:\out  -> יעד אחר
================================================================================
#>

[CmdletBinding()]
param(
    [string] $Destination
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Destination) { $Destination = Join-Path $Root 'מסירה-ללקוח' }

# רשימה לבנה ולא רשימה שחורה: קובץ חדש שמישהו יוסיף לתיקייה לא ייכנס לחבילה
# בטעות. עדיף שיישכח משהו ויתגלה, מאשר שסיסמה תיסע ללקוח.
$INCLUDE_FILES = @(
    'bank-scraper-portable.ps1',
    'scheduler.ps1',
    'install-schedule.ps1',
    'package.json',
    'package-lock.json',
    'הגדרות.txt',
    'קרא אותי.txt',
    'משיכת תנועות מהבנק.bat',
    'שינוי תיקיית הפלט.bat',
    'התקנת תזמון.bat'
)
$INCLUDE_DIRS = @('בדיקות')

$EXCLUDED_NOTE = @(
    'secrets\    - סיסמאות בנק. הלקוח ימלא משלו.',
    'runtime\    - Node ו-Chromium פרטיים + פרופילי דפדפן. נבנה לבד בהרצה הראשונה.',
    'node_modules\ - נבנה לבד בהרצה הראשונה.',
    'out\        - תנועות בנק שנמשכו כאן.',
    'scrape-banks.js - נוצר אוטומטית מה-PS1 בכל הרצה.'
)

if (Test-Path -LiteralPath $Destination) {
    Write-Host "היעד כבר קיים ויימחק: $Destination" -ForegroundColor Yellow
    Remove-Item -LiteralPath $Destination -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $Destination | Out-Null

$copied = 0
$missing = @()
foreach ($f in $INCLUDE_FILES) {
    $src = Join-Path $Root $f
    if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination $Destination; $copied++ }
    else { $missing += $f }
}
foreach ($d in $INCLUDE_DIRS) {
    $src = Join-Path $Root $d
    if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination $Destination -Recurse; $copied++ }
    else { $missing += "$d\" }
}

# בדיקת ביטחון אחרונה. אם משהו מהשלושה האלה הגיע ליעד - עוצרים ומודיעים, במקום
# למסור חבילה עם סיסמאות בפנים.
$leaked = @()
foreach ($bad in @('secrets', 'runtime', 'node_modules', 'out')) {
    if (Test-Path -LiteralPath (Join-Path $Destination $bad)) { $leaked += $bad }
}

Write-Host ''
if ($leaked.Count -gt 0) {
    Write-Host "עצור: נמצאו בחבילה תיקיות שאסור למסור: $($leaked -join ', ')" -ForegroundColor Red
    exit 1
}

Write-Host "החבילה מוכנה: $Destination" -ForegroundColor Green
Write-Host "הועתקו $copied פריטים."
if ($missing.Count -gt 0) { Write-Host "לא נמצאו (בדקי אם זה תקין): $($missing -join ', ')" -ForegroundColor Yellow }
Write-Host ''
Write-Host 'לא נכלל בכוונה:'
foreach ($n in $EXCLUDED_NOTE) { Write-Host "  $n" }
Write-Host ''
Write-Host 'מה שהלקוח צריך לעשות אחרי שהוא מקבל את התיקייה - ר. "מסירה ללקוח.md".'
