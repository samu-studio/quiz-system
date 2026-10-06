@echo off
setlocal
cd /d "%~dp0"
title Quiz System

rem --- Node bestimmen: bevorzugt mitgeliefertes portables Node, sonst System-Node ---
set "NODE_EXE=node"
if exist "%~dp0node\win-x64\node.exe" set "NODE_EXE=%~dp0node\win-x64\node.exe"

rem --- Pruefen ob Node vorhanden ist ---
"%NODE_EXE%" --version >nul 2>&1
if errorlevel 1 (
  echo.
  echo [FEHLER] Node.js wurde nicht gefunden.
  echo.
  echo   Zwei Moeglichkeiten:
  echo   1^) Node.js installieren:  https://nodejs.org  ^(LTS^)
  echo   2^) Portable Variante: lege eine "node.exe" hier ab:
  echo      %~dp0node\win-x64\node.exe
  echo.
  pause
  exit /b 1
)

echo Starte Quiz System ...
echo (Beenden jederzeit mit STRG+C oder der Taste "q")
"%NODE_EXE%" "%~dp0server.js"

echo.
echo Server beendet.
pause
