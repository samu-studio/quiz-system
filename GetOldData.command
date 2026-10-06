#!/bin/bash
# Eigene Inhalte (Bilder, Audios, Pause-Bilder, Hintergrundmusik, portables Node, config.json) aus
# einem alten Quiz-Ordner in diese neue Version holen.
# macOS: Doppelklick-Variante von GetOldData.sh (Finder startet nur .command per Doppelklick)
cd "$(dirname "$0")" || exit 1
exec bash ./GetOldData.sh "$@"
