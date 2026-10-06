'use strict';
/*
 * „Wahr/Falsch"-Blitzrunde: Aussagen werden nacheinander gezeigt, Spieler
 * entscheiden wahr/falsch. Zwei Antwort-Modi (nurSchnellster: erster Buzz
 * entscheidet + loest sofort auf; sonst: alle stimmen ab, Master loest per
 * „Auflösen" auf) x zwei Punkte-Modi (fix: Pauschalpunkte; zeit: wie Zeitdruck
 * mit der Zeit fallend). Kein Auto-Timer – der Master schaltet per „Weiter".
 */
const { config } = require('../config');
const { game, publicPlayer, recordScore } = require('../state');
const { shuffle } = require('../util');
const bus = require('../bus');

function normStatement(it) {
  if (it == null) return null;
  if (typeof it === 'string') {
    const t = it.trim().slice(0, 140);
    return t ? { text: t, wahr: true } : null;
  }
  if (typeof it === 'object') {
    const t = String(it.text != null ? it.text : '').trim().slice(0, 140);
    return t ? { text: t, wahr: !!it.wahr } : null;
  }
  return null;
}

function activeTfCfg() {
  const g = config.games.tf || {};
  const prof = (g.profiles && g.profiles[g.activeProfile]) || {};
  const aussagen = Array.isArray(prof.aussagen) ? prof.aussagen.map(normStatement).filter(Boolean) : [];
  const punkteModus = prof.punkteModus === 'zeit' ? 'zeit' : 'fix';
  const punkte = Number.isFinite(prof.punkte) ? prof.punkte : 100;
  const startPunkte = Number.isFinite(prof.startPunkte) ? prof.startPunkte : 1000;
  let minPunkte = Number.isFinite(prof.minPunkte) ? prof.minPunkte : 100;
  if (minPunkte > startPunkte) minPunkte = startPunkte;
  const abzugProSek = Number.isFinite(prof.abzugProSek) ? prof.abzugProSek : 100;
  return {
    aussagen, punkteModus, punkte, startPunkte, minPunkte, abzugProSek,
    nurSchnellster: !!prof.nurSchnellster, mischen: !!prof.mischen
  };
}

// Laufzeitzustand auf den Lobby-Zustand zuruecksetzen (nichts gestartet).
function initTf() {
  game.tf = { order: [], pos: -1, phase: 'lobby', votes: {}, buzzedBy: null, groupPick: null };
}

// Aktuelle Aussage aufloesen (Objekt { text, wahr }) oder null.
function tfCurrentStatement() {
  const idx = game.tf.order[game.tf.pos];
  if (idx == null) return null;
  return activeTfCfg().aussagen[idx] || null;
}

// Punktwert fuer eine korrekte Antwort: pauschal oder mit der Zeit fallend
// (server-seitig eingefroren, sobald die Antwort eintrifft – analog Zeitdruck).
function tfPointsFor(cfg, elapsedMs) {
  if (cfg.punkteModus !== 'zeit') return cfg.punkte;
  let pts = cfg.startPunkte - cfg.abzugProSek * (Math.max(0, elapsedMs) / 1000);
  pts = Math.round(pts);
  if (pts < cfg.minPunkte) pts = cfg.minPunkte;
  if (pts > cfg.startPunkte) pts = cfg.startPunkte;
  return pts;
}

// Spiel starten: Aussagen-Reihenfolge festlegen (optional gemischt), erste
// Aussage zeigen. Ohne Aussagen passiert nichts.
function tfStart() {
  const cfg = activeTfCfg();
  if (cfg.aussagen.length === 0) return;
  let order = cfg.aussagen.map((_, i) => i);
  if (cfg.mischen) order = shuffle(order);
  game.tf.order = order;
  game.tf.pos = 0;
  game.tf.phase = 'running';
  game.tf.votes = {};
  game.tf.buzzedBy = null;
  game.tf.groupPick = null;
  bus.broadcast();
}

// Nicht an einen Teilnehmer gebundene Master-Auswahl (Nur-Master-Modus im
// Abstimmungs-Modus, analog zu Zeitdruck/MC): der Master klickt selbst „Wahr"
// oder „Falsch" fuer die ganze Runde, ohne dass ein Spieler dafuer Punkte
// bekommt. Aenderbar bis zur Aufloesung.
function tfSetGroupPick(answer, elapsedMs) {
  if (game.tf.phase !== 'running') return;
  if (activeTfCfg().nurSchnellster) return;   // im Schnellster-Modus gibt es keine Gruppenwahl
  let elapsed = Number(elapsedMs);
  if (!Number.isFinite(elapsed) || elapsed < 0) elapsed = 0;
  game.tf.groupPick = { answer: !!answer, points: tfPointsFor(activeTfCfg(), elapsed) };
  bus.broadcast();
}

