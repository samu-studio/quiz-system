'use strict';
/*
 * Hintergrundmusik (generisch, spielunabhaengig). Abgespielt wird NUR am
 * Bildschirm; der Server haelt Playlist-Position + Play/Pause autoritativ und
 * der Bildschirm folgt dem Snapshot (s. public/js/music.js). Ein Titelwechsel
 * ist ein neues `token` – endet ein Titel, meldet der Bildschirm das per
 * `musicEnded{token}` (mehrere Bildschirme -> nur die erste Meldung zaehlt).
 *
 * Spiele koennen die Musik pausieren: waehrend ein Spiel aus MUSIC_PAUSE_ALWAYS
 * oder aus config.music.pauseGames aktiv ist, bleibt sie stumm (der Master-
 * Wunsch `playing` bleibt dabei erhalten, nach dem Spielwechsel geht es weiter).
 */
const bus = require('./bus');
const { config, saveConfig, MUSIC_REPEATS, sanitizeMusic, listMusic } = require('./config');
const { game } = require('./state');

// Spiele mit eigenem Ton – hier laeuft NIE Hintergrundmusik (nicht abwaehlbar).
const MUSIC_PAUSE_ALWAYS = ['aq'];

function tracks() { return config.music.tracks; }

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function currentTrack() {
  const m = game.music;
  return tracks()[m.order[m.pos]] || '';
}

// Abspielreihenfolge neu aufbauen (nach Playlist-Aenderung/Shuffle-Umschalten).
// `keep` = Dateiname, der aktuell laeuft – bleibt, wenn noch vorhanden, der
// aktuelle Titel (kein Neustart). Gibt true zurueck, wenn er erhalten blieb.
function rebuildOrder(keep) {
  const m = game.music;
  const idx = tracks().map((_, i) => i);
  const keepIdx = keep ? tracks().indexOf(keep) : -1;
  if (config.music.shuffle) {
    m.order = shuffled(idx);
    if (keepIdx >= 0) m.order = [keepIdx].concat(m.order.filter((i) => i !== keepIdx));
    m.pos = 0;
  } else {
    m.order = idx;
    m.pos = keepIdx >= 0 ? keepIdx : 0;
  }
  if (!m.order.length) m.playing = false;
  return keepIdx >= 0;
}

// Aktives Spiel, das die Musik gerade pausiert (oder null).
function musicBlockedBy() {
  const g = config.activeGame;
  if (g === 'none') return null;
  return (MUSIC_PAUSE_ALWAYS.includes(g) || config.music.pauseGames.includes(g)) ? g : null;
}

function musicPlay() {
  if (!game.music.order.length) return;
  game.music.playing = true;
  bus.broadcast();
}

function musicPause() {
  game.music.playing = false;
  bus.broadcast();
}

// Naechster Titel. `auto` = Titel ist von selbst zu Ende gelaufen (dann greifen
// „Titel wiederholen" und „am Ende stoppen"); ein Klick auf ⏭ springt immer weiter.
function musicNext(auto) {
  const m = game.music;
  const n = m.order.length;
  if (!n) return;
  if (auto && config.music.repeat === 'one') {
    m.token++;
  } else if (m.pos + 1 < n) {
    m.pos++;
    m.token++;
  } else {
    if (auto && config.music.repeat === 'off') m.playing = false;
    if (config.music.shuffle && n > 1) {
      // Neu mischen, aber nicht denselben Titel direkt nochmal
      const last = m.order[m.pos];
      m.order = shuffled(m.order);
      if (m.order[0] === last) m.order.push(m.order.shift());
    }
    m.pos = 0;
    m.token++;
  }
  bus.broadcast();
}

function musicPrev() {
  const m = game.music;
  const n = m.order.length;
  if (!n) return;
  m.pos = m.pos > 0 ? m.pos - 1 : n - 1;
  m.token++;
  bus.broadcast();
}

