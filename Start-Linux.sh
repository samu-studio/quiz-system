#!/bin/bash
# Startskript für Linux
cd "$(dirname "$0")" || exit 1

# --- Architektur bestimmen (PC/64-bit = x64, Raspberry Pi u.ä. = arm64) ---
case "$(uname -m)" in
  aarch64|arm64) ARCH="linux-arm64" ;;
  *)             ARCH="linux-x64"   ;;
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
  echo "  1) Installieren: https://nodejs.org  (oder per Paketmanager)"
  echo "  2) Portable Variante: node-Binary hier ablegen: ./node/$ARCH/node"
  read -r -p "Enter zum Schließen..."
  exit 1
fi

echo "Starte Quiz System ..."
echo "(Beenden jederzeit mit STRG+C oder der Taste \"q\")"
"$NODE_EXE" server.js
#read -r -p "Server beendet. Enter zum Schließen...
echo Server beendet
