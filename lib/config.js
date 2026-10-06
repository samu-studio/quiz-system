'use strict';
/*
 * Konfiguration laden / speichern (config.json) + Design/Themes.
 * Enthaelt die Default-Konfiguration (inkl. Default-Profile aller Spiele),
 * Migration alter config.json-Formate und die Sanitizer fuer Design/Spielplan.
 * Die aufgeloesten "active<Spiel>Cfg()"-Funktionen liegen bei den jeweiligen
 * Spielen in lib/games/*.js (die kennen ihr eigenes Datenformat).
 */
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT_DIR, 'config.json');

const DEFAULT_CONFIG = {
  port: 8080,
  adminPassword: 'admin',
  title: 'Quiz System',
  qrTitle: '📱 Zum Mitspielen scannen', // Ueberschrift der QR-Karte am Bildschirm (vom Master aenderbar, persistiert)
  theme: 'neon',
  design: {
    // Globale Palette (nur wirksam wenn theme === 'custom')
    colors: {
      bg: '#0b0f1a', bg2: '#121a2e', panel: '#16203a', panel2: '#1d2a4a',
      text: '#eaf0ff', muted: '#8a97b8', accent: '#4dd0ff', accent2: '#b46bff',
      success: '#27e08a', warn: '#ffb020', danger: '#ff4d6d'
    },
    radius: 16,        // px (0..40) – nur custom
    font: 'system',    // system|rounded|serif|mono|condensed – nur custom
    glow: 40,          // px (0..80) – nur custom
    // Hintergrund-Stil (gilt fuer ALLE Rollen, auch auf Presets)
    bgStyle: 'radial', // radial|linear|solid|mesh
    bgAngle: 160,      // deg (bei linear)
    // Bildschirm-Extras (nur Rolle screen)
    screen: {
      bgImage: '',       // Dateiname in public/backgrounds/ ('' = keins)
      imageDim: 45,      // % Abdunklung (0..90)
      imageBlur: 0,      // px (0..20)
      effect: 'none',    // none|stars|particles|confetti|aurora|grid
      effectSpeed: 100,  // % Tempo der Effekt-Animation (25..300, 100 = Standard)
      vignette: false,
      titleStyle: 'normal' // normal|huge|outline
    }
  },
  // Pause-Bildschirm (Killswitch-Anzeige am Beamer): eigener Text + Hintergrund,
  // unabhaengig vom laufenden Spiel/Design. Der Killswitch selbst (game.locked)
  // bleibt der bestehende Laufzeit-Mechanismus (s. state.js) – hier wird nur
  // festgelegt, WIE der Bildschirm waehrend einer Sperre aussieht.
  pauseScreen: {
    text: 'Pause',        // Ueberschrift auf dem Pause-Bildschirm
    icon: '⏸️',            // Symbol ueber der Ueberschrift, aus PAUSE_ICONS ('' = kein Symbol)
    background: 'design', // 'design' (aktuelles Design/Theme) | 'color' (Vollfarbe) | 'images' (Diashow)
    color: '#0b0f1a',     // Vollfarbe, nur bei background === 'color'
    images: [],           // Dateinamen in public/pause/, nur bei background === 'images'
    interval: 6,          // Sekunden zwischen Bildwechseln (bei mehreren Bildern)
    dim: 35,              // % Abdunklung ueber der Diashow (0..90)
    blur: 0               // px Unschaerfe der Diashow-Bilder (0..20)
  },
  // Spieler-Nachrichten (Master-Tab „💬 Nachrichten"): drei schnell abrufbare
  // Vorlagen. Die gerade angezeigte Nachricht selbst ist Laufzeitzustand
  // (state.js game.messages), hier liegen nur die gespeicherten Presets.
  //   name – Beschriftung des Preset-Buttons, text/image – Inhalt (image = Datei
  //   in public/backgrounds/), dim/blur – Abdunklung (%)/Unschaerfe (px) des
  //   Spieler-Hintergrunds, closable – Spieler duerfen die Nachricht wegklicken.
  messagePresets: [
    { name: 'Pause', text: 'Kurze Pause – gleich geht\'s weiter!', image: '', dim: 60, blur: 6, closable: false },
    { name: 'Bildschirm', text: 'Bitte alle zum Bildschirm schauen 👀', image: '', dim: 50, blur: 4, closable: true },
    { name: 'Essen', text: 'Das Essen ist fertig 🍕', image: '', dim: 60, blur: 6, closable: true }
  ],
  openBrowser: true,
  // Aktuell gewaehltes Spiel + je Spiel benannte Konfig-Profile
  activeGame: 'reaction',
  // Sortierung der Spiele-Kachelliste im Master-Tab „Spiele":
  //   gameSort  – aktiver Sortiermodus ('custom' | 'alphaAsc' | 'alphaDesc' | 'recent')
  //   gameOrder – frei per Drag&Drop gesetzte Reihenfolge (nur fuer 'custom')
  //   gamePlayed – Aktivierungs-Historie, zuletzt gewaehltes Spiel vorne (fuer 'recent')
  gameSort: 'custom',
  gameOrder: [],
  gamePlayed: [],
  // Spielplan (Playlist): eine vorbereitete Sequenz aus Spiel+Profil-Schritten,
  // die der Master mit „Nächstes" durchklickt (statt jedes Mal manuell umzustellen).
  //   steps – [{ game: <gameId>, profile: <Profilname> }]
  //   pos   – Index des zuletzt aktivierten Schritts (-1 = kein Schritt aktiv/off-Plan)
  playlist: { steps: [], pos: -1 },
  // Team-Einrichtung (Einzel- vs. Teamwertung + definierte Teams) – ueberlebt
  // einen Server-Neustart bewusst, damit sie nicht bei jedem Start neu angelegt
  // werden muss. Zuordnungen/Punkte bleiben Laufzeitzustand (siehe state.js).
  teamMode: false,
  teams: [],
  // Nur-Master-Modus: kein Spieler-Handy noetig, der Master steuert stellvertretend
  // (Buzzer/Antwort/Zuordnung/Schaetzung fuer gewaehlte Teilnehmer, s. lib/handlers/
  // master.js). Ueberlebt einen Neustart wie teamMode; lokale Teilnehmer selbst sind
  // reiner Laufzeitzustand (state.js participants) und muessen nach einem Neustart
  // neu angelegt werden.
  masterOnlyMode: false,
  // Emoji-Reaktionen: Spieler koennen jederzeit ein Emoji abschicken (schwebt am
  // Bildschirm auf). Laufzeitzustand (Rate-Limit-Zeitstempel je Spieler) bleibt
  // in state.js/participants; hier nur die vom Master gesetzten Optionen.
  // volume: Lautstaerke (0..1) des Party-Jingles, den der Bildschirm bei einer
  // Reaktion abspielt (0 = stumm); der Spieler entscheidet zusaetzlich per
  // eigenem Schalter, ob seine Reaktion ueberhaupt einen Sound anfordert.
  reactions: { enabled: true, rateLimit: 'none', volume: 0.5 }, // rateLimit: 'none'|'5s'|'1s'|'10s'
  // Fun-Pannel: Hype-Meter/Hype-Train am Bildschirm (Balken fuellt sich mit den
  // Emoji-Reaktionen der Spieler). Der Pegel selbst wird rein am Bildschirm aus
  // den ohnehin empfangenen Reaktionen berechnet, hier nur die Master-Optionen.
  hype: { enabled: false, sensitivity: 'mid' }, // sensitivity: 'low'|'mid'|'high'
  // Session-Endscreen (Spielplan-Zusammenfassung am Bildschirm): welche Fun-Fact-
  // Kacheln der Master zeigen lassen will. Laufzeitzustand der Statistik selbst
  // liegt in state.js (game.session), nur die Auswahl ueberlebt einen Neustart.
  sessionFacts: { fastest: true, jump: true, closest: true, correct: true },
  // Hintergrundmusik (spielt NUR am Bildschirm): Playlist + Wiedergabe-Optionen.
  // Laufzeitzustand (spielt/pausiert, Reihenfolge, aktueller Titel) liegt in
  // state.js (game.music), s. lib/music.js.
  //   tracks     – Dateinamen in public/music/ in Playlist-Reihenfolge
  //   volume     – Lautstaerke am Bildschirm (0..1)
  //   shuffle    – Zufallsreihenfolge
  //   repeat     – 'off' (am Ende stoppen) | 'all' (Playlist wiederholen) | 'one' (Titel wiederholen)
  //   fadeSec    – Ein-/Ausblendzeit bei Play/Pause in Sekunden (0..10)
  //   pauseGames – Spiele, waehrend denen die Musik automatisch pausiert (Audioquiz immer, s. music.js)
  music: { tracks: [], volume: 0.5, shuffle: false, repeat: 'all', fadeSec: 2, pauseGames: [] },
  // Soundboard (Master-Tab „🎉 Fun", spielt NUR am Bildschirm, s. lib/soundboard.js):
  //   volume – Lautstaerke am Bildschirm (0..1)
  //   hidden – ausgeblendete mitgelieferte Sounds (Dateinamen in public/sounds/soundboard/)
  // Eigene Sounds liegen in public/soundboard/ und erscheinen automatisch.
  soundboard: { volume: 0.8, hidden: [] },
  // Restliche Einstellungen des Master-Tabs „🎉 Fun", damit sie einen Neustart
  // ueberleben (der Laufzeitzustand selbst – laufender Countdown, offene Umfrage,
  // Drehung – bleibt in state.js):
  //   countdownSek/countdownWarn – Startwert + Piep-Sekunden des Countdowns
  //   pollQuestion               – zuletzt eingegebene Umfrage-Frage
  //   popupType                  – gewaehlte Fake-Popup-Art (POPUP_TYPES)
  //   wheelMode/wheelTexts       – Gluecksrad-Quelle + Freitext-Felder (Spielerauswahl
  //                                bleibt Laufzeit, clientIds gelten nur pro Sitzung)
  //   wheelDuration              – Drehdauer in Sekunden
  fun: { countdownSek: 10, countdownWarn: 10, pollQuestion: '', popupType: 'cookies', wheelMode: 'players', wheelTexts: [], wheelDuration: 6 },
  games: {
    reaction: {
      activeProfile: 'Standard',
      profiles: {
        'Standard': { autoGo: false, autoDelayMin: 1500, autoDelayMax: 4000 }
      }
    },
    wordlist: {
      activeProfile: 'Beispiel',
      profiles: {
        'Beispiel': { heading: 'Beispielliste', words: ['Apfel', 'Banane', 'Kirsche', 'Orange', 'Zitrone'] }
      }
    },
    mc: {
      activeProfile: 'Beispiel',
      profiles: {
        'Beispiel': {
          intro: 'Allgemeinwissen',
          points: 100,
          shuffleQuestions: false,
          shuffleAnswers: true,
          questions: [
            { q: 'Wie viele Kontinente gibt es?', answers: ['5', '6', '7', '8'], correct: 2 },
            { q: 'Welches Element hat das chemische Symbol „O"?', answers: ['Gold', 'Sauerstoff', 'Osmium', 'Wasserstoff'], correct: 1 },
            { q: 'Wer malte die Mona Lisa?', answers: ['Michelangelo', 'Raffael', 'Leonardo da Vinci', 'Donatello'], correct: 2 }
          ]
        }
      }
    },
    zd: {
      activeProfile: 'Beispiel',
      profiles: {
        'Beispiel': {
          intro: 'Schnellrunde',
          startPoints: 1000,
          minPoints: 100,
          drainPerSec: 100,
          shuffleQuestions: false,
          shuffleAnswers: true,
          questions: [
            { q: 'Hauptstadt von Frankreich?', answers: ['Paris', 'Rom', 'Madrid', 'Berlin'], correct: 0 },
            { q: 'Wie viele Beine hat eine Spinne?', answers: ['6', '8', '10', '12'], correct: 1 },
            { q: 'Welcher Planet ist der Sonne am nächsten?', answers: ['Venus', 'Mars', 'Merkur', 'Erde'], correct: 2 }
          ]
        }
      }
    },
    fw: {
      activeProfile: 'Beispiel',
      profiles: {
        'Beispiel': {
          kategorie: 'Obst',
          sekundenProWort: 4,
          punkte: 100,
          mischen: true,
          // Haken (wrong:true) = Wort passt NICHT in die Kategorie -> darauf buzzern.
          woerter: [
            { text: 'Apfel', wrong: false },
            { text: 'Banane', wrong: false },
            { text: 'Karotte', wrong: true },
            { text: 'Kirsche', wrong: false },
            { text: 'Gurke', wrong: true },
            { text: 'Orange', wrong: false },
            { text: 'Brokkoli', wrong: true },
            { text: 'Erdbeere', wrong: false },
            { text: 'Zwiebel', wrong: true },
            { text: 'Zitrone', wrong: false }
          ]
        }
      }
    },
    tf: {
      activeProfile: 'Beispiel',
      profiles: {
        'Beispiel': {
          nurSchnellster: false,
          punkteModus: 'fix',        // 'fix' = Pauschalpunkte, 'zeit' = wie Zeitdruck (faellt mit der Zeit)
          punkte: 100,
          startPunkte: 1000,
          minPunkte: 100,
          abzugProSek: 100,
          mischen: true,
          // Haken (wahr:true) = Aussage stimmt.
          aussagen: [
            { text: 'Der Eiffelturm steht in Paris.', wahr: true },
            { text: 'Die Sonne ist ein Planet.', wahr: false },
            { text: 'Ein Oktopus hat acht Arme.', wahr: true },
            { text: 'Der Mount Everest liegt in Afrika.', wahr: false },
            { text: 'Wasser besteht aus Wasserstoff und Sauerstoff.', wahr: true }
          ]
        }
      }
    },
    zu: {
      activeProfile: 'Beispiel',
      profiles: {
        'Beispiel': {
          titel: 'Personen → Erfindungen',
          linksLabel: 'Person',
          rechtsLabel: 'Erfindung',
          punkte: 100,
          mischen: true,
          // Zeile mit links UND rechts = echtes Paar. Nur links = „keine Verbindung"
          // (richtig ist, den Slot leer zu lassen). Nur rechts = Ablenker-Kärtchen
          // (gehört zu keinem Linken).
          paare: [
            { links: 'Nikola Tesla', rechts: 'Wechselstrom' },
            { links: 'Alexander Graham Bell', rechts: 'Telefon' },
            { links: 'Thomas Edison', rechts: 'Glühlampe' },
            { links: 'Karl Benz', rechts: 'Automobil' },
            { links: 'Wilhelm Röntgen', rechts: '' },   // keine Verbindung (Röntgenstrahlen fehlt)
            { links: '', rechts: 'Buchdruck' }           // Ablenker (gehört zu niemandem)
          ]
        }
      }
    },
    dq: {
      activeProfile: 'Beispiel',
      profiles: {
        'Beispiel': {
          intro: 'Detektivquiz',
          buzzerModus: false,      // false = Freitext (Master urteilt), true = Buzzer + mündlich
          startPunkte: 100,
          abzugProHinweis: 20,
          minPunkte: 20,
          mischen: false,
          // Je Fall: die Lösung + die Hinweise in Aufdeck-Reihenfolge (erst allgemein,
          // dann konkreter). Der Master schaltet die Hinweise nacheinander frei.
          faelle: [
            {
              loesung: 'Marie Curie',
              hinweise: [
                'Ich lebte im 19. und 20. Jahrhundert.',
                'Ich war Wissenschaftlerin.',
                'Ich erforschte die Radioaktivität.',
                'Ich erhielt gleich zwei Nobelpreise.'
              ]
            },
            {
              loesung: 'Leonardo da Vinci',
              hinweise: [
                'Ich lebte in der Zeit der Renaissance.',
                'Ich war Maler, Erfinder und Universalgelehrter.',
                'Ich entwarf fliegende Maschinen, lange bevor es Flugzeuge gab.',
                'Ich malte die Mona Lisa.'
              ]
            },
            {
              loesung: 'Frankreich',
              hinweise: [
                'Ich bin ein Land in Europa.',
                'In meiner Hauptstadt steht ein berühmter Eisenturm.',
                'Bei mir isst man gern Baguette und Croissants.',
                'Meine Hauptstadt ist Paris.'
              ]
            }
          ]
        }
      }
    },
    sq: {
      activeProfile: 'Beispiel',
      profiles: {
        'Beispiel': {
          intro: 'Schätzquiz',
          punkteModus: 'formel',      // 'formel' = Punkte nach Abweichung, 'rang' = nach Platzierung
          maxPunkte: 100,             // (Formel) Punkte bei perfekter Schätzung
          nullBeiProzent: 100,        // (Formel) Abweichung in %, ab der es 0 Punkte gibt
          rangPunkte: '5, 3, 2, 1',   // (Rang) Punkte-Staffel: Platz 1, 2, 3, …
          nurBesteAktiv: false,       // nur die besten X Schätzungen bekommen Punkte
          nurBesteAnzahl: 3,          // X (0 = niemand); Gleichstand an der Grenze zaehlt mit
          shuffleQuestions: false,
          // Je Frage: Fragetext, korrekte Zahl (loesung), Einheit + optional min/max/step.
          // Sind min UND max gesetzt, geben die Spieler per Slider ein, sonst per Zahlenfeld.
          fragen: [
            { q: 'Wie viele Einwohner hat Deutschland?', loesung: 83.5, einheit: 'Mio.', min: 0, max: 150, step: 0.5 },
            { q: 'Wie hoch ist der Eiffelturm (mit Antenne)?', loesung: 330, einheit: 'm', min: 0, max: 600, step: 1 },
            { q: 'In welchem Jahr wurde das erste iPhone vorgestellt?', loesung: 2007, einheit: '', min: 1990, max: 2025, step: 1 },
            { q: 'Wie viele Knochen hat ein erwachsener Mensch?', loesung: 206, einheit: 'Knochen', min: null, max: null, step: null }
          ]
        }
      }
    },
    zm: {
      activeProfile: 'Beispiel',
      profiles: {
        'Beispiel': {
          intro: 'Kritzelquiz',
          maxPunkte: 100,      // Punkte bei 100% der moeglichen Stimmen
          zeitlimit: 60,       // Sekunden zum Zeichnen (0 = kein Limit, Master schaltet manuell weiter)
          mischen: false,
          // Je Zeile ein Begriff, den alle gleichzeitig nachzeichnen.
          begriffe: ['Sonne', 'Katze', 'Haus', 'Fahrrad', 'Roboter']
        }
      }
    },
    aq: {
      activeProfile: 'Beispiel',
      profiles: {
        'Beispiel': {
          intro: 'Audioquiz',
          buzzerModus: false,      // false = Freitext (Master urteilt), true = Buzzer + mündlich
          mehrfachBuzzer: false,   // Buzzer-Modus: mehrere duerfen nacheinander buzzern (Reihenfolge)
          startPunkte: 100,
          abzugProStufe: 20,
          minPunkte: 20,
          mischen: false,
          // Je Runde: die Lösung, die Audiodatei (Dateiname in public/audio/, per Upload
          // im Konfig-Tab befüllt) und die Ausschnitt-Längen in Sekunden (aufsteigend;
          // 0 = ganzer Clip). Der Master gibt Stufe für Stufe längere Ausschnitte frei –
          // je früher gelöst, desto mehr Punkte. Der Ton läuft NUR auf dem Bildschirm.
          runden: [
            { loesung: 'Beispiel-Lösung', audio: '', stufen: [2, 5, 0] }
          ]
        }
      }
    },
    ro: {
      activeProfile: 'Beispiel',
      profiles: {
        'Beispiel': {
          intro: 'Reihenfolge-Quiz',
          punkteModus: 'alles',
          punkte: 100,
          shuffleQuestions: false,
          // Je Frage: der Fragetext und die Elemente in der RICHTIGEN Reihenfolge
          // (mind. 2). Den Spielern werden sie gemischt gezeigt; sie ziehen sie per
          // Drag & Drop in die von ihnen fuer richtig gehaltene Reihenfolge.
          fragen: [
            { frage: 'Von klein nach groß', items: ['Maus', 'Katze', 'Hund', 'Pferd'] }
          ]
        }
      }
    },
    bild: {
      activeProfile: 'Beispiel',
      profiles: {
        'Beispiel': {
          titel: 'Gleich geht es weiter …',
          untertitel: '',
          bild: '',              // Dateiname in public/backgrounds/ (Upload im Konfig-Tab)
          anzeige: 'contain',    // 'contain' = ganzes Bild, 'cover' = Bildschirm fuellen
          hintergrund: 'unscharf', // Flaeche neben dem Bild: 'unscharf' | 'schwarz' | 'design'
          unschaerfe: 0,         // px, der Master kann sie live aufheben („scharf stellen")
          abdunkeln: 0,          // %
          vignette: false,
          filter: 'none',        // 'none' | 'grau' | 'sepia' | 'invert'
          zoom: false,           // langsamer Ken-Burns-Zoom
          effekt: 'none',        // wie Design-Tab: none|stars|particles|confetti|aurora|grid
          effektTempo: 100,
          startVerborgen: false,
          aufHandy: false
        }
      }
    }
  }
};

