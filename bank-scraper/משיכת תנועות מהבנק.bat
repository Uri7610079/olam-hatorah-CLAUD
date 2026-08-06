@echo off
REM ============================================================================
REM  Bank transaction scraper - launcher.
REM
REM  IMPORTANT: this file must stay pure ASCII, with no "chcp" line.
REM  cmd.exe reads a batch file by BYTE POSITION. Changing the codepage
REM  mid-file (chcp 65001) breaks that bookkeeping on multi-byte characters,
REM  so it resumes reading from the middle of a line and every command
REM  becomes garbage. All Hebrew text is printed by the PowerShell script
REM  instead, where it works correctly.
REM
REM  This file must sit in the same folder as bank-scraper-portable.ps1.
REM
REM  Output folder: set in the settings file. Use the other .bat to change it.
REM
REM  FIRST LOGIN to each bank needs a visible browser: remove the REM from
REM  the FIRSTRUN line below, run once, then put the REM back.
REM ============================================================================

powershell -ExecutionPolicy Bypass -File "%~dp0bank-scraper-portable.ps1"

REM FIRSTRUN:
REM powershell -ExecutionPolicy Bypass -File "%~dp0bank-scraper-portable.ps1" -Bank hapoalim -Show

echo.
pause
