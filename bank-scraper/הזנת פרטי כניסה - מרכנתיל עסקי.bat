@echo off
REM ============================================================================
REM  Write the Mercantile BUSINESS login file, without editing JSON by hand.
REM
REM  This file must stay pure ASCII, with no "chcp" line - cmd.exe reads a
REM  batch file by BYTE POSITION, and changing the codepage mid-file breaks
REM  that bookkeeping on multi-byte characters. All Hebrew is printed by the
REM  PowerShell script instead, and that is also why the .ps1 it calls has an
REM  English filename.
REM ============================================================================

powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0set-business-login.ps1"

echo.
pause
