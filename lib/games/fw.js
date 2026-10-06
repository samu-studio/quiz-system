'use strict';
/*
 * „Falsche Woerter"-Buzzer: Woerter werden nacheinander (auto-getaktet) gezeigt,
 * Spieler buzzern, sobald ein Wort NICHT in die Kategorie passt.
 */
const { config } = require('../config');
const { game, publicPlayer, recordScore } = require('../state');
const { shuffle } = require('../util');
const bus = require('../bus');

let fwTimer = null;   // Auto-Weiterschalt-Timer des „Falsche Woerter"-Spiels

function normWordFlag(it) {
  if (it == null) return null;
  if (typeof it === 'string') {
    const t = it.trim().slice(0, 60);
    return t ? { text: t, wrong: false } : null;
  }
  if (typeof it === 'object') {
    const t = String(it.text != null ? it.text : '').trim().slice(0, 60);
    return t ? { text: t, wrong: !!it.wrong } : null;
  }
  return null;
}

function activeFwCfg() {
  const g = config.games.fw || {};
  const prof = (g.profiles && g.profiles[g.activeProfile]) || {};
  const kategorie = typeof prof.kategorie === 'string' ? prof.kategorie : '';
  const woerter = Array.isArray(prof.woerter) ? prof.woerter.map(normWordFlag).filter(Boolean) : [];
  const punkte = Number.isFinite(prof.punkte) ? prof.punkte : 100;
  const sekundenProWort = Number.isFinite(prof.sekundenProWort) ? prof.sekundenProWort : 4;
  return { kategorie, woerter, punkte, sekundenProWort, mischen: !!prof.mischen };
}

// Auto-Weiterschalt-Timer stoppen (Wortwechsel bei laufendem Spiel).
function clearFwTimer() { if (fwTimer) { clearTimeout(fwTimer); fwTimer = null; } }

// Laufzeitzustand auf den Lobby-Zustand zuruecksetzen (nichts gestartet).
// Punkte (game.scores) bleiben erhalten – dafuer gibt es resetScores.
function initFw() {
  clearFwTimer();
  game.fw = { order: [], pos: -1, phase: 'lobby', wordSeq: 0, pausedByBuzz: false, buzzedBy: null, buzzWrong: false, awarded: 0 };
}

// Aktuelles Wort aufloesen (Objekt { text, wrong }) oder null.
function fwCurrentWord() {
  const idx = game.fw.order[game.fw.pos];
  if (idx == null) return null;
  return activeFwCfg().woerter[idx] || null;
}

// Naechstes Wort planen: nach sekundenProWort automatisch weiterschalten. Der
// Wort-Zaehler (wordSeq) sichert ab, dass ein alter Timer nicht faelschlich ein
// bereits gewechseltes/pausiertes Wort weiterschaltet.
function scheduleFwAdvance() {
  clearFwTimer();
  const cfg = activeFwCfg();
  const seq = game.fw.wordSeq;
  const ms = Math.max(500, cfg.sekundenProWort * 1000);
  fwTimer = setTimeout(() => {
    if (game.fw.phase !== 'running' || game.fw.wordSeq !== seq) return;
    fwAdvance();
  }, ms);
}

// Auto-Weiterschalten: naechstes Wort zeigen oder – nach dem letzten – beenden.
function fwAdvance() {
  clearFwTimer();
  if (game.fw.pos + 1 >= game.fw.order.length) {
    game.fw.phase = 'done';
    bus.broadcast();
    return;
  }
  game.fw.pos++;
  game.fw.phase = 'running';
  game.fw.wordSeq++;
  scheduleFwAdvance();
  bus.broadcast();
}

// Spiel starten: Wortreihenfolge festlegen (optional gemischt), erstes Wort zeigen
// und den Auto-Timer anwerfen. Ohne Woerter passiert nichts.
function fwStart() {
  const cfg = activeFwCfg();
  if (cfg.woerter.length === 0) return;
  let order = cfg.woerter.map((_, i) => i);
  if (cfg.mischen) order = shuffle(order);
  game.fw.order = order;
  game.fw.pos = 0;
  game.fw.phase = 'running';
  game.fw.wordSeq++;
  game.fw.pausedByBuzz = false; game.fw.buzzedBy = null; game.fw.buzzWrong = false; game.fw.awarded = 0;
  scheduleFwAdvance();
  bus.broadcast();
}

