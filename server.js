'use strict';
/*
 * Quiz System – lokaler Server (keine npm-Abhaengigkeiten, nur Node-Bordmittel)
 * ---------------------------------------------------------------------------
 * - Liefert die Web-App aus /public aus (Bildschirm / Master / Spieler)
 * - Realtime-Synchronisierung ueber ein selbst implementiertes WebSocket
 * - Haelt den autoritativen Spielzustand und verteilt ihn an alle Geraete
 *
 * Start:  node server.js
 *
 * Der eigentliche Code liegt in lib/ (siehe dort fuer die Modul-Aufteilung);
 * diese Datei ist nur der duenne Einstiegspunkt: Laufzeitzustand des aktiven
 * Spiels beim Start angleichen, HTTP-/WebSocket-Server starten, Start-Banner
 * ausgeben, sauberes Beenden (STRG+C) verdrahten.
 */

const http = require('http');
const { exec } = require('child_process');
const { config } = require('./lib/config');
const { localIPs } = require('./lib/net');
const { serveStatic } = require('./lib/static');
const { createWsServer } = require('./lib/ws-server');
const { encodeFrame } = require('./lib/ws-protocol');
const { game } = require('./lib/state');
const { clearAutoGo } = require('./lib/games/reaction');
const { initWordlist } = require('./lib/games/wordlist');
const { initMc } = require('./lib/games/mc');
const { initZd } = require('./lib/games/zd');
const { clearFwTimer, initFw, scheduleFwAdvance } = require('./lib/games/fw');
const { initTf } = require('./lib/games/tf');
const { initZu } = require('./lib/games/zu');
const { initDq } = require('./lib/games/dq');
const { initSq } = require('./lib/games/sq');
const { initAq } = require('./lib/games/aq');
const { initRo } = require('./lib/games/ro');
const { clearZmTimer, initZm } = require('./lib/games/zm');
const { initBild } = require('./lib/games/bild');
const { loadPersisted, flushSave, takeRoundState } = require('./lib/persist');

// Teilnehmer/Punkte/Team-Zuordnung eines vorherigen Laufs wiederherstellen,
// bevor die erste Verbindung reinkommt (siehe lib/persist.js)
loadPersisted();

// Rundenzustand (Frage/Wort-Position, Phase, Antworten, ...) des aktiven
// Spiels wiederherstellen, falls state.json passend dazu welchen hat (gleiches
// Spiel + gleiches Profil) - sonst frisch in die Lobby (init<Spiel>()).
function restoreOrInit(gameId, key, initFn) {
  const restored = takeRoundState(gameId);
  if (!restored) { initFn(); return; }
  game[key] = restored;
}

if (config.activeGame === 'wordlist') restoreOrInit('wordlist', 'wl', initWordlist);
if (config.activeGame === 'mc') restoreOrInit('mc', 'mc', initMc);
if (config.activeGame === 'zd') restoreOrInit('zd', 'zd', initZd);
if (config.activeGame === 'fw') {
  restoreOrInit('fw', 'fw', initFw);
  // Auto-Weiterschalt-Timer gab es nur zur Laufzeit - bei einem wiederhergestellten
  // laufenden Wort den vollen Zeitschritt neu anwerfen (statt fuer immer stehen zu bleiben).
  if (game.fw.phase === 'running') scheduleFwAdvance();
}
if (config.activeGame === 'tf') restoreOrInit('tf', 'tf', initTf);
if (config.activeGame === 'zu') restoreOrInit('zu', 'zu', initZu);
if (config.activeGame === 'dq') restoreOrInit('dq', 'dq', initDq);
if (config.activeGame === 'sq') restoreOrInit('sq', 'sq', initSq);
if (config.activeGame === 'aq') restoreOrInit('aq', 'aq', initAq);
if (config.activeGame === 'ro') restoreOrInit('ro', 'ro', initRo);
if (config.activeGame === 'zm') restoreOrInit('zm', 'zm', initZm);
if (config.activeGame === 'bild') restoreOrInit('bild', 'bild', initBild);
if (config.activeGame === 'reaction') {
  const restored = takeRoundState('reaction');
  if (restored) {
    // 'armed'/'yellow'/'go' haengen an einem inzwischen verlorenen Server-Timer/
    // Startzeitpunkt (Autostart-Timer, Reaktionsmessung relativ zum Verbindungs-
    // zeitpunkt) - dafuer gibt es kein sinnvolles Wiederaufsetzen, also zurueck
    // auf 'idle'.
    const safe = restored.phase === 'armed' || restored.phase === 'yellow' || restored.phase === 'go';
    game.phase = safe ? 'idle' : (restored.phase || 'idle');
    game.roundId = restored.roundId || 0;
    game.round = restored.round || 1;
    game.results = safe ? {} : (restored.results || {});
  }
}

