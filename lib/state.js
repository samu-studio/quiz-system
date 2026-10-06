'use strict';
/*
 * Gemeinsamer Laufzeitzustand: Teilnehmerliste + der eine "game"-Zustand, den
 * alle Spiel-Module (lib/games/*.js) und Handler ueber ihre jeweiligen
 * Teilbereiche (game.mc, game.wl, ...) lesen/mutieren. `game` wird nie neu
 * zugewiesen, nur seine Eigenschaften veraendert – daher duerfen alle Module
 * einfach diese eine Referenz importieren.
 *
 * Der anfaengliche Laufzeitzustand des aktiven Spiels (z.B. game.mc passend
 * zum aktiven Profil befuellen) wird NICHT hier, sondern im Entry-Point
 * (server.js) gesetzt, da das die init<Spiel>()-Funktionen aus lib/games/*.js
 * braucht und die duerfen nicht von state.js abhaengen (Zyklus).
 */
const { config, POPUP_TYPES } = require('./config');
const { localIPs } = require('./net');

// clientId -> { id, role, name, avatar, color, online, conn, local }
// `local` markiert einen vom Master angelegten Stand-in-Teilnehmer ohne eigenes
// Geraet (Nur-Master-Modus, s. lib/handlers/master.js: addLocalPlayer) – online
// bleibt dauerhaft true, conn bleibt null.
const participants = new Map();