// ---------------------------------------------------------------------------
// Design / Themes
// ---------------------------------------------------------------------------
const THEME_PRESETS = ['neon', 'minimal', 'playful', 'midnight', 'sunset', 'forest', 'ocean', 'candy', 'contrast', 'custom'];
// Emoji-Reaktionen: erlaubte Rate-Limit-Stufen ('none' = keine Begrenzung).
const REACTION_RATE_LIMITS = ['none', '5s', '1s', '10s'];
const HYPE_SENSITIVITIES = ['low', 'mid', 'high'];
// Fake-Popups (Fun-Pannel): feste Auswahl, zugleich Server-Whitelist fuer
// popupShow (lib/handlers/master.js). Inhalt/Ablauf jedes Typs lebt im Client (fun.js).
const POPUP_TYPES = ['cookies', 'agb', 'captcha', 'update', 'virus', 'newsletter'];
// Gluecksrad-Grenzen (s. lib/wheel.js): max. Felder, max. Zeichen je Feld.
const WHEEL_MAX_ENTRIES = 40;
const WHEEL_MAX_LABEL = 40;
const DESIGN_FONTS = ['system', 'rounded', 'serif', 'mono', 'condensed'];
const DESIGN_BGSTYLES = ['radial', 'linear', 'solid', 'mesh'];
const SCREEN_EFFECTS = ['none', 'stars', 'particles', 'confetti', 'aurora', 'grid'];
const SCREEN_TITLESTYLES = ['normal', 'huge', 'outline'];
const GAME_SORTS = ['custom', 'alphaAsc', 'alphaDesc', 'recent'];  // Sortiermodi der Spiele-Kachelliste
const COLOR_KEYS = ['bg', 'bg2', 'panel', 'panel2', 'text', 'muted', 'accent', 'accent2', 'success', 'warn', 'danger'];

