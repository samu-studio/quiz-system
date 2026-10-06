'use strict';
/*
 * Zeichenquiz ("Kritzelquiz"): ein Begriff wird allen gleichzeitig gezeigt,
 * jeder zeichnet ihn auf einem Canvas nach (optional mit Zeitlimit). Danach
 * werden alle Zeichnungen anonym gezeigt; jeder stimmt (ausser fuer sich
 * selbst) fuer seinen Favoriten. Punkte = maxPunkte * Stimmenanteil an den
 * theoretisch moeglichen Stimmen (jeder andere Zeichner koennte stimmen) -
 * skaliert die Punkte automatisch auf die Spielerzahl der Runde.
 */
const { config } = require('../config');
const { game, publicPlayer, recordScore } = require('../state');
const { shuffle } = require('../util');
const bus = require('../bus');

function normBegriff(it) {
  if (it == null) return null;
  const t = String(it).trim().slice(0, 60);
  return t || null;
}

function activeZmCfg() {
  const g = config.games.zm || {};
  const prof = (g.profiles && g.profiles[g.activeProfile]) || {};
  const intro = typeof prof.intro === 'string' ? prof.intro : '';
  const maxPunkte = Number.isFinite(prof.maxPunkte) ? prof.maxPunkte : 100;
  const zeitlimit = Number.isFinite(prof.zeitlimit) ? Math.max(0, prof.zeitlimit) : 0;
  const begriffe = Array.isArray(prof.begriffe) ? prof.begriffe.map(normBegriff).filter(Boolean) : [];
  return { intro, maxPunkte, zeitlimit, mischen: !!prof.mischen, begriffe };
}

// Laufzeitzustand auf Lobby zuruecksetzen (nichts gestartet). Punkte bleiben.
function initZm() {
  clearZmTimer();
  game.zm = {
    order: [], pos: -1, phase: 'lobby', deadline: null,
    drawings: {},       // clientId -> Data-URL (PNG), nur im RAM, kein Datei-Schreiben
    submitted: {},       // clientId -> true (Lock-in der Abgabe)
    voteOrder: [],       // gemischte Liste der Zeichner-clientIds dieser Runde (Index = Slot beim Abstimmen)
    votes: {},           // clientId (Waehler) -> clientId (gewaehlter Autor)
    results: []          // nach Auswertung: [{...publicPlayer, image, votes, points}]
  };
}

// Aktueller Begriff (aus der ggf. gemischten Reihenfolge) oder null.
function zmCurrentBegriff(cfg) {
  cfg = cfg || activeZmCfg();
  const idx = game.zm.order[game.zm.pos];
  return (idx != null ? cfg.begriffe[idx] : null) || null;
}

// Punkte fuer eine Anzahl erhaltener Stimmen: Anteil an den theoretisch
// moeglichen Stimmen (alle anderen Zeichner dieser Runde) mal maxPunkte.
function zmPointsFor(cfg, stimmen, moeglich) {
  if (!moeglich || moeglich <= 0) return 0;
  const pts = Math.round(cfg.maxPunkte * stimmen / moeglich);
  return Math.max(0, Math.min(cfg.maxPunkte, pts));
}

// Auto-Weiterschalt-Timer (Zeitlimit einer Zeichenrunde), analog zu fw.js.
let zmTimer = null;
function clearZmTimer() { if (zmTimer) { clearTimeout(zmTimer); zmTimer = null; } }

function scheduleZmTimer(cfg) {
  clearZmTimer();
  if (cfg.zeitlimit > 0) {
    zmTimer = setTimeout(() => {
      zmTimer = null;
      if (game.zm.phase === 'drawing') zmToVoting();
    }, cfg.zeitlimit * 1000);
  }
}

// Laufzeit-Felder einer einzelnen Runde zuruecksetzen (Reihenfolge/Position
// bleiben unberuehrt, die aendert nur zmStart/zmNext).
function resetRoundState() {
  game.zm.drawings = {};
  game.zm.submitted = {};
  game.zm.voteOrder = [];
  game.zm.votes = {};
  game.zm.results = [];
}

// Quiz starten: Begriffsreihenfolge festlegen (optional gemischt), erste
// Zeichenrunde beginnen. Ohne Begriffe passiert nichts.
function zmStart() {
  const cfg = activeZmCfg();
  if (cfg.begriffe.length === 0) return;
  let order = cfg.begriffe.map((_, i) => i);
  if (cfg.mischen) order = shuffle(order);
  game.zm.order = order;
  game.zm.pos = 0;
  game.zm.phase = 'drawing';
  resetRoundState();
  game.zm.deadline = cfg.zeitlimit > 0 ? Date.now() + cfg.zeitlimit * 1000 : null;
  scheduleZmTimer(cfg);
  bus.broadcast();
}

