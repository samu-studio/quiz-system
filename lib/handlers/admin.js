'use strict';
/*
 * Admin-Kanal (Bildschirm-Steuerung): Login, globale Einstellungen, Uploads,
 * Spiel-/Profil-Verwaltung, Spielplan-Steuerung.
 */
const fs = require('fs');
const path = require('path');
const bus = require('../bus');
const { clamp, normQuestion } = require('../util');
const {
  config, saveConfig, THEME_PRESETS, GAME_SORTS, BG_DIR, AUDIO_DIR, MUSIC_DIR, SOUNDBOARD_DIR, PAUSE_DIR,
  safeBgName, safeAudioName, safePauseImgName, sanitizeDesign, sanitizePauseScreen,
  sanitizePlaylist, sanitizeTeams
} = require('../config');
const { addMusicTrack, dropMissingTracks } = require('../music');
const { game } = require('../state');
const { snapshotFor } = require('../snapshot');
const { clearAutoGo } = require('../games/reaction');
const { initWordlist } = require('../games/wordlist');
const { initMc } = require('../games/mc');
const { initZd } = require('../games/zd');
const { clearFwTimer, initFw, normWordFlag } = require('../games/fw');
const { initTf, normStatement } = require('../games/tf');
const { initZu, normPair } = require('../games/zu');
const { initDq, normCase } = require('../games/dq');
const { initSq, normEstQuestion } = require('../games/sq');
const { initAq, normAudioRound } = require('../games/aq');
const { initRo, normRoQuestion } = require('../games/ro');
const { clearZmTimer, initZm, normBegriff } = require('../games/zm');
const { initBild, normBildProfile } = require('../games/bild');

// Admin-Aktionen, die einen echten Spielwechsel/-schritt ausloesen (Spiel/Profil
// wechseln, Spielplan-Schritt anspringen). Wie bei den Master-Aktionen (s.
// SCOREBOARD_KEEP in lib/handlers/master.js) soll sowas das Vollbild-Scoreboard
// bzw. den Session-Endscreen automatisch verlassen, statt das neue Spiel zu verdecken.
const ADMIN_GAME_SWITCH_ACTIONS = new Set([
  'selectGame', 'selectProfile', 'playlistGoto', 'playlistNext', 'playlistPrev'
]);

// Ein Spiel (neu) aufsetzen – zentrale Weiche, genutzt von activateGame() und
// ueberall dort, wo ein Profilwechsel/-import das aktive Profil eines gerade
// aktiven Spiels betrifft (sonst laeuft das Spiel mit veraltetem Zustand weiter).
function reinitGame(gameId) {
  if (gameId === 'wordlist') initWordlist();
  else if (gameId === 'mc') initMc();
  else if (gameId === 'zd') initZd();
  else if (gameId === 'fw') initFw();
  else if (gameId === 'tf') initTf();
  else if (gameId === 'zu') initZu();
  else if (gameId === 'dq') initDq();
  else if (gameId === 'sq') initSq();
  else if (gameId === 'aq') initAq();
  else if (gameId === 'ro') initRo();
  else if (gameId === 'zm') initZm();
  else if (gameId === 'bild') initBild();
}

function activateGame(gameId) {
  config.activeGame = gameId;
  // Aktivierungs-Historie fuer den Sortiermodus „recent": zuletzt gewaehltes
  // Spiel nach vorne holen (Standby „none" nicht mitzaehlen – steht ohnehin unten).
  if (gameId !== 'none') {
    config.gamePlayed = [gameId].concat(config.gamePlayed.filter((g) => g !== gameId));
  }
  clearAutoGo();
  clearFwTimer();               // evtl. laufenden „Falsche Woerter"-Timer stoppen
  clearZmTimer();                // evtl. laufenden Zeichenquiz-Zeitlimit-Timer stoppen
  game.phase = 'idle';
  game.goServerTime = null;
  game.results = {};
  game.sessionEnd.active = false;   // ein echter Spielwechsel holt den Bildschirm vom Endscreen zurueck ins Spiel
  reinitGame(gameId);
}

