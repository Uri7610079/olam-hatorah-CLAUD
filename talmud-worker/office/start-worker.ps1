<#
  מפעיל את התוכנית אם היא לא רצה. המשימה המתוזמנת קוראת לזה כל 5 דקות, כך שאחרי
  הדלקת המחשב או תקלה התוכנית חוזרת לבד - ואף פעם לא רצים שני עותקים.
#>
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $Root 'worker.pid'

if (Test-Path $pidFile) {
    $old = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq 'node' })) { exit 0 }
}

$node = (Get-Content (Join-Path $Root 'node-path.txt') -ErrorAction SilentlyContinue | Select-Object -First 1)
if (-not $node -or -not (Test-Path $node)) { $node = 'node' }

$log = Join-Path $Root 'worker.log'
$err = Join-Path $Root 'worker-errors.log'
# יומן קודם נשמר בצד (פעם אחת), כדי שאפשר יהיה לראות מה קרה לפני ההפעלה מחדש
if (Test-Path $log) { Move-Item $log (Join-Path $Root 'worker.previous.log') -Force }

$proc = Start-Process -FilePath $node -ArgumentList ('"' + (Join-Path $Root 'talmud-worker.mjs') + '"') `
    -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $err -PassThru
Set-Content -Path $pidFile -Value $proc.Id