const BG_DIR = path.join(ROOT_DIR, 'public', 'backgrounds');
const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']);
try { fs.mkdirSync(BG_DIR, { recursive: true }); } catch (e) { /* egal */ }

function isHexColor(v) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v); }
function clampInt(v, lo, hi, fb) { let n = Math.round(Number(v)); if (!Number.isFinite(n)) n = fb; return Math.max(lo, Math.min(hi, n)); }

// Dateinamen fuer Hintergrundbilder absichern (kein Pfad-Ausbruch, nur Bild-Endungen)
function safeBgName(name) {
  const base = path.basename(String(name || '')).replace(/[^a-zA-Z0-9._-]/g, '_');
  const ext = path.extname(base).toLowerCase();
  if (!IMG_EXT.has(ext)) return null;
  if (!base || base.length > 80) return null;
  return base;
}

function listBackgrounds() {
  try {
    return fs.readdirSync(BG_DIR)
      .filter((f) => IMG_EXT.has(path.extname(f).toLowerCase()))
      .sort();
  } catch (e) { return []; }
}

// Audiodateien fuer das Audioquiz (analog zu den Hintergrundbildern) – liegen in
// public/audio/, werden per Upload befuellt und ueber den normalen Static-Handler
// ausgeliefert (Pfad-Ausbruch dort bereits geblockt).
const AUDIO_DIR = path.join(ROOT_DIR, 'public', 'audio');
const AUDIO_EXT = new Set(['.mp3', '.ogg', '.oga', '.wav', '.m4a', '.aac', '.weba', '.webm', '.flac', '.opus']);
try { fs.mkdirSync(AUDIO_DIR, { recursive: true }); } catch (e) { /* egal */ }

