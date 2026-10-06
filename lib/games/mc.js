'use strict';
/*
 * Multiple-Choice-Spiel: Master schaltet Frage fuer Frage frei, Spieler waehlen
 * eine Antwort, Master loest auf (Punkte fuer richtige Antworten).
 */
const { config } = require('../config');
const { game, recordScore } = require('../state');
const { shuffle, normQuestion } = require('../util');
const bus = require('../bus');

function activeMcCfg() {
  const g = config.games.mc || {};
  const prof = (g.profiles && g.profiles[g.activeProfile]) || {};
  const intro = typeof prof.intro === 'string' ? prof.intro : '';
  const questions = Array.isArray(prof.questions)
    ? prof.questions.map(normQuestion).filter(Boolean) : [];
  const points = Number.isFinite(prof.points) ? prof.points : 100;
  return {
    intro,
    questions,
    points,
    shuffleQuestions: !!prof.shuffleQuestions,
    shuffleAnswers: !!prof.shuffleAnswers
  };
}

// Aufgeloeste Konfiguration des aktiven Zeitdruck-Profils (inkl. Loesungen, darum

// Laufzeitzustand auf den Lobby-Zustand zuruecksetzen (nichts gestartet).
// Punkte (game.scores) bleiben bewusst erhalten – dafuer gibt es resetScores.
function initMc() {
  game.mc = { qOrder: [], pos: -1, phase: 'lobby', answers: {}, answerPerm: [], groupPick: null };
}

// Aktuelle Frage vorbereiten: Antwort-Anzeigereihenfolge festlegen (optional
// gemischt) und gesammelte Antworten der Vorfrage leeren.
function loadMcQuestion() {
  const cfg = activeMcCfg();
  const qi = game.mc.qOrder[game.mc.pos];
  const q = cfg.questions[qi];
  game.mc.groupPick = null;
  if (!q) { game.mc.answerPerm = []; game.mc.answers = {}; return; }
  let perm = q.answers.map((_, i) => i);
  if (cfg.shuffleAnswers) perm = shuffle(perm);
  game.mc.answerPerm = perm;   // Anzeigeindex -> Originalindex
  game.mc.answers = {};        // clientId -> gewaehlter Anzeigeindex
}

// Nicht an einen Teilnehmer gebundene "Allgemeinheit einigt sich auf ..."-Wahl:
// der Master klickt live eine Antwort an (aenderbar bis zur Aufloesung), fuer
// den Nur-Master-Modus ohne Punktevergabe – reine Spannungs-/Anzeigefunktion.
function mcSetGroupPick(idx) {
  if (game.mc.phase !== 'question') return;
  const i = Number(idx);
  if (!Number.isInteger(i) || i < 0 || i >= game.mc.answerPerm.length) return;
  game.mc.groupPick = i;
  bus.broadcast();
}

// Oeffentliche (maskierte) MC-Sicht fuer Spieler/Bildschirm. In der Fragephase
// wird die richtige Antwort NICHT verraten; erst in der Aufloesung kommen
// correct-Index + Stimmverteilung dazu.
function publicMc() {
  const cfg = activeMcCfg();
  const mc = game.mc;
  const out = {
    phase: mc.phase,
    intro: cfg.intro,
    // In der Lobby ist qOrder noch leer -> Fragenanzahl aus der Konfig zeigen.
    total: mc.qOrder.length || cfg.questions.length,
    number: mc.pos + 1,               // 1-basierte aktuelle Fragennummer
    answeredCount: Object.keys(mc.answers).length,
    points: cfg.points
  };
  if (mc.phase === 'question' || mc.phase === 'reveal') {
    const q = cfg.questions[mc.qOrder[mc.pos]];
    if (q) {
      out.question = q.q;
      out.answers = mc.answerPerm.map((oi) => q.answers[oi]);  // in Anzeigereihenfolge
      if (mc.phase === 'question') out.groupPick = mc.groupPick;
      if (mc.phase === 'reveal') {
        out.correct = mc.answerPerm.indexOf(q.correct);         // richtiger Anzeigeindex
        const dist = mc.answerPerm.map(() => 0);
        for (const opt of Object.values(mc.answers)) {
          if (opt >= 0 && opt < dist.length) dist[opt]++;
        }
        out.dist = dist;                                        // Stimmen je Anzeigeindex
      }
    }
  }
  return out;
}


function mcStart() {
  const cfg = activeMcCfg();
  if (cfg.questions.length === 0) return;
  let order = cfg.questions.map((_, i) => i);
  if (cfg.shuffleQuestions) order = shuffle(order);
  game.mc.qOrder = order;
  game.mc.pos = 0;
  game.mc.phase = 'question';
  loadMcQuestion();
  bus.broadcast();
}

// Aktuelle Frage aufloesen: richtige Antwort zeigen und allen Spielern mit
// korrekter Wahl die Punkte gutschreiben (einmalig pro Frage).
function mcReveal() {
  if (game.mc.phase !== 'question') return;
  const cfg = activeMcCfg();
  const q = cfg.questions[game.mc.qOrder[game.mc.pos]];
  if (q) {
    const correctDisplay = game.mc.answerPerm.indexOf(q.correct);
    for (const [id, opt] of Object.entries(game.mc.answers)) {
      if (opt === correctDisplay) recordScore(id, cfg.points, { game: 'mc' });
    }
  }
  game.mc.phase = 'reveal';
  bus.broadcast();
}

// Weiter: zur naechsten Frage springen; nach der letzten -> Endstand (done).
// Aus der Fragephase heraus zaehlt das als Ueberspringen (ohne Punkte).
function mcNext() {
  if (game.mc.phase !== 'question' && game.mc.phase !== 'reveal') return;
  if (game.mc.pos + 1 >= game.mc.qOrder.length) {
    game.mc.phase = 'done';
    bus.broadcast();
    return;
  }
  game.mc.pos++;
  game.mc.phase = 'question';
  loadMcQuestion();
  bus.broadcast();
}


module.exports = { activeMcCfg, initMc, loadMcQuestion, publicMc, mcStart, mcReveal, mcNext, mcSetGroupPick };