// Spieler-Antwort: Kernlogik, unabhaengig davon ob per press (Schnellster-Modus)
// oder answer (Abstimmungs-Modus) ausgeloest. Erste Antwort je Spieler zaehlt
// (Lock-in). Im Schnellster-Modus entscheidet die erste eintreffende Antwort
// insgesamt die Runde und loest sofort auf (wie ein Buzz).
function tfAnswer(p, msg) {
  if (game.tf.phase !== 'running') return;
  if (game.tf.votes[p.id]) return;              // Antwort ist fix (erste zaehlt)
  const cfg = activeTfCfg();
  const answer = !!msg.answer;
  let elapsed = Number(msg.elapsedMs);
  if (!Number.isFinite(elapsed) || elapsed < 0) elapsed = 0;
  elapsed = Math.round(elapsed);
  const st = tfCurrentStatement();
  const correct = !!(st && st.wahr === answer);
  const points = correct ? tfPointsFor(cfg, elapsed) : 0;
  game.tf.votes[p.id] = { answer, correct, points, elapsedMs: elapsed };

  if (cfg.nurSchnellster) {
    // Schnellster-Modus: die erste eintreffende Antwort entscheidet die Runde
    // sofort und pausiert (Verdict), wie der Buzz bei „Falsche Woerter".
    game.tf.buzzedBy = p.id;
    if (points > 0) recordScore(p.id, points, { game: 'tf', ms: elapsed });
    game.tf.phase = 'paused';
  }
  bus.broadcast();
}

// Aufloesen (nur Abstimmungs-Modus): allen korrekt liegenden Spielern ihren
// eingefrorenen Punktwert gutschreiben, Verteilung + Loesung oeffentlich machen.
function tfReveal() {
  if (game.tf.phase !== 'running') return;
  const cfg = activeTfCfg();
  if (cfg.nurSchnellster) return;   // im Schnellster-Modus loest die Antwort direkt auf
  for (const [id, v] of Object.entries(game.tf.votes)) {
    if (v.correct && v.points > 0) recordScore(id, v.points, { game: 'tf', ms: v.elapsedMs });
  }
  game.tf.phase = 'paused';
  bus.broadcast();
}

// Weiter (Master): zur naechsten Aussage; nach der letzten -> Endstand (done).
// Aus der laufenden Phase heraus zaehlt das als Ueberspringen (ohne Punkte).
function tfNext() {
  if (game.tf.phase !== 'running' && game.tf.phase !== 'paused') return;
  if (game.tf.pos + 1 >= game.tf.order.length) {
    game.tf.phase = 'done';
    bus.broadcast();
    return;
  }
  game.tf.pos++;
  game.tf.phase = 'running';
  game.tf.votes = {};
  game.tf.buzzedBy = null;
  game.tf.groupPick = null;
  bus.broadcast();
}

// Oeffentliche Sicht fuer Spieler/Bildschirm. Die Aussage ist sichtbar, ob sie
// wahr ist NICHT – das kommt erst in der paused-Phase (Verdict/Aufloesung)
// dazu. Waehrend running sieht der Master ueber votedCount, wie viele schon
// abgestimmt haben (ohne die Antworten selbst zu verraten).
function publicTf() {
  const cfg = activeTfCfg();
  const tf = game.tf;
  const out = {
    phase: tf.phase,
    total: tf.order.length || cfg.aussagen.length,
    number: tf.pos + 1,
    nurSchnellster: cfg.nurSchnellster,
    punkteModus: cfg.punkteModus,
    punkte: cfg.punkte,
    startPunkte: cfg.startPunkte,
    minPunkte: cfg.minPunkte,
    abzugProSek: cfg.abzugProSek,
    votedCount: Object.keys(tf.votes).length
  };
  if (tf.phase === 'running' || tf.phase === 'paused') {
    const st = tfCurrentStatement();
    out.statement = st ? st.text : '';
  }
  if (tf.phase === 'running' && !cfg.nurSchnellster) out.groupPick = tf.groupPick;
  if (tf.phase === 'paused') {
    const st = tfCurrentStatement();
    out.correct = st ? !!st.wahr : null;
    if (cfg.nurSchnellster && tf.buzzedBy) {
      const bp = publicPlayer(tf.buzzedBy);
      const v = tf.votes[tf.buzzedBy];
      out.verdict = {
        buzzerId: tf.buzzedBy,
        buzzerName: bp.name,
        buzzerAvatar: bp.avatar,
        buzzerColor: bp.color,
        answer: v ? v.answer : null,
        correct: v ? v.correct : null,
        awarded: v ? v.points : 0
      };
    } else if (!cfg.nurSchnellster) {
      let wahrCount = 0;
      let falschCount = 0;
      for (const v of Object.values(tf.votes)) { if (v.answer) wahrCount++; else falschCount++; }
      out.dist = { wahr: wahrCount, falsch: falschCount };
    }
  }
  return out;
}

module.exports = {
  activeTfCfg, normStatement, initTf, tfCurrentStatement, tfPointsFor,
  tfStart, tfAnswer, tfSetGroupPick, tfReveal, tfNext, publicTf
};