// Dateinamen fuer Audio absichern (kein Pfad-Ausbruch, nur Audio-Endungen)
function safeAudioName(name) {
  const base = path.basename(String(name || '')).replace(/[^a-zA-Z0-9._-]/g, '_');
  const ext = path.extname(base).toLowerCase();
  if (!AUDIO_EXT.has(ext)) return null;
  if (!base || base.length > 100) return null;
  return base;
}

function listAudios() {
  try {
    return fs.readdirSync(AUDIO_DIR)
      .filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase()))
      .sort();
  } catch (e) { return []; }
}

// Hintergrundmusik (analog zu den Audioquiz-Dateien, aber eigener Ordner – die
// Audioquiz-Dateien verraten ggf. die Loesung und sollen nicht in der Musik-
// Playlist auftauchen). Gleiche Endungs-Whitelist wie AUDIO_EXT.
const MUSIC_DIR = path.join(ROOT_DIR, 'public', 'music');
const MUSIC_REPEATS = ['off', 'all', 'one'];
try { fs.mkdirSync(MUSIC_DIR, { recursive: true }); } catch (e) { /* egal */ }

function listMusic() {
  try {
    return fs.readdirSync(MUSIC_DIR)
      .filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase()))
      .sort();
  } catch (e) { return []; }
}