const game = {
  mode: 'reaction',
  phase: 'idle',        // idle | armed | go | results
  roundId: 0,
  round: 1,
  goServerTime: null,
  locked: false,        // Killswitch: sperrt alle Spieler-Interaktionen
  disco: false,         // Fun-Pannel: Disco-Modus (Dauer-Hue-Rotate auf Bildschirm + Spielern, reiner Laufzeitzustand)
  scoreboard: 'off',    // Bildschirm-Scoreboard: 'off' | 'side' | 'full' (reiner Laufzeitzustand)
  scoreboardScale: 100, // Textgroesse des Bildschirm-Scoreboards in % (50..200, reiner Laufzeitzustand)
  podiumSpeed: 900,     // Podium-Enthuellung: ms pro Platz (300..3000, reiner Laufzeitzustand)
  podiumToken: 0,       // steigt bei jeder Podium-Aktivierung/Wiederholung -> Bildschirm spielt die Reveal-Sequenz neu ab
  showQr: false,        // QR-Code (Beitritts-URL) am Bildschirm ein-/ausblenden (reiner Laufzeitzustand, vom Master gesteuert)
  qrUrl: '',             // vom Master gesetzte eigene Beitritts-URL fuer den QR-Code (leer = automatisch per LAN-IP)
  aqVolume: 1,          // Audioquiz-Lautstaerke am Bildschirm (0..1, vom Master gesteuert, reiner Laufzeitzustand)
  results: {},          // clientId -> { reactionMs, falseStart }
  scores: {},           // clientId -> Punkte (Rundensiege)
  // Team-Modus (reiner Laufzeitzustand, spielunabhaengig – wie scores/scoreboard):
  // teamMode schaltet Einzel-/Teamwertung um, teams haelt die definierten Teams
  // ({ id, name, color }), playerTeam ordnet jeden Spieler (clientId) einem Team zu.
  // Team-Punkte = Summe der Mitglieder-Punkte (server-seitig in teamStandings()).
  // teamMode/teams starten aus config.json (ueberleben einen Neustart, siehe
  // config.js) und werden bei jeder Aenderung im Master dorthin zurueckgeschrieben.
  teamMode: config.teamMode,
  teams: config.teams.map((t) => ({ id: t.id, name: t.name, color: t.color })),
  playerTeam: {},
  // Fun-Pannel „Sabotage-Karte" (reiner Laufzeitzustand): clientId -> true fuer
  // verfluchte Spieler. Deren Eingaben verwirft der Server (s. lib/handlers/index.js),
  // ihr Handy zeigt die Spiel-UI verschwommen + grau. Ueberlebt Reconnects (clientId).
  cursed: {},
  // Wortlisten-Spiel (reiner Laufzeitzustand): aufgedeckte Felder, letzte Woerter
  // je Spieler und die per-Spieler-Freigaben (default: alle gesperrt).
  wl: { revealed: [], lastWords: {}, unlocked: {} },
  // Multiple-Choice (reiner Laufzeitzustand): Fragenreihenfolge, aktuelle Position,
  // Phase, gewaehlte Antwort je Spieler (nur aktuelle Frage) und die Anzeige-
  // Reihenfolge der Antworten (Mischen). Punkte laufen ueber game.scores.
  mc: { qOrder: [], pos: -1, phase: 'lobby', answers: {}, answerPerm: [] },
  // Zeitdruck (reiner Laufzeitzustand): wie MC, aber je Spieler wird zusaetzlich
  // der eingefrorene Punktwert bei Antwort gemerkt (answers: clientId -> { option, points }).
  zd: { qOrder: [], pos: -1, phase: 'lobby', answers: {}, answerPerm: [] },
  // „Falsche Woerter"-Buzzer (reiner Laufzeitzustand): gemischte Wort-Reihenfolge,
  // aktuelle Position, Phase (lobby|running|paused|done), ein Wort-Zaehler fuer die
  // lokale Buzzer-Zeitmessung, und – waehrend einer Buzz-Pause – wer gebuzzert hat,
  // ob das Wort wirklich falsch war und wie viele Punkte vergeben wurden.
  fw: { order: [], pos: -1, phase: 'lobby', wordSeq: 0, pausedByBuzz: false, buzzedBy: null, buzzWrong: false, awarded: 0 },
  // „Wahr/Falsch"-Blitzrunde (reiner Laufzeitzustand): gemischte Aussagen-
  // Reihenfolge, aktuelle Position, Phase (lobby|running|paused|done), Antworten
  // je Spieler der aktuellen Aussage (votes: clientId -> { answer, correct, points,
  // elapsedMs }) und – im Schnellster-Modus – wer als erstes geantwortet hat.
  tf: { order: [], pos: -1, phase: 'lobby', votes: {}, buzzedBy: null },
  // Zuordnungs-Spiel (reiner Laufzeitzustand): Phase (lobby|matching|reveal), das
  // aufgebaute Board (lefts fest, rights bereits in Anzeigereihenfolge), und je
  // Spieler seine Zuordnungskarte (leftId -> rightId). Punkte laufen ueber game.scores.
  zu: { phase: 'lobby', lefts: [], rights: [], answers: {} },
  // Detektivquiz (reiner Laufzeitzustand): Fallreihenfolge, aktuelle Position, Phase
  // (lobby|running|reveal|done), Anzahl aufgedeckter Hinweise des aktuellen Falls,
  // im Freitext-Modus die letzte Antwort je Spieler (mit eingefrorenem Hinweis-Stand),
  // im Buzzer-Modus der aktuell wartende Buzz und – nach einem Treffer – der Gewinner.
  dq: { order: [], pos: -1, phase: 'lobby', revealed: 0, answers: {}, buzz: null, winner: null },
  // Schätzquiz (reiner Laufzeitzustand): Fragenreihenfolge, Position, Phase
  // (lobby|question|reveal|done), Schätzung je Spieler (answers: clientId -> Zahl,
  // bis zum Auflösen editierbar – kein Lock-in) und, nach dem Auflösen, die
  // berechneten Ergebnisse (results: [{ id, value, dev, pts }]). Punkte laufen ueber game.scores.
  sq: { qOrder: [], pos: -1, phase: 'lobby', answers: {}, results: [] },
  // Audioquiz (reiner Laufzeitzustand): Rundenreihenfolge, Position, Phase
  // (lobby|running|reveal|done), Anzahl freigeschalteter Ausschnitt-Stufen des
  // aktuellen Rätsels, ein Wiedergabe-Token (der Bildschirm spielt neu, sobald es
  // sich aendert), je Spieler die letzte Antwort (mit eingefrorenem Stufen-Stand)
  // und – nach einem Treffer – der Gewinner. Punkte laufen ueber game.scores.
  aq: { order: [], pos: -1, phase: 'lobby', revealed: 0, playToken: 0, answers: {}, buzzes: [], winner: null },
  // Bildanzeige (reiner Laufzeitzustand): Bild ein-/ausgeblendet und ob der Master
  // die eingestellte Unschaerfe gerade aufgehoben hat („scharf stellen").
  bild: { sichtbar: true, scharf: false },
  // Reihenfolge-Quiz + Zeichenquiz: Startwerte wie in initRo()/initZm() – muessen
  // existieren, bevor das Spiel je aktiviert wurde (kick/cleanup raeumen dort auf).
  ro: { qOrder: [], pos: -1, phase: 'lobby', correctOrder: [], shown: [], groupPick: null, answers: {}, results: [] },
  zm: { order: [], pos: -1, phase: 'lobby', deadline: null, drawings: {}, submitted: {}, voteOrder: [], votes: {}, results: [] },
  // Hintergrundmusik (reiner Laufzeitzustand, spielunabhaengig – s. lib/music.js):
  // playing = Master-Wunsch (Play/Pause), order = Abspielreihenfolge als Indizes
  // in config.music.tracks (gemischt bei Shuffle), pos = aktuelle Stelle in order,
  // token steigt bei jedem Titelwechsel/Neustart -> der Bildschirm laedt neu.
  music: { playing: false, order: [], pos: 0, token: 0 },
  // Session-Ende (reiner Laufzeitzustand): aktiv, sobald der Master am Ende des
  // Spielplans auf "Naechstes" klickt; token steigt bei jeder (Wieder-)Anzeige,
  // damit der Bildschirm die Reveal-Sequenz neu abspielt (wie beim Podium).
  sessionEnd: { active: false, token: 0 },
  // Spieler-Nachrichten (reiner Laufzeitzustand, spielunabhaengig, wie die
  // Fake-Popups): je Spieler das aktuell geschaltete Overlay
  // (clientId -> { name, text, image, dim, blur, closable, token, done }).
  // token steigt bei jeder Sendung (der Spieler baut es dann frisch auf),
  // done = vom Spieler weggeklickt (Status fuer den Master).
  messages: {},
  messageToken: 0,
  // Fun-Countdown (reiner Laufzeitzustand, spielunabhaengig – s. lib/handlers/master.js):
  // aktiv = am Bildschirm eingeblendet, total = Startwert in Sekunden, laeuft = zaehlt
  // gerade, endsAt = Server-Zeitpunkt (Date.now) des Ablaufs (nur waehrend laeuft),
  // restMs = eingefrorene Restzeit (nur pausiert), warnSek = Ton in den letzten X
  // Sekunden (0 = stumm), token steigt bei Start/Pause/Fortsetzen/Ausblenden -> die
  // Clients uebernehmen die Restzeit nur dann neu (lokale Uhr, keine Latenz-Spruenge).
  countdown: { aktiv: false, total: 0, laeuft: false, endsAt: 0, restMs: 0, warnSek: 10, token: 0 },
  // Gluecksrad (Fun-Pannel, Laufzeitzustand – s. lib/wheel.js; mode/texts starten
  // aus config.fun und werden dorthin zurueckgeschrieben): Overlay am
  // Bildschirm sichtbar?, Quelle der Eintraege ('players' = ausgewaehlte clientIds,
  // 'text' = Freitext), laufende Drehung (token steigt je Drehung -> Bildschirm
  // animiert neu, spin = Ziel-Segment/Versatz/Umdrehungen/Dauer) und der Gewinner.
  wheel: { visible: false, mode: config.fun.wheelMode, playerIds: [], texts: config.fun.wheelTexts.slice(), spinning: false, token: 0, spin: null, frozen: [], pendingWinner: null, winner: null },
  // Fun-Fact-Statistiken ueber die ganze Session (reiner Laufzeitzustand, ueber-
  // lebt Spiel-/Spielplanwechsel, wird nur durch einen expliziten Reset geloescht).
  session: { fastest: null, biggestJump: null, closestGuess: null, correct: {} },
  // Schnellumfrage aus dem Fun-Pannel (reiner Laufzeitzustand, spielunabhaengig):
  // status 'off' (nichts sichtbar) | 'open' (Spieler stimmen ab, aenderbar) |
  // 'closed' (Endergebnis bleibt am Bildschirm stehen), question = Frage des
  // Masters, votes: clientId -> 'ja' | 'nein'.
  poll: { status: 'off', question: '', votes: {} },
  // Fun-Pannel „Fake-Popups" (reiner Laufzeitzustand): je Spieler das aktuell
  // geschaltete Spass-Popup (clientId -> { type, token, done }). token steigt bei
  // jedem neuen Popup (der Spieler baut es dann frisch auf), done = vom Spieler
  // weggeklickt/„erledigt" (bleibt fuer die Status-Anzeige beim Master stehen).
  popups: {},
  popupToken: 0
};

