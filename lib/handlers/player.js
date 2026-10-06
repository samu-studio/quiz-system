'use strict';
/*
 * Spieler-Kanal: Aktionen, die ein Spieler-Client an den Server sendet
 * (Reaktions-Buzzer, Wortlisten-Eingabe, Freitext, MC/Zeitdruck-Antwort,
 * Zuordnungs-Zuweisung, Schaetzung).
 */
const bus = require('../bus');
const { config } = require('../config');
const { participants, game, REACTION_EMOJIS, REACTION_RATE_LIMIT_MS, broadcastReaction } = require('../state');
const { maybeFinish } = require('../games/reaction');
const { activeWordlistCfg, normWord } = require('../games/wordlist');
const { activeZdCfg, zdPointsFor } = require('../games/zd');
const { fwBuzz } = require('../games/fw');
const { tfAnswer } = require('../games/tf');
const { activeDqCfg, dqBuzz } = require('../games/dq');
const { activeAqCfg, aqBuzz } = require('../games/aq');
const { sqCurrentQuestion } = require('../games/sq');
const { zmSubmit, zmCastVote } = require('../games/zm');

// Kern der Buzzer-Logik, unabhaengig davon, ob sie von einem echten Spieler-
// Client (onPress) oder stellvertretend vom Master (masterPress, s. master.js –
// fuer den Nur-Master-Modus ohne verbundene Spieler-Handys) ausgeloest wird.
function applyPress(p, msg) {
  if (game.locked) return;        // Killswitch aktiv: keine Interaktionen
  // „Falsche Woerter": der Buzzer nutzt dieselbe press-Nachricht wie die Ampel.
  if (config.activeGame === 'fw') return fwBuzz(p, msg);
  // Detektivquiz (Buzzer-Modus): der Buzzer nutzt ebenfalls die press-Nachricht.
  if (config.activeGame === 'dq') return dqBuzz(p, msg);
  // Audioquiz (Buzzer-Modus): ebenso.
  if (config.activeGame === 'aq') return aqBuzz(p, msg);
  if (game.results[p.id]) return; // pro Runde nur ein Druck zaehlt

  if (game.phase === 'armed' || game.phase === 'yellow') {
    game.results[p.id] = { falseStart: true, reactionMs: null };
    bus.broadcast();
    maybeFinish();
  } else if (game.phase === 'go') {
    let ms = Number(msg.reactionMs);
    if (!Number.isFinite(ms) || ms < 0) ms = 0;
    game.results[p.id] = { falseStart: false, reactionMs: Math.round(ms) };
    bus.broadcast();
    maybeFinish();
  }
  // in idle/results wird ein Druck ignoriert
}

function onPress(conn, msg) {
  const p = participants.get(conn.clientId);
  if (!p || p.role !== 'player') return;
  applyPress(p, msg);
}

// --- Spieler: Wort einreichen (Wortlisten-Spiel) ----------------------------
function applySubmitWord(p, msg) {
  if (config.activeGame !== 'wordlist') return;
  if (game.locked) return;                    // globaler Killswitch
  if (!game.wl.unlocked[p.id]) return;        // Spieler ist (noch) gesperrt
  const raw = String(msg.word || '').slice(0, 60).trim();
  if (!raw) return;
  game.wl.lastWords[p.id] = raw;              // letztes Wort merken (Master sieht es)

  // Treffer? -> erstes noch verdecktes, passendes Feld aufdecken
  const cfg = activeWordlistCfg();
  const target = normWord(raw);
  for (let i = 0; i < cfg.words.length; i++) {
    if (!game.wl.revealed[i] && normWord(cfg.words[i]) === target) {
      game.wl.revealed[i] = true;
      if (cfg.punkteAktiv) game.scores[p.id] = (game.scores[p.id] || 0) + cfg.punkte;
      break;
    }
  }
  bus.broadcast();
}

function onSubmitWord(conn, msg) {
  const p = participants.get(conn.clientId);
  if (!p || p.role !== 'player') return;
  applySubmitWord(p, msg);
}

// --- Spieler: Lösung tippen (Detektivquiz, Freitext-Modus) ------------------
// Speichert die letzte Antwort des Spielers samt eingefrorenem Hinweis-Stand
// (Freeze bei Abgabe). Der Master urteilt, ob sie richtig ist. Weiterraten ist
// erlaubt (jede Abgabe ueberschreibt die letzte). Nur waehrend ein Fall laeuft.
function applyGuess(p, msg) {
  if (game.locked) return;                       // globaler Killswitch
  const text = String(msg.text || '').slice(0, 80).trim();
  if (!text) return;
  // Detektivquiz (Freitext-Modus): Antwort + eingefrorener Hinweis-Stand.
  if (config.activeGame === 'dq') {
    if (activeDqCfg().buzzerModus) return;        // im Buzzer-Modus wird nicht getippt
    if (game.dq.phase !== 'running') return;      // nur solange ein Fall laeuft
    game.dq.answers[p.id] = { text, level: game.dq.revealed };
    bus.broadcast();
    return;
  }
  // Audioquiz (Freitext-Modus): Antwort + eingefrorener Ausschnitt-Stufen-Stand.
  if (config.activeGame === 'aq') {
    if (activeAqCfg().buzzerModus) return;        // im Buzzer-Modus wird nicht getippt
    if (game.aq.phase !== 'running') return;      // nur solange eine Runde laeuft
    game.aq.answers[p.id] = { text, level: game.aq.revealed };
    bus.broadcast();
    return;
  }
}

