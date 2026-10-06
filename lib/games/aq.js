'use strict';
/*
 * Audioquiz: wie Detektivquiz, aber die Hinweise sind laenger werdende Audio-
 * Ausschnitte statt Text. Abgespielt wird NUR am Bildschirm, ausgeloest ueber
 * ein Wiedergabe-Token; der Server verwaltet nur die freigegebene Laenge.
 * Spieler raten per Freitext (Master urteilt) oder per Buzzer + muendlich.
 * Optional (mehrfachBuzzer) duerfen mehrere nacheinander buzzern: der Master sieht
 * die Reihenfolge und gibt einzelne oder alle wieder frei.
 */
const { config, safeAudioName } = require('../config');
const { game, publicPlayer, recordScore } = require('../state');
const { shuffle } = require('../util');
const bus = require('../bus');

function normAudioRound(it) {
  if (!it || typeof it !== 'object') return null;
  const loesung = typeof it.loesung === 'string' ? it.loesung.trim().slice(0, 120) : '';
  if (!loesung) return null;
  const audio = safeAudioName(it.audio) || '';   // '' = (noch) keine Datei zugewiesen
  let stufen = [];
  if (Array.isArray(it.stufen)) {
    stufen = it.stufen
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n >= 0)
      .map((n) => Math.round(n * 10) / 10)        // max. 1 Nachkommastelle
      .slice(0, 12);
  }
  if (stufen.length === 0) stufen = [0];          // mindestens eine Stufe (ganzer Clip)
  const out = { loesung, audio, stufen };
  // Erweitert (optional): je Stufe ein eigener Abschnitt von..bis Sekunden statt
  // immer ab Clip-Anfang. bis 0 = bis zum Clip-Ende. Die Abschnitte bleiben auch bei
  // abgeschaltetem Modus gespeichert (Umschalten verliert nichts).
  if (Array.isArray(it.abschnitte)) {
    const r1 = (n) => Math.round(n * 10) / 10;
    out.abschnitte = it.abschnitte
      .map((a) => ({ von: Number(a && a.von), bis: Number(a && a.bis) || 0 }))
      .filter((a) => Number.isFinite(a.von) && a.von >= 0 && Number.isFinite(a.bis) && a.bis >= 0)
      .map((a) => ({ von: r1(a.von), bis: r1(a.bis) }))
      .filter((a) => a.bis === 0 || a.bis > a.von)
      .slice(0, 12);
  }
  out.erweitert = !!it.erweitert && Array.isArray(out.abschnitte) && out.abschnitte.length > 0;
  return out;
}

// Abspiel-Teile einer Runde: [{ von, sec }] – Startpunkt + Länge in Sekunden
// (sec 0 = bis zum Clip-Ende). Standard: jede Stufe ab 0; erweitert: eigene Abschnitte.
function aqTeile(round) {
  if (!round) return [];
  if (round.erweitert) {
    return round.abschnitte.map((a) => ({ von: a.von, sec: a.bis > 0 ? Math.round((a.bis - a.von) * 10) / 10 : 0 }));
  }
  return round.stufen.map((s) => ({ von: 0, sec: s }));
}

function activeAqCfg() {
  const g = config.games.aq || {};
  const prof = (g.profiles && g.profiles[g.activeProfile]) || {};
  const intro = typeof prof.intro === 'string' ? prof.intro : '';
  const startPunkte = Number.isFinite(prof.startPunkte) ? prof.startPunkte : 100;
  const abzugProStufe = Number.isFinite(prof.abzugProStufe) ? prof.abzugProStufe : 20;
  let minPunkte = Number.isFinite(prof.minPunkte) ? prof.minPunkte : 20;
  if (minPunkte > startPunkte) minPunkte = startPunkte;
  const runden = Array.isArray(prof.runden) ? prof.runden.map(normAudioRound).filter(Boolean) : [];
  return { intro, buzzerModus: !!prof.buzzerModus, mehrfachBuzzer: !!prof.mehrfachBuzzer, startPunkte, abzugProStufe, minPunkte, mischen: !!prof.mischen, runden };
}

function initAq() {
  game.aq = { order: [], pos: -1, phase: 'lobby', revealed: 0, playToken: 0, answers: {}, buzzes: [], winner: null };
}

// Aktuelle Runde aufloesen ({ loesung, audio, stufen }) oder null.
function aqCurrentRound() {
  const cfg = activeAqCfg();
  const idx = game.aq.order[game.aq.pos];
  if (idx == null) return null;
  return cfg.runden[idx] || null;
}

// Punktwert bei „level" freigeschalteten Ausschnitt-Stufen: Startpunkte minus Abzug
// je Stufe nach der ersten, mit Boden. level ist 1-basiert (1 Stufe = voller Startwert).
function aqPointsAt(cfg, level) {
  let pts = cfg.startPunkte - cfg.abzugProStufe * (Math.max(1, level) - 1);
  pts = Math.round(pts);
  if (pts < cfg.minPunkte) pts = cfg.minPunkte;
  if (pts > cfg.startPunkte) pts = cfg.startPunkte;
  return pts;
}