// --- Teams ------------------------------------------------------------------
// Preset-Farbpalette fuer neue Teams (Name = Standard-Teamname „Team <Name>").
const TEAM_COLORS = [
  { name: 'Rot',     color: '#ef4444' },
  { name: 'Grün',    color: '#22c55e' },
  { name: 'Blau',    color: '#3b82f6' },
  { name: 'Gelb',    color: '#eab308' },
  { name: 'Cyan',    color: '#06b6d4' },
  { name: 'Pink',    color: '#ec4899' },
  { name: 'Orange',  color: '#f97316' },
  { name: 'Violett', color: '#8b5cf6' }
];

// Farbe auf ein #rrggbb-Format normalisieren (oder null bei ungueltig).
function normHexColor(c) {
  const s = String(c || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : null;
}

// Naechste noch nicht vergebene Preset-Farbe fuer ein neues Team (danach zyklisch).
function nextTeamPreset() {
  const used = new Set(game.teams.map((t) => t.color));
  return TEAM_COLORS.find((c) => !used.has(c.color)) || TEAM_COLORS[game.teams.length % TEAM_COLORS.length];
}

// --- Spieler-Avatar/Farbe (generisch, reiner Laufzeitzustand am Teilnehmer) --
// Jeder Spieler kann sich selbst ein Emoji-Avatar + eine Farbe aus einer festen
// Preset-Liste waehlen (Ausklappmenue in der Spieler-Kopfzeile). Beide Listen
// sind gleichzeitig die Whitelist fuer die Server-Validierung (onSetAvatar/
// onSetColor in lib/handlers/connection.js) – nur Werte aus diesen Arrays sind
// gueltig, kein freier Text/keine freie Farbe. Farben teilen bewusst die
// TEAM_COLORS-Hex-Werte (visuell konsistent mit dem Team-Farbschema).
const PLAYER_AVATARS = [
  '🦊', '🐼', '🐵', '🐸', '🦁', '🐯', '🐨', '🐰',
  '🐻', '🐺', '🦄', '🐙', '🐢', '🦉', '🐧', '🦋',
  '🐝', '🐳', '🦖', '🐬', '🦔', '🐱', '🐶', '🐷'
];
const PLAYER_COLORS = TEAM_COLORS.map((c) => c.color);

// Emoji-Reaktionen: feste Auswahl, die der Spieler abschicken kann – zugleich
// die Server-Whitelist (onReaction in lib/handlers/player.js), kein freier Text.
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '🎉', '👏', '🔥', '😢'];

