'use strict';
/*
 * Wortlisten-Spiel: Master deckt Woerter auf, Spieler tippen (Freitext) die
 * verdeckten Woerter, um sie fuer sich freizuschalten.
 */
const { config } = require('../config');
const { game } = require('../state');

function activeWordlistCfg() {
  const g = config.games.wordlist || {};
  const prof = (g.profiles && g.profiles[g.activeProfile]) || {};
  const heading = typeof prof.heading === 'string' ? prof.heading : '';
  const words = Array.isArray(prof.words) ? prof.words.map((w) => String(w)) : [];
  const punkteAktiv = !!prof.punkteAktiv;
  const punkte = Number.isFinite(prof.punkte) ? prof.punkte : 10;
  return { heading, words, punkteAktiv, punkte };
}

// Normalisierung fuer den Wortvergleich (Gross/Klein, Rand-/Doppel-Leerzeichen).
function normWord(w) {
  return String(w).trim().toLowerCase().replace(/\s+/g, ' ');
}

// Laufzeitzustand an die aktive Wortliste angleichen: alles verdeckt, alle
// Spieler gesperrt, keine gemerkten Woerter.
function initWordlist() {
  const words = activeWordlistCfg().words;
  game.wl.revealed = words.map(() => false);
  game.wl.lastWords = {};
  game.wl.unlocked = {};
}

// Oeffentliche (maskierte) Wortliste fuer Spieler/Bildschirm. Verdeckte Woerter
// werden bewusst NICHT mitgesendet (Loesung nur beim Master, s. snapshotFor).
function publicWordlist() {
  const cfg = activeWordlistCfg();
  const entries = cfg.words.map((w, i) => {
    const isOpen = !!game.wl.revealed[i];
    return { revealed: isOpen, word: isOpen ? w : null };
  });
  return {
    heading: cfg.heading,
    entries,
    total: cfg.words.length,
    revealedCount: entries.filter((e) => e.revealed).length,
    unlocked: Object.assign({}, game.wl.unlocked)  // welcher Spieler senden darf
  };
}


module.exports = { activeWordlistCfg, normWord, initWordlist, publicWordlist };
