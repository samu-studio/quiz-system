'use strict';
/*
 * Zuordnungs-Spiel: Spieler ordnen rechte Kaertchen den linken Slots zu
 * (inkl. „keine Verbindung" und Ablenker-Kaertchen ohne Partner).
 */
const { config } = require('../config');
const { game, recordScore } = require('../state');
const { shuffle } = require('../util');
const bus = require('../bus');

function normPair(it) {
  if (!it || typeof it !== 'object') return null;
  const links = String(it.links != null ? it.links : '').trim().slice(0, 80);
  const rechts = String(it.rechts != null ? it.rechts : '').trim().slice(0, 80);
  if (!links && !rechts) return null;
  return { links, rechts };
}

function activeZuCfg() {
  const g = config.games.zu || {};
  const prof = (g.profiles && g.profiles[g.activeProfile]) || {};
  const titel = typeof prof.titel === 'string' ? prof.titel : '';
  const linksLabel = typeof prof.linksLabel === 'string' ? prof.linksLabel : '';
  const rechtsLabel = typeof prof.rechtsLabel === 'string' ? prof.rechtsLabel : '';
  const punkte = Number.isFinite(prof.punkte) ? prof.punkte : 100;
  const paare = Array.isArray(prof.paare) ? prof.paare.map(normPair).filter(Boolean) : [];
  return { titel, linksLabel, rechtsLabel, punkte, mischen: !!prof.mischen, paare };
}

function initZu() {
  game.zu = { phase: 'lobby', lefts: [], rights: [], answers: {}, groupPick: {} };
}

// Board aus der aktiven Konfig bauen: linke Slots (feste Reihenfolge) mit ihrem
// richtigen rechten Kaertchen (partner) bzw. partner:null („keine Verbindung"),
// und alle rechten Kaertchen inkl. Ablenker (Zeilen ohne links). rights werden
// optional gemischt und traegt jede Karte eine stabile id.
function buildZuData(cfg) {
  const lefts = [];
  const rights = [];
  let li = 0, ri = 0;
  cfg.paare.forEach((pr) => {
    const hasL = !!pr.links, hasR = !!pr.rechts;
    if (hasL && hasR) {
      const rid = 'R' + (ri++);
      rights.push({ id: rid, text: pr.rechts });
      lefts.push({ id: 'L' + (li++), text: pr.links, partner: rid });
    } else if (hasL) {
      lefts.push({ id: 'L' + (li++), text: pr.links, partner: null });
    } else if (hasR) {
      rights.push({ id: 'R' + (ri++), text: pr.rechts });   // Ablenker (kein Linker zeigt darauf)
    }
  });
  const order = rights.map((_, i) => i);
  const shown = cfg.mischen ? shuffle(order).map((i) => rights[i]) : rights;
  return { lefts, rights: shown };
}

// Rechte Kaertchen, die zu keinem Linken gehoeren (Ablenker).
function zuDistractorIds() {
  const partners = new Set(game.zu.lefts.map((l) => l.partner).filter(Boolean));
  return game.zu.rights.filter((r) => !partners.has(r.id)).map((r) => r.id);
}

// Quiz starten: Board aufbauen, in die Zuordnungsphase gehen, Antworten leeren.
// Ohne linke Slots passiert nichts.
function zuStart() {
  const cfg = activeZuCfg();
  const built = buildZuData(cfg);
  if (built.lefts.length === 0) return;
  game.zu.lefts = built.lefts;
  game.zu.rights = built.rights;
  game.zu.answers = {};
  game.zu.groupPick = {};
  game.zu.phase = 'matching';
  bus.broadcast();
}