// Musik-Einstellungen validieren: nur vorhandene Dateien (dedupliziert) in der
// Playlist, Werte auf erlaubte Bereiche klemmen. pauseGames nur echte Spiel-Ids.
function sanitizeMusic(input) {
  const d = JSON.parse(JSON.stringify(DEFAULT_CONFIG.music));
  if (!input || typeof input !== 'object') return d;
  if (Array.isArray(input.tracks)) {
    const avail = new Set(listMusic());
    const seen = new Set();
    d.tracks = input.tracks
      .filter((n) => typeof n === 'string' && avail.has(n) && !seen.has(n) && seen.add(n))
      .slice(0, 300);
  }
  const vol = Number(input.volume);
  if (Number.isFinite(vol)) d.volume = Math.min(1, Math.max(0, vol));
  d.shuffle = !!input.shuffle;
  if (MUSIC_REPEATS.includes(input.repeat)) d.repeat = input.repeat;
  const fade = Number(input.fadeSec);
  if (Number.isFinite(fade)) d.fadeSec = Math.round(Math.min(10, Math.max(0, fade)) * 10) / 10;
  if (Array.isArray(input.pauseGames)) {
    d.pauseGames = input.pauseGames.filter((g, i, a) =>
      typeof g === 'string' && DEFAULT_CONFIG.games[g] && a.indexOf(g) === i);
  }
  return d;
}

// Soundboard: mitgelieferte Sounds (public/sounds/soundboard/, Teil des Release)
// + eigene Uploads (public/soundboard/, Nutzerinhalt wie public/music/).
// Gleiche Endungs-Whitelist wie AUDIO_EXT.
const SOUND_PRESET_DIR = path.join(ROOT_DIR, 'public', 'sounds', 'soundboard');
const SOUNDBOARD_DIR = path.join(ROOT_DIR, 'public', 'soundboard');
try { fs.mkdirSync(SOUNDBOARD_DIR, { recursive: true }); } catch (e) { /* egal */ }

function listAudioDir(dir) {
  try {
    return fs.readdirSync(dir)
      .filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase()))
      .sort();
  } catch (e) { return []; }
}
function listSoundPresets() { return listAudioDir(SOUND_PRESET_DIR); }
function listSounds() { return listAudioDir(SOUNDBOARD_DIR); }

// Soundboard-Einstellungen validieren: Lautstaerke klemmen, `hidden` nur
// vorhandene mitgelieferte Sounds (dedupliziert).
function sanitizeSoundboard(input) {
  const d = JSON.parse(JSON.stringify(DEFAULT_CONFIG.soundboard));
  if (!input || typeof input !== 'object') return d;
  const vol = Number(input.volume);
  if (Number.isFinite(vol)) d.volume = Math.min(1, Math.max(0, vol));
  if (Array.isArray(input.hidden)) {
    const avail = new Set(listSoundPresets());
    d.hidden = input.hidden.filter((n, i, a) => typeof n === 'string' && avail.has(n) && a.indexOf(n) === i);
  }
  return d;
}

// Bilder fuer den Pause-Bildschirm (analog zu den Design-Hintergrundbildern) –
// eigener Ordner, da hier mehrere Bilder gleichzeitig aktiv sein koennen (Diashow).
const PAUSE_DIR = path.join(ROOT_DIR, 'public', 'pause');
try { fs.mkdirSync(PAUSE_DIR, { recursive: true }); } catch (e) { /* egal */ }
const PAUSE_BACKGROUNDS = ['design', 'color', 'images'];

// Feste Auswahl an Symbolen fuer den Pause-Bildschirm (Whitelist, s. PLAYER_AVATARS
// in state.js fuer das gleiche Muster) – '' steht fuer "kein Symbol" (deaktiviert).
// Muss mit PAUSE_ICON_LABELS in public/js/pause.js uebereinstimmen (dort mit Beschriftung
// fuers Auswahlfeld).
const PAUSE_ICONS = ['⏸️', '⏯️', '⏹️', '🔒', '☕', '🖥️', '🎬', '⏳', '🔔', ''];

function safePauseImgName(name) {
  const base = path.basename(String(name || '')).replace(/[^a-zA-Z0-9._-]/g, '_');
  const ext = path.extname(base).toLowerCase();
  if (!IMG_EXT.has(ext)) return null;
  if (!base || base.length > 80) return null;
  return base;
}

function listPauseImages() {
  try {
    return fs.readdirSync(PAUSE_DIR)
      .filter((f) => IMG_EXT.has(path.extname(f).toLowerCase()))
      .sort();
  } catch (e) { return []; }
}

// Ein vom Client kommendes Pause-Bildschirm-Objekt auf erlaubte Werte begrenzen
function sanitizePauseScreen(input) {
  const d = JSON.parse(JSON.stringify(DEFAULT_CONFIG.pauseScreen));
  if (!input || typeof input !== 'object') return d;
  if (typeof input.text === 'string') d.text = input.text.slice(0, 60);
  if (PAUSE_ICONS.includes(input.icon)) d.icon = input.icon;
  if (PAUSE_BACKGROUNDS.includes(input.background)) d.background = input.background;
  if (isHexColor(input.color)) d.color = input.color;
  if (Array.isArray(input.images)) {
    const avail = new Set(listPauseImages());
    d.images = input.images.filter((n) => typeof n === 'string' && avail.has(n)).slice(0, 20);
  }
  d.interval = clampInt(input.interval, 3, 60, d.interval);
  d.dim = clampInt(input.dim, 0, 90, d.dim);
  d.blur = clampInt(input.blur, 0, 20, d.blur);
  return d;
}

