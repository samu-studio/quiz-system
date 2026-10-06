'use strict';
/*
 * Schätzquiz: Spieler schaetzen eine Zahl; Punkte entweder nach Formel (Naehe
 * zur Loesung) oder nach Rang (Punkte-Staffel je Platzierung).
 */
const { config } = require('../config');
const { game, publicPlayer, recordScore } = require('../state');
const { shuffle, parseRangPunkte } = require('../util');
const bus = require('../bus');

function normEstQuestion(it) {
  if (!it || typeof it !== 'object') return null;
  const q = typeof it.q === 'string' ? it.q.trim().slice(0, 200) : '';
  const loesung = Number(it.loesung);
  if (!q || !Number.isFinite(loesung)) return null;
  const einheit = typeof it.einheit === 'string' ? it.einheit.trim().slice(0, 20) : '';
  // null/'' bleiben null (Number(null) waere 0!) – nur echte Zahlen uebernehmen.
  let min = (it.min == null || it.min === '') ? null : Number(it.min);
  if (min !== null && !Number.isFinite(min)) min = null;
  let max = (it.max == null || it.max === '') ? null : Number(it.max);
  if (max !== null && !Number.isFinite(max)) max = null;
  let step = (it.step == null || it.step === '') ? null : Number(it.step);
  if (step !== null && (!Number.isFinite(step) || step <= 0)) step = null;
  if (min === null || max === null || max <= min) { min = null; max = null; step = null; }
  return { q, loesung, einheit, min, max, step };
}

function activeSqCfg() {
  const g = config.games.sq || {};
  const prof = (g.profiles && g.profiles[g.activeProfile]) || {};
  const intro = typeof prof.intro === 'string' ? prof.intro : '';
  const punkteModus = prof.punkteModus === 'rang' ? 'rang' : 'formel';
  const maxPunkte = Number.isFinite(prof.maxPunkte) ? prof.maxPunkte : 100;
  let nullBeiProzent = Number.isFinite(prof.nullBeiProzent) ? prof.nullBeiProzent : 100;
  if (nullBeiProzent < 1) nullBeiProzent = 1;
  const rangPunkte = parseRangPunkte(prof.rangPunkte != null ? prof.rangPunkte : '5, 3, 2, 1');
  const fragen = Array.isArray(prof.fragen) ? prof.fragen.map(normEstQuestion).filter(Boolean) : [];
  const nurBesteAnzahl = Number.isFinite(prof.nurBesteAnzahl) ? Math.max(0, Math.round(prof.nurBesteAnzahl)) : 3;
  return {
    intro,
    punkteModus,
    maxPunkte,
    nullBeiProzent,
    rangPunkte: rangPunkte.length ? rangPunkte : [3, 2, 1],
    nurBesteAktiv: !!prof.nurBesteAktiv,
    nurBesteAnzahl,
    shuffleQuestions: !!prof.shuffleQuestions,
    fragen
  };
}

// Laufzeitzustand auf Lobby zuruecksetzen (nichts gestartet). Punkte bleiben.
function initSq() {
  game.sq = { qOrder: [], pos: -1, phase: 'lobby', answers: {}, results: [] };
}

// Aktuelle Schätzfrage (aus der ggf. gemischten Reihenfolge) oder null.
function sqCurrentQuestion() {
  const cfg = activeSqCfg();
  return cfg.fragen[game.sq.qOrder[game.sq.pos]] || null;
}

// Prozentuale Abweichung einer Schätzung von der Loesung (als Bruch, 0 = perfekt).
function sqDeviation(guess, answer) {
  return Math.abs(guess - answer) / Math.max(Math.abs(answer), 1e-9);
}

// Formel-Punkte einer einzelnen Schätzung: maxPunkte × (1 − Abweichung/Grenze),
// linear bis 0 an der konfigurierten Null-Abweichung. Boden 0.
function sqFormelPunkte(cfg, dev) {
  const grenze = cfg.nullBeiProzent / 100;    // Abweichung (als Bruch), ab der es 0 gibt
  const p = cfg.maxPunkte * (1 - dev / grenze);
  return Math.max(0, Math.round(p));
}

// Quiz starten: Reihenfolge festlegen (optional gemischt), erste Frage zeigen.
function sqStart() {
  const cfg = activeSqCfg();
  if (cfg.fragen.length === 0) return;
  let order = cfg.fragen.map((_, i) => i);
  if (cfg.shuffleQuestions) order = shuffle(order);
  game.sq.qOrder = order;
  game.sq.pos = 0;
  game.sq.phase = 'question';
  game.sq.answers = {};
  game.sq.results = [];
  bus.broadcast();
}

