#Requires -Version 5.1
<#
================================================================================
  install-schedule.ps1 — רושם ב-Windows משימה שמריצה את "scheduler.ps1" כל 15 דקות.

  זו פעולה חד-פעמית. אחרי ההתקנה כל שינוי בשעות ובימים נעשה במסך ההגדרות של
  המערכת, ולא כאן - המשימה הזו רק מעירה את המתזמן, והמתזמן הוא זה שבודק בקובץ
  התזמון האם הגיע הזמן להריץ.

  המשימה רצה תחת המשתמש המחובר, ולא כשירות מערכת. זה מכוון: הסקרייפר משתמש
  בפרופיל דפדפן קבוע כדי שהבנק יזהה "מחשב מוכר" ולא ידרוש אימות נוסף, והפרופיל
  הזה שייך למשתמש. הרצה כמשתמש אחר הייתה מאבדת אותו.

  למה schtasks ולא Register-ScheduledTask
  ----------------------------------------
  ‎Register-ScheduledTask‎ נכשל ב-"Access is denied" כשהוא רץ בלי הרשאות מנהל
  (נבדק בפועל). ‎schtasks.exe‎ רושם משימה למשתמש הנוכחי בלי הרשאות מנהל, ולכן
  המשתמשת לא צריכה לדעת מה זו "הרצה כמנהל" ולא צריכה סיסמת מנהל.

  שימוש:
     .\install-schedule.ps1              התקנה
     .\install-schedule.ps1 -Remove      הסרה
     .\install-schedule.ps1 -Status      בדיקה מה מותקן
================================================================================
#>

[CmdletBinding()]
param(
    [switch] $Remove,
    [switch] $Status,
    [int] $EveryMinutes = 15,
    # שם המשימה ב-Windows. ASCII בכוונה - שמות משימות עוברים דרך כלי מערכת
    # שלא תמיד מטפלים נכון בעברית.
    [string] $TaskName = 'OlamHaTorah-BankScraper'
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Wrapper = Join-Path $Root 'scheduler.ps1'

function Test-TaskExists {
    # ‎/query‎ מחזיר קוד יציאה שונה מאפס כשהמשימה לא קיימת. זו הבדיקה, לא הפלט.
    #
    # ההרצה עוברת דרך cmd בכוונה: כשמפנים stderr של תוכנית חיצונית בתוך
    # PowerShell 5.1, כל שורת שגיאה נעטפת ב-ErrorRecord, ועם ‎$ErrorActionPreference
    # = 'Stop'‎ זו שגיאה עוצרת שמפילה את הסקריפט. כלומר דווקא המצב הרגיל -
    # "המשימה עוד לא מותקנת" - היה קורס במקום להחזיר "לא קיימת". ‎cmd‎ בולע את
    # ה-stderr לפני ש-PowerShell רואה אותו, ונשאר רק קוד היציאה.
    cmd /c "schtasks /query /tn ""$TaskName"" >nul 2>&1"
    return ($LASTEXITCODE -eq 0)
}

# ------------------------------------------------------------------ מצב ------
if ($Status) {
    if (-not (Test-TaskExists)) {
        Write-Host "המשימה '$TaskName' אינה מותקנת."
        Write-Host "להתקנה: לחיצה כפולה על 'התקנת תזמון.bat'."
        exit 1
    }
    Write-Host "המשימה '$TaskName' מותקנת.`n"
    schtasks /query /tn $TaskName /fo LIST /v |
        Select-String -Pattern 'Status:|Last Run Time:|Last Result:|Next Run Time:|Repeat: Every:|Task To Run:'
    exit 0
}

# ------------------------------------------------------------------ הסרה -----
if ($Remove) {
    if (-not (Test-TaskExists)) { Write-Host "המשימה '$TaskName' לא הייתה מותקנת. אין מה להסיר."; exit 0 }
    schtasks /delete /tn $TaskName /f | Out-Null
    if (Test-TaskExists) { Write-Host "ההסרה נכשלה. המשימה עדיין מותקנת." -ForegroundColor Red; exit 1 }
    Write-Host "המשימה '$TaskName' הוסרה. הסקרייפר לא ירוץ יותר מעצמו."
    Write-Host "אפשר עדיין להריץ ידנית בלחיצה כפולה על 'משיכת תנועות מהבנק.bat'."
    exit 0
}

# ------------------------------------------------------------------ התקנה ----
if (-not (Test-Path -LiteralPath $Wrapper)) {
    Write-Host "שגיאה: לא נמצא 'scheduler.ps1' בתיקייה $Root" -ForegroundColor Red
    exit 1
}

# ‎\"‎ בתוך מחרוזת בגרשיים בודדים הוא בדיוק שני התווים backslash+quote. כך
# PowerShell מעביר ל-schtasks מרכאות אמיתיות סביב הנתיב, וזה נדרש כי הנתיב
# מכיל רווחים ועברית.
$taskRun = 'powershell -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File \"' + $Wrapper + '\"'

schtasks /create /tn $TaskName /tr $taskRun /sc minute /mo $EveryMinutes /f | Out-Null

# אימות אחרי הרישום, ולא הסתמכות על קוד היציאה בלבד: בגרסה קודמת של הקובץ הזה
# הרישום נכשל והמסך בכל זאת הודיע "הותקנה". הודעת הצלחה שקרית גרועה יותר
# מהודעת כישלון, כי היא שולחת את המשתמשת לחכות למשהו שלא יקרה.
if (-not (Test-TaskExists)) {
    Write-Host ''
    Write-Host "ההתקנה נכשלה - המשימה '$TaskName' לא נרשמה." -ForegroundColor Red
    Write-Host 'אפשר להמשיך לעבוד: הרצה ידנית בלחיצה כפולה על "משיכת תנועות מהבנק.bat".'
    exit 1
}

Write-Host ''
Write-Host "המשימה '$TaskName' הותקנה." -ForegroundColor Green
Write-Host "היא מתעוררת כל $EveryMinutes דקות ובודקת אם הגיע הזמן. ברוב הפעמים היא לא עושה כלום."
Write-Host 'המשימה רצה רק כשהמשתמש מחובר למחשב.'
Write-Host ''
Write-Host 'מה עכשיו:'
Write-Host '  1. במסך ההגדרות של המערכת: ניהול -> משיכה אוטומטית מהבנק - קובעים שעה וימים.'
Write-Host '  2. ממלאים סיסמאות בתיקיית secrets (ר. "קרא אותי.txt").'
Write-Host '  3. התחברות ראשונה לכל בנק דורשת דפדפן גלוי - ר. "קרא אותי.txt".'
Write-Host ''
Write-Host 'לבדיקה מיידית בלי לחכות:  .\scheduler.ps1 -WhatIfOnly'
Write-Host 'לבדיקת מצב:               .\install-schedule.ps1 -Status'
Write-Host 'להסרה:                    .\install-schedule.ps1 -Remove'