// Eine Spieler-Nachricht (Preset oder gesendete Nachricht) auf erlaubte Werte
// begrenzen. Bild nur, wenn es tatsaechlich in public/backgrounds/ liegt.
function sanitizeMessage(input, fallback) {
  const d = Object.assign({ name: '', text: '', image: '', dim: 60, blur: 6, closable: true }, fallback || {});
  if (!isPlainObj(input)) return d;
  if (typeof input.name === 'string') d.name = input.name.slice(0, 24);
  if (typeof input.text === 'string') d.text = input.text.slice(0, 500);
  if (typeof input.image === 'string') {
    d.image = (input.image && listBackgrounds().includes(input.image)) ? input.image : '';
  }
  d.dim = clampInt(input.dim, 0, 90, d.dim);
  d.blur = clampInt(input.blur, 0, 20, d.blur);
  if (typeof input.closable === 'boolean') d.closable = input.closable;
  return d;
}

// Immer genau drei Presets (fehlende mit den Defaults auffuellen).
function sanitizeMessagePresets(input) {
  const arr = Array.isArray(input) ? input : [];
  return DEFAULT_CONFIG.messagePresets.map((def, i) => sanitizeMessage(arr[i], def));
}

// Ein vom Client kommendes Design-Objekt auf erlaubte Werte begrenzen
function sanitizeDesign(input) {
  const d = JSON.parse(JSON.stringify(DEFAULT_CONFIG.design));
  if (!input || typeof input !== 'object') return d;
  if (input.colors && typeof input.colors === 'object') {
    for (const k of COLOR_KEYS) if (isHexColor(input.colors[k])) d.colors[k] = input.colors[k];
  }
  d.radius = clampInt(input.radius, 0, 40, d.radius);
  d.glow = clampInt(input.glow, 0, 80, d.glow);
  if (DESIGN_FONTS.includes(input.font)) d.font = input.font;
  if (DESIGN_BGSTYLES.includes(input.bgStyle)) d.bgStyle = input.bgStyle;
  d.bgAngle = clampInt(input.bgAngle, 0, 360, d.bgAngle);
  const s = input.screen || {};
  const bg = (typeof s.bgImage === 'string') ? safeBgName(s.bgImage) : null;
  d.screen.bgImage = (s.bgImage === '' || bg === null) ? '' : bg;
  // Nur ein tatsaechlich vorhandenes Bild behalten
  if (d.screen.bgImage && !listBackgrounds().includes(d.screen.bgImage)) d.screen.bgImage = '';
  d.screen.imageDim = clampInt(s.imageDim, 0, 90, d.screen.imageDim);
  d.screen.imageBlur = clampInt(s.imageBlur, 0, 20, d.screen.imageBlur);
  if (SCREEN_EFFECTS.includes(s.effect)) d.screen.effect = s.effect;
  d.screen.effectSpeed = clampInt(s.effectSpeed, 25, 300, d.screen.effectSpeed);
  d.screen.vignette = !!s.vignette;
  if (SCREEN_TITLESTYLES.includes(s.titleStyle)) d.screen.titleStyle = s.titleStyle;
  return d;
}

// Team-Liste validieren (id/Name/Farbe) – geteilt von Migration + Backup-Import.
function sanitizeTeams(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((t) => t && typeof t.id === 'string' && typeof t.name === 'string' && isHexColor(t.color))
    .map((t) => ({ id: t.id, name: String(t.name).slice(0, 40), color: t.color }))
    .slice(0, 12);
}

// Emoji-Reaktionen-Einstellungen validieren (Whitelist Rate-Limit-Stufe).
function sanitizeReactions(input) {
  const r = (input && typeof input === 'object') ? input : {};
  const vol = Number(r.volume);
  return {
    enabled: r.enabled !== false,
    rateLimit: REACTION_RATE_LIMITS.includes(r.rateLimit) ? r.rateLimit : 'none',
    volume: Number.isFinite(vol) ? Math.min(1, Math.max(0, vol)) : 0.5
  };
}

// Hype-Meter-Einstellungen validieren (Whitelist Empfindlichkeitsstufe).
function sanitizeHype(input) {
  const h = (input && typeof input === 'object') ? input : {};
  return {
    enabled: h.enabled === true,
    sensitivity: HYPE_SENSITIVITIES.includes(h.sensitivity) ? h.sensitivity : 'mid'
  };
}

// Gluecksrad-Freitexte: trimmen, kuerzen, leere raus, Anzahl begrenzen.
function sanitizeWheelTexts(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((t) => String(t == null ? '' : t).trim().slice(0, WHEEL_MAX_LABEL))
    .filter((t) => t)
    .slice(0, WHEEL_MAX_ENTRIES);
}

// Fun-Tab-Einstellungen validieren; fehlende/ungueltige Werte -> Default.
// Mit `base` (aktueller Stand) als Fallback auch fuer Teil-Updates nutzbar.
function sanitizeFun(input, base) {
  const d = Object.assign({}, DEFAULT_CONFIG.fun, base || {});
  const f = (input && typeof input === 'object') ? input : {};
  return {
    countdownSek: clampInt(f.countdownSek, 1, 5999, d.countdownSek),
    countdownWarn: clampInt(f.countdownWarn, 0, 60, d.countdownWarn),
    pollQuestion: typeof f.pollQuestion === 'string' ? f.pollQuestion.slice(0, 120) : d.pollQuestion,
    popupType: POPUP_TYPES.includes(f.popupType) ? f.popupType : d.popupType,
    wheelMode: (f.wheelMode === 'players' || f.wheelMode === 'text') ? f.wheelMode : d.wheelMode,
    wheelTexts: Array.isArray(f.wheelTexts) ? sanitizeWheelTexts(f.wheelTexts) : sanitizeWheelTexts(d.wheelTexts),
    wheelDuration: clampInt(f.wheelDuration, 2, 15, d.wheelDuration)
  };
}