function onGuess(conn, msg) {
  const p = participants.get(conn.clientId);
  if (!p || p.role !== 'player') return;
  applyGuess(p, msg);
}


// --- Spieler: Antwort waehlen (Multiple-Choice) -----------------------------
function applyAnswer(p, msg) {
  if (game.locked) return;                    // globaler Killswitch
  if (config.activeGame === 'mc') {
    if (game.mc.phase !== 'question') return;   // nur waehrend der Fragephase
    if (game.mc.answers[p.id] != null) return;  // Antwort ist fix (erste zaehlt)
    const opt = Number(msg.option);
    if (!Number.isInteger(opt) || opt < 0 || opt >= game.mc.answerPerm.length) return;
    game.mc.answers[p.id] = opt;
    bus.broadcast();
  } else if (config.activeGame === 'zd') {
    if (game.zd.phase !== 'question') return;   // nur waehrend der Fragephase
    if (game.zd.answers[p.id] != null) return;  // Antwort ist fix (erste zaehlt)
    const opt = Number(msg.option);
    if (!Number.isInteger(opt) || opt < 0 || opt >= game.zd.answerPerm.length) return;
    // Punktwert aus der vom Geraet gemeldeten Zeit einfrieren (Zeit lokal gemessen,
    // damit Netz-Latenz nicht benachteiligt – analog zur Reaktions-Fairness).
    let elapsed = Number(msg.elapsedMs);
    if (!Number.isFinite(elapsed) || elapsed < 0) elapsed = 0;
    const pts = zdPointsFor(activeZdCfg(), elapsed);
    game.zd.answers[p.id] = { option: opt, points: pts };
    bus.broadcast();
  }
}

function onAnswer(conn, msg) {
  const p = participants.get(conn.clientId);
  if (!p || p.role !== 'player') return;
  applyAnswer(p, msg);
}

// --- Spieler: Wahr/Falsch antworten (Wahr-Falsch-Blitzrunde) ----------------
// Eigene Nachricht (statt der generischen "answer"), da hier ein Boolean statt
// eines Anzeigeindex uebertragen wird. Kernlogik (Lock-in, Schnellster- vs.
// Abstimmungs-Modus) steckt in games/tf.js.
function applyTfAnswer(p, msg) {
  if (game.locked) return;                    // globaler Killswitch
  if (config.activeGame !== 'tf') return;
  tfAnswer(p, msg);
}

function onTfAnswer(conn, msg) {
  const p = participants.get(conn.clientId);
  if (!p || p.role !== 'player') return;
  applyTfAnswer(p, msg);
}

// --- Spieler: Kaertchen einem Slot zuordnen (Zuordnungs-Spiel) ---------------
// Setzt map[leftId] = rightId (oder loescht den Slot bei rightId == null). Ein
// rechtes Kaertchen kann pro Spieler nur an EINEM Slot liegen -> vorheriges
// Vorkommen wird entfernt. Nur in der Matching-Phase, killswitch-gated.
function applyAssign(p, msg) {
  if (config.activeGame !== 'zu') return;
  if (game.locked) return;                       // globaler Killswitch
  if (game.zu.phase !== 'matching') return;      // nur waehrend der Zuordnungsphase

  const leftId = String(msg.leftId || '');
  if (!game.zu.lefts.some((l) => l.id === leftId)) return;   // unbekannter Slot
  let rightId = msg.rightId == null ? null : String(msg.rightId);
  if (rightId !== null && !game.zu.rights.some((r) => r.id === rightId)) return; // unbekannte Karte

  const map = game.zu.answers[p.id] || (game.zu.answers[p.id] = {});
  if (rightId === null) {
    delete map[leftId];
  } else {
    // Karte darf nur an einem Slot liegen -> altes Vorkommen entfernen.
    for (const k of Object.keys(map)) { if (map[k] === rightId) delete map[k]; }
    map[leftId] = rightId;
  }
  bus.broadcast();
}

function onAssign(conn, msg) {
  const p = participants.get(conn.clientId);
  if (!p || p.role !== 'player') return;
  applyAssign(p, msg);
}

