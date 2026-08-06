@echo off
REM ============================================================================
REM  Runs all tests against bank-scraper-portable.ps1 in the parent folder.
REM  Requires Node installed on this machine (the scraper itself does not -
REM  it installs its own private copy).
REM
REM  Pure ASCII with no "chcp" line on purpose - cmd.exe corrupts batch files
REM  that mix a codepage change with multi-byte characters.
REM ============================================================================
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo Node was not found on this machine. The tests need Node installed.
  echo The scraper itself does not - it installs its own private copy.
  echo.
  pause
  exit /b 1
)

echo === building the testable module from the PS1 ===
node build-testable.js
if errorlevel 1 goto :failed

echo.
echo === field mapping and duplicate detection ===
node test-mapping.js
if errorlevel 1 goto :failed

echo.
echo === per-account attribution ===
node test-accounts.js
if errorlevel 1 goto :failed

echo.
echo === Node version check ===
powershell -ExecutionPolicy Bypass -File verscheck.ps1
if errorlevel 1 goto :failed

echo.
echo ============================================================
echo  ALL PASSED
echo ============================================================
echo.
pause
exit /b 0

:failed
echo.
echo ============================================================
echo  A TEST FAILED - see the detail above.
echo ============================================================
echo.
pause
exit /b 1
