<#
  התקנת "משיכה מתלמוד" במחשב המשרד - פעם אחת.

  מה זה עושה:
    1. מוודא שיש Node.js 20 ומעלה. אם אין - מוריד עותק פרטי לתיקייה הזו (בלי הרשאות מנהל,
       בלי לגעת ב-Node שכבר מותקן במחשב).
    2. רושם משימה מתוזמנת (למשתמש הנוכחי, בלי הרשאות מנהל) שבודקת כל 5 דקות שהתוכנית
       רצה, ומפעילה אותה אם לא - כך היא עולה לבד אחרי הדלקת המחשב וחוזרת אחרי תקלה.
    3. מפעיל אותה עכשיו, ובודק שהיא מגיעה לתלמוד ולמערכת.

  למה במחשב המשרד ולא בשרת: תלמוד חוסם שרתי ענן, אבל עונה למחשבים רגילים.
#>
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Runtime = Join-Path $Root 'runtime'
$TaskName = 'OlamHatorah-TalmudWorker'
$MinNode = [version]'20.0.0'

function Write-Step($t) { Write-Host ''; Write-Host "== $t" -ForegroundColor Cyan }

function Get-NodeVersion($exe) {
    try { $raw = & $exe -v 2>$null } catch { return $null }
    if ("$raw".Trim() -match '^v(\d+)\.(\d+)\.(\d+)') { return [version]"$($Matches[1]).$($Matches[2]).$($Matches[3])" }
    return $null
}

function Ensure-Node {
    $sys = Get-Command node -ErrorAction SilentlyContinue
    if ($sys) {
        $v = Get-NodeVersion $sys.Source
        if ($v -and $v -ge $MinNode) { Write-Host "  Node במחשב: v$v"; return $sys.Source }
    }
    $localExe = Join-Path $Runtime 'node\node.exe'
    if (Test-Path $localExe) {
        $v = Get-NodeVersion $localExe
        if ($v -and $v -ge $MinNode) { Write-Host "  Node פרטי: v$v"; return $localExe }
    }
    Write-Host '  מוריד עותק פרטי של Node.js (פעם אחת, צריך אינטרנט)...'
    New-Item -ItemType Directory -Force -Path $Runtime | Out-Null
    $arch = if ($env:PROCESSOR_ARCHITECTURE -match 'ARM64') { 'win-arm64' } else { 'win-x64' }
    $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
    $lts = $index | Where-Object { $_.lts } | Select-Object -First 1
    $name = "node-$($lts.version)-$arch"
    $zip = Join-Path $Runtime "$name.zip"
    Invoke-WebRequest -Uri "https://nodejs.org/dist/$($lts.version)/$name.zip" -OutFile $zip -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $Runtime -Force
    Remove-Item $zip -Force
    $target = Join-Path $Runtime 'node'
    if (Test-Path $target) { Remove-Item -Recurse -Force $target }
    Move-Item (Join-Path $Runtime $name) $target -Force
    $v = Get-NodeVersion $localExe
    if (-not $v) { throw 'התקנת Node נכשלה' }
    Write-Host "  הותקן Node פרטי: v$v"
    return $localExe
}

try {
    if (-not (Test-Path (Join-Path $Root 'config.json'))) { throw 'חסר הקובץ config.json בתיקייה - יש להעתיק את כל התיקייה כמו שהיא' }
    if (-not (Test-Path (Join-Path $Root 'talmud-worker.mjs'))) { throw 'חסר הקובץ talmud-worker.mjs בתיקייה' }

    Write-Step 'Node.js'
    $node = Ensure-Node
    Set-Content -Path (Join-Path $Root 'node-path.txt') -Value $node -Encoding UTF8

    Write-Step 'בדיקת חיבור לתלמוד ולמערכת'
    $check = & $node (Join-Path $Root 'talmud-worker.mjs') --check 2>&1 | Out-String
    Write-Host $check.Trim()
    if ($LASTEXITCODE -ne 0) { throw 'הבדיקה נכשלה - ר'' ההודעה למעלה' }

    Write-Step 'הפעלה אוטומטית'
    $starter = Join-Path $Root 'start-worker.ps1'
    # \" - מרכאות אמיתיות סביב הנתיב (רווחים ועברית בנתיב)
    $taskRun = 'powershell -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File \"' + $starter + '\"'
    schtasks /create /tn $TaskName /tr $taskRun /sc minute /mo 5 /f | Out-Null
    cmd /c "schtasks /query /tn ""$TaskName"" >nul 2>&1"
    if ($LASTEXITCODE -ne 0) { throw "המשימה המתוזמנת '$TaskName' לא נרשמה" }
    Write-Host "  נרשמה משימה '$TaskName' (בדיקה כל 5 דקות שהתוכנית רצה)"

    & powershell -ExecutionPolicy Bypass -NoProfile -File $starter
    Start-Sleep -Seconds 4
    $pidFile = Join-Path $Root 'worker.pid'
    $running = (Test-Path $pidFile) -and (Get-Process -Id (Get-Content $pidFile) -ErrorAction SilentlyContinue)
    if (-not $running) { throw 'התוכנית לא עלתה - ר'' worker-errors.log' }

    Write-Host ''
    Write-Host '✓ ההתקנה הסתיימה. משיכה מתלמוד פועלת מהמחשב הזה.' -ForegroundColor Green
    Write-Host '  המחשב צריך להיות דלוק ומחובר כשלוחצים "משיכה" במערכת.'
} catch {
    Write-Host ''
    Write-Host "ההתקנה נכשלה: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
