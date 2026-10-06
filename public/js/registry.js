'use strict';
// GAMES-Registry (datengetrieben) + Bootstrap. MUSS ZULETZT laden: das GAMES-
// Literal referenziert die create*-Funktionen aus den Spiel-Modulen oben.

// ---------------------------------------------------------------------------
// Spiel-Registry (datengetrieben) – jedes Spiel bringt Meta + Konfig-Felder +
// rollenspezifische Oberflaechen (player/screen/master) mit.
// Erweiterung um neue Spiele: hier Eintrag ergaenzen + serverseitige Logik.
//
// Rollen-Module (player/screen/master) sind Fabriken mit der Signatur:
//   create(root, ctx) -> { update(state), destroy?() }
// - `root`  ist der leere Mount-Container; das Modul baut seine DOM dort hinein.
// - `ctx`   stellt gemeinsame Helfer bereit (send, clientId, Timing, State, admin).
// - `update(state)` wird bei jedem Server-Snapshot aufgerufen.
// - `master` baut die Live-Steuerung + Ergebnisse des Spiels (im Tab „🎮 Controls").
// Killswitch (Sperre), Wartezustand und die Geraeteliste werden generisch vom
// Wrapper behandelt, darum muessen Spiele sich darum NICHT kuemmern.
// ---------------------------------------------------------------------------
const GAMES = {
  reaction: {
    id: 'reaction',
    name: 'Reaktion / Ampel',
    emoji: '🚦',
    desc: 'Wer bei GRÜN am schnellsten drückt, gewinnt die Runde.',
    fields: [
      { key: 'autoGo', label: 'Auto-GRÜN mit Zufallsverzögerung', type: 'bool' },
      { key: 'autoDelayMin', label: 'Verzögerung min (ms)', type: 'number', min: 200, max: 10000, step: 100 },
      { key: 'autoDelayMax', label: 'Verzögerung max (ms)', type: 'number', min: 200, max: 15000, step: 100 },
      { key: 'rangPunkte', label: 'Punkte-Staffel je Platz, Komma-getrennt (Platz 1, 2, 3, …)', type: 'text', maxlength: 200, placeholder: 'z. B. 3, 2, 1' }
    ],
    defaults: { autoGo: false, autoDelayMin: 1500, autoDelayMax: 4000, rangPunkte: '3, 2, 1' },
    player: createReactionPlayer,
    screen: createReactionScreen,
    master: createReactionMaster
  },
  wordlist: {
    id: 'wordlist',
    name: 'Wortliste aufdecken',
    emoji: '📝',
    desc: 'Spieler erraten verdeckte Begriffe – Treffer decken die Liste auf.',
    fields: [
      { key: 'heading', label: 'Überschrift (auf dem Bildschirm)', type: 'text', maxlength: 80, placeholder: 'z. B. Alle 151 Pokémon' },
      { key: 'words', label: 'Begriffe (ein Begriff pro Zeile)', type: 'list', rows: 12, placeholder: 'Pikachu\nRaichu\nGlumanda\n…' },
      { key: 'punkteAktiv', label: 'Punkte vergeben', type: 'bool' },
      { key: 'punkte', label: 'Punkte pro aufgedecktem Begriff', type: 'number', min: 1, max: 100000, step: 5, showIf: { key: 'punkteAktiv', value: true } }
    ],
    defaults: { heading: '', words: [], punkteAktiv: false, punkte: 10 },
    player: createWordlistPlayer,
    screen: createWordlistScreen,
    master: createWordlistMaster
  },
  mc: {
    id: 'mc',
    name: 'Multiple Choice',
    emoji: '🅰️',
    desc: 'Fragen mit mehreren Antworten – die richtige gibt Punkte.',
    fields: [
      { key: 'intro', label: 'Titel (auf dem Bildschirm)', type: 'text', maxlength: 80, placeholder: 'z. B. Allgemeinwissen' },
      { key: 'points', label: 'Punkte pro richtiger Antwort', type: 'number', min: 1, max: 100000, step: 10 },
      { key: 'shuffleQuestions', label: 'Fragen-Reihenfolge mischen', type: 'bool' },
      { key: 'shuffleAnswers', label: 'Antworten je Frage mischen', type: 'bool' },
      { key: 'questions', label: 'Fragen', type: 'mcq' }
    ],
    defaults: { intro: '', points: 100, shuffleQuestions: false, shuffleAnswers: true, questions: [] },
    player: createMcPlayer,
    screen: createMcScreen,
    master: createMcMaster
  },
  zd: {
    id: 'zd',
    name: 'Zeitdruck',
    emoji: '⏱️',
    desc: 'Je schneller die richtige Antwort, desto mehr Punkte – der Zähler tickt herunter.',
    fields: [
      { key: 'intro', label: 'Titel (auf dem Bildschirm)', type: 'text', maxlength: 80, placeholder: 'z. B. Schnellrunde' },
      { key: 'startPoints', label: 'Startpunkte', type: 'number', min: 10, max: 1000000, step: 50 },
      { key: 'minPoints', label: 'Mindestpunkte (Boden)', type: 'number', min: 0, max: 1000000, step: 10 },
      { key: 'drainPerSec', label: 'Punkteverlust pro Sekunde', type: 'number', min: 1, max: 1000000, step: 10 },
      { key: 'shuffleQuestions', label: 'Fragen-Reihenfolge mischen', type: 'bool' },
      { key: 'shuffleAnswers', label: 'Antworten je Frage mischen', type: 'bool' },
      { key: 'questions', label: 'Fragen', type: 'mcq' }
    ],
    defaults: { intro: '', startPoints: 1000, minPoints: 100, drainPerSec: 100, shuffleQuestions: false, shuffleAnswers: true, questions: [] },
    player: createZdPlayer,
    screen: createZdScreen,
    master: createZdMaster
  },
  fw: {
    id: 'fw',
    name: 'Falsche Wörter',
    emoji: '🚫',
    desc: 'Wörter fliegen ein – buzzern, sobald eines nicht in die Kategorie passt.',
    fields: [
      { key: 'kategorie', label: 'Kategorie (Titel auf dem Bildschirm)', type: 'text', maxlength: 80, placeholder: 'z. B. Obst' },
      { key: 'sekundenProWort', label: 'Sekunden pro Wort', type: 'number', min: 1, max: 60, step: 1 },
      { key: 'punkte', label: 'Punkte pro erwischtem Falschwort', type: 'number', min: 1, max: 100000, step: 10 },
      { key: 'mischen', label: 'Wörter mischen', type: 'bool' },
      { key: 'woerter', label: 'Wörter (Haken = passt NICHT in die Kategorie)', type: 'wordflags' }
    ],
    defaults: { kategorie: '', sekundenProWort: 4, punkte: 100, mischen: true, woerter: [] },
    player: createFwPlayer,
    screen: createFwScreen,
    master: createFwMaster
  },
  tf: {
    id: 'tf',
    name: 'Wahr/Falsch-Blitzrunde',
    emoji: '⚡',
    desc: 'Aussagen nacheinander entscheiden: wahr oder falsch? Wahlweise buzzert der Schnellste, oder alle stimmen ab.',
    fields: [
      { key: 'nurSchnellster', label: 'Nur-Schnellster-Modus (sonst: alle stimmen ab)', type: 'bool' },
      { key: 'mischen', label: 'Reihenfolge der Aussagen mischen', type: 'bool' },
      { key: 'punkteModus', label: 'Punkte-Modus', type: 'select', options: [
        { value: 'fix', label: 'Pauschal' },
        { value: 'zeit', label: 'Mit der Zeit fallend' }
      ] },
      { key: 'punkte', label: 'Punkte pro richtiger Antwort', type: 'number', min: 1, max: 100000, step: 10, showIf: { key: 'punkteModus', value: 'fix' } },
      { key: 'startPunkte', label: 'Startpunkte', type: 'number', min: 10, max: 1000000, step: 50, showIf: { key: 'punkteModus', value: 'zeit' } },
      { key: 'minPunkte', label: 'Mindestpunkte (Boden)', type: 'number', min: 0, max: 1000000, step: 10, showIf: { key: 'punkteModus', value: 'zeit' } },
      { key: 'abzugProSek', label: 'Punkteverlust pro Sekunde', type: 'number', min: 1, max: 1000000, step: 10, showIf: { key: 'punkteModus', value: 'zeit' } },
      { key: 'aussagen', label: 'Aussagen (Haken = ist wahr)', type: 'truefalse' }
    ],
    defaults: {
      nurSchnellster: false, mischen: true, punkteModus: 'fix', punkte: 100,
      startPunkte: 1000, minPunkte: 100, abzugProSek: 100, aussagen: []
    },
    player: createTfPlayer,
    screen: createTfScreen,
    master: createTfMaster
  },
  zu: {
    id: 'zu',
    name: 'Zuordnungsquiz',
    emoji: '🔗',
    desc: 'Kärtchen per Drag & Drop den richtigen Elementen zuordnen – Fallen inklusive.',
    fields: [
      { key: 'titel', label: 'Titel (auf dem Bildschirm)', type: 'text', maxlength: 80, placeholder: 'z. B. Personen → Erfindungen' },
      { key: 'linksLabel', label: 'Überschrift linke Spalte', type: 'text', maxlength: 40, placeholder: 'z. B. Person' },
      { key: 'rechtsLabel', label: 'Überschrift rechte Spalte', type: 'text', maxlength: 40, placeholder: 'z. B. Erfindung' },
      { key: 'punkte', label: 'Punkte pro richtiger Zuordnung', type: 'number', min: 1, max: 100000, step: 10 },
      { key: 'mischen', label: 'Rechte Kärtchen mischen', type: 'bool' },
      { key: 'paare', label: 'Zuordnungen', type: 'pairs' }
    ],
    defaults: { titel: '', linksLabel: '', rechtsLabel: '', punkte: 100, mischen: true, paare: [] },
    player: createZuPlayer,
    screen: createZuScreen,
    master: createZuMaster
  },
  dq: {
    id: 'dq',
    name: 'Detektivquiz',
    emoji: '🕵️',
    desc: 'Hinweise nacheinander aufdecken – je früher die Lösung, desto mehr Punkte.',
    fields: [
      { key: 'intro', label: 'Titel (auf dem Bildschirm)', type: 'text', maxlength: 80, placeholder: 'z. B. Detektivquiz' },
      { key: 'buzzerModus', label: 'Buzzer-Modus (Spieler buzzern & sagen die Lösung laut; sonst tippen sie sie ein)', type: 'bool' },
      { key: 'startPunkte', label: 'Startpunkte (bei 1 Hinweis)', type: 'number', min: 10, max: 1000000, step: 10 },
      { key: 'abzugProHinweis', label: 'Abzug pro weiterem Hinweis', type: 'number', min: 0, max: 1000000, step: 5 },
      { key: 'minPunkte', label: 'Mindestpunkte (Boden)', type: 'number', min: 0, max: 1000000, step: 5 },
      { key: 'mischen', label: 'Reihenfolge der Fälle mischen', type: 'bool' },
      { key: 'faelle', label: 'Fälle', type: 'cases' }
    ],
    defaults: { intro: '', buzzerModus: false, startPunkte: 100, abzugProHinweis: 20, minPunkte: 20, mischen: false, faelle: [] },
    player: createDqPlayer,
    screen: createDqScreen,
    master: createDqMaster
  },
  sq: {
    id: 'sq',
    name: 'Schätzquiz',
    emoji: '📊',
    desc: 'Zahlen schätzen – je näher an der Wahrheit, desto mehr Punkte.',
    fields: [
      { key: 'intro', label: 'Titel (auf dem Bildschirm)', type: 'text', maxlength: 80, placeholder: 'z. B. Schätzquiz' },
      { key: 'punkteModus', label: 'Punkte-Modus', type: 'select', options: [
        { value: 'formel', label: 'Formel nach Abweichung (jeder unabhängig)' },
        { value: 'rang', label: 'Rang-basiert (nach Platzierung)' }
      ] },
      { key: 'maxPunkte', label: 'Punkte bei perfekter Schätzung', type: 'number', min: 1, max: 1000000, step: 10, showIf: { key: 'punkteModus', value: 'formel' } },
      { key: 'nullBeiProzent', label: 'Abweichung in %, ab der es 0 Punkte gibt', type: 'number', min: 1, max: 100000, step: 5, showIf: { key: 'punkteModus', value: 'formel' } },
      { key: 'rangPunkte', label: 'Punkte-Staffel, Komma-getrennt (Platz 1, 2, 3, …)', type: 'text', maxlength: 200, placeholder: 'z. B. 5, 3, 2, 1', showIf: { key: 'punkteModus', value: 'rang' } },
      { key: 'nurBesteAktiv', label: 'Nur die besten X Spieler bekommen Punkte (Gleichstand: alle gleichauf)', type: 'bool' },
      { key: 'nurBesteAnzahl', label: 'Anzahl X (0 = niemand bekommt Punkte)', type: 'number', min: 0, max: 1000, step: 1, showIf: { key: 'nurBesteAktiv', value: true } },
      { key: 'shuffleQuestions', label: 'Fragen-Reihenfolge mischen', type: 'bool' },
      { key: 'fragen', label: 'Schätzfragen', type: 'estq' }
    ],
    defaults: { intro: '', punkteModus: 'formel', maxPunkte: 100, nullBeiProzent: 100, rangPunkte: '5, 3, 2, 1', nurBesteAktiv: false, nurBesteAnzahl: 3, shuffleQuestions: false, fragen: [] },
    player: createSqPlayer,
    screen: createSqScreen,
    master: createSqMaster
  },
  aq: {
    id: 'aq',
    name: 'Audioquiz',
    emoji: '🔊',
    desc: 'Immer längere Audio-Ausschnitte – je früher erkannt, desto mehr Punkte.',
    fields: [
      { key: 'intro', label: 'Titel (auf dem Bildschirm)', type: 'text', maxlength: 80, placeholder: 'z. B. Audioquiz' },
      { key: 'buzzerModus', label: 'Buzzer-Modus (Spieler buzzern & sagen die Lösung laut; sonst tippen sie sie ein)', type: 'bool' },
      { key: 'mehrfachBuzzer', label: 'Mehrere dürfen buzzern (Buzzer-Modus: Reihenfolge wird gesammelt, Master gibt einzeln oder alle wieder frei)', type: 'bool' },
      { key: 'startPunkte', label: 'Startpunkte (bei 1. Ausschnitt)', type: 'number', min: 10, max: 1000000, step: 10 },
      { key: 'abzugProStufe', label: 'Abzug pro weiterem Ausschnitt', type: 'number', min: 0, max: 1000000, step: 5 },
      { key: 'minPunkte', label: 'Mindestpunkte (Boden)', type: 'number', min: 0, max: 1000000, step: 5 },
      { key: 'mischen', label: 'Reihenfolge der Runden mischen', type: 'bool' },
      { key: 'runden', label: 'Runden (Audio + Lösung)', type: 'audioq' }
    ],
    defaults: { intro: '', buzzerModus: false, mehrfachBuzzer: false, startPunkte: 100, abzugProStufe: 20, minPunkte: 20, mischen: false, runden: [] },
    player: createAqPlayer,
    screen: createAqScreen,
    master: createAqMaster
  },
  ro: {
    id: 'ro',
    name: 'Reihenfolge-Quiz',
    emoji: '🔀',
    desc: 'Kärtchen per Drag & Drop in die richtige Reihenfolge bringen.',
    fields: [
      { key: 'intro', label: 'Titel (auf dem Bildschirm)', type: 'text', maxlength: 80, placeholder: 'z. B. Reihenfolge-Quiz' },
      { key: 'punkteModus', label: 'Punkte-Modus', type: 'select', options: [
        { value: 'alles', label: 'Alles oder nichts (nur bei 100% richtiger Reihenfolge)' },
        { value: 'paare', label: 'Teilpunkte (nach Anzahl richtiger Paare)' }
      ] },
      { key: 'punkte', label: 'Punkte pro Frage (bei perfekter Reihenfolge)', type: 'number', min: 1, max: 100000, step: 10 },
      { key: 'shuffleQuestions', label: 'Fragen-Reihenfolge mischen', type: 'bool' },
      { key: 'fragen', label: 'Fragen', type: 'roq' }
    ],
    defaults: { intro: '', punkteModus: 'alles', punkte: 100, shuffleQuestions: false, fragen: [] },
    player: createRoPlayer,
    screen: createRoScreen,
    master: createRoMaster
  },
  zm: {
    id: 'zm',
    name: 'Kritzelquiz',
    emoji: '🎨',
    desc: 'Ein Begriff wird gleichzeitig von allen gezeichnet – dann stimmt jeder für seinen Favoriten ab.',
    fields: [
      { key: 'intro', label: 'Titel (auf dem Bildschirm)', type: 'text', maxlength: 80, placeholder: 'z. B. Kritzelquiz' },
      { key: 'maxPunkte', label: 'Punkte bei 100% der möglichen Stimmen', type: 'number', min: 1, max: 100000, step: 10 },
      { key: 'zeitlimit', label: 'Zeitlimit zum Zeichnen in Sekunden (0 = kein Limit)', type: 'number', min: 0, max: 1800, step: 5 },
      { key: 'mischen', label: 'Reihenfolge der Begriffe mischen', type: 'bool' },
      { key: 'begriffe', label: 'Begriffe (ein Begriff pro Zeile)', type: 'list', rows: 12, placeholder: 'Sonne\nKatze\nHaus\n…' }
    ],
    defaults: { intro: '', maxPunkte: 100, zeitlimit: 60, mischen: false, begriffe: [] },
    player: createZmPlayer,
    screen: createZmScreen,
    master: createZmMaster
  },
  bild: {
    id: 'bild',
    name: 'Bildanzeige',
    emoji: '🖼️',
    desc: 'Zeigt einfach ein Bild auf dem Bildschirm – ideal als Folie zwischen Spielen im Spielplan.',
    fields: [
      { key: 'bild', label: 'Bild', type: 'bildwahl' },
      { key: 'titel', label: 'Titel (über dem Bild, optional)', type: 'text', maxlength: 80, placeholder: 'z. B. Pause – gleich geht es weiter' },
      { key: 'untertitel', label: 'Untertitel (optional)', type: 'text', maxlength: 160 },
      { key: 'anzeige', label: 'Darstellung', type: 'select', options: [
        { value: 'contain', label: 'Ganzes Bild zeigen (einpassen)' },
        { value: 'cover', label: 'Bildschirm füllen (Ränder werden beschnitten)' }
      ] },
      { key: 'hintergrund', label: 'Fläche neben dem Bild', type: 'select', options: [
        { value: 'unscharf', label: 'Unscharfe Kopie des Bildes' },
        { value: 'schwarz', label: 'Schwarz' },
        { value: 'design', label: 'Design-Hintergrund' }
      ], showIf: { key: 'anzeige', value: 'contain' } },
      { key: 'unschaerfe', label: 'Unschärfe (Master kann live „scharf stellen")', type: 'range', min: 0, max: 40, step: 1, unit: 'px' },
      { key: 'abdunkeln', label: 'Abdunkeln', type: 'range', min: 0, max: 90, step: 1, unit: '%' },
      { key: 'vignette', label: 'Vignette (dunkle Ecken)', type: 'bool' },
      { key: 'filter', label: 'Farbfilter', type: 'select', options: [
        { value: 'none', label: 'Kein Filter' },
        { value: 'grau', label: 'Schwarz-Weiß' },
        { value: 'sepia', label: 'Sepia' },
        { value: 'invert', label: 'Invertiert' }
      ] },
      { key: 'zoom', label: 'Langsamer Zoom (Ken-Burns-Effekt)', type: 'bool' },
      { key: 'effekt', label: 'Effekt über dem Bild', type: 'select', options: [
        { value: 'none', label: 'Kein Effekt' },
        { value: 'stars', label: 'Sterne' },
        { value: 'particles', label: 'Partikel' },
        { value: 'confetti', label: 'Konfetti' },
        { value: 'aurora', label: 'Aurora' },
        { value: 'grid', label: 'Raster' }
      ] },
      { key: 'effektTempo', label: 'Effekt-Tempo', type: 'range', min: 25, max: 300, step: 5, unit: '%',
        showIf: { key: 'effekt', values: ['stars', 'particles', 'confetti', 'aurora', 'grid'] } },
      { key: 'startVerborgen', label: 'Verborgen starten (Master blendet das Bild ein)', type: 'bool' },
      { key: 'aufHandy', label: 'Bild auch auf den Handys zeigen', type: 'bool' }
    ],
    defaults: {
      bild: '', titel: '', untertitel: '', anzeige: 'contain', hintergrund: 'unscharf', unschaerfe: 0, abdunkeln: 0,
      vignette: false, filter: 'none', zoom: false, effekt: 'none', effektTempo: 100, startVerborgen: false, aufHandy: false
    },
    preview: previewBild,
    player: createBildPlayer,
    screen: createBildScreen,
    master: createBildMaster
  },
  // Sonderfall: kein Spiel aktiv – Spieler/Bildschirm zeigen nur einen neutralen
  // Standby. Ermoeglicht dem Master, im Hintergrund umzustellen, ohne dass die
  // Spieler direkt etwas sehen. Hat keine Profile/Felder/Oberflaechen (noConfig).
  none: {
    id: 'none',
    name: 'Kein Spiel (Standby)',
    emoji: '⏸️',
    desc: 'Neutraler Wartezustand – Spieler sehen nichts, Master kann in Ruhe umstellen.',
    fields: [],
    defaults: {},
    noConfig: true
  }
};

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
startApp();