// Freigegebener Ausschnitt beim aktuellen Stufen-Stand: { von, sec } (sec 0 = bis
// Clip-Ende). Beim Auflösen ist immer der ganze Clip frei (zum Vorspielen der Lösung).
function aqSnippet(round, phase, revealed) {
  if (!round || phase === 'reveal') return { von: 0, sec: 0 };   // ganzer Clip
  const t = aqTeile(round)[Math.max(0, revealed - 1)];
  return t || { von: 0, sec: 0 };
}

// Quiz starten: Rundenreihenfolge festlegen (optional gemischt), erste Runde zeigen
// (erste Ausschnitt-Stufe frei, einmal abspielen). Ohne Runden passiert nichts.
function aqStart() {
  const cfg = activeAqCfg();
  if (cfg.runden.length === 0) return;
  let order = cfg.runden.map((_, i) => i);
  if (cfg.mischen) order = shuffle(order);
  game.aq.order = order;
  game.aq.pos = 0;
  game.aq.phase = 'running';
  game.aq.revealed = 1;
  game.aq.playToken++;                               // Bildschirm spielt den ersten Ausschnitt
  game.aq.answers = {};
  game.aq.buzzes = [];
  game.aq.winner = null;
  bus.broadcast();
}

// Naechste (laengere) Ausschnitt-Stufe freischalten und abspielen (bis alle frei sind).
// Waehrend ein Buzz (bzw. die Buzz-Reihe) auf Entscheidung wartet, wird nicht weiter freigeschaltet.
function aqNextClue() {
  if (game.aq.phase !== 'running') return;
  if (game.aq.buzzes.length) return;
  const cur = aqCurrentRound();
  if (!cur) return;
  if (game.aq.revealed < aqTeile(cur).length) {
    game.aq.revealed++;
    game.aq.playToken++;                             // laengeren Ausschnitt sofort spielen
    bus.broadcast();
  }
}

// Aktuellen Ausschnitt (bzw. in der Auflösung den ganzen Clip) erneut abspielen.
function aqReplay() {
  if (game.aq.phase !== 'running' && game.aq.phase !== 'reveal') return;
  if (game.aq.buzzes.length) return;                          // Buzz wartet: Ton bleibt aus
  game.aq.playToken++;
  bus.broadcast();
}

// Freitext-Modus: einen Spieler als richtig werten. Punkte = eingefrorener Wert beim
// Stufen-Stand SEINER Abgabe (Freeze bei Abgabe). Beendet die Runde.
function aqAward(clientId) {
  if (game.aq.phase !== 'running') return;
  const cfg = activeAqCfg();
  if (cfg.buzzerModus) return;                       // Freitext-Modus only
  const a = game.aq.answers[clientId];
  if (!a) return;
  const pts = aqPointsAt(cfg, a.level);
  recordScore(clientId, pts, { game: 'aq' });
  game.aq.winner = Object.assign(publicPlayer(clientId), { points: pts, level: a.level });
  game.aq.phase = 'reveal';
  // Beim Auflösen NICHT automatisch abspielen – der Master kann den ganzen Clip
  // bei Bedarf über „Nochmal abspielen" starten.
  bus.broadcast();
}

// Eintrag der Buzz-Reihe zu clientId (ohne Angabe: der erste in der Reihe).
function aqBuzzIndex(clientId) {
  if (!clientId) return game.aq.buzzes.length ? 0 : -1;
  return game.aq.buzzes.findIndex((b) => b.id === clientId);
}

// Buzzer-Modus: einen Buzz (ohne clientId: den ersten der Reihe) als richtig werten.
// Punkte = eingefrorener Wert beim Stufen-Stand DIESES Buzz. Beendet die Runde.
function aqBuzzOk(clientId) {
  if (game.aq.phase !== 'running') return;
  const i = aqBuzzIndex(clientId);
  if (i < 0) return;
  const cfg = activeAqCfg();
  const b = game.aq.buzzes[i];
  const pts = aqPointsAt(cfg, b.level);
  recordScore(b.id, pts, { game: 'aq' });
  game.aq.winner = Object.assign(publicPlayer(b.id), { points: pts, level: b.level });
  game.aq.buzzes = [];
  game.aq.phase = 'reveal';
  bus.broadcast();
}

// Buzzer-Modus: einen Buzz (ohne clientId: den ersten der Reihe) als falsch werten
// bzw. freigeben – kein Abzug, der Spieler darf wieder buzzern. Die Runde bleibt
// offen (Master spielt ggf. weiter ab, sobald die Reihe leer ist).
function aqBuzzWrong(clientId) {
  if (game.aq.phase !== 'running') return;
  const i = aqBuzzIndex(clientId);
  if (i < 0) return;
  game.aq.buzzes.splice(i, 1);
  bus.broadcast();
}

// Buzzer-Modus: die ganze Buzz-Reihe auf einmal freigeben (alle duerfen wieder).
function aqBuzzReleaseAll() {
  if (game.aq.phase !== 'running' || !game.aq.buzzes.length) return;
  game.aq.buzzes = [];
  bus.broadcast();
}

