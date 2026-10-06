'use strict';
/*
 * Zeitdruck-Spiel: wie Multiple-Choice, aber der erzielbare Punktwert faellt
 * mit der Zeit (server-seitig eingefroren, sobald der Spieler antwortet).
 */
const { config } = require('../config');
const { game, recordScore } = require('../state');
const { shuffle, normQuestion } = require('../util');
const bus = require('../bus');

function activeZdCfg() {
  const g = config.games.zd || {};
  const prof = (g.profiles && g.profiles[g.activeProfile]) || {};
  const intro = typeof prof.intro === 'string' ? prof.intro : '';
  const questions = Array.isArray(prof.questions)
    ? prof.questions.map(normQuestion).filter(Boolean) : [];
  const startPoints = Number.isFinite(prof.startPoints) ? prof.startPoints : 1000;
  const drainPerSec = Number.isFinite(prof.drainPerSec) ? prof.drainPerSec : 100;
  let minPoints = Number.isFinite(prof.minPoints) ? prof.minPoints : 100;
  if (minPoints > startPoints) minPoints = startPoints;
  return {
    intro,
    questions,
    startPoints,
    minPoints,
    drainPerSec,
    shuffleQuestions: !!prof.shuffleQuestions,
    shuffleAnswers: !!prof.shuffleAnswers
  };
}

function initZd() {
  game.zd = { qOrder: [], pos: -1, phase: 'lobby', answers: {}, answerPerm: [], groupPick: null };
}

// Aktuelle Frage vorbereiten: Antwort-Anzeigereihenfolge festlegen (optional
// gemischt) und gesammelte Antworten der Vorfrage leeren.
function loadZdQuestion() {
  const cfg = activeZdCfg();
  const qi = game.zd.qOrder[game.zd.pos];
  const q = cfg.questions[qi];
  game.zd.groupPick = null;
  if (!q) { game.zd.answerPerm = []; game.zd.answers = {}; return; }
  let perm = q.answers.map((_, i) => i);
  if (cfg.shuffleAnswers) perm = shuffle(perm);
  game.zd.answerPerm = perm;   // Anzeigeindex -> Originalindex
  game.zd.answers = {};        // clientId -> { option: Anzeigeindex, points }
}

// Nicht an einen Teilnehmer gebundene Master-Auswahl (Nur-Master-Modus): der
// Master klickt direkt auf eine Antwortzeile im Master-Panel (wie bei Multiple
// Choice). Wie bei einer echten Antwort friert der Zeitpunkt des Klicks den
// Punktwert ein; da die Wahl an keinen Teilnehmer gebunden ist, wird trotzdem
// niemandem ein Score gutgeschrieben.
function zdSetGroupPick(idx, elapsedMs) {
  if (game.zd.phase !== 'question') return;
  const i = Number(idx);
  if (!Number.isInteger(i) || i < 0 || i >= game.zd.answerPerm.length) return;
  let elapsed = Number(elapsedMs);
  if (!Number.isFinite(elapsed) || elapsed < 0) elapsed = 0;
  game.zd.groupPick = { option: i, points: zdPointsFor(activeZdCfg(), elapsed) };
  bus.broadcast();
}

// Punktwert aus verstrichener Zeit (ms) berechnen: linearer Verfall bis zum Boden.
function zdPointsFor(cfg, elapsedMs) {
  let pts = cfg.startPoints - cfg.drainPerSec * (Math.max(0, elapsedMs) / 1000);
  pts = Math.round(pts);
  if (pts < cfg.minPoints) pts = cfg.minPoints;
  if (pts > cfg.startPoints) pts = cfg.startPoints;
  return pts;
}

// Oeffentliche (maskierte) Zeitdruck-Sicht fuer Spieler/Bildschirm. In der
// Fragephase wird die richtige Antwort NICHT verraten; erst beim Aufloesen kommen
// correct-Index + Stimmverteilung dazu. Punkte-Parameter fuer den lokalen Zaehler.
function publicZd() {
  const cfg = activeZdCfg();
  const zd = game.zd;
  const out = {
    phase: zd.phase,
    intro: cfg.intro,
    // In der Lobby ist qOrder noch leer -> Fragenanzahl aus der Konfig zeigen.
    total: zd.qOrder.length || cfg.questions.length,
    number: zd.pos + 1,               // 1-basierte aktuelle Fragennummer
    answeredCount: Object.keys(zd.answers).length,
    startPoints: cfg.startPoints,
    minPoints: cfg.minPoints,
    drainPerSec: cfg.drainPerSec
  };
  if (zd.phase === 'question' || zd.phase === 'reveal') {
    const q = cfg.questions[zd.qOrder[zd.pos]];
    if (q) {
      out.question = q.q;
      out.answers = zd.answerPerm.map((oi) => q.answers[oi]);  // in Anzeigereihenfolge
      if (zd.phase === 'question') out.groupPick = zd.groupPick;
      if (zd.phase === 'reveal') {
        out.correct = zd.answerPerm.indexOf(q.correct);         // richtiger Anzeigeindex
        const dist = zd.answerPerm.map(() => 0);
        for (const a of Object.values(zd.answers)) {
          if (a.option >= 0 && a.option < dist.length) dist[a.option]++;
        }
        out.dist = dist;                                        // Stimmen je Anzeigeindex
      }
    }
  }
  return out;
}

function zdStart() {
  const cfg = activeZdCfg();
  if (cfg.questions.length === 0) return;
  let order = cfg.questions.map((_, i) => i);
  if (cfg.shuffleQuestions) order = shuffle(order);
  game.zd.qOrder = order;
  game.zd.pos = 0;
  game.zd.phase = 'question';
  loadZdQuestion();
  bus.broadcast();
}

// Aktuelle Frage aufloesen: richtige Antwort zeigen und jedem Spieler mit korrekter
// Wahl seinen eingefrorenen (zeitabhaengigen) Punktwert gutschreiben.
function zdReveal() {
  if (game.zd.phase !== 'question') return;
  const cfg = activeZdCfg();
  const q = cfg.questions[game.zd.qOrder[game.zd.pos]];
  if (q) {
    const correctDisplay = game.zd.answerPerm.indexOf(q.correct);
    for (const [id, a] of Object.entries(game.zd.answers)) {
      if (a.option === correctDisplay) recordScore(id, a.points, { game: 'zd' });
    }
  }
  game.zd.phase = 'reveal';
  bus.broadcast();
}

// Weiter: zur naechsten Frage; nach der letzten -> Endstand (done). Aus der
// Fragephase heraus zaehlt das als Ueberspringen (ohne Punkte).
function zdNext() {
  if (game.zd.phase !== 'question' && game.zd.phase !== 'reveal') return;
  if (game.zd.pos + 1 >= game.zd.qOrder.length) {
    game.zd.phase = 'done';
    bus.broadcast();
    return;
  }
  game.zd.pos++;
  game.zd.phase = 'question';
  loadZdQuestion();
  bus.broadcast();
}


module.exports = { activeZdCfg, initZd, loadZdQuestion, zdPointsFor, publicZd, zdStart, zdReveal, zdNext, zdSetGroupPick };
