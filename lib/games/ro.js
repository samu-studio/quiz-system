'use strict';
/*
 * Reihenfolge-Quiz: Spieler bringen eine Liste von Kaertchen per Drag & Drop in
 * die richtige Reihenfolge. Kein Buzzer/Wettrennen – jeder sortiert selbst,
 * die eigene Reihenfolge ist bis zur Aufloesung frei aenderbar (kein Lock-in).
 * Punkte-Modus je Profil waehlbar: "alles" (nur bei 100% richtiger Reihenfolge)
 * oder "paare" (Teilpunkte nach Anzahl richtig aufeinanderfolgender Paare).
 */
const { config } = require('../config');
const { game, publicPlayer, recordScore } = require('../state');
const { shuffle } = require('../util');
const bus = require('../bus');

function normRoQuestion(it) {
  if (!it || typeof it !== 'object') return null;
  const frage = typeof it.frage === 'string' ? it.frage.trim().slice(0, 200) : '';
  const items = Array.isArray(it.items)
    ? it.items.map((s) => String(s != null ? s : '').trim().slice(0, 80)).filter(Boolean).slice(0, 20)
    : [];
  if (!frage || items.length < 2) return null;
  return { frage, items };
}

function activeRoCfg() {
  const g = config.games.ro || {};
  const prof = (g.profiles && g.profiles[g.activeProfile]) || {};
  const intro = typeof prof.intro === 'string' ? prof.intro : '';
  const punkteModus = prof.punkteModus === 'paare' ? 'paare' : 'alles';
  const punkte = Number.isFinite(prof.punkte) ? prof.punkte : 100;
  const fragen = Array.isArray(prof.fragen) ? prof.fragen.map(normRoQuestion).filter(Boolean) : [];
  return { intro, punkteModus, punkte, shuffleQuestions: !!prof.shuffleQuestions, fragen };
}

// Laufzeitzustand auf Lobby zuruecksetzen (nichts gestartet). Punkte bleiben.
function initRo() {
  game.ro = { qOrder: [], pos: -1, phase: 'lobby', correctOrder: [], shown: [], groupPick: null, answers: {}, results: [] };
}

// Aktuelle Frage (aus der ggf. gemischten Reihenfolge) oder null.
function roCurrentQuestion() {
  const cfg = activeRoCfg();
  return cfg.fragen[game.ro.qOrder[game.ro.pos]] || null;
}

// Board der aktuellen Frage aufbauen: stabile ids in der RICHTIGEN Reihenfolge
// (correctOrder, nie vor der Aufloesung an Spieler/Bildschirm gesendet) plus die
// Anzeigereihenfolge (shown, gemischt) – identisch fuer alle Empfaenger, damit
// niemand aus der id-Nummerierung auf die Loesung schliessen kann.
function loadRoQuestion() {
  const q = roCurrentQuestion();
  if (!q) { game.ro.correctOrder = []; game.ro.shown = []; return; }
  const items = q.items.map((text, i) => ({ id: 'I' + i, text }));
  game.ro.correctOrder = items.map((it) => it.id);
  const indices = items.map((_, i) => i);
  // Neu mischen, falls der Zufall zufaellig genau die Loesung trifft (bei wenigen
  // Elementen nicht unwahrscheinlich) - die Startanzeige darf nie schon geloest sein.
  // normRoQuestion() garantiert mind. 2 Elemente, es gibt also immer >= 2 Permutationen.
  let order;
  do {
    order = shuffle(indices);
  } while (order.every((i, pos) => i === indices[pos]));
  game.ro.shown = order.map((i) => items[i]);
}

// Anzahl aufeinanderfolgender Paare der eingereichten Reihenfolge, die auch in
// der Loesung in genau dieser Reihenfolge benachbart sind (fuer den Punkte-
// Modus "paare").
function roCorrectPairsCount(order, correctOrder) {
  const idxInCorrect = {};
  correctOrder.forEach((id, i) => { idxInCorrect[id] = i; });
  let count = 0;
  for (let i = 0; i + 1 < order.length; i++) {
    const a = order[i], b = order[i + 1];
    if (idxInCorrect[a] != null && idxInCorrect[b] === idxInCorrect[a] + 1) count++;
  }
  return count;
}

function roIsExact(order, correctOrder) {
  return order.length === correctOrder.length && order.every((id, i) => id === correctOrder[i]);
}

