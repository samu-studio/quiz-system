'use strict';
/*
 * Kleine, spielunabhaengige Helfer (Zufall, Zahlen-Clamping, IDs, gemeinsame
 * Frage-Normalisierung fuer MC/Zeitdruck).
 */
const crypto = require('crypto');

function genId() {
  return crypto.randomBytes(6).toString('hex');
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Punktwert auf eine ganze Zahl in vernuenftigen Grenzen begrenzen (negativ erlaubt).
function clampScore(v) {
  let n = Math.round(Number(v));
  if (!Number.isFinite(n)) n = 0;
  return Math.max(-100000, Math.min(100000, n));
}

// Zufaellige Reihenfolge (Fisher-Yates, in-place auf einer Kopie).
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Eine einzelne Multiple-Choice-Frage validieren/normalisieren. Ungueltige
// Fragen (leer, < 2 Antworten) ergeben null und werden verworfen. Wird von
// MC UND Zeitdruck genutzt (gleiches Fragenformat).
function normQuestion(it) {
  if (!it || typeof it !== 'object') return null;
  const q = typeof it.q === 'string' ? it.q.trim().slice(0, 200) : '';
  let answers = Array.isArray(it.answers) ? it.answers.map((a) => String(a).trim().slice(0, 120)) : [];
  answers = answers.filter(Boolean).slice(0, 6);
  let correct = Number(it.correct);
  if (!Number.isInteger(correct) || correct < 0 || correct >= answers.length) correct = 0;
  if (!q || answers.length < 2) return null;
  return { q, answers, correct };
}

// Punkte-Staffel je Platzierung aus einem Komma/Zeilen-getrennten String parsen
// (z. B. "3, 2, 1" -> [3,2,1]). Wird von Schaetzquiz UND Reaktion genutzt.
function parseRangPunkte(str) {
  return String(str == null ? '' : str)
    .split(/[,\n;]+/)
    .map((s) => Math.round(Number(s.trim())))
    .filter((n) => Number.isFinite(n) && n >= 0);
}

module.exports = { genId, clamp, clampScore, shuffle, normQuestion, parseRangPunkte };
