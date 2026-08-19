@echo off
REM ============================================================================
REM  One-off test: Mercantile BUSINESS portal (organisation account).
REM
REM  This file must stay pure ASCII, with no "chcp" line - cmd.exe reads a
REM  batch file by BYTE POSITION, and changing the codepage mid-file breaks
REM  that bookkeeping on multi-byte characters. All Hebrew is printed by the
REM  PowerShell script instead, which is also why the .ps1 it calls has an
REM  English filename.
REM
REM  The logic lives in run-business-test.ps1, not in a long -Command string
REM  here: an end-of-run marker has to be written INSIDE the transcript, and
REM  that is easy to get wrong when it is squeezed into one cmd line.
REM
REM  Output: business-test-output.txt next to this file. That file is what
REM  gets sent back for diagnosis - nothing needs copying off the screen.
REM ============================================================================

powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0run-business-test.ps1"

echo.
pause
