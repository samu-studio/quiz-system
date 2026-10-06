'use strict';
/*
 * Gluecksrad (Fun-Pannel, generisch, spielunabhaengig – Laufzeitzustand; Modus +
 * Freitexte werden zusaetzlich in config.fun gespeichert).
 * Der Master befuellt das Rad entweder mit ausgewaehlten Spielern (mode 'players',
 * gespeichert als clientIds, Name/Avatar/Farbe werden live aufgeloest) oder mit
 * Freitext-Eintraegen (mode 'text'). Der Server ist autoritativ: er lost beim
 * Drehen den Gewinner aus und schickt dem Bildschirm nur Ziel-Segment, Versatz
 * im Segment und Umdrehungen – der Bildschirm animiert, das Ergebnis steht vorher fest.
 */
const bus = require('./bus');
const { clamp } = require('./util');
const { participants, game, publicPlayer } = require('./state');
const { config, saveConfig, sanitizeWheelTexts, WHEEL_MAX_ENTRIES } = require('./config');

let spinTimer = null;

function wheelPlayerIds() {
  return game.wheel.playerIds.filter((id) => { const p = participants.get(id); return p && p.role === 'player'; });
}

// Aktuelle Rad-Eintraege, aufgeloest: [{ label, avatar?, color?, id? }].
function wheelEntries() {
  const w = game.wheel;
  if (w.mode === 'players') {
    return wheelPlayerIds().map((id) => { const pp = publicPlayer(id); return { id, label: pp.name, avatar: pp.avatar, color: pp.color }; });
  }
  return w.texts.map((t) => ({ label: t }));
}

function wheelSetVisible(on) {
  game.wheel.visible = !!on;
}

// Eintraege setzen (waehrend des Drehens gesperrt, sonst wuerde das Ziel-Segment verrutschen).
function wheelSetEntries(msg) {
  const w = game.wheel;
  if (w.spinning) return;
  if (msg.mode === 'players' || msg.mode === 'text') w.mode = msg.mode;
  if (Array.isArray(msg.texts)) w.texts = sanitizeWheelTexts(msg.texts);
  if (Array.isArray(msg.playerIds)) {
    w.playerIds = [...new Set(msg.playerIds.map(String))].filter((id) => participants.has(id)).slice(0, WHEEL_MAX_ENTRIES);
  }
  w.winner = null;
  // Modus + Freitexte ueberleben einen Neustart (Spielerauswahl nicht, s. config.fun).
  config.fun.wheelMode = w.mode;
  config.fun.wheelTexts = w.texts.slice();
  saveConfig();
}

function wheelSpin(durationSec) {
  const w = game.wheel;
  const entries = wheelEntries();
  if (w.spinning || entries.length === 0) return;
  const idx = Math.floor(Math.random() * entries.length);
  w.visible = true;
  w.spinning = true;
  w.token += 1;
  w.winner = null;
  w.spin = {
    count: entries.length,
    index: idx,
    offset: 0.15 + Math.random() * 0.7,          // Zeiger landet nicht auf einer Segmentgrenze
    turns: 5 + Math.floor(Math.random() * 4),
    durationMs: Math.round(clamp(Number(durationSec) || 6, 2, 20) * 1000)
  };
  w.frozen = entries;                            // Segmente waehrend der Drehung einfrieren
  w.pendingWinner = entries[idx];
  if (spinTimer) clearTimeout(spinTimer);
  spinTimer = setTimeout(() => {
    spinTimer = null;
    w.spinning = false;
    w.winner = w.pendingWinner;
    w.pendingWinner = null;
    bus.broadcast();
  }, w.spin.durationMs + 200);
}

// Gewinner aus dem Rad nehmen (z.B. „jeder nur einmal dran").
function wheelRemoveWinner() {
  const w = game.wheel;
  if (w.spinning || !w.winner) return;
  if (w.mode === 'players') w.playerIds = w.playerIds.filter((id) => id !== w.winner.id);
  else {
    const i = w.texts.indexOf(w.winner.label);
    if (i >= 0) w.texts.splice(i, 1);
  }
  w.winner = null;
}

// Fuer Bildschirm + Master (Spieler bekommen das Rad nicht).
function wheelPublic() {
  const w = game.wheel;
  return {
    visible: w.visible,
    mode: w.mode,
    entries: w.spinning ? w.frozen : wheelEntries(),
    spinning: w.spinning,
    token: w.token,
    spin: w.spin,
    winner: w.winner
  };
}

// Nur Master: Rohdaten fuer die Editor-Felder im Fun-Tab.
function wheelAdmin() {
  return { texts: game.wheel.texts.slice(), playerIds: wheelPlayerIds() };
}

module.exports = { wheelSetVisible, wheelSetEntries, wheelSpin, wheelRemoveWinner, wheelPublic, wheelAdmin, WHEEL_MAX_ENTRIES };
