#Requires -Version 5.1
<#
================================================================================
  set-business-login.ps1 — כותב את קובץ הכניסה למערכת העסקית, בלי עריכה ידנית.

  למה זה קיים
  ------------
  קובץ JSON נערך ביד בפנקס רשימות הוא מקור קבוע לתקלות: פסיק שנשאר תלוי אחרי
  מחיקת שורה, מרכאה שנמחקה בטעות, סוגר חסר. כל אחת מהן מפילה הרצה שלמה, וכל
  אחת נראית תקינה לחלוטין לעין. זה קרה כאן פעמיים ברצף.

  הקובץ הזה שואל שתי שאלות וכותב JSON תקין בעצמו, כולל בריחה נכונה של תווים
  מיוחדים בסיסמה (מרכאות, לוכסנים). אחרי הכתיבה הוא קורא את הקובץ בחזרה
  ומוודא שהוא נפתח - כדי שלא נגלה תקלה רק בהרצה הבאה מול הבנק.

  השם באנגלית בכוונה: קובץ ה-BAT שמפעיל אותו חייב להישאר ASCII טהור, ולכן
  אסור שיכיל את שם הקובץ בעברית.
================================================================================
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# הקובץ יושב בתיקיית האבחון; תיקיית הסיסמאות שייכת לסקרייפר, רמה אחת מעל.
# חשוב שתישאר שם: מחיקת תיקיית האבחון אסור שתיקח איתה את הסיסמאות.
$ToolsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ToolsRoot
if (-not (Test-Path -LiteralPath (Join-Path $Root 'bank-scraper-portable.ps1'))) {
    Write-Host "שגיאה: לא נמצא bank-scraper-portable.ps1 בתיקייה $Root" -ForegroundColor Red
    Write-Host 'ודאו שתיקיית "כלי אבחון" נמצאת בתוך תיקיית הסקרייפר ולא הועברה החוצה.' -ForegroundColor Red
    exit 1
}
$Secrets = Join-Path $Root 'secrets'
New-Item -ItemType Directory -Force -Path $Secrets | Out-Null

Write-Host ''
Write-Host '=== הזנת פרטי כניסה - מרכנתיל, מערכת עסקית ===' -ForegroundColor Cyan
Write-Host ''
Write-Host 'אלה הפרטים שאיתם נכנסים לאתר הבנק במסך "כניסה לחשבונות עסקיים".'
Write-Host 'שני שדות בלבד: מספר העמותה וסיסמה. אין כאן קוד משתמש.'
Write-Host ''

$id = (Read-Host 'מספר העמותה').Trim()
if (-not $id) { Write-Host 'לא הוזן מספר עמותה. לא נכתב כלום.' -ForegroundColor Red; exit 1 }

# קריאה רגילה ולא ‎-AsSecureString‎. הסתרת ההקלדה נראית עדיפה, אבל
# ‎-AsSecureString‎ דורש קונסולה אינטראקטיבית אמיתית ונתקע בכל הרצה אחרת - כלומר
# גם לא ניתן לבדיקה מראש. הסיסמה נכתבת ממילא לקובץ כטקסט גלוי (כך הסקרייפר
# קורא אותה), ולכן הרווח קטן והסיכון להיתקעות אמיתי. עדיף מסלול שנבדק.
$password = Read-Host 'סיסמה'
if (-not $password) { Write-Host 'לא הוזנה סיסמה. לא נכתב כלום.' -ForegroundColor Red; exit 1 }

# שם הקובץ נקבע לבד, ואין שאלת "תווית".
#
# הגרסה הראשונה כאן ביקשה תווית חופשית, וזו הייתה טעות: המשתמש מקליד בחלון
# cmd שבו העברית ממילא מוצגת משובשת, וטקסט עברי שנקלט משם עלול להפוך לשם
# קובץ מעוות. מספר העמותה הוא ספרות בלבד, הוא מזהה את העמותה בצורה מושלמת,
# ואין צורך להקליד אותו פעם נוספת - הוא כבר נמסר.
$name = 'mercantile-business'
$primary = Join-Path $Secrets 'mercantile-business.json'
$existingId = $null
if (Test-Path -LiteralPath $primary) {
    try { $existingId = "$((Get-Content -LiteralPath $primary -Raw -Encoding UTF8 | ConvertFrom-Json).id)".Trim() } catch { $existingId = $null }
}

if ((Test-Path -LiteralPath $primary) -and $existingId -and $existingId -ne $id) {
    # עמותה נוספת: קובץ נפרד על שם מספר העמותה שלה.
    $name = "mercantile-business__$id"
    Write-Host ''
    Write-Host "כבר קיימת עמותה ($existingId). זו תיכתב כעמותה נוספת." -ForegroundColor Yellow
}
$file = Join-Path $Secrets "$name.json"

if (Test-Path -LiteralPath $file) {
    Write-Host ''
    Write-Host "הקובץ $name.json כבר קיים ומכיל את אותה עמותה." -ForegroundColor Yellow
    $answer = Read-Host 'להחליף את תוכנו? (כן/לא)'
    if ($answer -notmatch '^(כן|כ|y|yes)$') { Write-Host 'בוטל. לא נכתב כלום.'; exit 0 }
}

# ConvertTo-Json מטפל בעצמו בבריחה של מרכאות, לוכסנים ותווי עברית - וזו בדיוק
# העבודה שאי אפשר לסמוך עליה בעריכה ידנית.
$json = ([ordered]@{ id = $id; password = $password } | ConvertTo-Json)
[System.IO.File]::WriteAllText($file, $json, (New-Object System.Text.UTF8Encoding $false))

# אימות: קוראים בחזרה ומוודאים שהקובץ נפתח ושהערכים הגיעו שלמים. בלי זה היינו
# מגלים תקלה רק בהרצה הבאה מול הבנק - כלומר אחרי שנשרפה כניסה יומית.
try {
    $check = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
    Write-Host ''
    Write-Host "הקובץ נכתב אך אינו נקרא בחזרה: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
if ($check.id -ne $id -or $check.password -ne $password) {
    Write-Host ''
    Write-Host 'הקובץ נכתב אך התוכן שנקרא בחזרה אינו זהה למה שהוזן.' -ForegroundColor Red
    exit 1
}

$masked = if ($password.Length -le 2) { '***' } else { $password.Substring(0,1) + ('*' * ($password.Length - 1)) }
Write-Host ''
Write-Host 'נכתב בהצלחה ואומת:' -ForegroundColor Green
Write-Host "  קובץ:        $file"
Write-Host "  מספר עמותה:  $id"
Write-Host "  סיסמה:       $masked"
Write-Host ''
Write-Host 'עכשיו אפשר להריץ את "בדיקת חשבון עמותה - מרכנתיל.bat".'