// Rate-Limit-Stufe -> Mindestabstand in ms zwischen zwei Reaktionen desselben
// Spielers ('none' = kein Mindestabstand). Serverseitig durchgesetzt (onReaction).
const REACTION_RATE_LIMIT_MS = { none: 0, '5s': 200, '1s': 1000, '10s': 10000 };

// Eine Reaktion direkt (ohne Snapshot-Umweg) an alle verbundenen Geraete senden –
// Reaktionen sind ein fluechtiges Animations-Event, kein Teil des synchronisierten
// Spielzustands (kein Reconnect-Bedarf, keine volle Snapshot-Neuberechnung noetig).
function broadcastReaction(payload) {
  const msg = Object.assign({ type: 'reaction' }, payload);
  for (const p of participants.values()) {
    if (p.online && p.conn) { try { p.conn.send(msg); } catch (e) { /* egal */ } }
  }
}

// Einen Flashbang (kurzer weisser Vollbild-Blitz, Fade-out im Client) an
// Bildschirm und Spieler senden - fluechtiges Animations-Event wie
// broadcastReaction, kein Teil des Spielzustands. Bewusst nicht an den Master
// selbst (der sitzt am Steuergeraet, nicht vor dem Beamer/den Spieler-Handys).
function broadcastFlashbang() {
  const msg = { type: 'flashbang' };
  for (const p of participants.values()) {
    if (p.online && p.conn && p.role !== 'master') { try { p.conn.send(msg); } catch (e) { /* egal */ } }
  }
}

