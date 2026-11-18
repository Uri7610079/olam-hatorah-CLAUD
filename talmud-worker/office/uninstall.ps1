<#
  הסרת "משיכה מתלמוד" מהמחשב הזה: מבטל את המשימה המתוזמנת ועוצר את התוכנית.
  התיקייה עצמה נשארת - אפשר למחוק אותה אחר כך.
#>
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$TaskName = 'OlamHatorah-TalmudWorker'
cmd /c "schtasks /delete /tn ""$TaskName"" /f >nul 2>&1"
$pidFile = Join-Path $Root 'worker.pid'
if (Test-Path $pidFile) {
    $p = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
    Remove-Item $pidFile -Force
}
Write-Host '✓ משיכה מתלמוד הוסרה מהמחשב הזה.' -ForegroundColor Green
