@echo off
REM ============================================================================
REM  Opens the settings file (output folder) in Notepad.
REM  IMPORTANT: this file must stay pure ASCII, no "chcp" line - see the
REM  explanation in the other .bat. All Hebrew is printed by PowerShell.
REM  This file must sit in the same folder as bank-scraper-portable.ps1.
REM ============================================================================

powershell -ExecutionPolicy Bypass -File "%~dp0bank-scraper-portable.ps1" -EditSettings
