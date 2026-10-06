#!/bin/bash
# Release-ZIP zum Verschicken bauen (ohne node/, eigene Inhalte, config.json). Linux + macOS.
# Optional direkt: bash Release.sh <win|linux|mac|alle> [Versionsname]
cd "$(dirname "$0")" || exit 1

# --- Node bestimmen: portables Node, sonst System-Node (wie Start-Linux.sh / Start-macOS.command) ---
if [ "$(uname -s)" = "Darwin" ]; then
  case "$(uname -m)" in arm64|aarch64) ARCH="mac-arm64" ;; *) ARCH="mac-x64" ;; esac
else
  case "$(uname -m)" in aarch64|arm64) ARCH="linux-arm64" ;; *) ARCH="linux-x64" ;; esac
fi
NODE_EXE="node"
if [ -f "./node/$ARCH/node" ]; then
  chmod +x "./node/$ARCH/node" 2>/dev/null
  NODE_EXE="./node/$ARCH/node"
fi
if ! "$NODE_EXE" --version >/dev/null 2>&1; then
  echo "[FEHLER] Node.js nicht gefunden (weder in node/$ARCH/ noch im System)."
  read -r -p "Enter zum Schliessen ..." _
  exit 1
fi

"$NODE_EXE" tools/release.js "$@"
echo
read -r -p "Enter zum Schliessen ..." _