// Manuelle Pause durch den Master (kein Buzz): aktuelles Wort bleibt stehen, es
// wird nichts bewertet. „Weiter" laeuft danach mit DEMSELBEN Wort weiter.
function fwPause() {
  if (game.fw.phase !== 'running') return;
  clearFwTimer();
  game.fw.phase = 'paused';
  game.fw.pausedByBuzz = false;
  game.fw.buzzedBy = null; game.fw.buzzWrong = false; game.fw.awarded = 0;
  bus.broadcast();
}

// Weiter (Master): nach einem Buzz zum naechsten Wort, nach manueller Pause mit
// demselben Wort. Nach dem letzten Wort -> Endstand.
function fwResume() {
  if (game.fw.phase !== 'paused') return;
  const advance = game.fw.pausedByBuzz;
  game.fw.pausedByBuzz = false; game.fw.buzzedBy = null; game.fw.buzzWrong = false; game.fw.awarded = 0;
  if (advance) {
    if (game.fw.pos + 1 >= game.fw.order.length) { game.fw.phase = 'done'; clearFwTimer(); bus.broadcast(); return; }
    game.fw.pos++;
  }
  game.fw.phase = 'running';
  game.fw.wordSeq++;
  scheduleFwAdvance();
  bus.broadcast();
}

// Spieler-Buzz: pausiert sofort das laufende Wort und bewertet server-seitig.
// Erster eintreffender Buzz gewinnt (weitere werden ignoriert, da nicht mehr
// 'running'). Falsches Wort -> Punkte fuer den Buzzer; passendes Wort -> Fehlbuzz
// ohne Abzug. elapsedMs wird vom Geraet lokal gemessen (Fairness) und als interner
// Tiebreak gespeichert, aber nicht angezeigt.
function fwBuzz(p, msg) {
  if (game.fw.phase !== 'running') return;   // nur waehrend ein Wort laeuft
  clearFwTimer();
  const w = fwCurrentWord();
  const wrong = !!(w && w.wrong);
  game.fw.phase = 'paused';
  game.fw.pausedByBuzz = true;
  game.fw.buzzedBy = p.id;
  game.fw.buzzWrong = wrong;
  let elapsed = Number(msg && msg.elapsedMs);
  game.fw.buzzedElapsed = Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed) : null;
  let awarded = 0;
  if (wrong) {
    const cfg = activeFwCfg();
    awarded = cfg.punkte;
    recordScore(p.id, awarded, { game: 'fw', ms: game.fw.buzzedElapsed });
  }
  game.fw.awarded = awarded;
  bus.broadcast();
}

// Oeffentliche Sicht fuer Spieler/Bildschirm. Das aktuelle Wort ist sichtbar,
// die falsch/richtig-Markierung NICHT – erst bei einer Buzz-Pause kommt das
// Ergebnis (verdict) dazu. Bei manueller Pause gibt es kein verdict.
function publicFw() {
  const cfg = activeFwCfg();
  const fw = game.fw;
  const out = {
    phase: fw.phase,
    kategorie: cfg.kategorie,
    total: fw.order.length || cfg.woerter.length,
    number: fw.pos + 1,
    punkte: cfg.punkte,
    sekundenProWort: cfg.sekundenProWort,
    wordSeq: fw.wordSeq
  };
  if (fw.phase === 'running' || fw.phase === 'paused') {
    const w = fwCurrentWord();
    out.word = w ? w.text : '';
  }
  if (fw.phase === 'paused' && fw.buzzedBy) {
    const bp = publicPlayer(fw.buzzedBy);
    out.verdict = {
      wrong: fw.buzzWrong,
      buzzerId: fw.buzzedBy,
      buzzerName: bp.name,
      buzzerAvatar: bp.avatar,
      buzzerColor: bp.color,
      awarded: fw.awarded
    };
  }
  return out;
}

module.exports = {
  activeFwCfg, normWordFlag, clearFwTimer, initFw, fwCurrentWord,
  scheduleFwAdvance, fwAdvance, fwStart, fwPause, fwResume, fwBuzz, publicFw
};