// --- Spieler: Zahl schaetzen (Schätzquiz) -----------------------------------
// Anders als bei MC/Zeitdruck ist die Schätzung bis zum Auflösen editierbar (kein
// Lock-in): jede neue Zahl ueberschreibt die alte. Killswitch-gated, nur in der
// Fragephase. Sind fuer die Frage Slider-Grenzen gesetzt, wird die Zahl darauf begrenzt.
function applyEstimate(p, msg) {
  if (config.activeGame !== 'sq') return;
  if (game.locked) return;                       // globaler Killswitch
  if (game.sq.phase !== 'question') return;      // nur waehrend der Fragephase
  let v = Number(msg.value);
  if (!Number.isFinite(v)) return;
  const q = sqCurrentQuestion();
  if (q) {
    if (q.min !== null && v < q.min) v = q.min;
    if (q.max !== null && v > q.max) v = q.max;
  }
  game.sq.answers[p.id] = v;
  bus.broadcast();
}

function onEstimate(conn, msg) {
  const p = participants.get(conn.clientId);
  if (!p || p.role !== 'player') return;
  applyEstimate(p, msg);
}

// --- Spieler: Kaertchen in eine Reihenfolge bringen (Reihenfolge-Quiz) ------
// Wie bei sq/zu kein Lock-in: jede neue Reihenfolge ueberschreibt die alte, bis
// der Master aufloest. Killswitch-gated, nur in der Fragephase. Die gesendete
// Reihenfolge muss eine vollstaendige Permutation der angezeigten Kaertchen-
// ids sein, sonst wird sie verworfen.
function applyOrder(p, msg) {
  if (config.activeGame !== 'ro') return;
  if (game.locked) return;                       // globaler Killswitch
  if (game.ro.phase !== 'question') return;      // nur waehrend der Fragephase
  if (!Array.isArray(msg.order)) return;
  const shownIds = game.ro.shown.map((it) => it.id);
  const order = msg.order.map((x) => String(x));
  if (order.length !== shownIds.length) return;
  const validSet = new Set(shownIds);
  if (new Set(order).size !== order.length || !order.every((id) => validSet.has(id))) return;
  game.ro.answers[p.id] = order;
  bus.broadcast();
}

function onOrder(conn, msg) {
  const p = participants.get(conn.clientId);
  if (!p || p.role !== 'player') return;
  applyOrder(p, msg);
}

// --- Spieler: Zeichnung abgeben (Zeichenquiz) -------------------------------
// Lock-in (nur die erste Abgabe je Runde zaehlt, s. zmSubmit), Killswitch-gated.
function applyZmSubmit(p, msg) {
  if (game.locked) return;
  zmSubmit(p, msg && msg.data);
}

function onZmSubmit(conn, msg) {
  const p = participants.get(conn.clientId);
  if (!p || p.role !== 'player') return;
  applyZmSubmit(p, msg);
}

// --- Spieler: fuer eine Zeichnung abstimmen (Zeichenquiz) -------------------
function applyZmVote(p, msg) {
  if (game.locked) return;
  zmCastVote(p, msg && msg.slotIdx);
}

function onZmVote(conn, msg) {
  const p = participants.get(conn.clientId);
  if (!p || p.role !== 'player') return;
  applyZmVote(p, msg);
}

// Emoji-Reaktion eines Spielers: schwebt am Bildschirm auf (generisch, spiel-
// unabhaengig, kein Teil des synchronisierten Spielzustands, s. broadcastReaction).
// Rate-Limit haengt am Teilnehmer selbst (ueberlebt Spielwechsel), nicht am `game`.
function onReaction(conn, msg) {
  if (!config.reactions.enabled) return;
  const p = participants.get(conn.clientId);
  if (!p || p.role !== 'player') return;
  const emoji = String(msg.emoji || '');
  if (!REACTION_EMOJIS.includes(emoji)) return;
  const minMs = REACTION_RATE_LIMIT_MS[config.reactions.rateLimit] || 0;
  const now = Date.now();
  if (minMs > 0 && p.lastReactionAt && now - p.lastReactionAt < minMs) return;
  p.lastReactionAt = now;
  broadcastReaction({ clientId: p.id, emoji, avatar: p.avatar || null, color: p.color || null, sound: !!msg.sound });
}

// Schnellumfrage (Fun-Pannel): Ja/Nein-Stimme, bis zum Beenden aenderbar.
function onPollVote(conn, msg) {
  if (game.locked || game.poll.status !== 'open') return;
  const p = participants.get(conn.clientId);
  if (!p || p.role !== 'player') return;
  if (msg.vote !== 'ja' && msg.vote !== 'nein') return;
  game.poll.votes[p.id] = msg.vote;
  bus.broadcast();
}

module.exports = {
  onPress, onSubmitWord, onGuess, onAnswer, onTfAnswer, onAssign, onEstimate, onOrder, onReaction, onPollVote,
  onZmSubmit, onZmVote,
  // Fuer den Master-Stellvertreter-Kanal (Nur-Master-Modus, s. lib/handlers/master.js):
  // dieselbe Kernlogik, aber fuer einen vom Master gewaehlten Teilnehmer statt den
  // Absender der Nachricht.
  applyPress, applySubmitWord, applyGuess, applyAnswer, applyTfAnswer, applyAssign, applyEstimate, applyOrder,
  applyZmSubmit, applyZmVote
};