// Importierte Profile in ein Spiel zusammenfuehren (merge, gleicher Name ueberschreibt,
// unbekannte bestehende Profile bleiben unberuehrt). Reinitiiert das Spiel, falls
// dessen gerade aktives Profil dabei ueberschrieben wurde. Gibt die Anzahl der
// uebernommenen Profile zurueck (0 = nichts Verwertbares in der Datei).
function importProfilesInto(gameId, rawProfiles) {
  const g = config.games[gameId];
  if (!g || !rawProfiles || typeof rawProfiles !== 'object') return 0;
  let count = 0;
  let touchedActive = false;
  for (const rawName of Object.keys(rawProfiles)) {
    if (count >= 200) break;                      // Missbrauchsschutz (riesige Datei)
    const name = String(rawName).trim().slice(0, 40);
    if (!name) continue;
    g.profiles[name] = sanitizeProfile(gameId, rawProfiles[rawName] || {});
    if (name === g.activeProfile) touchedActive = true;
    count++;
  }
  if (touchedActive && config.activeGame === gameId) reinitGame(gameId);
  return count;
}

// Einen Spielplan-Schritt aktivieren: ggf. dessen Profil als aktiv setzen und dann
// das Spiel aktivieren (frische Lobby). Setzt playlist.pos auf den Schritt. Gibt
// false zurueck, wenn der Index ungueltig ist. Kein saveConfig/broadcast (Aufrufer).
function activatePlaylistStep(index) {
  const steps = config.playlist.steps;
  if (!Number.isInteger(index) || index < 0 || index >= steps.length) return false;
  const step = steps[index];
  const g = config.games[step.game];
  if (!g) return false;                       // Spiel existiert nicht mehr
  // Profil des Schritts aktiv setzen.
  if (step.profile && g.profiles[step.profile]) g.activeProfile = step.profile;
  activateGame(step.game);
  config.playlist.pos = index;
  return true;
}

