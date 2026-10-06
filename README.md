# Quiz System

> 🤖✨ **Vibegecodete App** – dieses Projekt ist komplett per *Vibe-Coding* entstanden: Ideen
> und Tests von mir, der Code größtenteils von einer KI ([Claude Code](https://claude.com/claude-code)).
> Es läuft bei uns zuverlässig auf Partys, ist aber ein Hobbyprojekt ohne Garantie –
> Fehler, Ecken und Kanten inklusive. Issues und Ideen sind willkommen!

Lokale Quiz-/Party-Spiel-Plattform für das eigene WLAN – **ohne Installation, ohne Cloud-Server**.
Ein Rechner ist der Host (an ihm hängt der **Bildschirm**/Beamer). **Master** und **Spieler**
verbinden sich per Handy-Browser über die IP-Adresse des Hosts. Alles synchronisiert sich
in Echtzeit über WebSocket – der Server hält den kompletten Spielzustand, die Clients zeigen
nur an.

## ⬇️ Download

**[➡️ Neueste Version herunterladen](../../releases/latest)** – dort unter „Assets" die ZIP
für das eigene Betriebssystem wählen:

| Datei                          | System  |
|--------------------------------|---------|
| `quiz_system_<Version>-win.zip`   | Windows |
| `quiz_system_<Version>-mac.zip`   | macOS   |
| `quiz_system_<Version>-linux.zip` | Linux   |

ZIP entpacken, Startdatei doppelklicken – fertig (siehe [Schnellstart](#schnellstart)).
Ältere Versionen gibt es unter [Releases](../../releases).

> Die Release-ZIPs enthalten **kein** Node.js (zu groß). Entweder [Node.js](https://nodejs.org)
> (aktuelle LTS) einmal installieren, oder eine portable Node-Binary in den Ordner `node/`
> legen (siehe unten). Beim Update aus einer älteren Version holt `GetOldData` das portable
> Node automatisch mit.

## Spiele

Aktuell enthalten sind **zwölf Spiele** plus eine Bildanzeige für Zwischenfolien, dazu ein
datengetriebenes Gerüst, mit dem sich weitere Modi leicht ergänzen lassen:

| Spiel                     | Kurzbeschreibung                                                     |
|---------------------------|----------------------------------------------------------------------|
| 🚦 Reaktion/Ampel         | Wer bei Grün zuerst drückt gewinnt – zu früh zählt nicht.            |
| 📝 Wortliste aufdecken    | Gemeinsam Wörter einer versteckten Liste erraten.                    |
| 🅰️ Multiple Choice        | Klassisches Quiz, Server wertet die Antworten aus.                   |
| ⏱️ Zeitdruck              | Multiple Choice mit Punkteverfall – schnell = mehr Punkte.           |
| 🚫 Falsche Wörter         | Buzzern, wenn ein Wort nicht in die Kategorie passt.                 |
| ⚡ Wahr/Falsch-Blitzrunde | Aussagen schnell als wahr oder falsch einordnen – buzzern oder alle. |
| 🔗 Zuordnungsquiz         | Kärtchen per Drag & Drop richtig zuordnen.                           |
| 🔀 Reihenfolge-Quiz       | Kärtchen per Drag & Drop in die richtige Reihenfolge bringen.        |
| 🕵️ Detektivquiz           | Hinweise nach und nach aufdecken, früh raten = mehr Punkte.          |
| 📊 Schätzquiz             | Zahl schätzen – näher dran = mehr Punkte.                            |
| 🔊 Audioquiz              | Immer längere Audio-Schnipsel früh erkennen für mehr Punkte.         |
| 🎨 Kritzelquiz            | Alle zeichnen denselben Begriff, danach wird der Favorit gewählt.    |
| 🖼️ Bildanzeige            | Kein Spiel – ein Bild als „Folie" zwischen zwei Runden.              |

Dazu kommen spielübergreifende Party-Extras im 🎉 Fun-Tab: Countdown, Glücksrad, Soundboard,
Schnellumfrage, Hype-Meter, Hintergrundmusik, Nachrichten an Spieler, Fake-Popups und die
Sabotage-Karte.

Codebase, Kommentare und UI sind auf Deutsch.

---

## Schnellstart

1. Release-ZIP [herunterladen](../../releases/latest) und auf dem Host-Rechner entpacken
   (oder diesen Ordner per USB/ZIP kopieren).
2. Passende Startdatei für das Betriebssystem starten:
   - **Windows:** `Start-Windows.bat` (Doppelklick)
   - **macOS:** `Start-macOS.command` (Doppelklick)
   - **Linux:** `Start-Linux.sh` (im Terminal `bash Start-Linux.sh`, oder ausführbar machen)
3. Es öffnet sich automatisch der **Bildschirm** im Browser. Im schwarzen Fenster stehen
   die Adressen für die Handys, z. B. `http://192.168.0.100:8080/`.
4. Handys im **gleichen WLAN** öffnen die passende Adresse – **die Rolle steckt im Pfad**:

   | Adresse                   | Rolle                           |
   |---------------------------|---------------------------------|
   | `http://<IP>:8080/`       | 🎮 Spieler (Standard)           |
   | `http://<IP>:8080/master` | 🎛️ Master (fragt Passwort ab)  |
   | `http://<IP>:8080/screen` | 🖥️ Bildschirm (frei aufrufbar) |

   Alternativ blendet der Master am Bildschirm einen **QR-Code** zur Beitritts-Adresse ein
   (Tab „🎮 Spiel" → „📱 QR-Code am Bildschirm") – Handys scannen und sind sofort Spieler,
   ohne die Adresse einzutippen.

> **Kein Node.js auf dem Zielrechner?** Kein Problem – im Ordner `node/` liegen portable
> Node-Binaries pro System, die Startdateien wählen automatisch die passende:
>
> | Ordner                  | System                           |
> |-------------------------|----------------------------------|
> | `node/win-x64/node.exe` | Windows 64-bit                   |
> | `node/linux-x64/node`   | Linux 64-bit (PC/Laptop)         |
> | `node/linux-arm64/node` | Linux ARM64 (z. B. Raspberry Pi) |
> | `node/mac-x64/node`     | macOS Intel *(leer)*             |
> | `node/mac-arm64/node`   | macOS Apple Silicon *(leer)*     |
>
> Fehlt eine Binary, fällt die Startdatei automatisch auf ein installiertes System-Node zurück.

---

## Update auf eine neue Version (eigene Inhalte übernehmen)

Eine neue Version kommt als frischer Ordner – dort fehlen die eigenen Inhalte. Einfach im
**neuen** Ordner die passende Datei starten und im Dialog den **alten** Ordner wählen:

- **Windows:** `GetOldData.bat` (Doppelklick; alternativ den alten Ordner auf die Datei ziehen)
- **macOS:** `GetOldData.command` (Doppelklick)
- **Linux:** `bash GetOldData.sh` (Dialog über zenity/kdialog, sonst Pfad im Terminal eingeben)

Übernommen werden hochgeladene Hintergrund-/Pause-Bilder, Audios und Hintergrundmusik
(`public/backgrounds`, `public/pause`, `public/audio`, `public/music`), das portable Node (`node/`) sowie die `config.json` mit allen
Profilen, Fragen, Design, Spielplan und Passwort. Die Config wird dabei um alles ergänzt, was
die neue Version zusätzlich kennt (neue Einstellungen, neue Spiele, neue Profilfelder).
Vorhandene Dateien der neuen Version werden nie überschrieben; die bisherige `config.json`
wird als `config.json.vor-import-<Zeit>` gesichert. Der Server muss dabei beendet sein.

---

## Die drei Rollen

| Rolle          | Aufruf    | Aufgabe                              |
|----------------|-----------|--------------------------------------|
| 🖥️ Bildschirm | `/screen` | Beamer-Anzeige, vom Master gesteuert |
| 🎛️ Master     | `/master` | Steuert & konfiguriert alles         |
| 🎮 Spieler     | `/`       | Bedient das aktive Spiel             |

- **🖥️ Bildschirm** – reine Anzeige des jeweils aktiven Spiels, Scoreboard/Siegerehrung und QR-Beitritt. Zeigt oben nur **einen kleinen Punkt** für die eigene Verbindung.
- **🎛️ Master** – steuert und konfiguriert das Spiel, Design und alle generischen Features (Teams, Scoreboard, Spielplan …). **Nur der Master sieht die komplette Geräteliste.**
- **🎮 Spieler** – gibt seinen Namen ein und bekommt die passende „Fernbedienung" für das aktive Spiel (Buzzer, Antwort-Buttons, Slider, Eingabefeld, Drag & Drop – je nach Spiel). Sieht oben nur den eigenen Verbindungspunkt.

> **Verbindungsanzeige & Privatsphäre:** Wer verbunden ist, sieht **nur der Master**
> (Tab „🎮 Spiel" → Geräteliste). Spieler und Bildschirm bekommen lediglich ein kleines
> grün/rotes Symbol für ihre *eigene* Verbindung. Auch Lösungen/richtige Antworten werden
> serverseitig zurückgehalten, bis der Master sie aufdeckt – kein Spiel verrät sie vorher
> per Netzwerkverkehr.

---

## Master: die Tabs

Der Master-Bereich (`/master`, passwortgeschützt – Standard: `admin`) hat diese Tabs:

- **🎮 Spiel** – laufendes Spiel steuern: Killswitch („Spieler sperren"), die spielspezifischen Live-Controls (Start/Weiter/Auflösen/Reset o. ä.) + Ergebnisse, Geräteliste mit Punktekorrektur & Kick, Team-Verwaltung, Scoreboard-/Siegerehrungs-Schalter, Spielplan-Leiste und der QR-Code-Schalter.
- **🎲 Spiele** – Spiel auswählen (mit Sortierung/„schon gespielt"-Markierung), je Spiel **mehrere benannte Konfig-Profile** (laden, bearbeiten, unter neuem Namen speichern, aktiv setzen, löschen) sowie der **Spielplan-Editor** (vorbereitete Spiel+Profil-Abfolge für den ganzen Abend, mit „Nächstes"/„Zurück" durchklickbar).
- **🎨 Design** – Theme-Presets, eigene Farbpalette, Eckenradius/Glow/Schriftart, Hintergrund-Stil, sowie Bildschirm-Extras (Hintergrundbild-Upload, Dim/Blur, Effekte wie Sterne/Partikel/Konfetti/Aurora, Vignette, Titel-Stil) mit Live-Vorschau.
- **🎉 Fun** – Party-Extras unabhängig vom Spiel: Countdown, Glücksrad, Soundboard, Schnellumfrage, Hype-Meter, Nachrichten, Fake-Popups, Sabotage-Karte.
- **⚙️ Allgemein** – Titel, Admin-Passwort und Hintergrundmusik.

Alle Einstellungen werden in `config.json` gespeichert und überstehen einen Neustart.

### Generische Features (spielübergreifend, für jedes Spiel automatisch verfügbar)

- **🔒 Killswitch** – sperrt sofort alle Spieler-Interaktionen, egal welches Spiel läuft.
- **Punktekorrektur** – jeder Spieler-Punktestand lässt sich live per +/− oder Direkteingabe anpassen; eine gemeinsame `game.scores`-Tabelle wird von allen Spielen genutzt.
- **Scoreboard am Bildschirm** – aus/seitliche Leiste/Vollbild/Siegerehrung (Podium mit Medaillen für die Top 3), vom Master umschaltbar; kehrt bei der nächsten Spielaktion automatisch zum laufenden Spiel zurück (außer die seitliche Leiste).
- **Teams** – optionale Team-Wertung: Spieler werden Teams zugeordnet, Team-Punkte sind die Summe der Mitgliederpunkte; Team-Farben erscheinen in Rangliste, Scoreboard und Podium.
- **Spielplan/Playlist** – vorbereitete Reihenfolge aus Spiel + Profil, die der Master Schritt für Schritt durchklickt, statt jedes Mal manuell umzuschalten; übersteht einen Neustart.
- **Design/Theming** – global für alle Rollen, inkl. eigener Hintergrundbilder/Effekte nur für den Bildschirm.
- **QR-Beitritt** – Beitritts-URL als QR-Code am Bildschirm einblendbar.

---

## Konfiguration (`config.json`)

| Feld                                    | Bedeutung                                                           |
|-----------------------------------------|---------------------------------------------------------------------|
| `port`                                  | Netzwerk-Port (Standard 8080)                                       |
| `adminPassword`                         | Passwort für den Master-Bereich                                     |
| `title`                                 | Titel auf Bildschirm/Master                                         |
| `theme`                                 | Theme-Preset oder `custom`                                          |
| `design`                                | Farbpalette, Radius/Glow/Schrift, Hintergrund, Bildschirm-Extras    |
| `activeGame`                            | Aktuell gespieltes Spiel (oder `none` für Standby)                  |
| `gameSort` / `gameOrder` / `gamePlayed` | Sortierung/Status der Spieleliste im Master                         |
| `games.<spiel>.activeProfile`           | Aktives Konfig-Profil dieses Spiels                                 |
| `games.<spiel>.profiles.<name>`         | Benanntes Profil mit den Spiel-Einstellungen                        |
| `playlist`                              | Vorbereitete Spiel+Profil-Abfolge (`steps[]`) + Fortschritt (`pos`) |
| `teamMode` / `teams`                    | Team-Wertung an/aus + angelegte Teams                               |
| `openBrowser`                           | Beim Start automatisch den Bildschirm öffnen                        |

`theme` ist ein Preset-Name (`neon`, `minimal`, `playful`, `midnight`, `sunset`, `forest`,
`ocean`, `candy`, `contrast`) oder `custom`. `activeGame` ist eines von `reaction`,
`wordlist`, `mc`, `zd`, `fw`, `tf`, `zu`, `ro`, `dq`, `sq`, `aq`, `zm`, `bild` (oder `none`). Welche Felder ein Spielprofil hat
(Fragen, Punkte, Timing …), steht je Spiel in der `GAMES`-Registry (`public/js/registry.js`).

> Ältere `config.json`-Dateien mit älterer/flacher Struktur werden beim Start automatisch
> migriert (`migrateConfig()`).

---

## Technik (kurz)

- **Server:** `server.js` ist nur der dünne Einstiegspunkt (Server starten, Start-Banner, sauberes Beenden); die eigentliche Logik liegt modular in `lib/` – u. a. `lib/ws-server.js` (selbst implementiertes WebSocket, RFC 6455), `lib/state.js`/`lib/config.js` (Laufzeitzustand/`config.json`), `lib/snapshot.js` (rollenabhängige Snapshots), `lib/handlers/` (Nachrichtenverarbeitung pro Rolle) und `lib/games/<id>.js` (Spiellogik je Spiel). **Keine npm-Abhängigkeiten**, kein `npm install` nötig.
- **Client:** `public/index.html` (alle drei Ansichten in einer Seite, per Rolle ein-/ausgeblendet) + `public/js/` – klassische, nicht-modulare `<script>`-Dateien in fester Ladereihenfolge, die sich einen globalen Scope teilen (`core.js`, je ein `game-<id>.js`, `config.js`, `editors.js`, `design.js`, zuletzt `registry.js`). `public/styles.css` hält die Theme-Presets.
- **Netzwerk:** Alle Geräte müssen im selben WLAN/LAN sein.

### Firewall

Beim ersten Start fragt Windows evtl. nach einer **Firewall-Freigabe für Node.js** –
für „Private Netzwerke" **zulassen**, sonst erreichen die Handys den Host nicht.

---

## Erweiterbar

Das System ist bewusst als Gerüst gebaut, das um weitere Spiele wachsen soll:

1. **Client – UI:** `public/js/game-<id>.js` mit den `player`-/`screen`-/`master`-Render- Modulen des Spiels anlegen (`create(root, ctx) → { update, destroy? }`) – Vorbild sind `createReactionPlayer`/`createReactionScreen`/`createReactionMaster`. Das `master`-Modul enthält gleich die spielspezifischen Live-Controls + Ergebnisse. Script-Tag in `public/index.html` **vor** `registry.js` ergänzen.
2. **Client – Konfig:** Eintrag in der `GAMES`-Registry (`public/js/registry.js`): Name, Emoji, Beschreibung, Konfig-`fields` + `defaults`, die drei `create*`-Fabriken. Ein neuer Feld-`type` braucht zusätzlich einen Editor in `public/js/editors.js` + Anbindung in `config.js`.
3. **Server:** neues Modul unter `lib/games/<id>.js` (Zustand/Phasenlogik, analog zu den bestehenden), Aktionen in den passenden `lib/handlers/*.js` verdrahten, erlaubte Konfig-Felder in `sanitizeProfile()` ergänzen.

Profile, Spielauswahl, die Standby-Ansicht (`'none'`), Killswitch, Geräteliste, Punkte/
Scoreboard/Teams, Spielplan und rollenbasierte Ansichten funktionieren dann automatisch mit –
inklusive Master-Live-Steuerung, die einfach das `master`-Modul des neuen Spiels einhängt.

---

## Für Entwickler: Release veröffentlichen

Releases baut GitHub automatisch (`.github/workflows/release.yml`): Sobald ein Tag `v…`
gepusht wird, packt die Action per `tools/release.js` die drei ZIPs (Windows/macOS/Linux)
und hängt sie an ein neues GitHub-Release mit automatisch erzeugten Release-Notes.

```bash
git tag v8          # Versionsname = Tag, ergibt z. B. quiz_system_v8-win.zip
git push origin v8
```

Lokal geht es weiterhin ohne GitHub über `Release.sh` / `Release.bat`
(→ `release/quiz_system_<Version>-<system>.zip`).
