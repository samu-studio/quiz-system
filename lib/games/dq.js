'use strict';
/*
 * Detektivquiz: Hinweise werden nacheinander aufgedeckt; Spieler raten per
 * Freitext (Master urteilt) oder per Buzzer + muendlich (Master entscheidet).
 */
const { config, safeBgName } = require('../config');
const { game, publicPlayer, recordScore } = require('../state');
const { shuffle } = require('../util');
const bus = require('../bus');

function normCase(it) {
  if (!it || typeof it !== 'object') return null;
  const loesung = typeof it.loesung === 'string' ? it.loesung.trim().slice(0, 120) : '';
  let hinweise = Array.isArray(it.hinweise) ? it.hinweise.map((h) => String(h).trim().slice(0, 200)) : [];
  hinweise = hinweise.filter(Boolean).slice(0, 15);
  if (!loesung || hinweise.length === 0) return null;
  // Optionales Lösungsbild (Dateiname in public/backgrounds/, wie bei der Bildanzeige).
  const bild = (typeof it.bild === 'string' && safeBgName(it.bild)) || '';
  return { loesung, hinweise, bild };
}

function activeDqCfg() {
  const g = config.games.dq || {};
  const prof = (g.profiles && g.profiles[g.activeProfile]) || {};
  const intro = typeof prof.intro === 'string' ? prof.intro : '';
  const startPunkte = Number.isFinite(prof.startPunkte) ? prof.startPunkte : 100;
  const abzugProHinweis = Number.isFinite(prof.abzugProHinweis) ? prof.abzugProHinweis : 20;
  let minPunkte = Number.isFinite(prof.minPunkte) ? prof.minPunkte : 20;
  if (minPunkte > startPunkte) minPunkte = startPunkte;
  const faelle = Array.isArray(prof.faelle) ? prof.faelle.map(normCase).filter(Boolean) : [];
  return { intro, buzzerModus: !!prof.buzzerModus, startPunkte, abzugProHinweis, minPunkte, mischen: !!prof.mischen, faelle };
}

function initDq() {
  game.dq = { order: [], pos: -1, phase: 'lobby', revealed: 0, answers: {}, buzz: null, winner: null };
}

// Aktuellen Fall aufloesen ({ loesung, hinweise }) oder null.
function dqCurrentCase() {
  const cfg = activeDqCfg();
  const idx = game.dq.order[game.dq.pos];
  if (idx == null) return null;
  return cfg.faelle[idx] || null;
}

// Punktwert bei „level" aufgedeckten Hinweisen: Startpunkte minus Abzug je Hinweis
// nach dem ersten, mit Boden. level ist 1-basiert (1 Hinweis = voller Startwert).
function dqPointsAt(cfg, level) {
  let pts = cfg.startPunkte - cfg.abzugProHinweis * (Math.max(1, level) - 1);
  pts = Math.round(pts);
  if (pts < cfg.minPunkte) pts = cfg.minPunkte;
  if (pts > cfg.startPunkte) pts = cfg.startPunkte;
  return pts;
}

// Quiz starten: Fallreihenfolge festlegen (optional gemischt), ersten Fall zeigen
// (erster Hinweis aufgedeckt). Ohne Faelle passiert nichts.
function dqStart() {
  const cfg = activeDqCfg();
  if (cfg.faelle.length === 0) return;
  let order = cfg.faelle.map((_, i) => i);
  if (cfg.mischen) order = shuffle(order);
  game.dq.order = order;
  game.dq.pos = 0;
  game.dq.phase = 'running';
  game.dq.revealed = 1;
  game.dq.answers = {};
  game.dq.buzz = null;
  game.dq.winner = null;
  bus.broadcast();
}

// Nächsten Hinweis des aktuellen Falls aufdecken (bis alle offen sind). Waehrend
// ein Buzz auf Entscheidung wartet, wird nicht weiter aufgedeckt.
function dqNextClue() {
  if (game.dq.phase !== 'running') return;
  if (game.dq.buzz) return;
  const cur = dqCurrentCase();
  if (!cur) return;
  if (game.dq.revealed < cur.hinweise.length) {
    game.dq.revealed++;
    bus.broadcast();
  }
}

// Freitext-Modus: einen Spieler als richtig werten. Punkte = eingefrorener Wert
// beim Hinweis-Stand SEINER Abgabe (Freeze bei Abgabe). Beendet den Fall.
function dqAward(clientId) {
  if (game.dq.phase !== 'running') return;
  const cfg = activeDqCfg();
  if (cfg.buzzerModus) return;                 // Freitext-Modus only
  const a = game.dq.answers[clientId];
  if (!a) return;                              // nur wer geraten hat
  const pts = dqPointsAt(cfg, a.level);
  recordScore(clientId, pts, { game: 'dq' });
  game.dq.winner = Object.assign(publicPlayer(clientId), { points: pts, level: a.level });
  game.dq.phase = 'reveal';
  bus.broadcast();
}