// Zeichnung abgeben (Lock-in: nur die erste Abgabe je Spieler und Runde
// zaehlt). dataUrl ist ein komplettes `data:image/png;base64,...`.
function zmSubmit(p, dataUrl) {
  if (game.zm.phase !== 'drawing') return;
  if (game.zm.submitted[p.id]) return;
  const data = String(dataUrl || '');
  const m = data.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (!m) return;
  let buf;
  try { buf = Buffer.from(m[1], 'base64'); } catch (e) { buf = null; }
  if (!buf || buf.length === 0 || buf.length > 3 * 1024 * 1024) return; // max 3 MB
  game.zm.drawings[p.id] = data;
  game.zm.submitted[p.id] = true;
  bus.broadcast();
}

// Zeichenphase manuell (Master) oder per Zeitlimit beenden -> Abstimmung.
// Nur wer eine Zeichnung abgegeben hat, kommt in die (gemischte) Galerie.
function zmToVoting() {
  if (game.zm.phase !== 'drawing') return;
  clearZmTimer();
  game.zm.voteOrder = shuffle(Object.keys(game.zm.drawings));
  game.zm.votes = {};
  game.zm.phase = 'voting';
  bus.broadcast();
}

// Spieler-Stimme fuer eine Zeichnung (per Slot-Index in voteOrder). Keine
// Selbstwahl; die Wahl kann bis zur Auswertung beliebig oft geaendert werden
// (ueberschreibt einfach die vorherige Stimme desselben Spielers).
function zmCastVote(p, slotIdx) {
  if (game.zm.phase !== 'voting') return;
  const idx = Number(slotIdx);
  if (!Number.isInteger(idx) || idx < 0 || idx >= game.zm.voteOrder.length) return;
  const authorId = game.zm.voteOrder[idx];
  if (authorId === p.id) return;
  game.zm.votes[p.id] = authorId;
  bus.broadcast();
}

// Auswerten: Stimmen zaehlen, Punkte vergeben (eingefroren je Autor), Runde
// abschliessen.
function zmReveal() {
  if (game.zm.phase !== 'voting') return;
  const cfg = activeZmCfg();
  const authors = game.zm.voteOrder;
  const moeglich = Math.max(0, authors.length - 1);
  const counts = {};
  authors.forEach((id) => { counts[id] = 0; });
  Object.values(game.zm.votes).forEach((authorId) => {
    if (counts[authorId] != null) counts[authorId]++;
  });
  const results = authors.map((id) => {
    const stimmen = counts[id] || 0;
    const pts = zmPointsFor(cfg, stimmen, moeglich);
    if (pts > 0) recordScore(id, pts, { game: 'zm' });
    return Object.assign(publicPlayer(id), { image: game.zm.drawings[id] || null, votes: stimmen, points: pts });
  });
  results.sort((a, b) => b.votes - a.votes || b.points - a.points);
  game.zm.results = results;
  game.zm.phase = 'reveal';
  bus.broadcast();
}

// Naechster Begriff (oder Endstand nach dem letzten). Nur aus der Auswertung.
function zmNext() {
  if (game.zm.phase !== 'reveal') return;
  if (game.zm.pos + 1 >= game.zm.order.length) {
    game.zm.phase = 'done';
    bus.broadcast();
    return;
  }
  const cfg = activeZmCfg();
  game.zm.pos++;
  game.zm.phase = 'drawing';
  resetRoundState();
  game.zm.deadline = cfg.zeitlimit > 0 ? Date.now() + cfg.zeitlimit * 1000 : null;
  scheduleZmTimer(cfg);
  bus.broadcast();
}

// Oeffentliche (maskierte) Sicht fuer Spieler/Bildschirm. In der Zeichenphase
// ist der Begriff selbst kein Geheimnis (jeder zeichnet ihn); waehrend der
// Abstimmung kommt die Galerie OHNE Autor (Autor erst bei der Auswertung).
function publicZm() {
  const cfg = activeZmCfg();
  const zm = game.zm;
  const out = {
    phase: zm.phase,
    intro: cfg.intro,
    total: zm.order.length || cfg.begriffe.length,
    pos: zm.pos + 1,
    deadline: zm.deadline
  };
  if (zm.phase === 'drawing' || zm.phase === 'voting' || zm.phase === 'reveal') {
    out.begriff = zmCurrentBegriff(cfg);
  }
  if (zm.phase === 'drawing') {
    out.submittedCount = Object.keys(zm.submitted).length;
  } else if (zm.phase === 'voting') {
    out.entries = zm.voteOrder.map((id, idx) => ({ slotIdx: idx, image: zm.drawings[id] || null }));
    out.voteCount = Object.keys(zm.votes).length;
    out.voterTotal = zm.voteOrder.length;
  } else if (zm.phase === 'reveal') {
    out.results = zm.results;
  }
  return out;
}

module.exports = {
  activeZmCfg, normBegriff, initZm, zmCurrentBegriff, zmPointsFor, clearZmTimer,
  zmStart, zmSubmit, zmToVoting, zmCastVote, zmReveal, zmNext, publicZm
};