// Bestimmten Playlist-Eintrag sofort abspielen (▶ in der Playlist-Liste).
function musicGoto(index) {
  const m = game.music;
  const p = m.order.indexOf(index);
  if (p < 0) return;
  m.pos = p;
  m.token++;
  m.playing = true;
  bus.broadcast();
}

// Bildschirm meldet: Titel zu Ende (bzw. nicht abspielbar). Nur die Meldung zum
// aktuellen token zaehlt – so springen mehrere Bildschirme nicht mehrfach weiter.
function onMusicEnded(conn, msg) {
  if (conn.role !== 'screen') return;
  if (msg.token !== game.music.token || !game.music.playing) return;
  musicNext(true);
}

// Persistierte Einstellungen aendern (Playlist, Lautstaerke, Shuffle, ...).
// Laeuft der aktuelle Titel danach nicht mehr in der Playlist, wird neu geladen.
function setMusicSettings(patch) {
  const cur = currentTrack();
  const shuffleBefore = config.music.shuffle;
  config.music = sanitizeMusic(Object.assign({}, config.music, patch));
  saveConfig();
  if (patch.tracks !== undefined || config.music.shuffle !== shuffleBefore) {
    if (!rebuildOrder(cur)) game.music.token++;
  }
  bus.broadcast();
}

function setMusicVolume(v) {
  const vol = Number(v);
  if (!Number.isFinite(vol)) return;
  setMusicSettings({ volume: vol });
}

function setMusicRepeat(mode) {
  if (!MUSIC_REPEATS.includes(mode)) return;
  setMusicSettings({ repeat: mode });
}

// Datei wurde hochgeladen: ans Playlist-Ende haengen (falls noch nicht drin).
function addMusicTrack(name) {
  if (tracks().includes(name)) return;
  setMusicSettings({ tracks: tracks().concat(name) });
}

// Datei wurde geloescht: aus der Playlist nehmen (sanitizeMusic filtert gegen
// die tatsaechlich vorhandenen Dateien).
function dropMissingTracks() {
  setMusicSettings({ tracks: tracks().slice() });
}

// Anzeige-Titel aus dem Dateinamen (Endung weg, _ -> Leerzeichen).
function trackTitle(file) {
  return String(file || '').replace(/\.[^.]+$/, '').replace(/_+/g, ' ').trim();
}

// Snapshot-Teil fuer Bildschirm + Master. `audible` = der Bildschirm soll
// tatsaechlich spielen (Master-Wunsch UND kein pausierendes Spiel).
function musicPublic() {
  const m = game.music;
  const track = currentTrack();
  const blockedBy = musicBlockedBy();
  return {
    track,
    title: trackTitle(track),
    token: m.token,
    playing: m.playing,
    audible: !!(m.playing && track && !blockedBy),
    blockedBy,
    volume: config.music.volume,
    fadeMs: Math.round(config.music.fadeSec * 1000)
  };
}

// Nur Master: volle Einstellungen + Position + verfuegbare Dateien.
function musicAdmin() {
  const m = game.music;
  return Object.assign(musicPublic(), {
    tracks: tracks(),
    files: listMusic(),
    pos: m.order.length ? m.pos + 1 : 0,
    count: m.order.length,
    currentIndex: m.order.length ? m.order[m.pos] : -1,
    shuffle: config.music.shuffle,
    repeat: config.music.repeat,
    fadeSec: config.music.fadeSec,
    pauseGames: config.music.pauseGames,
    pauseAlways: MUSIC_PAUSE_ALWAYS
  });
}

// Anfangszustand aus der gespeicherten Playlist (Musik startet pausiert).
rebuildOrder('');

module.exports = {
  MUSIC_PAUSE_ALWAYS,
  musicPlay,
  musicPause,
  musicNext,
  musicPrev,
  musicGoto,
  onMusicEnded,
  setMusicSettings,
  setMusicVolume,
  setMusicRepeat,
  addMusicTrack,
  dropMissingTracks,
  musicPublic,
  musicAdmin
};