// Nicht an einen Teilnehmer gebundene "Allgemeinheit einigt sich auf ..."-Wahl:
// der Master klickt live eine Zuordnung an (aenderbar bis zur Aufloesung), fuer
// den Nur-Master-Modus ohne Punktevergabe – reine Spannungs-/Anzeigefunktion.
function zuSetGroupPick(leftId, rightId) {
  if (game.zu.phase !== 'matching') return;
  if (!game.zu.lefts.some((l) => l.id === leftId)) return;
  const rid = rightId == null ? null : String(rightId);
  if (rid !== null && !game.zu.rights.some((r) => r.id === rid)) return;
  if (rid === null) {
    delete game.zu.groupPick[leftId];
  } else {
    // Kaertchen darf nur an EINEM Slot liegen -> altes Vorkommen entfernen (wie applyAssign).
    for (const k of Object.keys(game.zu.groupPick)) { if (game.zu.groupPick[k] === rid) delete game.zu.groupPick[k]; }
    game.zu.groupPick[leftId] = rid;
  }
  bus.broadcast();
}

// Aufloesen: jede Zuordnung je Spieler bewerten und pro Treffer Punkte gutschreiben.
// Treffer = platziertes Kaertchen == partner des Slots; bei partner:null zaehlt ein
// leer gelassener Slot als Treffer („keine Verbindung" korrekt erkannt).
function zuReveal() {
  if (game.zu.phase !== 'matching') return;
  const cfg = activeZuCfg();
  for (const [id, map] of Object.entries(game.zu.answers)) {
    let correct = 0;
    for (const l of game.zu.lefts) {
      const placed = (map && map[l.id]) || null;
      if (placed === l.partner) correct++;   // beide null (keine Verbindung) oder gleicher rightId
    }
    if (correct > 0) recordScore(id, correct * cfg.punkte, { game: 'zu' });
  }
  game.zu.phase = 'reveal';
  bus.broadcast();
}

// Oeffentliche (maskierte) Zuordnungs-Sicht fuer Spieler/Bildschirm. Board-Texte
// sind sichtbar, die richtige Zuordnung NICHT – erst beim Aufloesen kommen
// solution + distractors + Trefferzaehlung dazu.
function publicZu() {
  const cfg = activeZuCfg();
  const zu = game.zu;
  // Anzahl bewertbarer linker Slots (fuer Fortschritt/Punktehinweis).
  const totalLefts = zu.lefts.length || cfg.paare.filter((p) => p.links).length;
  const out = {
    phase: zu.phase,
    titel: cfg.titel,
    linksLabel: cfg.linksLabel,
    rechtsLabel: cfg.rechtsLabel,
    punkte: cfg.punkte,
    total: totalLefts,
    playerCount: Object.keys(zu.answers).length   // Spieler, die schon etwas platziert haben
  };
  if (zu.phase === 'matching' || zu.phase === 'reveal') {
    out.lefts = zu.lefts.map((l) => ({ id: l.id, text: l.text }));   // ohne partner!
    out.rights = zu.rights.map((r) => ({ id: r.id, text: r.text })); // in Anzeigereihenfolge
    if (zu.phase === 'matching') out.groupPick = Object.assign({}, zu.groupPick);
    if (zu.phase === 'reveal') {
      const solution = {};
      zu.lefts.forEach((l) => { solution[l.id] = l.partner; });
      out.solution = solution;                    // leftId -> rightId | null
      out.distractors = zuDistractorIds();        // rechte Kaertchen ohne Partner
      // Trefferzaehlung je Slot (wie viele Spieler richtig lagen) fuer den Bildschirm.
      const counts = {};
      zu.lefts.forEach((l) => { counts[l.id] = 0; });
      for (const map of Object.values(zu.answers)) {
        zu.lefts.forEach((l) => {
          const placed = (map && map[l.id]) || null;
          if (placed === l.partner) counts[l.id]++;
        });
      }
      out.correctCounts = counts;
    }
  }
  return out;
}

module.exports = { activeZuCfg, normPair, initZu, buildZuData, zuDistractorIds, zuStart, zuReveal, publicZu, zuSetGroupPick };