// Punkte einer eingereichten Reihenfolge nach dem konfigurierten Modus.
function roPointsFor(cfg, order, correctOrder) {
  if (!Array.isArray(order) || order.length !== correctOrder.length) return 0;
  if (cfg.punkteModus === 'alles') return roIsExact(order, correctOrder) ? cfg.punkte : 0;
  const total = correctOrder.length - 1;
  if (total <= 0) return 0;
  return Math.round(cfg.punkte * roCorrectPairsCount(order, correctOrder) / total);
}

// Quiz starten: Reihenfolge der Fragen festlegen (optional gemischt), erste
// Frage aufbauen und zeigen.
function roStart() {
  const cfg = activeRoCfg();
  if (cfg.fragen.length === 0) return;
  let order = cfg.fragen.map((_, i) => i);
  if (cfg.shuffleQuestions) order = shuffle(order);
  game.ro.qOrder = order;
  game.ro.pos = 0;
  game.ro.phase = 'question';
  game.ro.answers = {};
  game.ro.results = [];
  game.ro.groupPick = null;
  loadRoQuestion();
  bus.broadcast();
}

// Nicht an einen Teilnehmer gebundene "Allgemeinheit einigt sich auf ..."-Wahl:
// der Master zieht live eine komplette Reihenfolge zurecht (aenderbar bis zur
// Aufloesung), fuer den Nur-Master-Modus ohne Punktevergabe – reine Anzeigefunktion.
function roSetGroupPick(order) {
  if (game.ro.phase !== 'question') return;
  if (!Array.isArray(order)) return;
  const shownIds = game.ro.shown.map((it) => it.id);
  const cleaned = order.map((x) => String(x));
  if (cleaned.length !== shownIds.length) return;
  const validSet = new Set(shownIds);
  if (new Set(cleaned).size !== cleaned.length || !cleaned.every((id) => validSet.has(id))) return;
  game.ro.groupPick = cleaned;
  bus.broadcast();
}

// Aufloesen: jede eingereichte Reihenfolge bewerten und Punkte gutschreiben.
function roReveal() {
  if (game.ro.phase !== 'question') return;
  const cfg = activeRoCfg();
  const correctOrder = game.ro.correctOrder;
  const results = [];
  for (const [id, order] of Object.entries(game.ro.answers)) {
    const pts = roPointsFor(cfg, order, correctOrder);
    results.push({ id, order, pts, exact: roIsExact(order, correctOrder) });
    if (pts > 0) recordScore(id, pts, { game: 'ro' });
  }
  game.ro.results = results;
  game.ro.phase = 'reveal';
  bus.broadcast();
}

// Weiter: naechste Frage bzw. -> Endstand (done).
function roNext() {
  if (game.ro.phase !== 'question' && game.ro.phase !== 'reveal') return;
  if (game.ro.pos + 1 >= game.ro.qOrder.length) {
    game.ro.phase = 'done';
    bus.broadcast();
    return;
  }
  game.ro.pos++;
  game.ro.phase = 'question';
  game.ro.answers = {};
  game.ro.results = [];
  game.ro.groupPick = null;
  loadRoQuestion();
  bus.broadcast();
}

// Oeffentliche (maskierte) Reihenfolge-Sicht fuer Spieler/Bildschirm. Die
// Kaertchen (in Anzeigereihenfolge) sind sichtbar, die richtige Reihenfolge
// NICHT – erst beim Aufloesen kommen solution + Ergebnisliste dazu.
function publicRo() {
  const cfg = activeRoCfg();
  const ro = game.ro;
  const out = {
    phase: ro.phase,
    intro: cfg.intro,
    punkteModus: cfg.punkteModus,
    punkte: cfg.punkte,
    total: ro.qOrder.length || cfg.fragen.length,
    number: ro.pos + 1,
    answeredCount: Object.keys(ro.answers).length
  };
  if (ro.phase === 'question' || ro.phase === 'reveal') {
    const q = roCurrentQuestion();
    if (q) {
      out.frage = q.frage;
      out.items = ro.shown.map((it) => ({ id: it.id, text: it.text }));   // Anzeigereihenfolge, NICHT die Loesung
      if (ro.phase === 'question') out.groupPick = ro.groupPick;
      if (ro.phase === 'reveal') {
        out.solution = ro.correctOrder;   // ids in der richtigen Reihenfolge
        out.results = ro.results.map((r) => Object.assign(publicPlayer(r.id), { order: r.order, pts: r.pts, exact: r.exact }));
      }
    }
  }
  return out;
}

module.exports = {
  activeRoCfg, normRoQuestion, initRo, roCurrentQuestion, loadRoQuestion,
  roCorrectPairsCount, roIsExact, roPointsFor, roStart, roReveal, roNext,
  roSetGroupPick, publicRo
};