const server = http.createServer(serveStatic);
const { connections, keepAliveTimer } = createWsServer(server);

server.listen(config.port, '0.0.0.0', () => {
  const ips = localIPs();
  const bar = '='.repeat(60);
  console.log('\n' + bar);
  console.log('  QUIZ SYSTEM laeuft');
  console.log(bar);
  console.log('  Bildschirm (dieser PC):  http://localhost:' + config.port + '/screen');
  console.log('  Master/Spielleitung:     http://localhost:' + config.port + '/master   (Passwort noetig)');
  console.log('');
  console.log('  Handys im selben WLAN oeffnen eine dieser Adressen (= Spieler):');
  if (ips.length === 0) {
    console.log('    (keine Netzwerk-IP gefunden – ist WLAN/LAN aktiv?)');
  } else {
    for (const ip of ips) {
      console.log('    http://' + ip + ':' + config.port + '/            (Spieler)');
      console.log('    http://' + ip + ':' + config.port + '/master      (Master, Passwort)');
      console.log('    http://' + ip + ':' + config.port + '/screen      (Bildschirm)');
    }
  }
  console.log('');
  console.log('  Admin-Passwort:  ' + config.adminPassword + '   (in config.json / Konfig-Tab aenderbar)');
  console.log('  Beenden mit STRG+C  (oder Taste "q")');
  console.log(bar + '\n');

  if (config.openBrowser) {
    const url = 'http://localhost:' + config.port + '/screen';
    const cmd = process.platform === 'win32' ? 'start "" "' + url + '"'
      : process.platform === 'darwin' ? 'open "' + url + '"'
      : 'xdg-open "' + url + '"';
    exec(cmd, () => {});
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('\n[Fehler] Port ' + config.port + ' ist belegt. Aendere "port" in config.json.\n');
  } else {
    console.error('[Fehler]', err.message);
  }
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Sauberes Beenden (STRG+C) mit sofortiger Rueckmeldung + Ladeanzeige
// ---------------------------------------------------------------------------
let shuttingDown = false;

function gracefulShutdown() {
  // Zweiter STRG+C-Druck: sofort hart beenden
  if (shuttingDown) { process.exit(0); return; }
  shuttingDown = true;

  // Konsole aus dem Raw-Modus holen, damit die Batch-Datei danach normal weiterlaeuft
  try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch (e) {}

  // SOFORTIGE Meldung
  console.log('\n\n' + '='.repeat(60));
  console.log('  Quiz-System wird beendet ...');
  console.log('='.repeat(60));

  // Keepalive + laufende Timer stoppen
  clearInterval(keepAliveTimer);
  clearAutoGo();
  clearFwTimer();
  clearZmTimer();

  // Ausstehendes Debounce-Speichern (Teilnehmer/Punkte) sofort nachholen
  flushSave();

  // Alle Verbindungen freundlich schliessen, dann trennen
  process.stdout.write('  - Verbindungen werden getrennt ...');
  for (const conn of connections) {
    try { conn.socket.write(encodeFrame(Buffer.alloc(0), 0x8)); } catch (e) {}
    try { conn.socket.destroy(); } catch (e) {}
  }
  connections.clear();
  console.log(' fertig');

  // Ladeanzeige (Spinner) waehrend der Server schliesst
  const frames = ['|', '/', '-', '\\'];
  let i = 0;
  process.stdout.write('  - Server wird gestoppt   ');
  const spinner = setInterval(() => {
    process.stdout.write('\r  - Server wird gestoppt ' + frames[i++ % frames.length] + ' ');
  }, 100);

  const finish = () => {
    clearInterval(spinner);
    process.stdout.write('\r  - Server wird gestoppt ... fertig\n');
    console.log('\n  Beendet. Das Fenster kann geschlossen werden.\n');
    process.exit(0);
  };

  // Server schliessen, mit Sicherheits-Timeout falls etwas haengt
  const safety = setTimeout(finish, 1500);
  server.close(() => { clearTimeout(safety); finish(); });
}

// STRG+C unter Windows abfangen, BEVOR cmd.exe die "Terminate batch job"-Abfrage
// zeigt: Im Raw-Modus liefert die Konsole STRG+C als Tastendruck (Byte 0x03) an
// Node und erzeugt KEIN Konsolen-Signal an die Batch-Datei.
if (process.stdin.isTTY) {
  try {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (buf) => {
      // STRG+C = 0x03, 'q' = 0x71, 'Q' = 0x51
      if (buf.includes(0x03) || buf.includes(0x71) || buf.includes(0x51)) {
        gracefulShutdown();
      }
    });
  } catch (e) { /* kein TTY -> Fallback ueber SIGINT unten */ }
}

// Fallback (z. B. wenn kein TTY vorhanden ist oder unter Linux/macOS)
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
