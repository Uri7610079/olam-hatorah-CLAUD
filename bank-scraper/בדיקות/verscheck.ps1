$MinNodeVersion = [version]'22.22.2'

function Get-NodeVersion($exePath) {
    try { $raw = & $exePath -v 2>$null } catch { return $null }
    if ("$raw".Trim() -match '^v(\d+)\.(\d+)\.(\d+)') {
        return [version]"$($Matches[1]).$($Matches[2]).$($Matches[3])"
    }
    return $null
}

$fail = 0
function Check($name, $cond, $extra) {
  if ($cond) { Write-Host "  PASS  $name" } else { Write-Host "  FAIL  $name  -> $extra"; $script:fail++ }
}

Write-Host "--- version parsing ---"
foreach ($t in @(
  @{f='node-old.cmd';   exp='20.11.0'},
  @{f='node-edge.cmd';  exp='22.0.0'},
  @{f='node-exact.cmd'; exp='22.22.2'},
  @{f='node-new.cmd';   exp='24.18.0'}
)) {
  $v = Get-NodeVersion (Join-Path $PSScriptRoot $t.f)
  Check "$($t.f) -> v$($t.exp)" ("$v" -eq $t.exp) "got '$v'"
}
Check "garbage output -> null" ($null -eq (Get-NodeVersion (Join-Path $PSScriptRoot 'node-broken.cmd'))) "not null"
Check "missing file -> null, no throw" ($null -eq (Get-NodeVersion (Join-Path $PSScriptRoot 'nope.cmd'))) "not null"

Write-Host "--- accept/reject against v$MinNodeVersion ---"
Check "v20.11.0 rejected" ((Get-NodeVersion (Join-Path $PSScriptRoot 'node-old.cmd')) -lt $MinNodeVersion) ""
Check "v22.0.0 rejected (minor matters, not just major)" ((Get-NodeVersion (Join-Path $PSScriptRoot 'node-edge.cmd')) -lt $MinNodeVersion) ""
Check "v22.22.2 accepted (exact boundary)" ((Get-NodeVersion (Join-Path $PSScriptRoot 'node-exact.cmd')) -ge $MinNodeVersion) ""
Check "v24.18.0 accepted" ((Get-NodeVersion (Join-Path $PSScriptRoot 'node-new.cmd')) -ge $MinNodeVersion) ""

Write-Host "--- LTS pick from the real nodejs.org index ---"
try {
  $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
  $naive = ($index | Where-Object { $_.lts } | Select-Object -First 1).version
  $lts = $null
  foreach ($c in ($index | Where-Object { $_.lts })) {
    if ("$($c.version)" -match '^v(\d+)\.(\d+)\.(\d+)$') {
      if ([version]"$($Matches[1]).$($Matches[2]).$($Matches[3])" -ge $MinNodeVersion) { $lts = $c; break }
    }
  }
  Check "an LTS meeting the requirement exists" ($null -ne $lts) "none found"
  if ($lts) {
    Write-Host "        old code would grab: $naive"
    Write-Host "        new code picks     : $($lts.version)  (LTS $($lts.lts))"
  }
} catch {
  Write-Host "  SKIP  no network: $($_.Exception.Message)"
}

Write-Host ""
if ($fail -eq 0) { Write-Host "ALL PASSED" } else { Write-Host "$fail FAILED" }
exit $fail
