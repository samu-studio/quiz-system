'use strict';
/*
 * Master-Kanal (Spielsteuerung): Scoreboard/Killswitch/Teams (generisch,
 * spielunabhaengig) sowie die Weiterleitung an die je-Spiel-Aktionen.
 */
const bus = require('../bus');
const { clamp, clampScore, genId } = require('../util');
const {
  config, saveConfig, DEFAULT_CONFIG, REACTION_RATE_LIMITS, HYPE_SENSITIVITIES, sanitizeSessionFacts, sanitizeMessagePresets, sanitizeFun
} = require('../config');
const { participants, game, normHexColor, nextTeamPreset, assignAvatarColor, resetSession, broadcastFlashbang, broadcastKopfstand, POPUP_TYPES } = require('../state');
const {
  applyPress, applyGuess, applyEstimate, applyTfAnswer
} = require('./player');
const { armRound, goYellow, backToRed, goGreen, endRound, resetRound } = require('../games/reaction');
const { activeWordlistCfg, initWordlist } = require('../games/wordlist');
const { mcStart, mcReveal, mcNext, initMc, mcSetGroupPick } = require('../games/mc');
const { zdStart, zdReveal, zdNext, initZd, zdSetGroupPick } = require('../games/zd');
const { fwStart, fwPause, fwResume, initFw } = require('../games/fw');
const { tfStart, tfReveal, tfNext, tfSetGroupPick, initTf } = require('../games/tf');
const { zuStart, zuReveal, initZu, zuSetGroupPick } = require('../games/zu');
const {
  dqStart, dqNextClue, dqAward, dqBuzzOk, dqBuzzWrong, dqRevealSolution, dqNextCase, initDq
} = require('../games/dq');
const { sqStart, sqReveal, sqNext, initSq } = require('../games/sq');
const {
  aqStart, aqNextClue, aqReplay, aqAward, aqBuzzOk, aqBuzzWrong, aqBuzzReleaseAll, aqRevealSolution, aqSetVolume, aqNextRound, initAq
} = require('../games/aq');
const { roStart, roReveal, roNext, initRo, roSetGroupPick } = require('../games/ro');
const { zmStart, zmToVoting, zmReveal, zmNext, initZm } = require('../games/zm');
const { bildSetSichtbar, bildSetScharf, initBild } = require('../games/bild');
const {
  musicPlay, musicPause, musicNext, musicPrev, musicGoto, setMusicSettings, setMusicVolume, setMusicRepeat
} = require('../music');
const { soundboardPlay, soundboardStop, setSoundboardSettings } = require('../soundboard');
const { wheelSetVisible, wheelSetEntries, wheelSpin, wheelRemoveWinner } = require('../wheel');

const SCOREBOARD_KEEP = new Set([
  'setScoreboard', 'setScoreboardScale', 'setScore', 'adjustScore', 'resetScores', 'cleanup', 'kick', 'setLocked', 'aqVolume', 'setQr',
  'replayPodium', 'setPodiumSpeed', 'replaySessionEnd', 'resetSession', 'setSessionFacts',
  // Team-Einrichtung ist keine Spielsteuerung -> Vollbild-Scoreboard bleibt stehen.
  'setTeamMode', 'addTeam', 'removeTeam', 'renameTeam', 'setTeamColor', 'assignTeam', 'setQrUrl', 'setQrTitle',
  // Nur-Master-Modus-Einrichtung (Teilnehmer anlegen) ist ebenfalls keine Spielsteuerung.
  'setMasterOnlyMode', 'addLocalPlayer',
  // Emoji-Reaktionen-Einstellungen sind ebenfalls keine Spielsteuerung.
  'setReactionsEnabled', 'setReactionsRateLimit', 'setReactionsVolume',
  // Fun-Pannel (z.B. Flashbang) ist reiner Show-Effekt, keine Spielsteuerung.
  'flashbang', 'setHypeEnabled', 'setHypeSensitivity', 'pollStart', 'pollClose', 'pollHide', 'soundPlay', 'soundStop', 'soundVolume', 'soundHidden', 'setDisco', 'kopfstand', 'curse', 'uncurseAll', 'popupShow', 'popupClear',
  'countdownStart', 'countdownPause', 'countdownResume', 'countdownStop',
  'wheelShow', 'wheelSetEntries', 'wheelSpin', 'wheelRemoveWinner', 'setFunSettings',
  // Spieler-Nachrichten laufen ueber dem Spiel, keine Spielsteuerung.
  'messageShow', 'messageClear', 'setMessagePresets',
  // Hintergrundmusik laeuft neben dem Spiel her, keine Spielsteuerung.
  'musicPlay', 'musicPause', 'musicNext', 'musicPrev', 'musicGoto', 'musicVolume', 'musicShuffle',
  'musicRepeat', 'musicSetTracks', 'musicFade', 'musicPauseGames'
]);