// Aktuelle Frage aufloesen: Punkte je nach Modus berechnen, gutschreiben und die
// (nach Naehe sortierte) Ergebnisliste fuer Bildschirm/Spieler aufbauen.
function sqReveal() {
  if (game.sq.phase !== 'question') return;
  const cfg = activeSqCfg();
  const q = sqCurrentQuestion();
  let results = [];
  if (q) {
    const entries = Object.entries(game.sq.answers).map(([id, value]) => ({
      id, value, dev: sqDeviation(value, q.loesung), pts: 0
    }));
    if (cfg.punkteModus === 'rang') {
      // Nach Abweichung sortieren; Punkte aus der Staffel. Gleiche Abweichung =
      // gleicher Platz (Standard-Wettkampf-Ranking: 1,2,2,4 …).
      entries.sort((a, b) => a.dev - b.dev);
      let i = 0;
      while (i < entries.length) {
        let j = i;
        while (j + 1 < entries.length && entries[j + 1].dev === entries[i].dev) j++;
        const pts = cfg.rangPunkte[i] != null ? cfg.rangPunkte[i] : 0;
        for (let k = i; k <= j; k++) entries[k].pts = pts;
        i = j + 1;
      }
    } else {
      // Formel: jeder unabhaengig nach seiner Abweichung.
      for (const e of entries) e.pts = sqFormelPunkte(cfg, e.dev);
    }
    if (cfg.nurBesteAktiv) {
      // Nur die besten X bekommen Punkte (0 = niemand). Platz wie im Rang-Modus
      // (1,2,2,4 …): wer gleichauf an der Grenze liegt, behaelt seine Punkte.
      entries.sort((a, b) => a.dev - b.dev);
      for (let i = 0; i < entries.length; i++) {
        let platz = i;
        while (platz > 0 && entries[platz - 1].dev === entries[i].dev) platz--;
        if (platz >= cfg.nurBesteAnzahl) entries[i].pts = 0;
      }
    }
    for (const e of entries) {
      if (e.pts > 0) recordScore(e.id, e.pts, { game: 'sq', dev: e.dev });
    }
    entries.sort((a, b) => a.dev - b.dev);   // beste Schätzung zuerst (Anzeige)
    results = entries;
  }
  game.sq.results = results;
  game.sq.phase = 'reveal';
  bus.broadcast();
}

// Weiter: naechste Frage bzw. -> Endstand (done).
function sqNext() {
  if (game.sq.phase !== 'question' && game.sq.phase !== 'reveal') return;
  if (game.sq.pos + 1 >= game.sq.qOrder.length) {
    game.sq.phase = 'done';
    bus.broadcast();
    return;
  }
  game.sq.pos++;
  game.sq.phase = 'question';
  game.sq.answers = {};
  game.sq.results = [];
  bus.broadcast();
}

// Oeffentliche (maskierte) Schätzquiz-Sicht fuer Spieler/Bildschirm. In der
// Fragephase kommt nur Frage + Einheit + Slider-Grenzen (Loesung NICHT); erst beim
// Aufloesen kommen loesung + Ergebnisliste (Namen sind dann ohnehin oeffentlich).
function publicSq() {
  const cfg = activeSqCfg();
  const sq = game.sq;
  const out = {
    phase: sq.phase,
    intro: cfg.intro,
    punkteModus: cfg.punkteModus,
    total: sq.qOrder.length || cfg.fragen.length,
    number: sq.pos + 1,
    answeredCount: Object.keys(sq.answers).length
  };
  if (sq.phase === 'question' || sq.phase === 'reveal') {
    const q = sqCurrentQuestion();
    if (q) {
      out.question = q.q;
      out.einheit = q.einheit;
      out.min = q.min;
      out.max = q.max;
      out.step = q.step;
      if (sq.phase === 'reveal') {
        out.loesung = q.loesung;
        out.results = sq.results.map((r) => Object.assign(publicPlayer(r.id), { value: r.value, dev: r.dev, pts: r.pts }));
      }
    }
  }
  return out;
}


module.exports = {
  activeSqCfg, normEstQuestion, parseRangPunkte, initSq, sqCurrentQuestion,
  sqDeviation, sqFormelPunkte, sqStart, sqReveal, sqNext, publicSq
};
