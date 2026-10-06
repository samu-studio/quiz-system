#!/bin/bash
# Eigene Inhalte (Bilder, Audios, Pause-Bilder, Hintergrundmusik, portables Node, config.json) aus
# einem alten Quiz-Ordner in diese neue Version holen. Linux + macOS.
# Optional: alten Ordner direkt als Argument uebergeben: bash GetOldData.sh /pfad/alt
cd "$(dirname "$0")" || exit 1

# --- Alten Ordner bestimmen: Argument, sonst Dialog, sonst Eingabe im Terminal ---
OLD_DIR="$1"
PROMPT="Alten Quiz-Ordner waehlen (die vorherige Version mit deinen Inhalten)"
if [ -z "$OLD_DIR" ]; then
  if [ "$(uname -s)" = "Darwin" ]; then
    OLD_DIR="$(osascript -e "POSIX path of (choose folder with prompt \"$PROMPT\")" 2>/dev/null)"
  elif [ -n "$DISPLAY$WAYLAND_DISPLAY" ] && command -v zenity >/dev/null 2>&1; then
    OLD_DIR="$(zenity --file-selection --directory --title="$PROMPT" 2>/dev/null)"
  elif [ -n "$DISPLAY$WAYLAND_DISPLAY" ] && command -v kdialog >/dev/null 2>&1; then
    OLD_DIR="$(kdialog --getexistingdirectory "$HOME" --title "$PROMPT" 2>/dev/null)"
  else
    echo "$PROMPT"
    echo "(Tipp: Ordner ins Terminal ziehen, dann Enter)"
    read -r -p "Pfad: " OLD_DIR
    OLD_DIR="${OLD_DIR%\'}"; OLD_DIR="${OLD_DIR#\'}"   # Anfuehrungszeichen vom Reinziehen entfernen
    OLD_DIR="${OLD_DIR%\"}"; OLD_DIR="${OLD_DIR#\"}"
    OLD_DIR="${OLD_DIR%% }"
  fi
fi
if [ -z "$OLD_DIR" ]; then
  echo "Kein Ordner gewaehlt – abgebrochen."
  read -r -p "Enter zum Schliessen ..." _
  exit 1
fi

# --- Architektur bestimmen (wie Start-Linux.sh / Start-macOS.command) ---
if [ "$(uname -s)" = "Darwin" ]; then
  case "$(uname -m)" in arm64|aarch64) ARCH="mac-arm64" ;; *) ARCH="mac-x64" ;; esac
else
  case "$(uname -m)" in aarch64|arm64) ARCH="linux-arm64" ;; *) ARCH="linux-x64" ;; esac
fi

# --- Node bestimmen: portables Node dieser Version, sonst das der alten (auch eine Ebene
# tiefer, falls der Ordner ueber der App gewaehlt wurde), sonst System-Node.
# Ohne jedes Node laeuft so das alte portable Node, und das Skript kopiert es mit hierher.
NODE_EXE="node"
for CAND in "./node/$ARCH/node" "$OLD_DIR/node/$ARCH/node" "$OLD_DIR"/*/node/"$ARCH"/node; do
  if [ -f "$CAND" ]; then
    chmod +x "$CAND" 2>/dev/null
    if "$CAND" --version >/dev/null 2>&1; then NODE_EXE="$CAND"; break; fi
  fi
done
if ! "$NODE_EXE" --version >/dev/null 2>&1; then
  echo "[FEHLER] Node.js nicht gefunden (weder in node/$ARCH/ noch im System)."
  read -r -p "Enter zum Schliessen ..." _
  exit 1
fi

"$NODE_EXE" tools/get-old-data.js "$OLD_DIR"
echo
read -r -p "Enter zum Schliessen ..." _