// Fun-Countdown ausblenden (countdownStop, oder wenn ein anderes Bildschirm-Overlay
// wie das Gluecksrad ihn abloest – sonst wuerde er es ueberdecken).
function countdownAus() {
  const cd = game.countdown;
  if (!cd.aktiv) return;
  cd.aktiv = false;
  cd.laeuft = false;
  cd.token++;
}

function onMaster(conn, msg) {
  if (!conn.authed) return;                 // Steuerung nur fuer freigeschaltete Master
  // Auto-Ruecksprung: eine Spielsteuerung beendet das Vollbild-Scoreboard bzw. das
  // Podium (beide verdecken das Spiel komplett). Der 'side'-Modus bleibt bewusst stehen.
  if ((game.scoreboard === 'full' || game.scoreboard === 'podium') && !SCOREBOARD_KEEP.has(msg.action)) {
    game.scoreboard = 'off';
  }
  // Analog: eine Spielsteuerung holt den Bildschirm auch vom Session-Endscreen zurueck.
  if (game.sessionEnd.active && !SCOREBOARD_KEEP.has(msg.action)) {
    game.sessionEnd.active = false;
  }
  switch (msg.action) {
    case 'setLocked':
      game.locked = !!msg.locked;
      bus.broadcast();
      return;
    // --- Fun-Pannel (generisch, spielunabhaengig, wird noch wachsen) --------
    case 'flashbang':                         // Bildschirm + Spieler kurz weiss aufblitzen lassen
      broadcastFlashbang();
      return;
    case 'setHypeEnabled':                    // Hype-Meter am Bildschirm ein/aus
      config.hype.enabled = !!msg.on;
      saveConfig();
      bus.broadcast();
      return;
    case 'setHypeSensitivity':
      if (!HYPE_SENSITIVITIES.includes(msg.level)) return;
      config.hype.sensitivity = msg.level;
      saveConfig();
      bus.broadcast();
      return;
    case 'setFunSettings': {                  // Fun-Tab-Eingaben (Countdown, Umfrage-Frage, Popup-Art, Drehdauer) speichern
      // Rad-Modus/-Texte laufen nur ueber wheelSetEntries (sonst weicht game.wheel ab).
      const { wheelMode, wheelTexts } = config.fun;
      config.fun = Object.assign(sanitizeFun(Object.assign({}, config.fun, msg.settings), config.fun), { wheelMode, wheelTexts });
      saveConfig();
      bus.broadcast();
      return;
    }
    case 'popupShow': {                       // Fake-Popup an einen Spieler (clientId) oder alle ('all') schalten
      if (!POPUP_TYPES.includes(msg.popup)) return;
      const ids = msg.clientId === 'all'
        ? [...participants.values()].filter((p) => p.role === 'player' && !p.local).map((p) => p.id)
        : (participants.has(msg.clientId) ? [msg.clientId] : []);
      if (!ids.length) return;
      for (const id of ids) game.popups[id] = { type: msg.popup, token: ++game.popupToken, done: false };
      bus.broadcast();
      return;
    }
    case 'popupClear':                        // Popup eines Spielers (oder aller) entfernen
      if (msg.clientId === 'all') game.popups = {};
      else delete game.popups[msg.clientId];
      bus.broadcast();
      return;
    // --- Spieler-Nachrichten (Text + Bild als Overlay auf den Handys) -------
    case 'messageShow': {                     // Vorlage (preset-Index) an einen Spieler (clientId) oder alle ('all') schicken
      const m = config.messagePresets[msg.preset];
      if (!Number.isInteger(msg.preset) || !m || (!m.text.trim() && !m.image)) return;
      const ids = msg.clientId === 'all'
        ? [...participants.values()].filter((p) => p.role === 'player' && !p.local).map((p) => p.id)
        : (participants.has(msg.clientId) && participants.get(msg.clientId).role === 'player' ? [msg.clientId] : []);
      if (!ids.length) return;
      for (const id of ids) {
        game.messages[id] = { name: m.name, text: m.text, image: m.image, dim: m.dim, blur: m.blur,
          closable: m.closable, token: ++game.messageToken, done: false };
      }
      bus.broadcast();
      return;
    }
    case 'messageClear':                      // Nachricht eines Spielers (oder aller) entfernen
      if (msg.clientId === 'all') game.messages = {};
      else delete game.messages[msg.clientId];
      bus.broadcast();
      return;
    case 'setMessagePresets':
      config.messagePresets = sanitizeMessagePresets(msg.presets);
      saveConfig();
      bus.broadcast();
      return;
    case 'kopfstand':                         // Spieler-Handys 10 Sekunden auf den Kopf stellen
      broadcastKopfstand();
      return;
    case 'curse': {                           // Sabotage-Karte: Spieler verfluchen / Fluch aufheben
      const p = participants.get(msg.clientId);
      if (!p || p.role !== 'player') return;
      if (msg.on) game.cursed[p.id] = true;
      else delete game.cursed[p.id];
      bus.broadcast();
      return;
    }
    case 'uncurseAll':                        // alle Flueche auf einmal aufheben
      game.cursed = {};
      bus.broadcast();
      return;
    case 'setDisco':                          // Disco-Modus: Farben auf Bildschirm + Spielern dauerhaft durchrotieren
      game.disco = !!msg.on;
      bus.broadcast();
      return;
    case 'countdownStart': {                  // grossen Countdown am Bildschirm einblenden + starten
      const sek = Math.round(Number(msg.seconds));
      if (!Number.isFinite(sek) || sek < 1) return;
      const cd = game.countdown;
      cd.total = clamp(sek, 1, 5999);
      cd.warnSek = clamp(Math.round(Number(msg.warnSek)) || 0, 0, 60);
      cd.aktiv = true;
      cd.laeuft = true;
      wheelSetVisible(false);                 // Bildschirm-Overlays schliessen sich gegenseitig ab
      cd.endsAt = Date.now() + cd.total * 1000;
      cd.restMs = 0;
      cd.token++;
      bus.broadcast();
      return;
    }
    case 'countdownPause': {
      const cd = game.countdown;
      if (!cd.aktiv || !cd.laeuft) return;
      cd.restMs = Math.max(0, cd.endsAt - Date.now());
      cd.laeuft = false;
      cd.token++;
      bus.broadcast();
      return;
    }
    case 'countdownResume': {
      const cd = game.countdown;
      if (!cd.aktiv || cd.laeuft || cd.restMs <= 0) return;
      cd.endsAt = Date.now() + cd.restMs;
      cd.laeuft = true;
      cd.token++;
      bus.broadcast();
      return;
    }
    case 'countdownStop':                     // Countdown ausblenden (auch nach Ablauf)
      countdownAus();
      bus.broadcast();
      return;
    // Soundboard (s. lib/soundboard.js): Sound am Bildschirm abspielen/stoppen
    case 'soundPlay':   return soundboardPlay(msg.kind, msg.file);
    case 'soundStop':   return soundboardStop();
    case 'soundVolume': if (!Number.isFinite(Number(msg.value))) return; return setSoundboardSettings({ volume: Number(msg.value) });
    case 'soundHidden': if (!Array.isArray(msg.hidden)) return; return setSoundboardSettings({ hidden: msg.hidden });
    case 'pollStart':                         // Schnellumfrage (Ja/Nein) an die Spieler schicken
      game.poll = {
        status: 'open',
        question: String(msg.question || '').trim().slice(0, 120) || 'Ja oder Nein?',
        votes: {}
      };
      bus.broadcast();
      return;
    case 'pollClose':                         // Abstimmung beenden, Ergebnis bleibt am Bildschirm
      if (game.poll.status !== 'open') return;
      game.poll.status = 'closed';
      bus.broadcast();
      return;
    case 'pollHide':                          // Umfrage ueberall ausblenden
      game.poll = { status: 'off', question: '', votes: {} };
      bus.broadcast();
      return;
    case 'wheelShow':                         // Gluecksrad am Bildschirm ein-/ausblenden
      wheelSetVisible(msg.on);
      if (msg.on) countdownAus();             // Rad ersetzt einen laufenden Countdown
      bus.broadcast();
      return;
    case 'wheelSetEntries':                   // { mode?, texts?, playerIds? }
      wheelSetEntries(msg);
      bus.broadcast();
      return;
    case 'wheelSpin':                         // Server lost den Gewinner, Bildschirm animiert
      wheelSpin(msg.durationSec);
      if (game.wheel.visible) countdownAus(); // Drehen blendet das Rad ein
      bus.broadcast();
      return;
    case 'wheelRemoveWinner':
      wheelRemoveWinner();
      bus.broadcast();
      return;
    // --- Nur-Master-Modus (kein Spieler-Handy noetig) -----------------------
    // Der Master steuert stellvertretend fuer einen gewaehlten Teilnehmer (echt
    // verbunden ODER lokal angelegt, s. addLocalPlayer) – dieselbe Kernlogik wie
    // ein Spieler-Client (applyPress/applyGuess/... aus lib/handlers/player.js),
    // nur mit vom Master gewaehlter clientId statt der des Absenders.
    case 'setMasterOnlyMode':
      config.masterOnlyMode = !!msg.on;
      saveConfig();
      bus.broadcast();
      return;
    // --- Emoji-Reaktionen (generisch, spielunabhaengig) ---------------------
    case 'setReactionsEnabled':
      config.reactions.enabled = !!msg.on;
      saveConfig();
      bus.broadcast();
      return;
    case 'setReactionsRateLimit':
      if (!REACTION_RATE_LIMITS.includes(msg.limit)) return;
      config.reactions.rateLimit = msg.limit;
      saveConfig();
      bus.broadcast();
      return;
    case 'setReactionsVolume': {
      const vol = Number(msg.value);
      if (!Number.isFinite(vol)) return;
      config.reactions.volume = Math.min(1, Math.max(0, vol));
      saveConfig();
      bus.broadcast();
      return;
    }
    case 'addLocalPlayer': {
      let n = 0;
      for (const pp of participants.values()) if (pp.local) n++;
      const name = (typeof msg.name === 'string' && msg.name.trim())
        ? msg.name.trim().slice(0, 24) : ('Lokal ' + (n + 1));
      const id = genId();
      const p = { id, role: 'player', name, online: true, conn: null, local: true };
      assignAvatarColor(p);
      participants.set(id, p);
      bus.broadcast();
      return;
    }
    case 'masterPress': {
      const p = msg.clientId && participants.get(msg.clientId);
      if (p && p.role === 'player') applyPress(p, msg);
      return;
    }
    case 'masterGuess': {
      const p = msg.clientId && participants.get(msg.clientId);
      if (p && p.role === 'player') applyGuess(p, msg);
      return;
    }
    case 'masterEstimate': {
      const p = msg.clientId && participants.get(msg.clientId);
      if (p && p.role === 'player') applyEstimate(p, msg);
      return;
    }
    case 'masterTfAnswer': {
      const p = msg.clientId && participants.get(msg.clientId);
      if (p && p.role === 'player') applyTfAnswer(p, msg);
      return;
    }
    // --- Hintergrundmusik (generisch, spielunabhaengig, s. lib/music.js) -----
    case 'musicPlay':       return musicPlay();
    case 'musicPause':      return musicPause();
    case 'musicNext':       return musicNext(false);
    case 'musicPrev':       return musicPrev();
    case 'musicGoto':       return musicGoto(Number(msg.index));
    case 'musicVolume':     return setMusicVolume(msg.value);
    case 'musicShuffle':    return setMusicSettings({ shuffle: !!msg.on });
    case 'musicRepeat':     return setMusicRepeat(msg.mode);
    case 'musicSetTracks':  if (!Array.isArray(msg.tracks)) return; return setMusicSettings({ tracks: msg.tracks });
    case 'musicFade':       return setMusicSettings({ fadeSec: msg.value });
    case 'musicPauseGames': if (!Array.isArray(msg.games)) return; return setMusicSettings({ pauseGames: msg.games });
    // --- Scoreboard / Punkte-Korrektur --------------------------------------
    case 'setScoreboard':                    // Bildschirm-Scoreboard umschalten
      game.scoreboard = ['off', 'side', 'full', 'podium'].includes(msg.mode) ? msg.mode : 'off';
      // Jede (Wieder-)Aktivierung des Podiums soll die Spotlight-Enthuellung neu
      // abspielen -> Token hochzaehlen, der Bildschirm erkennt den Wechsel daran.
      if (game.scoreboard === 'podium') game.podiumToken = (game.podiumToken || 0) + 1;
      // Umschalten der Scoreboard-Ansicht holt den Bildschirm vom Session-Endscreen
      // weg (sonst verdeckt der Endscreen das gewaehlte Scoreboard).
      game.sessionEnd.active = false;
      bus.broadcast();
      return;
    case 'setScoreboardScale':                // Textgroesse des Bildschirm-Scoreboards (%)
      game.scoreboardScale = clamp(Math.round(Number(msg.value) || 100), 50, 200);
      bus.broadcast();
      return;
    case 'replayPodium':                      // Podium-Enthuellung erneut abspielen (Master-Button)
      game.podiumToken = (game.podiumToken || 0) + 1;
      bus.broadcast();
      return;
    case 'replaySessionEnd':                  // Session-Endscreen erneut abspielen (Master-Button)
      if (!game.sessionEnd.active) return;
      game.sessionEnd.token = (game.sessionEnd.token || 0) + 1;
      bus.broadcast();
      return;
    case 'setPodiumSpeed':                    // Tempo der Podium-Enthuellung (ms pro Platz)
      game.podiumSpeed = clamp(Math.round(Number(msg.value) || 900), 300, 3000);
      bus.broadcast();
      return;
    case 'setQr':                             // QR-Code (Beitritts-URL) am Bildschirm ein-/ausblenden
      game.showQr = !!msg.on;
      bus.broadcast();
      return;
    case 'setQrUrl':                          // eigene Beitritts-URL setzen (leer = automatisch per LAN-IP)
      game.qrUrl = (typeof msg.url === 'string') ? msg.url.trim().slice(0, 300) : '';
      bus.broadcast();
      return;
    case 'setQrTitle':                        // Ueberschrift der QR-Karte setzen (leer = Standardtext), persistiert in config.json
      config.qrTitle = (typeof msg.title === 'string' && msg.title.trim())
        ? msg.title.trim().slice(0, 60)
        : DEFAULT_CONFIG.qrTitle;
      saveConfig();
      bus.broadcast();
      return;
    case 'setScore': {                        // Punkte eines Spielers exakt setzen
      const id = msg.clientId;
      const p = id && participants.get(id);
      if (!p || p.role !== 'player') return;
      game.scores[id] = clampScore(msg.value);
      bus.broadcast();
      return;
    }
    case 'adjustScore': {                     // Punkte eines Spielers relativ aendern (±x)
      const id = msg.clientId;
      const p = id && participants.get(id);
      if (!p || p.role !== 'player') return;
      const delta = Math.round(Number(msg.delta) || 0);
      game.scores[id] = clampScore((game.scores[id] || 0) + delta);
      bus.broadcast();
      return;
    }
    case 'arm': if (config.activeGame === 'none') return; return armRound();
    case 'yellow': if (config.activeGame === 'none') return; return goYellow();
    case 'red': if (config.activeGame === 'none') return; return backToRed();
    case 'go': if (config.activeGame === 'none') return; return goGreen();
    case 'endRound': if (config.activeGame === 'none') return; return endRound();
    case 'reset': if (config.activeGame === 'none') return; return resetRound();
    case 'resetScores':
      // Punkte weg -> die bisherigen Fun Facts (Punktesprung, meiste richtige Antworten, ...)
      // beziehen sich auf Punkte, die es nicht mehr gibt, daher gleich mit zuruecksetzen.
      game.scores = {}; resetSession(); bus.broadcast(); return;
    case 'resetSession':                      // Session-Fun-Fact-Statistik manuell zuruecksetzen
      resetSession(); bus.broadcast(); return;
    case 'setSessionFacts':                   // Welche Fun-Fact-Kacheln der Session-Endscreen zeigt
      config.sessionFacts = sanitizeSessionFacts(msg.facts);
      saveConfig();
      bus.broadcast();
      return;
    // --- Teams (generisch, spielunabhaengig) --------------------------------
    // Team-Modus + Teamliste landen in config.json (ueberleben einen Neustart);
    // Zuordnungen (playerTeam) und Punkte bleiben reiner Laufzeitzustand.
    case 'setTeamMode':                       // Einzel- vs. Teamwertung umschalten
      game.teamMode = !!msg.on;
      config.teamMode = game.teamMode; saveConfig();
      bus.broadcast();
      return;
    case 'addTeam': {                         // neues Team (naechste freie Preset-Farbe)
      if (game.teams.length >= 12) return;    // sinnvolle Obergrenze
      const preset = nextTeamPreset();
      const color = normHexColor(msg.color) || preset.color;
      const name = (typeof msg.name === 'string' && msg.name.trim())
        ? msg.name.trim().slice(0, 24) : ('Team ' + preset.name);
      game.teams.push({ id: genId(), name, color });
      config.teams = game.teams; saveConfig();
      bus.broadcast();
      return;
    }
    case 'removeTeam': {                       // Team loeschen (Zuordnungen aufheben)
      const tid = msg.teamId;
      game.teams = game.teams.filter((t) => t.id !== tid);
      for (const k of Object.keys(game.playerTeam)) {
        if (game.playerTeam[k] === tid) delete game.playerTeam[k];
      }
      config.teams = game.teams; saveConfig();
      bus.broadcast();
      return;
    }
    case 'renameTeam': {                       // Team umbenennen
      const t = game.teams.find((x) => x.id === msg.teamId);
      if (t && typeof msg.name === 'string') t.name = msg.name.slice(0, 24) || t.name;
      config.teams = game.teams; saveConfig();
      bus.broadcast();
      return;
    }
    case 'setTeamColor': {                     // Team-Farbe aendern
      const t = game.teams.find((x) => x.id === msg.teamId);
      const c = normHexColor(msg.color);
      if (t && c) t.color = c;
      config.teams = game.teams; saveConfig();
      bus.broadcast();
      return;
    }
    case 'assignTeam': {                       // Spieler einem Team zuordnen (oder lösen)
      const id = msg.clientId;
      const p = id && participants.get(id);
      if (!p || p.role !== 'player') return;
      const tid = msg.teamId;
      if (!tid) delete game.playerTeam[id];
      else if (game.teams.some((t) => t.id === tid)) game.playerTeam[id] = tid;
      bus.broadcast();
      return;
    }
    // --- Wortlisten-Spiel ---------------------------------------------------
    case 'wlSetLock': {                       // einzelnen Spieler sperren/freigeben
      if (config.activeGame !== 'wordlist') return;
      const id = msg.clientId;
      if (!id || !participants.has(id)) return;
      if (msg.locked) delete game.wl.unlocked[id];
      else game.wl.unlocked[id] = true;
      bus.broadcast();
      return;
    }
    case 'wlLockAll':                         // alle Spieler sperren
      if (config.activeGame !== 'wordlist') return;
      game.wl.unlocked = {};
      bus.broadcast();
      return;
    case 'wlUnlockAll':                       // alle Spieler freigeben
      if (config.activeGame !== 'wordlist') return;
      for (const pp of participants.values()) {
        if (pp.role === 'player') game.wl.unlocked[pp.id] = true;
      }
      bus.broadcast();
      return;
    case 'wlToggleReveal': {                  // ein Feld auf-/zudecken
      if (config.activeGame !== 'wordlist') return;
      const idx = Number(msg.index);
      const words = activeWordlistCfg().words;
      if (!Number.isInteger(idx) || idx < 0 || idx >= words.length) return;
      if (game.wl.revealed.length !== words.length) initWordlist();
      game.wl.revealed[idx] = !game.wl.revealed[idx];
      bus.broadcast();
      return;
    }
    case 'wlReset':                           // alles wieder verdecken (+ Freigaben/Woerter leeren)
      if (config.activeGame !== 'wordlist') return;
      initWordlist();
      bus.broadcast();
      return;
    // --- Multiple-Choice-Spiel ----------------------------------------------
    case 'mcStart':  if (config.activeGame !== 'mc') return; return mcStart();
    case 'mcReveal': if (config.activeGame !== 'mc') return; return mcReveal();
    case 'mcNext':   if (config.activeGame !== 'mc') return; return mcNext();
    case 'mcReset':  if (config.activeGame !== 'mc') return; initMc(); bus.broadcast(); return;
    // "Die Allgemeinheit einigt sich auf ...": Master-Live-Auswahl ohne
    // Teilnehmerbindung (s. lib/games/mc.js), aenderbar bis zur Aufloesung.
    case 'mcGroupPick': if (config.activeGame !== 'mc') return; return mcSetGroupPick(msg.option);
    // --- Zeitdruck-Spiel ----------------------------------------------------
    case 'zdStart':  if (config.activeGame !== 'zd') return; return zdStart();
    case 'zdReveal': if (config.activeGame !== 'zd') return; return zdReveal();
    case 'zdNext':   if (config.activeGame !== 'zd') return; return zdNext();
    case 'zdReset':  if (config.activeGame !== 'zd') return; initZd(); bus.broadcast(); return;
    case 'zdGroupPick': if (config.activeGame !== 'zd') return; return zdSetGroupPick(msg.option, msg.elapsedMs);
    // --- „Falsche Woerter"-Spiel --------------------------------------------
    case 'fwStart':  if (config.activeGame !== 'fw') return; return fwStart();
    case 'fwPause':  if (config.activeGame !== 'fw') return; return fwPause();
    case 'fwResume': if (config.activeGame !== 'fw') return; return fwResume();
    case 'fwReset':  if (config.activeGame !== 'fw') return; initFw(); bus.broadcast(); return;
    // --- Wahr/Falsch-Blitzrunde ----------------------------------------------
    case 'tfStart':  if (config.activeGame !== 'tf') return; return tfStart();
    case 'tfReveal': if (config.activeGame !== 'tf') return; return tfReveal();
    case 'tfNext':   if (config.activeGame !== 'tf') return; return tfNext();
    case 'tfReset':  if (config.activeGame !== 'tf') return; initTf(); bus.broadcast(); return;
    // "Die Allgemeinheit einigt sich auf ...": Master-Live-Auswahl ohne
    // Teilnehmerbindung (Abstimmungs-Modus, s. lib/games/tf.js), aenderbar bis zur Aufloesung.
    case 'tfGroupPick': if (config.activeGame !== 'tf') return; return tfSetGroupPick(msg.answer, msg.elapsedMs);
    // --- Zuordnungs-Spiel ---------------------------------------------------
    case 'zuStart':  if (config.activeGame !== 'zu') return; return zuStart();
    case 'zuReveal': if (config.activeGame !== 'zu') return; return zuReveal();
    case 'zuReset':  if (config.activeGame !== 'zu') return; initZu(); bus.broadcast(); return;
    case 'zuGroupPick': if (config.activeGame !== 'zu') return; return zuSetGroupPick(msg.leftId, msg.rightId);
    // --- Detektivquiz -------------------------------------------------------
    case 'dqStart':  if (config.activeGame !== 'dq') return; return dqStart();
    case 'dqClue':   if (config.activeGame !== 'dq') return; return dqNextClue();
    case 'dqAward':  if (config.activeGame !== 'dq') return; return dqAward(msg.clientId);
    case 'dqOk':     if (config.activeGame !== 'dq') return; return dqBuzzOk();
    case 'dqWrong':  if (config.activeGame !== 'dq') return; return dqBuzzWrong();
    case 'dqReveal': if (config.activeGame !== 'dq') return; return dqRevealSolution();
    case 'dqNext':   if (config.activeGame !== 'dq') return; return dqNextCase();
    case 'dqReset':  if (config.activeGame !== 'dq') return; initDq(); bus.broadcast(); return;
    // --- Schätzquiz ---------------------------------------------------------
    case 'sqStart':  if (config.activeGame !== 'sq') return; return sqStart();
    case 'sqReveal': if (config.activeGame !== 'sq') return; return sqReveal();
    case 'sqNext':   if (config.activeGame !== 'sq') return; return sqNext();
    case 'sqReset':  if (config.activeGame !== 'sq') return; initSq(); bus.broadcast(); return;
    // --- Audioquiz ----------------------------------------------------------
    case 'aqStart':   if (config.activeGame !== 'aq') return; return aqStart();
    case 'aqClue':    if (config.activeGame !== 'aq') return; return aqNextClue();
    case 'aqReplay':  if (config.activeGame !== 'aq') return; return aqReplay();
    case 'aqAward':   if (config.activeGame !== 'aq') return; return aqAward(msg.clientId);
    case 'aqOk':      if (config.activeGame !== 'aq') return; return aqBuzzOk(msg.clientId);
    case 'aqWrong':   if (config.activeGame !== 'aq') return; return aqBuzzWrong(msg.clientId);
    case 'aqReleaseAll': if (config.activeGame !== 'aq') return; return aqBuzzReleaseAll();
    case 'aqReveal':  if (config.activeGame !== 'aq') return; return aqRevealSolution();
    case 'aqVolume':  if (config.activeGame !== 'aq') return; return aqSetVolume(msg.value);
    case 'aqNext':    if (config.activeGame !== 'aq') return; return aqNextRound();
    case 'aqReset':   if (config.activeGame !== 'aq') return; initAq(); bus.broadcast(); return;
    // --- Reihenfolge-Quiz ----------------------------------------------------
    case 'roStart':  if (config.activeGame !== 'ro') return; return roStart();
    case 'roReveal': if (config.activeGame !== 'ro') return; return roReveal();
    case 'roNext':   if (config.activeGame !== 'ro') return; return roNext();
    case 'roReset':  if (config.activeGame !== 'ro') return; initRo(); bus.broadcast(); return;
    // "Die Allgemeinheit einigt sich auf ...": Master-Live-Auswahl ohne
    // Teilnehmerbindung (s. lib/games/ro.js), aenderbar bis zur Aufloesung.
    case 'roGroupPick': if (config.activeGame !== 'ro') return; return roSetGroupPick(msg.order);
    // --- Zeichenquiz -----------------------------------------------------
    case 'zmStart':    if (config.activeGame !== 'zm') return; return zmStart();
    case 'zmToVoting': if (config.activeGame !== 'zm') return; return zmToVoting();
    case 'zmReveal':   if (config.activeGame !== 'zm') return; return zmReveal();
    case 'zmNext':     if (config.activeGame !== 'zm') return; return zmNext();
    case 'zmReset':    if (config.activeGame !== 'zm') return; initZm(); bus.broadcast(); return;
    // --- Bildanzeige ---------------------------------------------------------
    case 'bildSichtbar': if (config.activeGame !== 'bild') return; return bildSetSichtbar(msg.on);
    case 'bildScharf':   if (config.activeGame !== 'bild') return; return bildSetScharf(msg.on);
    case 'bildReset':    if (config.activeGame !== 'bild') return; initBild(); bus.broadcast(); return;
    case 'cleanup': {
      for (const [id, p] of participants) {
        if (!p.online) {
          participants.delete(id);
          delete game.results[id];
          delete game.scores[id];
          delete game.playerTeam[id];
          delete game.cursed[id];
          delete game.mc.answers[id];
          delete game.zd.answers[id];
          delete game.tf.votes[id];
          delete game.zu.answers[id];
          delete game.dq.answers[id];
          delete game.sq.answers[id];
          delete game.aq.answers[id];
          delete game.ro.answers[id];
          delete game.zm.drawings[id];
          delete game.zm.submitted[id];
          delete game.zm.votes[id];
          delete game.popups[id];
          delete game.messages[id];
        }
      }
      bus.broadcast();
      return;
    }
    case 'kick':
      if (msg.clientId && participants.has(msg.clientId)) {
        const p = participants.get(msg.clientId);
        if (p.conn) { try { p.conn.socket.destroy(); } catch (e) {} }
        participants.delete(msg.clientId);
        delete game.results[msg.clientId];
        delete game.scores[msg.clientId];
        delete game.playerTeam[msg.clientId];
        delete game.cursed[msg.clientId];
        delete game.mc.answers[msg.clientId];
        delete game.zd.answers[msg.clientId];
        delete game.tf.votes[msg.clientId];
        delete game.poll.votes[msg.clientId];
        delete game.zu.answers[msg.clientId];
        delete game.dq.answers[msg.clientId];
        delete game.sq.answers[msg.clientId];
        delete game.aq.answers[msg.clientId];
        delete game.ro.answers[msg.clientId];
        delete game.zm.drawings[msg.clientId];
        delete game.zm.submitted[msg.clientId];
        delete game.zm.votes[msg.clientId];
        delete game.popups[msg.clientId];
        delete game.messages[msg.clientId];
        bus.broadcast();
      }
      return;
    default: return;
  }
}

module.exports = { onMaster };
