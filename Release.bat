@echo off
rem Release-ZIP zum Verschicken bauen (ohne node/, eigene Inhalte, config.json).
rem Optional direkt: Release.bat win^|linux^|mac^|alle [Versionsname]
setlocal
cd /d "%~dp0"
title Quiz System - Release bauen

rem --- Node bestimmen: bevorzugt mitgeliefertes portables Node, sonst System-Node ---
set "NODE_EXE=node"
if exist "%~dp0node\win-x64\node.exe" set "NODE_EXE=%~dp0node\win-x64\node.exe"

"%NODE_EXE%" --version >nul 2>&1
if errorlevel 1 (
  echo.
  echo [FEHLER] Node.js wurde nicht gefunden ^(weder in node\win-x64\ noch im System^).
  echo.
  pause
  exit /b 1
)

"%NODE_EXE%" "%~dp0tools\release.js" %*
echo.
pause