// Fun-Fact-Auswahl des Session-Endscreens validieren (Whitelist Objektschluessel,
// fehlende/ungueltige Werte -> Default true, wie bei sanitizeReactions).
function sanitizeSessionFacts(input) {
  const d = Object.assign({}, DEFAULT_CONFIG.sessionFacts);
  if (!input || typeof input !== 'object') return d;
  for (const k of Object.keys(d)) d[k] = input[k] !== false;
  return d;
}

// Spielplan validieren: nur Schritte mit existierendem Spiel (kein 'none') behalten;
// jeder Schritt bekommt ein konkretes Profil – fehlt es oder existiert es nicht (mehr),
// wird das aktive (sonst erste) Profil des Spiels fest eingetragen.
// `pos` auf einen gueltigen Bereich klemmen (-1 = kein Schritt aktiv). `cfg` liefert
// den Spiele-/Profil-Kontext (waehrend der Migration ist `config` evtl. noch nicht gesetzt).
function sanitizePlaylist(input, cfg) {
  const games = (cfg && cfg.games) || {};
  const src = (input && typeof input === 'object') ? input : {};
  const rawSteps = Array.isArray(src.steps) ? src.steps : [];
  const steps = [];
  for (const st of rawSteps) {
    if (steps.length >= 100) break;
    if (!st || typeof st !== 'object') continue;
    const game = String(st.game || '');
    if (game === 'none' || !games[game]) continue;   // nur echte, existierende Spiele
    let profile = typeof st.profile === 'string' ? st.profile : '';
    const profs = (games[game] && games[game].profiles) || {};
    if (!profs[profile]) {                            // leer/unbekannt -> konkretes Profil eintragen
      const act = games[game].activeProfile;
      profile = profs[act] ? act : (Object.keys(profs)[0] || '');
    }
    steps.push({ game, profile });
  }
  let pos = Number.isInteger(src.pos) ? src.pos : -1;
  if (pos < -1 || pos >= steps.length) pos = -1;
  return { steps, pos };
}

// Reines Objekt (kein null/Array/Primitive) – fuer die Typ-Pruefungen beim Laden.
function isPlainObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

function migrateConfig(cfg) {
  // Grundwerte mit falschem Typ (von Hand editierte config.json) auf Default zuruecksetzen
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) cfg.port = DEFAULT_CONFIG.port;
  if (typeof cfg.adminPassword === 'number') cfg.adminPassword = String(cfg.adminPassword);
  if (typeof cfg.adminPassword !== 'string' || !cfg.adminPassword.trim()) {
    // Leeres Passwort wuerde /master ungeschuetzt lassen
    console.warn('[warn] config.json: adminPassword fehlt/leer – Standard-Passwort "' + DEFAULT_CONFIG.adminPassword + '" wird verwendet.');
    cfg.adminPassword = DEFAULT_CONFIG.adminPassword;
  }
  if (typeof cfg.title !== 'string') cfg.title = DEFAULT_CONFIG.title;
  if (typeof cfg.qrTitle !== 'string') cfg.qrTitle = DEFAULT_CONFIG.qrTitle;
  cfg.openBrowser = cfg.openBrowser !== false;
  cfg.masterOnlyMode = !!cfg.masterOnlyMode;
  if (!isPlainObj(cfg.games)) cfg.games = null;
  // Aeltere config.json (flache autoGo-Felder) auf die neue Spiel-/Profil-Struktur heben
  if (!cfg.games) {
    cfg.games = {
      reaction: {
        activeProfile: 'Standard',
        profiles: {
          'Standard': {
            autoGo: !!cfg.autoGo,
            autoDelayMin: Number.isFinite(cfg.autoDelayMin) ? cfg.autoDelayMin : 1500,
            autoDelayMax: Number.isFinite(cfg.autoDelayMax) ? cfg.autoDelayMax : 4000
          }
        }
      }
    };
  }
  if (!cfg.activeGame) cfg.activeGame = 'reaction';
  // Spiele-Sortierung (Master-Tab) – Defaults ergaenzen, Typen absichern.
  if (!GAME_SORTS.includes(cfg.gameSort)) cfg.gameSort = 'custom';
  if (!Array.isArray(cfg.gameOrder)) cfg.gameOrder = [];
  if (!Array.isArray(cfg.gamePlayed)) cfg.gamePlayed = [];
  if (!cfg.games.reaction) {
    cfg.games.reaction = { activeProfile: 'Standard', profiles: { 'Standard': { autoGo: false, autoDelayMin: 1500, autoDelayMax: 4000 } } };
  }
  if (!cfg.games.wordlist) {
    cfg.games.wordlist = {
      activeProfile: 'Beispiel',
      profiles: { 'Beispiel': { heading: 'Beispielliste', words: ['Apfel', 'Banane', 'Kirsche', 'Orange', 'Zitrone'] } }
    };
  }
  if (!cfg.games.mc) {
    cfg.games.mc = JSON.parse(JSON.stringify(DEFAULT_CONFIG.games.mc));
  }
  if (!cfg.games.zd) {
    cfg.games.zd = JSON.parse(JSON.stringify(DEFAULT_CONFIG.games.zd));
  }
  if (!cfg.games.fw) {
    cfg.games.fw = JSON.parse(JSON.stringify(DEFAULT_CONFIG.games.fw));
  }
  if (!cfg.games.tf) {
    cfg.games.tf = JSON.parse(JSON.stringify(DEFAULT_CONFIG.games.tf));
  }
  if (!cfg.games.zu) {
    cfg.games.zu = JSON.parse(JSON.stringify(DEFAULT_CONFIG.games.zu));
  }
  if (!cfg.games.dq) {
    cfg.games.dq = JSON.parse(JSON.stringify(DEFAULT_CONFIG.games.dq));
  }
  if (!cfg.games.sq) {
    cfg.games.sq = JSON.parse(JSON.stringify(DEFAULT_CONFIG.games.sq));
  }
  if (!cfg.games.aq) {
    cfg.games.aq = JSON.parse(JSON.stringify(DEFAULT_CONFIG.games.aq));
  }
  if (!cfg.games.ro) {
    cfg.games.ro = JSON.parse(JSON.stringify(DEFAULT_CONFIG.games.ro));
  }
  if (!cfg.games.zm) {
    cfg.games.zm = JSON.parse(JSON.stringify(DEFAULT_CONFIG.games.zm));
  }
  if (!cfg.games.bild) {
    cfg.games.bild = JSON.parse(JSON.stringify(DEFAULT_CONFIG.games.bild));
  }
  // Je Spiel: Struktur absichern (kaputter Eintrag -> Default-Profile) und
  // activeProfile auf ein existierendes Profil zeigen lassen (sonst das erste).
  for (const id of Object.keys(DEFAULT_CONFIG.games)) {
    const g = cfg.games[id];
    if (!isPlainObj(g) || !isPlainObj(g.profiles) || !Object.keys(g.profiles).length) {
      cfg.games[id] = JSON.parse(JSON.stringify(DEFAULT_CONFIG.games[id]));
      continue;
    }
    for (const name of Object.keys(g.profiles)) {
      if (!isPlainObj(g.profiles[name])) g.profiles[name] = {};
    }
    if (typeof g.activeProfile !== 'string' || !g.profiles[g.activeProfile]) {
      g.activeProfile = Object.keys(g.profiles)[0];
    }
  }
  // Unbekanntes Spiel -> Standby statt eines Spiels ohne Oberflaeche
  if (cfg.activeGame !== 'none' && !DEFAULT_CONFIG.games[cfg.activeGame]) cfg.activeGame = 'none';
  // Spielplan (Playlist) absichern: Struktur + gueltige Schritte.
  cfg.playlist = sanitizePlaylist(cfg.playlist, cfg);
  cfg.teamMode = !!cfg.teamMode;
  cfg.teams = sanitizeTeams(cfg.teams);
  cfg.reactions = sanitizeReactions(cfg.reactions);
  cfg.hype = sanitizeHype(cfg.hype);
  cfg.sessionFacts = sanitizeSessionFacts(cfg.sessionFacts);
  cfg.music = sanitizeMusic(cfg.music);
  cfg.soundboard = sanitizeSoundboard(cfg.soundboard);
  cfg.fun = sanitizeFun(cfg.fun);
  if (!THEME_PRESETS.includes(cfg.theme)) cfg.theme = 'neon';
  // Design-Objekt (Palette/Form/Hintergrund/Bildschirm-Extras) sicherstellen + validieren
  cfg.design = sanitizeDesign(cfg.design);
  // Pause-Bildschirm (Text/Hintergrund/Bilder) sicherstellen + validieren
  cfg.pauseScreen = sanitizePauseScreen(cfg.pauseScreen);
  cfg.messagePresets = sanitizeMessagePresets(cfg.messagePresets);
  delete cfg.autoGo; delete cfg.autoDelayMin; delete cfg.autoDelayMax;
  return cfg;
}

