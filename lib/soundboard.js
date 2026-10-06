'use strict';
/*
 * Soundboard (Master-Tab „🎉 Fun", generisch, spielunabhaengig). Der Master
 * tippt einen Sound an, abgespielt wird NUR am Bildschirm (dort haengen die
 * Lautsprecher). Wie der Flashbang ein fluechtiges Event – direkt an die
 * Bildschirme geschickt, kein Teil des Spielzustands (ein spaeter verbundener
 * Bildschirm soll keinen alten Sound nachspielen).
 *
 * Zwei Quellen:
 * - 'preset': mitgelieferte Sounds in public/sounds/soundboard/ (per
 *   config.soundboard.hidden ausblendbar)
 * - 'own':    eigene Uploads in public/soundboard/ (uploadSound/deleteSound im
 *   Admin-Kanal)
 */
const bus = require('./bus');
const { config, saveConfig, listSoundPresets, listSounds, sanitizeSoundboard } = require('./config');
const { participants } = require('./state');

const SOURCES = {
  preset: { list: listSoundPresets, url: '/sounds/soundboard/' },
  own: { list: listSounds, url: '/soundboard/' }
};

function sendToScreens(msg) {
  for (const p of participants.values()) {
    if (p.online && p.conn && p.role === 'screen') { try { p.conn.send(msg); } catch (e) { /* egal */ } }
  }
}

// Nur Dateien abspielen, die es in der jeweiligen Quelle wirklich gibt.
function soundboardPlay(kind, file) {
  const src = SOURCES[kind];
  if (!src || typeof file !== 'string' || !src.list().includes(file)) return;
  sendToScreens({
    type: 'soundboard',
    src: src.url + encodeURIComponent(file),
    volume: config.soundboard.volume
  });
}

function soundboardStop() {
  sendToScreens({ type: 'soundboardStop' });
}

function setSoundboardSettings(patch) {
  config.soundboard = sanitizeSoundboard(Object.assign({}, config.soundboard, patch));
  saveConfig();
  bus.broadcast();
}

// Nur Master: verfuegbare Sounds + Einstellungen.
function soundboardAdmin() {
  return {
    presets: listSoundPresets(),
    own: listSounds(),
    hidden: config.soundboard.hidden,
    volume: config.soundboard.volume
  };
}

module.exports = { soundboardPlay, soundboardStop, setSoundboardSettings, soundboardAdmin };
