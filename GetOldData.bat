@echo off
setlocal
cd /d "%~dp0"
title Quiz System - alte Inhalte holen

rem Eigene Inhalte (Bilder, Audios, Pause-Bilder, Hintergrundmusik, portables Node, config.json) aus
rem einem alten Quiz-Ordner in diese neue Version holen.
rem Alternativ: alten Ordner per Drag and Drop auf diese Datei ziehen.

rem --- Alten Ordner bestimmen: Argument, sonst Explorer-Ordnerdialog ---
set "OLD_DIR=%~1"
if not defined OLD_DIR (
  for /f "usebackq delims=" %%i in (`powershell -NoProfile -STA -Command "$f=(New-Object -ComObject Shell.Application).BrowseForFolder(0,'Alten Quiz-Ordner waehlen (die vorherige Version mit deinen Inhalten)',0x51,17); if($f){$f.Self.Path}"`) do set "OLD_DIR=%%i"
)
if not defined OLD_DIR (
  echo Kein Ordner per Dialog gewaehlt.
  echo Pfad eingeben ^(oder Ordner hier hineinziehen^), leer = Abbrechen:
  set /p "OLD_DIR=Pfad: "
)
if not defined OLD_DIR (
  echo Abgebrochen.
  pause
  exit /b 1
)
set "OLD_DIR=%OLD_DIR:"=%"

rem --- Node bestimmen: portables Node dieser Version, sonst das der alten (auch eine Ebene
rem tiefer, falls der Ordner ueber der App gewaehlt wurde), sonst System-Node.
rem Ohne jedes Node laeuft so das alte portable Node, und das Skript kopiert es mit hierher.
set "NODE_EXE=node"
for /d %%d in ("%OLD_DIR%\*") do if exist "%%~fd\node\win-x64\node.exe" set "NODE_EXE=%%~fd\node\win-x64\node.exe"
if exist "%OLD_DIR%\node\win-x64\node.exe" set "NODE_EXE=%OLD_DIR%\node\win-x64\node.exe"
if exist "%~dp0node\win-x64\node.exe" set "NODE_EXE=%~dp0node\win-x64\node.exe"

"%NODE_EXE%" --version >nul 2>&1
if errorlevel 1 (
  echo.
  echo [FEHLER] Node.js wurde nicht gefunden ^(weder in node\win-x64\ noch im System^).
  echo.
  pause
  exit /b 1
)

"%NODE_EXE%" "%~dp0tools\get-old-data.js" "%OLD_DIR%"
echo.
pause