// Spieler-Buzz (Buzzer-Modus): standardmaessig gewinnt der erste eintreffende Buzz
// und wartet auf die Master-Entscheidung; weitere werden ignoriert, solange einer
// aussteht. Mit mehrfachBuzzer reihen sich weitere Buzzes (je Spieler einmal, bis
// er freigegeben wird) in Eintreffens-Reihenfolge dahinter ein. Der Stufen-Stand
// wird je Buzz als Punkte-Basis eingefroren. Der Bildschirm stoppt den Ton, sobald
// ein Buzz ansteht. elapsedMs (lokal gemessen) nur als interner Tiebreak.
function aqBuzz(p, msg) {
  const cfg = activeAqCfg();
  if (!cfg.buzzerModus) return;                      // nur im Buzzer-Modus
  if (game.aq.phase !== 'running') return;
  if (game.aq.buzzes.length && !cfg.mehrfachBuzzer) return;   // es wartet schon ein Buzz
  if (game.aq.buzzes.some((b) => b.id === p.id)) return;      // schon in der Reihe
  let elapsed = Number(msg && msg.elapsedMs);
  game.aq.buzzes.push({
    id: p.id,
    level: game.aq.revealed,
    elapsed: Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed) : null
  });
  bus.broadcast();
}

// Lösung zeigen, ohne dass jemand richtig lag. Beendet die Runde ohne Punkte.
function aqRevealSolution() {
  if (game.aq.phase !== 'running') return;
  game.aq.buzzes = [];
  game.aq.winner = null;
  game.aq.phase = 'reveal';
  // Kein playToken++ – „Lösung zeigen" startet keinen Ton mehr (nur „Nochmal
  // abspielen" spielt in der Auflösung den ganzen Clip).
  bus.broadcast();
}

// Audioquiz-Lautstaerke am Bildschirm setzen (0..1, vom Master gesteuert).
function aqSetVolume(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return;
  game.aqVolume = Math.min(1, Math.max(0, n));
  bus.broadcast();
}

// Naechste Runde (oder Endstand nach der letzten). Nur aus der Auflösungsphase.
function aqNextRound() {
  if (game.aq.phase !== 'reveal') return;
  if (game.aq.pos + 1 >= game.aq.order.length) {
    game.aq.phase = 'done';
    bus.broadcast();
    return;
  }
  game.aq.pos++;
  game.aq.phase = 'running';
  game.aq.revealed = 1;
  game.aq.playToken++;
  game.aq.answers = {};
  game.aq.buzzes = [];
  game.aq.winner = null;
  bus.broadcast();
}

// Oeffentliche (maskierte) Audioquiz-Sicht fuer Spieler/Bildschirm. Nur die aktuell
// freigegebene Ausschnitt-Länge + das Wiedergabe-Token sind sichtbar; die Loesung
// (und der Dateiname) kommen NICHT hier (Dateiname nur an Bildschirm+Master).
function publicAq() {
  const cfg = activeAqCfg();
  const aq = game.aq;
  const out = {
    phase: aq.phase,
    intro: cfg.intro,
    buzzerModus: cfg.buzzerModus,
    mehrfachBuzzer: cfg.mehrfachBuzzer,
    startPunkte: cfg.startPunkte,
    abzugProStufe: cfg.abzugProStufe,
    minPunkte: cfg.minPunkte,
    total: aq.order.length || cfg.runden.length,
    number: aq.pos + 1,
    playToken: aq.playToken,
    volume: game.aqVolume,
    answered: Object.keys(aq.answers).length
  };
  if (aq.phase === 'running' || aq.phase === 'reveal') {
    const cur = aqCurrentRound();
    if (cur) {
      const snip = aqSnippet(cur, aq.phase, aq.revealed);
      out.stufenCount = aqTeile(cur).length;
      out.revealed = aq.revealed;
      out.snippetVon = snip.von;                    // Startpunkt in Sekunden
      out.snippetSec = snip.sec;                    // Länge; 0 = bis Clip-Ende
      out.pointsNow = aqPointsAt(cfg, aq.revealed);
      if (aq.phase === 'reveal') {
        out.loesung = cur.loesung;
        out.winner = aq.winner
          ? { id: aq.winner.id, name: aq.winner.name, avatar: aq.winner.avatar, color: aq.winner.color, points: aq.winner.points }
          : null;
      }
    }
    // Buzzer-Wartezustand (wer hat gebuzzert, in Reihenfolge) – oeffentlich fuer
    // Bildschirm/Spieler. buzz = der erste der Reihe (der gerade antworten darf).
    if (aq.buzzes.length) {
      out.buzzes = aq.buzzes.map((b) => Object.assign(publicPlayer(b.id), { level: b.level }));
      out.buzz = out.buzzes[0];
    }
  }
  return out;
}

module.exports = {
  activeAqCfg, normAudioRound, initAq, aqCurrentRound, aqPointsAt, aqTeile, aqSnippet,
  aqStart, aqNextClue, aqReplay, aqAward, aqBuzzOk, aqBuzzWrong, aqBuzzReleaseAll, aqBuzz, aqRevealSolution, aqSetVolume, aqNextRound, publicAq
};