function onAdmin(conn, msg) {
  if (msg.action === 'auth') {
    const ok = String(msg.password || '') === String(config.adminPassword);
    conn.authed = ok;                       // Verbindung als Master freischalten
    conn.send({ type: 'adminResult', ok });
    if (ok) conn.send(snapshotFor(conn));   // sofort Master-Daten (Teilnehmer/Konfig) nachliefern
    return;
  }
  // Alle weiteren Admin-Aktionen setzen eine freigeschaltete Verbindung voraus
  if (!conn.authed) { conn.send({ type: 'adminResult', ok: false }); return; }

  // Auto-Ruecksprung wie in onMaster(): ein Spiel-/Profil-/Spielplan-Wechsel beendet
  // das Vollbild-Scoreboard bzw. den Session-Endscreen (beide verdecken das Spiel).
  if (ADMIN_GAME_SWITCH_ACTIONS.has(msg.action)) {
    if (game.scoreboard === 'full' || game.scoreboard === 'podium') game.scoreboard = 'off';
    if (game.sessionEnd.active) game.sessionEnd.active = false;
  }

  if (msg.action === 'settings') {
    // Globale Einstellungen (Titel, Design, Passwort)
    const s = msg.settings || {};
    if (typeof s.title === 'string') config.title = s.title.slice(0, 60);
    if (THEME_PRESETS.includes(s.theme)) config.theme = s.theme;
    if (s.design) config.design = sanitizeDesign(s.design);
    if (s.pauseScreen) config.pauseScreen = sanitizePauseScreen(s.pauseScreen);
    if (typeof s.newPassword === 'string' && s.newPassword.length >= 1) {
      config.adminPassword = s.newPassword.slice(0, 60);
    }
    saveConfig();
    bus.broadcast();                              // zuerst Zustand verteilen (s. o.) ...
    conn.send({ type: 'adminResult', ok: true }); // ... dann Erfolg quittieren
  } else if (msg.action === 'uploadBg') {
    // Hintergrundbild hochladen: Data-URL -> Datei in public/backgrounds/ schreiben
    const name = safeBgName(msg.name);
    const data = String(msg.data || '');
    const m = data.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
    if (!name || !m) { conn.send({ type: 'adminResult', ok: false, error: 'Ungültiges Bild.' }); return; }
    let buf;
    try { buf = Buffer.from(m[1], 'base64'); } catch (e) { buf = null; }
    if (!buf || buf.length === 0 || buf.length > 12 * 1024 * 1024) {
      conn.send({ type: 'adminResult', ok: false, error: 'Bild fehlt oder ist zu groß (max 12 MB).' }); return;
    }
    try {
      fs.mkdirSync(BG_DIR, { recursive: true });
      fs.writeFileSync(path.join(BG_DIR, name), buf);
    } catch (e) { conn.send({ type: 'adminResult', ok: false, error: 'Speichern fehlgeschlagen.' }); return; }
    bus.broadcast();
    conn.send({ type: 'adminResult', ok: true, uploadedBg: name });
  } else if (msg.action === 'deleteBg') {
    // Hintergrundbild loeschen
    const name = safeBgName(msg.name);
    if (name) {
      try { fs.unlinkSync(path.join(BG_DIR, name)); } catch (e) { /* egal */ }
      // War es das aktive Bild, Auswahl leeren
      if (config.design.screen.bgImage === name) { config.design.screen.bgImage = ''; saveConfig(); }
    }
    bus.broadcast();
    conn.send({ type: 'adminResult', ok: true });
  } else if (msg.action === 'uploadPauseImg') {
    // Pause-Bildschirm-Bild hochladen: Data-URL -> Datei in public/pause/ schreiben,
    // und gleich in die Diashow-Auswahl aufnehmen (wie Design-Hintergrundbilder,
    // aber additiv, da hier mehrere Bilder aktiv sein koennen).
    const safeName = safePauseImgName(msg.name);
    const data = String(msg.data || '');
    const m = data.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
    if (!safeName || !m) { conn.send({ type: 'adminResult', ok: false, error: 'Ungültiges Bild.' }); return; }
    let buf;
    try { buf = Buffer.from(m[1], 'base64'); } catch (e) { buf = null; }
    if (!buf || buf.length === 0 || buf.length > 12 * 1024 * 1024) {
      conn.send({ type: 'adminResult', ok: false, error: 'Bild fehlt oder ist zu groß (max 12 MB).' }); return;
    }
    try {
      fs.mkdirSync(PAUSE_DIR, { recursive: true });
      fs.writeFileSync(path.join(PAUSE_DIR, safeName), buf);
    } catch (e) { conn.send({ type: 'adminResult', ok: false, error: 'Speichern fehlgeschlagen.' }); return; }
    if (!config.pauseScreen.images.includes(safeName)) {
      config.pauseScreen.images = config.pauseScreen.images.concat(safeName).slice(0, 20);
      saveConfig();
    }
    bus.broadcast();
    conn.send({ type: 'adminResult', ok: true, uploadedPauseImg: safeName });
  } else if (msg.action === 'deletePauseImg') {
    // Pause-Bildschirm-Bild loeschen (Datei + aus der Diashow-Auswahl entfernen)
    const name = safePauseImgName(msg.name);
    if (name) {
      try { fs.unlinkSync(path.join(PAUSE_DIR, name)); } catch (e) { /* egal */ }
      if (config.pauseScreen.images.includes(name)) {
        config.pauseScreen.images = config.pauseScreen.images.filter((n) => n !== name);
        saveConfig();
      }
    }
    bus.broadcast();
    conn.send({ type: 'adminResult', ok: true });
  } else if (msg.action === 'uploadAudio') {
    // Audiodatei hochladen: Data-URL -> Datei in public/audio/ schreiben (Audioquiz).
    const name = safeAudioName(msg.name);
    const data = String(msg.data || '');
    const m = data.match(/^data:[^;,]*;base64,(.+)$/);   // MIME variiert je nach Browser
    if (!name || !m) { conn.send({ type: 'adminResult', ok: false, error: 'Ungültige Audiodatei.' }); return; }
    let buf;
    try { buf = Buffer.from(m[1], 'base64'); } catch (e) { buf = null; }
    if (!buf || buf.length === 0 || buf.length > 30 * 1024 * 1024) {
      conn.send({ type: 'adminResult', ok: false, error: 'Audio fehlt oder ist zu groß (max 30 MB).' }); return;
    }
    try {
      fs.mkdirSync(AUDIO_DIR, { recursive: true });
      fs.writeFileSync(path.join(AUDIO_DIR, name), buf);
    } catch (e) { conn.send({ type: 'adminResult', ok: false, error: 'Speichern fehlgeschlagen.' }); return; }
    bus.broadcast();
    conn.send({ type: 'adminResult', ok: true, uploadedAudio: name });
  } else if (msg.action === 'deleteAudio') {
    // Audiodatei loeschen
    const name = safeAudioName(msg.name);
    if (name) { try { fs.unlinkSync(path.join(AUDIO_DIR, name)); } catch (e) { /* egal */ } }
    bus.broadcast();
    conn.send({ type: 'adminResult', ok: true });
  } else if (msg.action === 'uploadMusic') {
    // Hintergrundmusik hochladen: Data-URL -> Datei in public/music/, landet
    // automatisch am Ende der Musik-Playlist.
    const name = safeAudioName(msg.name);
    const data = String(msg.data || '');
    const m = data.match(/^data:[^;,]*;base64,(.+)$/);   // MIME variiert je nach Browser
    if (!name || !m) { conn.send({ type: 'adminResult', ok: false, error: 'Ungültige Audiodatei.' }); return; }
    let buf;
    try { buf = Buffer.from(m[1], 'base64'); } catch (e) { buf = null; }
    if (!buf || buf.length === 0 || buf.length > 30 * 1024 * 1024) {
      conn.send({ type: 'adminResult', ok: false, error: 'Audio fehlt oder ist zu groß (max 30 MB).' }); return;
    }
    try {
      fs.mkdirSync(MUSIC_DIR, { recursive: true });
      fs.writeFileSync(path.join(MUSIC_DIR, name), buf);
    } catch (e) { conn.send({ type: 'adminResult', ok: false, error: 'Speichern fehlgeschlagen.' }); return; }
    addMusicTrack(name);
    bus.broadcast();
    conn.send({ type: 'adminResult', ok: true, uploadedMusic: name });
  } else if (msg.action === 'deleteMusic') {
    // Musikdatei loeschen (und aus der Playlist nehmen)
    const name = safeAudioName(msg.name);
    if (name) { try { fs.unlinkSync(path.join(MUSIC_DIR, name)); } catch (e) { /* egal */ } }
    dropMissingTracks();
    conn.send({ type: 'adminResult', ok: true });
  } else if (msg.action === 'uploadSound') {
    // Eigener Soundboard-Sound: Data-URL -> Datei in public/soundboard/ (kurze
    // Effekte, daher kleineres Limit als bei Musik/Audioquiz).
    const name = safeAudioName(msg.name);
    const data = String(msg.data || '');
    const m = data.match(/^data:[^;,]*;base64,(.+)$/);   // MIME variiert je nach Browser
    if (!name || !m) { conn.send({ type: 'adminResult', ok: false, error: 'Ungültige Audiodatei.' }); return; }
    let buf;
    try { buf = Buffer.from(m[1], 'base64'); } catch (e) { buf = null; }
    if (!buf || buf.length === 0 || buf.length > 10 * 1024 * 1024) {
      conn.send({ type: 'adminResult', ok: false, error: 'Sound fehlt oder ist zu groß (max 10 MB).' }); return;
    }
    try {
      fs.mkdirSync(SOUNDBOARD_DIR, { recursive: true });
      fs.writeFileSync(path.join(SOUNDBOARD_DIR, name), buf);
    } catch (e) { conn.send({ type: 'adminResult', ok: false, error: 'Speichern fehlgeschlagen.' }); return; }
    bus.broadcast();
    conn.send({ type: 'adminResult', ok: true, uploadedSound: name });
  } else if (msg.action === 'deleteSound') {
    // Eigenen Soundboard-Sound loeschen (mitgelieferte nur ausblendbar, s. soundHidden)
    const name = safeAudioName(msg.name);
    if (name) { try { fs.unlinkSync(path.join(SOUNDBOARD_DIR, name)); } catch (e) { /* egal */ } }
    bus.broadcast();
    conn.send({ type: 'adminResult', ok: true });
  } else if (msg.action === 'saveProfile') {
    // Profil eines Spiels anlegen/aktualisieren
    const game = String(msg.game || '');
    const name = String(msg.name || '').trim().slice(0, 40);
    if (!config.games[game] || !name) { conn.send({ type: 'adminResult', ok: false }); return; }
    config.games[game].profiles[name] = sanitizeProfile(game, msg.settings || {});
    if (msg.activate) config.games[game].activeProfile = name;
    // Wird das gerade aktive Profil des laufenden Spiels bearbeitet, neu aufsetzen (Lobby).
    if (config.activeGame === game && config.games[game].activeProfile === name) reinitGame(game);
    saveConfig();
    bus.broadcast();                              // zuerst Zustand verteilen (s. o.) ...
    conn.send({ type: 'adminResult', ok: true }); // ... dann Erfolg quittieren
  } else if (msg.action === 'deleteProfile') {
    const game = String(msg.game || '');
    const name = String(msg.name || '');
    const g = config.games[game];
    if (!g || !g.profiles[name]) { conn.send({ type: 'adminResult', ok: false }); return; }
    if (Object.keys(g.profiles).length <= 1) { conn.send({ type: 'adminResult', ok: false }); return; }
    delete g.profiles[name];
    if (g.activeProfile === name) g.activeProfile = Object.keys(g.profiles)[0];
    if (config.activeGame === game) reinitGame(game);
    saveConfig();
    bus.broadcast();                              // zuerst Zustand verteilen (s. o.) ...
    conn.send({ type: 'adminResult', ok: true }); // ... dann Erfolg quittieren
  } else if (msg.action === 'selectProfile') {
    const game = String(msg.game || '');
    const name = String(msg.name || '');
    const g = config.games[game];
    if (!g || !g.profiles[name]) { conn.send({ type: 'adminResult', ok: false }); return; }
    g.activeProfile = name;
    if (config.activeGame === game) reinitGame(game);
    config.playlist.pos = -1;                 // manuelle Profilwahl -> vom Spielplan lösen
    saveConfig();
    bus.broadcast();                              // zuerst Zustand verteilen (s. o.) ...
    conn.send({ type: 'adminResult', ok: true }); // ... dann Erfolg quittieren
  } else if (msg.action === 'selectGame') {
    const gameId = String(msg.game || '');
    // 'none' = kein Spiel (Standby); sonst muss das Spiel existieren
    if (gameId !== 'none' && !config.games[gameId]) { conn.send({ type: 'adminResult', ok: false }); return; }
    activateGame(gameId);
    config.playlist.pos = -1;                 // manuelle Spielwahl -> vom Spielplan lösen
    saveConfig();
    bus.broadcast();                              // zuerst Zustand verteilen (s. o.) ...
    conn.send({ type: 'adminResult', ok: true }); // ... dann Erfolg quittieren
  } else if (msg.action === 'playlistSet') {
    // Ganzen Spielplan ersetzen (Editor sendet die vollstaendige Schritt-Liste).
    config.playlist = sanitizePlaylist({ steps: msg.steps, pos: config.playlist.pos }, config);
    saveConfig();
    bus.broadcast();
    conn.send({ type: 'adminResult', ok: true });
  } else if (msg.action === 'playlistGoto') {
    // Auf einen bestimmten Schritt springen und dessen Spiel+Profil aktivieren.
    if (activatePlaylistStep(Number(msg.index))) {
      saveConfig(); bus.broadcast(); conn.send({ type: 'adminResult', ok: true });
    } else { conn.send({ type: 'adminResult', ok: false }); }
  } else if (msg.action === 'playlistNext') {
    const target = config.playlist.pos < 0 ? 0 : config.playlist.pos + 1;
    const steps = config.playlist.steps;
    if (activatePlaylistStep(target)) {
      saveConfig(); bus.broadcast(); conn.send({ type: 'adminResult', ok: true });
    } else if (steps.length > 0 && config.playlist.pos === steps.length - 1) {
      // Letzter Schritt bereits aktiv, "Naechstes" waere ausserhalb des Plans ->
      // Spielplan ist zu Ende: Session-Endscreen am Bildschirm zeigen statt ok:false.
      game.sessionEnd.active = true;
      game.sessionEnd.token = (game.sessionEnd.token || 0) + 1;
      bus.broadcast(); conn.send({ type: 'adminResult', ok: true });
    } else { conn.send({ type: 'adminResult', ok: false }); }
  } else if (msg.action === 'playlistPrev') {
    if (config.playlist.pos > 0 && activatePlaylistStep(config.playlist.pos - 1)) {
      saveConfig(); bus.broadcast(); conn.send({ type: 'adminResult', ok: true });
    } else { conn.send({ type: 'adminResult', ok: false }); }
  } else if (msg.action === 'setGameSort') {
    // Sortiermodus der Spiele-Kachelliste umschalten.
    const mode = String(msg.sort || '');
    if (!GAME_SORTS.includes(mode)) { conn.send({ type: 'adminResult', ok: false }); return; }
    config.gameSort = mode;
    saveConfig();
    bus.broadcast();
    conn.send({ type: 'adminResult', ok: true });
  } else if (msg.action === 'setGameOrder') {
    // Freie Reihenfolge (Drag&Drop) speichern. Nur bekannte Spiele-IDs (ohne 'none'),
    // dedupliziert; unbekannte/fehlende Eintraege werden verworfen bzw. spaeter ergaenzt.
    const known = Object.keys(config.games);
    const seen = new Set();
    const order = [];
    if (Array.isArray(msg.order)) {
      for (const gid of msg.order) {
        const id = String(gid);
        if (id !== 'none' && known.includes(id) && !seen.has(id)) { seen.add(id); order.push(id); }
      }
    }
    config.gameOrder = order;
    saveConfig();
    bus.broadcast();
    conn.send({ type: 'adminResult', ok: true });
  } else if (msg.action === 'importProfiles') {
    // JSON-Import: ein einzelnes Profil ODER alle Profile eines Spiels (gleiche
    // Weiche – „profiles" ist in beiden Faellen eine Name->Profil-Map). Merge:
    // vorhandene Profile bleiben, gleicher Name wird ueberschrieben.
    const gameId = String(msg.game || '');
    const count = config.games[gameId] ? importProfilesInto(gameId, msg.profiles) : 0;
    if (count === 0) {
      conn.send({ type: 'adminResult', ok: false, error: 'Keine gültigen Profile in der Datei gefunden.' });
      return;
    }
    saveConfig();
    bus.broadcast();
    conn.send({ type: 'adminResult', ok: true, imported: count });
  } else if (msg.action === 'importFull') {
    // Gesamt-Backup importieren: Titel/Theme/Design/Team-Einrichtung/Spielplan werden
    // uebernommen (sofern in der Datei vorhanden), Spiel-Profile werden je Spiel
    // zusammengefuehrt (merge). Das Admin-Passwort ist bewusst NICHT Teil des Backups.
    const data = (msg.data && typeof msg.data === 'object') ? msg.data : null;
    if (!data) { conn.send({ type: 'adminResult', ok: false, error: 'Ungültige Backup-Datei.' }); return; }
    if (typeof data.title === 'string') config.title = data.title.slice(0, 60);
    if (THEME_PRESETS.includes(data.theme)) config.theme = data.theme;
    if (data.design) config.design = sanitizeDesign(data.design);
    if (data.pauseScreen) config.pauseScreen = sanitizePauseScreen(data.pauseScreen);
    // teamMode/teams leben zur Laufzeit in game.* (game.teams ist die massgebliche Kopie,
    // config.teams nur die Persistenz-Spiegelung – siehe master.js); beide zusammenhalten.
    if (typeof data.teamMode === 'boolean') { config.teamMode = data.teamMode; game.teamMode = data.teamMode; }
    if (Array.isArray(data.teams)) {
      const byId = new Map(game.teams.map((t) => [t.id, t]));
      for (const t of sanitizeTeams(data.teams)) byId.set(t.id, t);   // merge per Team-ID
      const merged = Array.from(byId.values()).slice(0, 12);
      game.teams = merged;
      config.teams = merged;
    }
    let imported = 0;
    if (data.games && typeof data.games === 'object') {
      for (const gid of Object.keys(config.games)) {
        const src = data.games[gid];
        if (src && src.profiles) imported += importProfilesInto(gid, src.profiles);
      }
    }
    // Erst NACH dem Merge der Spiel-Profile validieren (Playlist prueft Spiel/Profil-Existenz).
    if (data.playlist) config.playlist = sanitizePlaylist(data.playlist, config);
    saveConfig();
    bus.broadcast();
    conn.send({ type: 'adminResult', ok: true, imported });
  }
}