// Buzzer-Modus: den wartenden Buzz als richtig werten. Punkte = eingefrorener Wert
// beim Hinweis-Stand DES BUZZ. Beendet den Fall.
function dqBuzzOk() {
  if (game.dq.phase !== 'running' || !game.dq.buzz) return;
  const cfg = activeDqCfg();
  const b = game.dq.buzz;
  const pts = dqPointsAt(cfg, b.level);
  recordScore(b.id, pts, { game: 'dq' });
  game.dq.winner = Object.assign(publicPlayer(b.id), { points: pts, level: b.level });
  game.dq.buzz = null;
  game.dq.phase = 'reveal';
  bus.broadcast();
}

// Buzzer-Modus: den wartenden Buzz als falsch werten – kein Abzug, es darf weiter
// gebuzzert werden (Hinweise laufen weiter). Der Fall bleibt offen.
function dqBuzzWrong() {
  if (game.dq.phase !== 'running' || !game.dq.buzz) return;
  game.dq.buzz = null;
  bus.broadcast();
}

// Lösung zeigen, ohne dass jemand richtig lag (niemand hat es erraten). Beendet
// den Fall ohne Punkte.
function dqRevealSolution() {
  if (game.dq.phase !== 'running') return;
  game.dq.buzz = null;
  game.dq.winner = null;
  game.dq.phase = 'reveal';
  bus.broadcast();
}

// Nächster Fall (oder Endstand nach dem letzten). Nur aus der Auflösungsphase.
function dqNextCase() {
  if (game.dq.phase !== 'reveal') return;
  if (game.dq.pos + 1 >= game.dq.order.length) {
    game.dq.phase = 'done';
    bus.broadcast();
    return;
  }
  game.dq.pos++;
  game.dq.phase = 'running';
  game.dq.revealed = 1;
  game.dq.answers = {};
  game.dq.buzz = null;
  game.dq.winner = null;
  bus.broadcast();
}

// Spieler-Buzz (Buzzer-Modus): der erste eintreffende Buzz gewinnt und wartet auf
// die Master-Entscheidung; weitere werden ignoriert, solange einer aussteht. Der
// Hinweis-Stand wird als Punkte-Basis eingefroren (Freeze bei Abgabe). elapsedMs
// wird lokal gemessen (Fairness) und als interner Tiebreak gemerkt.
function dqBuzz(p, msg) {
  const cfg = activeDqCfg();
  if (!cfg.buzzerModus) return;                // nur im Buzzer-Modus
  if (game.dq.phase !== 'running') return;
  if (game.dq.buzz) return;                     // es wartet schon ein Buzz
  let elapsed = Number(msg && msg.elapsedMs);
  game.dq.buzz = {
    id: p.id,
    level: game.dq.revealed,
    elapsed: Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed) : null
  };
  bus.broadcast();
}

// Oeffentliche (maskierte) Detektivquiz-Sicht fuer Spieler/Bildschirm. Nur die
// bereits aufgedeckten Hinweise sind sichtbar; die Loesung kommt erst beim
// Auflösen. Der Buzzer-Wartezustand (wer gebuzzert hat) ist oeffentlich.
function publicDq() {
  const cfg = activeDqCfg();
  const dq = game.dq;
  const out = {
    phase: dq.phase,
    intro: cfg.intro,
    buzzerModus: cfg.buzzerModus,
    startPunkte: cfg.startPunkte,
    abzugProHinweis: cfg.abzugProHinweis,
    minPunkte: cfg.minPunkte,
    total: dq.order.length || cfg.faelle.length,
    number: dq.pos + 1,
    answered: Object.keys(dq.answers).length
  };
  if (dq.phase === 'running' || dq.phase === 'reveal') {
    const cur = dqCurrentCase();
    if (cur) {
      out.hinweise = cur.hinweise.slice(0, dq.revealed);   // nur aufgedeckte Hinweise
      out.hintCount = cur.hinweise.length;
      out.revealed = dq.revealed;
      out.pointsNow = dqPointsAt(cfg, dq.revealed);
      if (dq.phase === 'reveal') {
        out.loesung = cur.loesung;
        out.loesungBild = cur.bild || '';
        out.winner = dq.winner
          ? { id: dq.winner.id, name: dq.winner.name, avatar: dq.winner.avatar, color: dq.winner.color, points: dq.winner.points }
          : null;
      }
    }
    // Buzzer-Wartezustand (wer hat gebuzzert) – oeffentlich fuer Bildschirm/Spieler.
    if (dq.buzz) {
      out.buzz = publicPlayer(dq.buzz.id);
    }
  }
  return out;
}

module.exports = {
  activeDqCfg, normCase, initDq, dqCurrentCase, dqPointsAt, dqStart, dqNextClue,
  dqAward, dqBuzzOk, dqBuzzWrong, dqRevealSolution, dqNextCase, dqBuzz, publicDq
};
