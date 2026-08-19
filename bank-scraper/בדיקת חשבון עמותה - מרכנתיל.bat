@echo off
REM ============================================================================
REM  One-off test: Mercantile BUSINESS portal (organisation account).
REM
REM  This file must stay pure ASCII, with no "chcp" line - cmd.exe reads a
REM  batch file by BYTE POSITION, and changing the codepage mid-file breaks
REM  that bookkeeping on multi-byte characters. All Hebrew is printed by the
REM  PowerShell script instead.
REM
REM  What it does:
REM    1. runs ONLY the mercantile-business connection, with a visible browser
REM    2. saves the complete output to  business-test-output.txt  next to it
REM
REM  The saved file is the whole point: it is what gets sent back for
REM  diagnosis. Nothing needs to be copied off the screen by hand.
REM ============================================================================

powershell -ExecutionPolicy Bypass -NoProfile -Command "$ErrorActionPreference='Continue'; Start-Transcript -Path '%~dp0business-test-output.txt' -Force | Out-Null; try { & '%~dp0bank-scraper-portable.ps1' -Bank mercantile-business -Show } catch { Write-Host ('FAILED: ' + $_.Exception.Message) } finally { Stop-Transcript | Out-Null }; Write-Host ''; Write-Host 'the full output was saved to:' -ForegroundColor Cyan; Write-Host '%~dp0business-test-output.txt' -ForegroundColor Cyan"

echo.
pause
