'use strict';
/*
 * Persistiert Teilnehmer-Identitaeten + Punktestand + den Rundenzustand des
 * gerade aktiven Spiels ueber einen Server-Neustart hinweg (state.json neben
 * config.json) - damit ein versehentlicher Absturz/Neustart nicht den ganzen
 * Punktestand UND Spielfortschritt eines Abends verwirft. Gesichert wird nur
 * das aktive Spiel (game[ROUND_STATE_KEY[activeGame]] bzw. die entsprechenden
 * game.*-Felder bei Reaktion); andere, gerade inaktive Spiele starten beim
 * naechsten Wechsel dorthin ohnehin frisch in der Lobby.
 *
 * Reconnect braucht dafuer keine Aenderung: der Client schickt nach einem
 * Neustart weiterhin seine alte clientId (aus localStorage) per "hello" -
 * onHello() (lib/handlers/connection.js) findet sie dann einfach schon in
 * `participants` vor (aus state.json geladen) und haengt die Verbindung wie
 * bei jedem normalen Reconnect wieder ein.
 */
const fs = require('fs');
const path = require('path');
const bus = require('./bus');
const { clampScore } = require('./util');
const { config } = require('./config');
const { participants, game } = require('./state');

const STATE_PATH = path.join(__dirname, '..', 'state.json');
const SAVE_DELAY_MS = 500;

// Spiel-Id -> Schluessel des Rundenzustands in `game` (Reaktion liegt flach
// auf `game` selbst, s. buildRoundState()).
const ROUND_STATE_KEY = {
  wordlist: 'wl', mc: 'mc', zd: 'zd', fw: 'fw', tf: 'tf', zu: 'zu', dq: 'dq', sq: 'sq', aq: 'aq', bild: 'bild'
};

let saveTimer = null;
let pendingRound = null;   // aus state.json geladener Rundenzustand, bis restoreRound() ihn abholt

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, SAVE_DELAY_MS);
}

// Rundenzustand des gerade aktiven Spiels fuer state.json aufbereiten (oder
// null bei Standby/unbekanntem Spiel). Bei Reaktion kommt der Zustand nicht
// aus einem game.<key>-Unterobjekt, sondern aus einzelnen game.*-Feldern.
function buildRoundState() {
  const gid = config.activeGame;
  if (gid === 'none') return null;
  const gcfg = config.games[gid];
  const profile = gcfg ? gcfg.activeProfile : null;
  if (gid === 'reaction') {
    return { game: gid, profile, data: { phase: game.phase, roundId: game.roundId, round: game.round, results: game.results } };
  }
  const key = ROUND_STATE_KEY[gid];
  if (!key || !game[key]) return null;
  return { game: gid, profile, data: game[key] };
}

function saveNow() {
  const data = {
    participants: [...participants.values()].map((p) => ({
      id: p.id, role: p.role, name: p.name, avatar: p.avatar || null, color: p.color || null, local: !!p.local
    })),
    scores: game.scores,
    playerTeam: game.playerTeam,
    round: buildRoundState()
  };
  try { fs.writeFileSync(STATE_PATH, JSON.stringify(data)); } catch (e) { /* ignore */ }
}

// Beim Start: Teilnehmer/Punkte/Team-Zuordnung aus einem vorherigen Lauf
// wiederherstellen (Aufruf VOR dem Start des WebSocket-Servers, damit die
// erste "hello"-Nachricht nach einem Neustart schon auf den vorhandenen
// Teilnehmer trifft statt einen neuen anzulegen).
function loadPersisted() {
  let data;
  try { data = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch (e) { return; }
  if (!data || typeof data !== 'object') return;

  for (const p of Array.isArray(data.participants) ? data.participants : []) {
    if (!p || typeof p.id !== 'string' || !p.id) continue;
    const local = !!p.local;
    participants.set(p.id, {
      id: p.id,
      role: ['screen', 'master', 'player'].includes(p.role) ? p.role : 'player',
      name: String(p.name || '').slice(0, 24) || 'Spieler',
      avatar: p.avatar || null,
      color: p.color || null,
      local,
      online: local,   // lokale Master-Stand-ins bleiben dauerhaft online, echte Geraete erst nach Reconnect
      conn: null
    });
  }
  if (data.scores && typeof data.scores === 'object') {
    for (const [id, v] of Object.entries(data.scores)) game.scores[id] = clampScore(v);
  }
  if (data.playerTeam && typeof data.playerTeam === 'object') {
    for (const [id, tid] of Object.entries(data.playerTeam)) {
      if (typeof tid === 'string') game.playerTeam[id] = tid;
    }
  }
  if (data.round && typeof data.round === 'object') pendingRound = data.round;
}

// Fuer ein bestimmtes Spiel den geladenen Rundenzustand abholen – nur wenn er
// wirklich zu diesem Spiel UND dessen gerade aktivem Profil gehoert (sonst
// koennten z. B. Fragen-Indizes nicht mehr zur (inzwischen geaenderten)
// Konfiguration passen). Wird waehrend des Server-Starts je Spiel genau einmal
// aufgerufen (s. server.js); danach ist pendingRound verbraucht.
function takeRoundState(gameId) {
  if (!pendingRound || pendingRound.game !== gameId) return null;
  const gcfg = config.games[gameId];
  const profile = gcfg ? gcfg.activeProfile : null;
  if (pendingRound.profile !== profile) return null;
  const data = pendingRound.data;
  pendingRound = null;
  return data;
}

// Ausstehendes Debounce-Speichern sofort ausfuehren (fuer sauberes Beenden)
function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  saveNow();
}

bus.onChange(scheduleSave);

module.exports = { loadPersisted, flushSave, takeRoundState };
