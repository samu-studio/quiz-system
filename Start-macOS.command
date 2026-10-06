#!/bin/bash
# Startskript für macOS (Doppelklick möglich)
cd "$(dirname "$0")" || exit 1

# --- Architektur bestimmen (Apple Silicon = arm64, Intel = x64) ---
case "$(uname -m)" in
  arm64|aarch64) ARCH="mac-arm64" ;;
  *)             ARCH="mac-x64"   ;;
esac

# --- Node bestimmen: bevorzugt mitgeliefertes portables Node, sonst System-Node ---
# (chmod, falls das Ausfuehr-Bit beim Entpacken des ZIP verloren ging)
NODE_EXE="node"
if [ -f "./node/$ARCH/node" ]; then
  chmod +x "./node/$ARCH/node" 2>/dev/null
  NODE_EXE="./node/$ARCH/node"
fi

if ! "$NODE_EXE" --version >/dev/null 2>&1; then
  echo "[FEHLER] Node.js nicht gefunden."
  echo "  1) Installieren: https://nodejs.org  (LTS)"
  echo "  2) Portable Variante: node-Binary hier ablegen: ./node/$ARCH/node"
  read -r -p "Enter zum Schließen..."
  exit 1
fi

echo "Starte Quiz System ..."
echo "(Beenden jederzeit mit STRG+C oder der Taste \"q\")"
"$NODE_EXE" server.js
read -r -p "Server beendet. Enter zum Schließen..."