function defaultConfigCopy() {
  return migrateConfig(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
}

// Unlesbare config.json beiseitelegen, bevor der naechste saveConfig() sie mit
// Defaults ueberschreibt – sonst waeren alle eigenen Profile/Fragen still weg.
function backupBrokenConfig(reason) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = CONFIG_PATH + '.kaputt-' + stamp;
  let saved = false;
  try { fs.copyFileSync(CONFIG_PATH, backup); saved = true; } catch (e) { /* egal */ }
  console.warn('\n[WARNUNG] config.json ist fehlerhaft (' + reason + ') – es werden die Standard-Einstellungen verwendet.');
  if (saved) console.warn('          Die kaputte Datei wurde gesichert als: ' + path.basename(backup));
  console.warn('          Fehler in der Sicherung beheben und sie wieder in config.json umbenennen, um die eigenen Einstellungen zurueckzuholen.\n');
}

function loadConfig() {
  let raw;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch (e) {
    return defaultConfigCopy();   // keine config.json (Erststart) -> Defaults, kein Fehler
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    backupBrokenConfig('kein gueltiges JSON: ' + e.message);
    return defaultConfigCopy();
  }
  if (!isPlainObj(parsed)) {
    backupBrokenConfig('kein JSON-Objekt');
    return defaultConfigCopy();
  }
  try {
    return migrateConfig(Object.assign({}, JSON.parse(JSON.stringify(DEFAULT_CONFIG)), parsed));
  } catch (e) {
    backupBrokenConfig('unerwartete Struktur: ' + e.message);
    return defaultConfigCopy();
  }
}

const config = loadConfig();

// Atomar speichern: erst in eine Temp-Datei, dann umbenennen – ein Absturz/Abziehen
// des USB-Sticks mitten im Schreiben hinterlaesst so nie eine halbe config.json.
function saveConfig() {
  const tmp = CONFIG_PATH + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
    fs.renameSync(tmp, CONFIG_PATH);
  } catch (e) {
    console.warn('[warn] config.json konnte nicht gespeichert werden:', e.message);
    try { fs.unlinkSync(tmp); } catch (e2) { /* egal */ }
  }
}

module.exports = {
  ROOT_DIR,
  config,
  saveConfig,
  DEFAULT_CONFIG,
  migrateConfig,   // auch fuer tools/get-old-data.js (alte config.json nachbessern)
  THEME_PRESETS,
  REACTION_RATE_LIMITS,
  HYPE_SENSITIVITIES,
  DESIGN_FONTS,
  DESIGN_BGSTYLES,
  SCREEN_EFFECTS,
  SCREEN_TITLESTYLES,
  GAME_SORTS,
  COLOR_KEYS,
  BG_DIR,
  AUDIO_DIR,
  MUSIC_DIR,
  MUSIC_REPEATS,
  PAUSE_DIR,
  PAUSE_BACKGROUNDS,
  PAUSE_ICONS,
  isHexColor,
  clampInt,
  safeBgName,
  listBackgrounds,
  safeAudioName,
  listAudios,
  listMusic,
  sanitizeMusic,
  SOUND_PRESET_DIR,
  SOUNDBOARD_DIR,
  listSoundPresets,
  listSounds,
  sanitizeSoundboard,
  safePauseImgName,
  listPauseImages,
  sanitizeDesign,
  sanitizePauseScreen,
  sanitizeMessage,
  sanitizeMessagePresets,
  sanitizePlaylist,
  sanitizeTeams,
  sanitizeReactions,
  sanitizeHype,
  sanitizeSessionFacts,
  sanitizeFun,
  sanitizeWheelTexts,
  POPUP_TYPES,
  WHEEL_MAX_ENTRIES,
  WHEEL_MAX_LABEL
};