// Kopfstand (nur Spieler-Handys fuer ein paar Sekunden um 180 Grad drehen,
// Bildschirm und Master bleiben aufrecht) - fluechtiges Animations-Event wie
// broadcastFlashbang, die Dauer steckt in der Nachricht, das Zurueckdrehen
// macht der Client selbst.
const KOPFSTAND_MS = 10000;
function broadcastKopfstand() {
  const msg = { type: 'kopfstand', ms: KOPFSTAND_MS };
  for (const p of participants.values()) {
    if (p.online && p.conn && p.role === 'player') { try { p.conn.send(msg); } catch (e) { /* egal */ } }
  }
}


// Naechstes Avatar/Farb-Preset (zyklisch nach Spieleranzahl) einem Teilnehmer
// zuweisen. Gemeinsam genutzt von echten Beitritten (onHello) und lokalen
// Teilnehmern, die der Master im Nur-Master-Modus anlegt (s. lib/handlers/master.js).
function assignAvatarColor(p) {
  let n = 0;
  for (const pp of participants.values()) if (pp.role === 'player') n++;
  p.avatar = PLAYER_AVATARS[n % PLAYER_AVATARS.length];
  p.color = PLAYER_COLORS[n % PLAYER_COLORS.length];
}

// Oeffentliche Identitaet eines Teilnehmers (Name + Avatar + Farbe) mit Fallback,
// falls der Teilnehmer nicht (mehr) existiert. Zentraler Helfer fuer alle Stellen,
// an denen ein Spielername oeffentlich angezeigt wird (Bestenliste, Scoreboard,
// Ergebnislisten, Buzzer-/Gewinner-Meldungen, ...), damit Avatar/Farbe ueberall
// mitwandern, ohne die Fallback-Logik zu wiederholen.
function publicPlayer(id) {
  const p = participants.get(id);
  return p
    ? { id, name: p.name, avatar: p.avatar || null, color: p.color || null }
    : { id, name: '???', avatar: null, color: null };
}

// Punkte vergeben + Session-Fun-Fact-Statistik pflegen (von allen lib/games/*.js
// genutzt statt game.scores direkt zu mutieren). meta: { game, ms?, dev? } –
// ms (Reaktions-/Buzzzeit) und dev (Schaetzabweichung) sind optional, je nach
// Spielart. Nur echte Punktvergaben (pts > 0) fliessen in die Fun Facts ein.
function recordScore(clientId, pts, meta = {}) {
  game.scores[clientId] = (game.scores[clientId] || 0) + pts;
  if (pts <= 0) return;
  const s = game.session;
  s.correct[clientId] = (s.correct[clientId] || 0) + 1;
  if (!s.biggestJump || pts > s.biggestJump.pts) {
    s.biggestJump = { id: clientId, pts, game: meta.game || null };
  }
  if (Number.isFinite(meta.ms) && meta.ms >= 0 && (!s.fastest || meta.ms < s.fastest.ms)) {
    s.fastest = { id: clientId, ms: meta.ms, game: meta.game || null };
  }
  if (Number.isFinite(meta.dev) && meta.dev >= 0 && (!s.closestGuess || meta.dev < s.closestGuess.dev)) {
    s.closestGuess = { id: clientId, dev: meta.dev, game: meta.game || null };
  }
}

// Session-Fun-Fact-Statistik manuell zuruecksetzen (Master-Aktion, s. lib/handlers/master.js).
function resetSession() {
  game.session = { fastest: null, biggestJump: null, closestGuess: null, correct: {} };
}

