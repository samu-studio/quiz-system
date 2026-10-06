'use strict';
/*
 * Reaktionsspiel: einfachstes Spiel, hat keinen eigenen game.<x>-Unterzustand
 * (nur game.phase/results/scores/round, die schon in state.js stehen).
 */
const { config } = require('../config');
const { game, participants, recordScore } = require('../state');
const { parseRangPunkte } = require('../util');
const bus = require('../bus');

let autoGoTimer = null;

function activeReactionCfg() {
  const g = config.games.reaction || {};
  const prof = (g.profiles && g.profiles[g.activeProfile]) || {};
  const cfg = Object.assign({ autoGo: false, autoDelayMin: 1500, autoDelayMax: 4000, rangPunkte: '3, 2, 1' }, prof);
  const rangPunkte = parseRangPunkte(cfg.rangPunkte);
  cfg.rangPunkte = rangPunkte.length ? rangPunkte : [3, 2, 1];
  return cfg;
}

function clearAutoGo() {
  if (autoGoTimer) { clearTimeout(autoGoTimer); autoGoTimer = null; }
}

function armRound() {
  clearAutoGo();
  game.phase = 'armed';
  game.roundId++;
  game.goServerTime = null;
  game.results = {};
  bus.broadcast();
  const rc = activeReactionCfg();
  if (rc.autoGo) {
    const delay = rc.autoDelayMin +
      Math.random() * (rc.autoDelayMax - rc.autoDelayMin);
    const armedRound = game.roundId;
    autoGoTimer = setTimeout(() => {
      if (game.phase === 'armed' && game.roundId === armedRound) goGreen();
    }, delay);
  }
}

// Rot -> Gelb: der Master kann die Ampel manuell weiterschalten (klassischer
// Ampelspiel-Bluff), bevor er GRUEN gibt. Auto-GRUEN bleibt unveraendert
// (springt weiter direkt von 'armed' auf 'go').
function goYellow() {
  if (game.phase !== 'armed') return;
  clearAutoGo();
  game.phase = 'yellow';
  bus.broadcast();
}

// Gelb -> zurueck zu Rot: der Bluff - Spieler, die auf GRUEN warten, muessen
// weiter warten. Wie 'armed' zaehlt ein Druck hier als Fehlstart.
function backToRed() {
  if (game.phase !== 'yellow') return;
  game.phase = 'armed';
  bus.broadcast();
}

function goGreen() {
  if (game.phase !== 'armed' && game.phase !== 'yellow') return;
  clearAutoGo();
  game.phase = 'go';
  game.goServerTime = Date.now();
  bus.broadcast();
}

function activePlayerIds() {
  const ids = [];
  for (const p of participants.values()) {
    if (p.role === 'player' && p.online) ids.push(p.id);
  }
  return ids;
}

function maybeFinish() {
  const ids = activePlayerIds();
  if (ids.length === 0) return;
  const allDone = ids.every((id) => game.results[id]);
  if (allDone) endRound();
}

function endRound() {
  clearAutoGo();
  if (game.phase === 'results') return;
  game.phase = 'results';
  // Punkte nach Platzierung (schnellste gueltige Zeit zuerst) aus der Rang-
  // Staffel vergeben. Gleiche Zeit = gleicher Platz (Standard-Wettkampf-Ranking,
  // z. B. 1,2,2,4 …), wie beim Schaetzquiz.
  const cfg = activeReactionCfg();
  const valid = Object.entries(game.results)
    .filter(([, r]) => !r.falseStart && Number.isFinite(r.reactionMs))
    .sort((a, b) => a[1].reactionMs - b[1].reactionMs);
  let i = 0;
  while (i < valid.length) {
    let j = i;
    while (j + 1 < valid.length && valid[j + 1][1].reactionMs === valid[i][1].reactionMs) j++;
    const pts = cfg.rangPunkte[i] || 0;
    for (let k = i; k <= j; k++) {
      const [id, r] = valid[k];
      r.pts = pts;
      if (pts > 0) recordScore(id, pts, { game: 'reaction', ms: r.reactionMs });
    }
    i = j + 1;
  }
  bus.broadcast();
}

function resetRound() {
  clearAutoGo();
  game.phase = 'idle';
  game.goServerTime = null;
  game.results = {};
  game.round++;
  bus.broadcast();
}


module.exports = {
  activeReactionCfg,
  clearAutoGo,
  armRound,
  goYellow,
  backToRed,
  goGreen,
  activePlayerIds,
  maybeFinish,
  endRound,
  resetRound
};
