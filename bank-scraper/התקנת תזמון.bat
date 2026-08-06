@echo off
REM ============================================================================
REM  Installs the Windows scheduled task that wakes the scraper's scheduler.
REM  One-time setup. The timing itself (hour, days) is set in the web app,
REM  not here - this task only wakes the scheduler every 15 minutes.
REM
REM  IMPORTANT: this file must stay pure ASCII, with no "chcp" line - see the
REM  explanation in "moshihat tnuot" launcher. All Hebrew is printed by the
REM  PowerShell script instead.
REM  This file must sit in the same folder as scheduler.ps1.
REM
REM  To remove the task later, run from a terminal in this folder:
REM     powershell -ExecutionPolicy Bypass -File install-schedule.ps1 -Remove
REM ============================================================================

powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0install-schedule.ps1"

echo.
pause