// Team-Wertung: je Team die Summe der Mitglieder-Punkte + Mitgliederliste,
// beides absteigend nach Punkten sortiert. Grundlage fuer Scoreboard/Bestenliste
// im Team-Modus und die Anzeige der Team-Summen beim Master.
function teamStandings() {
  const byId = {};
  game.teams.forEach((t) => { byId[t.id] = { id: t.id, name: t.name, color: t.color, pts: 0, members: [] }; });
  for (const p of participants.values()) {
    if (p.role !== 'player') continue;
    const tid = game.playerTeam[p.id];
    if (!tid || !byId[tid]) continue;
    const pts = game.scores[p.id] || 0;
    byId[tid].pts += pts;
    byId[tid].members.push({ id: p.id, name: p.name, avatar: p.avatar || null, pts, online: !!p.online });
  }
  const arr = game.teams.map((t) => byId[t.id]);
  arr.forEach((t) => t.members.sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name)));
  arr.sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));
  return arr;
}

// Beitritts-URL fuer die Spieler (Basis der Adresse, die als QR-Code auf dem
// Bildschirm gezeigt wird). Waehlt aus allen LAN-IPv4-Adressen die wahrschein-
// lichste echte Heim-/Bueronetz-Adresse: 192.168.* vor 10.* vor 172.16–31.*
// (letzterer Bereich ist unter Windows oft ein virtueller Hyper-V-/WSL-Adapter,
// den Handys nicht erreichen). Innerhalb einer Stufe bleibt die OS-Reihenfolge.
function preferredLanIp() {
  const ips = localIPs();
  if (ips.length === 0) return null;
  const rank = (ip) => {
    if (/^192\.168\./.test(ip)) return 0;
    if (/^10\./.test(ip)) return 1;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return 2;
    return 3;
  };
  return ips.slice().sort((a, b) => rank(a) - rank(b))[0];
}
function buildJoinUrl() {
  if (game.qrUrl) return game.qrUrl;    // vom Master fest gesetzt -> Auto-Erkennung uebersteuern
  const host = preferredLanIp() || 'localhost';
  return 'http://' + host + ':' + config.port + '/';
}

// Fuer ALLE Rollen sichtbare Basis-Einstellungen (Design/Titel/aktives Spiel/Killswitch)
function publicSettings() {
  return {
    title: config.title,
    qrTitle: config.qrTitle,      // Ueberschrift der QR-Karte am Bildschirm (vom Master gesetzt, persistiert)
    theme: config.theme,
    design: config.design,
    pauseScreen: config.pauseScreen,   // Text/Hintergrund/Bilder fuer den Killswitch-Pause-Bildschirm
    activeGame: config.activeGame,
    locked: game.locked,
    masterOnlyMode: !!config.masterOnlyMode,   // Nur-Master-Modus: Master steuert stellvertretend (kein Spieler-Handy noetig)
    showQr: game.showQr,          // QR-Code am Bildschirm sichtbar? (vom Master gesteuert)
    joinUrl: buildJoinUrl(),      // Beitritts-Adresse fuer den QR-Code (automatisch oder vom Master gesetzt)
    qrUrlOverride: game.qrUrl,    // rohe Master-Eingabe (leer = automatisch), fuer das Eingabefeld beim Master
    reactions: { enabled: !!config.reactions.enabled, rateLimit: config.reactions.rateLimit, volume: config.reactions.volume },
    hype: { enabled: !!config.hype.enabled, sensitivity: config.hype.sensitivity },   // Hype-Meter am Bildschirm (Fun-Pannel)
    sessionFacts: config.sessionFacts   // welche Fun-Fact-Kacheln der Session-Endscreen zeigt (vom Master gewaehlt)
  };
}

module.exports = {
  participants,
  game,
  TEAM_COLORS,
  PLAYER_AVATARS,
  PLAYER_COLORS,
  REACTION_EMOJIS,
  REACTION_RATE_LIMIT_MS,
  POPUP_TYPES,
  normHexColor,
  nextTeamPreset,
  assignAvatarColor,
  publicPlayer,
  recordScore,
  resetSession,
  teamStandings,
  preferredLanIp,
  buildJoinUrl,
  publicSettings,
  broadcastReaction,
  broadcastFlashbang,
  broadcastKopfstand
};
