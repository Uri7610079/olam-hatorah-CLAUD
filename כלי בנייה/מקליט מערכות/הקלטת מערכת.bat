@echo off
REM ============================================================================
REM  System recorder - a BUILD tool, not an operational one.
REM
REM  Records a manual browsing session in any web system, so that a scraper
REM  can be written for it without guessing. Pick a system from the menu, log
REM  in, walk through the screens that matter, then close the browser window.
REM
REM  Systems are listed in the systems JSON file next to this one. Adding a
REM  system is a line in that file, not a code change.
REM
REM  Typed values, passwords and response bodies are NEVER recorded, and any
REM  run of 5+ digits is masked. See the header of system-recorder.ps1.
REM
REM  This file must stay pure ASCII, with no "chcp" line - cmd.exe reads a
REM  batch file by BYTE POSITION, and changing the codepage mid-file breaks
REM  that bookkeeping on multi-byte characters. All Hebrew is printed by the
REM  PowerShell script instead.
REM ============================================================================

powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0system-recorder.ps1"

echo.
pause
