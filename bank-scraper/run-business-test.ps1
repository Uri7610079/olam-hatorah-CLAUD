#Requires -Version 5.1
<#
================================================================================
  run-business-test.ps1 — בדיקת החשבון העסקי, עם תיעוד מלא לקובץ.

  למה זה קיים בנפרד מקובץ ה-BAT
  --------------------------------
  קובץ ה-BAT חייב להישאר ASCII טהור (cmd.exe קורא אותו לפי מיקום בבתים), ולכן
  כל טקסט בעברית חייב לצאת מ-PowerShell. עד עכשיו זה נעשה במחרוזת ‎-Command‎
  ארוכה בתוך ה-BAT, ושם גם הסתתרה תקלה: סימן הסיום הודפס *אחרי* ‎Stop-Transcript‎,
  כלומר לא נכנס לקובץ כלל.

  התוצאה בשטח: הקובץ נשלח באמצע ההרצה, ולא היה שום סימן שהוא חלקי - לא לשולח
  ולא למי שקורא. הרצה מול הבנק היא משאב יקר (אחת ליום), וסבב שהתבזבז על קובץ
  חלקי הוא בדיוק מה שאסור שיקרה.

  עכשיו סימן הסיום נכתב לתוך התיעוד, לפני שהוא נסגר.
================================================================================
#>

[CmdletBinding()]
param(
    # ברירת המחדל היא הכניסה העסקית הראשונה. אפשר להעביר מפתח אחר לבדיקה נקודתית.
    [string] $Bank = 'mercantile-business'
)

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Scraper = Join-Path $Root 'bank-scraper-portable.ps1'
$LogFile = Join-Path $Root 'business-test-output.txt'

if (-not (Test-Path -LiteralPath $Scraper)) {
    Write-Host "שגיאה: לא נמצא bank-scraper-portable.ps1 בתיקייה $Root" -ForegroundColor Red
    exit 1
}

Start-Transcript -Path $LogFile -Force | Out-Null
try {
    Write-Host ''
    Write-Host '=== תחילת הרצה ===' -ForegroundColor Cyan
    Write-Host "התחיל בשעה: $(Get-Date -Format 'HH:mm:ss')"
    Write-Host ''
    & $Scraper -Bank $Bank -Show
    $code = $LASTEXITCODE
} catch {
    Write-Host ""
    Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
    $code = 1
} finally {
    # הסימן הזה נכתב *בתוך* התיעוד ולפני סגירתו, וזו כל הנקודה: קובץ שאין בו את
    # השורה הזו הוא קובץ שנלקח באמצע ההרצה, וזה ניתן לזיהוי במבט אחד.
    Write-Host ''
    Write-Host '=== סוף ההרצה - הקובץ שלם ===' -ForegroundColor Green
    Write-Host "הסתיים בשעה: $(Get-Date -Format 'HH:mm:ss')"
    Stop-Transcript | Out-Null
}

Write-Host ''
Write-Host 'הפלט המלא נשמר ב:' -ForegroundColor Cyan
Write-Host "  $LogFile" -ForegroundColor Cyan
Write-Host ''
Write-Host 'לפני ששולחים את הקובץ - לוודא שמופיעה בסופו השורה:' -ForegroundColor Yellow
Write-Host '  === סוף ההרצה - הקובץ שלם ===' -ForegroundColor Yellow
Write-Host 'אם היא חסרה, ההרצה עוד לא הסתיימה.' -ForegroundColor Yellow

exit $code