function sanitizeProfile(game, s) {
  if (game === 'reaction') {
    const out = {
      autoGo: !!s.autoGo,
      autoDelayMin: Number.isFinite(s.autoDelayMin) ? clamp(s.autoDelayMin, 200, 10000) : 1500,
      autoDelayMax: Number.isFinite(s.autoDelayMax) ? s.autoDelayMax : 4000,
      rangPunkte: typeof s.rangPunkte === 'string' ? s.rangPunkte.slice(0, 200)
        : (Array.isArray(s.rangPunkte) ? s.rangPunkte.join(', ').slice(0, 200) : '3, 2, 1')
    };
    out.autoDelayMax = clamp(out.autoDelayMax, out.autoDelayMin, 15000);
    return out;
  }
  if (game === 'wordlist') {
    const heading = typeof s.heading === 'string' ? s.heading.slice(0, 80) : '';
    let words = [];
    if (Array.isArray(s.words)) words = s.words;
    else if (typeof s.words === 'string') words = s.words.split('\n');
    words = words.map((w) => String(w).trim()).filter(Boolean).map((w) => w.slice(0, 60)).slice(0, 300);
    const punkteAktiv = !!s.punkteAktiv;
    const punkte = Number.isFinite(s.punkte) ? clamp(Math.round(s.punkte), 1, 100000) : 10;
    return { heading, words, punkteAktiv, punkte };
  }
  if (game === 'mc') {
    const intro = typeof s.intro === 'string' ? s.intro.slice(0, 80) : '';
    const points = Number.isFinite(s.points) ? clamp(Math.round(s.points), 1, 100000) : 100;
    const questions = Array.isArray(s.questions)
      ? s.questions.map(normQuestion).filter(Boolean).slice(0, 100) : [];
    return {
      intro,
      points,
      shuffleQuestions: !!s.shuffleQuestions,
      shuffleAnswers: !!s.shuffleAnswers,
      questions
    };
  }
  if (game === 'zd') {
    const intro = typeof s.intro === 'string' ? s.intro.slice(0, 80) : '';
    const startPoints = Number.isFinite(s.startPoints) ? clamp(Math.round(s.startPoints), 10, 1000000) : 1000;
    let minPoints = Number.isFinite(s.minPoints) ? clamp(Math.round(s.minPoints), 0, startPoints) : Math.min(100, startPoints);
    const drainPerSec = Number.isFinite(s.drainPerSec) ? clamp(Math.round(s.drainPerSec), 1, 1000000) : 100;
    const questions = Array.isArray(s.questions)
      ? s.questions.map(normQuestion).filter(Boolean).slice(0, 100) : [];
    return {
      intro,
      startPoints,
      minPoints,
      drainPerSec,
      shuffleQuestions: !!s.shuffleQuestions,
      shuffleAnswers: !!s.shuffleAnswers,
      questions
    };
  }
  if (game === 'fw') {
    const kategorie = typeof s.kategorie === 'string' ? s.kategorie.slice(0, 80) : '';
    const punkte = Number.isFinite(s.punkte) ? clamp(Math.round(s.punkte), 1, 100000) : 100;
    const sekundenProWort = Number.isFinite(s.sekundenProWort) ? clamp(Math.round(s.sekundenProWort), 1, 60) : 4;
    const woerter = Array.isArray(s.woerter)
      ? s.woerter.map(normWordFlag).filter(Boolean).slice(0, 300) : [];
    return { kategorie, punkte, sekundenProWort, mischen: !!s.mischen, woerter };
  }
  if (game === 'tf') {
    const punkteModus = s.punkteModus === 'zeit' ? 'zeit' : 'fix';
    const punkte = Number.isFinite(s.punkte) ? clamp(Math.round(s.punkte), 1, 100000) : 100;
    const startPunkte = Number.isFinite(s.startPunkte) ? clamp(Math.round(s.startPunkte), 10, 1000000) : 1000;
    let minPunkte = Number.isFinite(s.minPunkte) ? clamp(Math.round(s.minPunkte), 0, startPunkte) : Math.min(100, startPunkte);
    const abzugProSek = Number.isFinite(s.abzugProSek) ? clamp(Math.round(s.abzugProSek), 1, 1000000) : 100;
    const aussagen = Array.isArray(s.aussagen)
      ? s.aussagen.map(normStatement).filter(Boolean).slice(0, 300) : [];
    return {
      nurSchnellster: !!s.nurSchnellster, punkteModus, punkte, startPunkte, minPunkte, abzugProSek,
      mischen: !!s.mischen, aussagen
    };
  }
  if (game === 'zu') {
    const titel = typeof s.titel === 'string' ? s.titel.slice(0, 80) : '';
    const linksLabel = typeof s.linksLabel === 'string' ? s.linksLabel.slice(0, 40) : '';
    const rechtsLabel = typeof s.rechtsLabel === 'string' ? s.rechtsLabel.slice(0, 40) : '';
    const punkte = Number.isFinite(s.punkte) ? clamp(Math.round(s.punkte), 1, 100000) : 100;
    const paare = Array.isArray(s.paare)
      ? s.paare.map(normPair).filter(Boolean).slice(0, 100) : [];
    return { titel, linksLabel, rechtsLabel, punkte, mischen: !!s.mischen, paare };
  }
  if (game === 'dq') {
    const intro = typeof s.intro === 'string' ? s.intro.slice(0, 80) : '';
    const startPunkte = Number.isFinite(s.startPunkte) ? clamp(Math.round(s.startPunkte), 10, 1000000) : 100;
    let minPunkte = Number.isFinite(s.minPunkte) ? clamp(Math.round(s.minPunkte), 0, startPunkte) : Math.min(20, startPunkte);
    const abzugProHinweis = Number.isFinite(s.abzugProHinweis) ? clamp(Math.round(s.abzugProHinweis), 0, 1000000) : 20;
    const faelle = Array.isArray(s.faelle)
      ? s.faelle.map(normCase).filter(Boolean).slice(0, 100) : [];
    return { intro, buzzerModus: !!s.buzzerModus, startPunkte, minPunkte, abzugProHinweis, mischen: !!s.mischen, faelle };
  }
  if (game === 'sq') {
    const intro = typeof s.intro === 'string' ? s.intro.slice(0, 80) : '';
    const punkteModus = s.punkteModus === 'rang' ? 'rang' : 'formel';
    const maxPunkte = Number.isFinite(s.maxPunkte) ? clamp(Math.round(s.maxPunkte), 1, 1000000) : 100;
    const nullBeiProzent = Number.isFinite(s.nullBeiProzent) ? clamp(Math.round(s.nullBeiProzent), 1, 100000) : 100;
    const rangPunkte = typeof s.rangPunkte === 'string' ? s.rangPunkte.slice(0, 200)
      : (Array.isArray(s.rangPunkte) ? s.rangPunkte.join(', ').slice(0, 200) : '5, 3, 2, 1');
    const nurBesteAnzahl = Number.isFinite(s.nurBesteAnzahl) ? clamp(Math.round(s.nurBesteAnzahl), 0, 1000) : 3;
    const fragen = Array.isArray(s.fragen)
      ? s.fragen.map(normEstQuestion).filter(Boolean).slice(0, 100) : [];
    return { intro, punkteModus, maxPunkte, nullBeiProzent, rangPunkte, nurBesteAktiv: !!s.nurBesteAktiv, nurBesteAnzahl, shuffleQuestions: !!s.shuffleQuestions, fragen };
  }
  if (game === 'aq') {
    const intro = typeof s.intro === 'string' ? s.intro.slice(0, 80) : '';
    const startPunkte = Number.isFinite(s.startPunkte) ? clamp(Math.round(s.startPunkte), 10, 1000000) : 100;
    let minPunkte = Number.isFinite(s.minPunkte) ? clamp(Math.round(s.minPunkte), 0, startPunkte) : Math.min(20, startPunkte);
    const abzugProStufe = Number.isFinite(s.abzugProStufe) ? clamp(Math.round(s.abzugProStufe), 0, 1000000) : 20;
    const runden = Array.isArray(s.runden)
      ? s.runden.map(normAudioRound).filter(Boolean).slice(0, 100) : [];
    return { intro, buzzerModus: !!s.buzzerModus, mehrfachBuzzer: !!s.mehrfachBuzzer, startPunkte, minPunkte, abzugProStufe, mischen: !!s.mischen, runden };
  }
  if (game === 'ro') {
    const intro = typeof s.intro === 'string' ? s.intro.slice(0, 80) : '';
    const punkteModus = s.punkteModus === 'paare' ? 'paare' : 'alles';
    const punkte = Number.isFinite(s.punkte) ? clamp(Math.round(s.punkte), 1, 100000) : 100;
    const fragen = Array.isArray(s.fragen)
      ? s.fragen.map(normRoQuestion).filter(Boolean).slice(0, 100) : [];
    return { intro, punkteModus, punkte, shuffleQuestions: !!s.shuffleQuestions, fragen };
  }
  if (game === 'zm') {
    const intro = typeof s.intro === 'string' ? s.intro.slice(0, 80) : '';
    const maxPunkte = Number.isFinite(s.maxPunkte) ? clamp(Math.round(s.maxPunkte), 1, 100000) : 100;
    const zeitlimit = Number.isFinite(s.zeitlimit) ? clamp(Math.round(s.zeitlimit), 0, 1800) : 60;
    let begriffe = [];
    if (Array.isArray(s.begriffe)) begriffe = s.begriffe;
    else if (typeof s.begriffe === 'string') begriffe = s.begriffe.split('\n');
    begriffe = begriffe.map(normBegriff).filter(Boolean).slice(0, 300);
    return { intro, maxPunkte, zeitlimit, mischen: !!s.mischen, begriffe };
  }
  if (game === 'bild') return normBildProfile(s);
  return {};
}

module.exports = { onAdmin, activateGame, activatePlaylistStep, sanitizeProfile };
