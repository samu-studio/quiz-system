'use strict';
// ---------------------------------------------------------------------------
// Gluecksrad (Fun-Pannel): Overlay am Bildschirm + Steuerung im Master-Tab „🎉 Fun".
// Der Server lost den Gewinner aus (lib/wheel.js) und schickt nur Ziel-Segment,
// Versatz im Segment, Umdrehungen und Dauer – hier wird nur animiert.
// - renderScreenWheel(s): Bildschirm, folgt s.wheel (nur Bildschirm+Master bekommen es).
// - renderFunWheel(s): Master, Moduswahl Spieler/Freitext, Spielerauswahl, Buttons.
// - setupWheel(): verdrahtet die Master-Bedienelemente.
// ---------------------------------------------------------------------------
const WHEEL_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899'];

let wheelRot = 0;            // Bildschirm: aktuelle Drehung der Scheibe (Grad, im Uhrzeigersinn)
let wheelToken = null;       // Bildschirm: zuletzt verarbeitete Drehung (null = noch nie gerendert)
let wheelDiscSig = '';       // Bildschirm: Signatur der gezeichneten Segmente
let wheelSigs = {};          // Master: Signaturen, damit nur bei Aenderung neu gebaut wird
let wheelTextTimer = null;   // Master: Entprellung der Freitext-Eingabe

function wheelMod(a, m) { return ((a % m) + m) % m; }

// Scheibe als SVG (viewBox -100..100, Segment 0 beginnt oben, im Uhrzeigersinn).
function buildWheelSvg(entries) {
  const n = entries.length;
  if (n === 0) return '<svg viewBox="-100 -100 200 200"><circle r="98" fill="var(--panel-2)" stroke="var(--border)"/>' +
    '<text x="0" y="40" text-anchor="middle" font-size="9" fill="var(--muted)">Keine Felder</text></svg>';
  const seg = 360 / n;
  const pt = (deg, r) => { const t = (deg - 90) * Math.PI / 180; return (r * Math.cos(t)).toFixed(2) + ' ' + (r * Math.sin(t)).toFixed(2); };
  const fs = Math.max(4.5, Math.min(11, 150 / Math.max(n, 1), 120 / Math.max(...entries.map((e) => (e.label || '').length + (e.avatar ? 2 : 0)), 6)));
  let out = '<svg viewBox="-100 -100 200 200">';
  entries.forEach((e, i) => {
    let col = e.color || WHEEL_COLORS[i % WHEEL_COLORS.length];
    // Gleiche Farbe am Uebergang letztes->erstes Segment vermeiden.
    if (!e.color && i === n - 1 && n > 1 && i % WHEEL_COLORS.length === 0) col = WHEEL_COLORS[1];
    const a0 = i * seg, a1 = (i + 1) * seg;
    const path = n === 1
      ? '<circle r="98" fill="' + escapeHtml(col) + '"/>'
      : '<path d="M0 0 L' + pt(a0, 98) + ' A98 98 0 ' + (seg > 180 ? 1 : 0) + ' 1 ' + pt(a1, 98) + ' Z" fill="' + escapeHtml(col) + '" stroke="rgba(0,0,0,.35)" stroke-width=".6"/>';
    let label = (e.avatar ? e.avatar + ' ' : '') + (e.label || '');
    if (label.length > 22) label = label.slice(0, 21) + '…';
    const mid = a0 + seg / 2;
    out += path + '<text transform="rotate(' + (mid - 90).toFixed(2) + ') translate(58 0)" text-anchor="middle" dominant-baseline="central"' +
      ' font-size="' + fs.toFixed(1) + '" class="wheel-label">' + escapeHtml(label) + '</text>';
  });
  return out + '<circle r="98" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2"/></svg>';
}

// Zielwinkel: der Zeiger oben zeigt auf (index + offset) * Segmentbreite.
function wheelTargetRot(spin) {
  const seg = 360 / spin.count;
  const desired = wheelMod(-(spin.index + spin.offset) * seg, 360);
  const base = wheelRot + spin.turns * 360;
  return base + wheelMod(desired - wheelMod(base, 360), 360);
}

function renderScreenWheel(s) {
  const el = $('screen-wheel');
  if (!el) return;
  const w = s.wheel;
  const show = !!(w && w.visible);
  const wasHidden = el.classList.contains('hidden');
  el.classList.toggle('hidden', !show);
  if (!w) return;
  const disc = $('wheel-disc');

  const sig = JSON.stringify(w.entries.map((e) => [e.label, e.avatar, e.color]));
  if (sig !== wheelDiscSig) { wheelDiscSig = sig; disc.innerHTML = buildWheelSvg(w.entries); }

  if (w.token !== wheelToken) {
    const first = wheelToken === null;
    wheelToken = w.token;
    if (w.spin) {
      const target = wheelTargetRot(w.spin);
      if (first || !w.spinning || !show) {
        // Erstes Rendern / Reconnect nach der Drehung: direkt auf die Endstellung.
        disc.style.transition = 'none';
        disc.style.transform = 'rotate(' + target + 'deg)';
      } else {
        if (wasHidden) { disc.style.transition = 'none'; void disc.offsetWidth; }
        disc.style.transition = 'transform ' + w.spin.durationMs + 'ms cubic-bezier(.12,.6,.08,1)';
        disc.style.transform = 'rotate(' + target + 'deg)';
      }
      wheelRot = target;
    }
  }

  const res = $('wheel-result');
  const win = !w.spinning && w.winner;
  res.classList.toggle('hidden', !win);
  if (win) {
    const html = '🎉 ' + avatarChip(w.winner) + ' <span>' + escapeHtml(w.winner.label) + '</span>';
    if (res.dataset.html !== html) { res.dataset.html = html; res.innerHTML = html; }
  } else res.dataset.html = '';
}

// --- Master -----------------------------------------------------------------
function wheelParseTexts(v) {
  return String(v || '').split('\n').map((t) => t.trim()).filter((t) => t);
}

function renderFunWheel(s) {
  const w = s.wheel;
  const adm = s.wheelAdmin;
  if (!w || !adm || !$('wheel-mode')) return;
  document.querySelectorAll('#wheel-mode .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === w.mode));
  $('wheel-players-box').classList.toggle('hidden', w.mode !== 'players');
  $('wheel-text-box').classList.toggle('hidden', w.mode !== 'text');

  // Spielerauswahl (Checkboxen = Server-Stand)
  const players = proxyPlayers(s);
  const chosen = new Set(adm.playerIds);
  const list = $('wheel-players');
  const lSig = players.map((p) => p.id + ':' + p.name + ':' + p.avatar + ':' + p.online + ':' + chosen.has(p.id)).join('|');
  if (wheelSigs.players !== lSig) {
    wheelSigs.players = lSig;
    list.innerHTML = '';
    if (players.length === 0) list.innerHTML = '<p class="muted small">Noch keine Spieler verbunden.</p>';
    players.forEach((p) => {
      const lab = document.createElement('label');
      lab.className = 'row';
      lab.innerHTML = '<input type="checkbox" /> ' + avatarChip(p) + ' ' + escapeHtml(p.name) + (p.online ? '' : ' <span class="muted small">(offline)</span>');
      const cb = lab.querySelector('input');
      cb.checked = chosen.has(p.id);
      cb.addEventListener('change', () => {
        const ids = (latestState && latestState.wheelAdmin ? latestState.wheelAdmin.playerIds : []).filter((id) => id !== p.id);
        if (cb.checked) ids.push(p.id);
        send({ type: 'master', action: 'wheelSetEntries', mode: 'players', playerIds: ids });
      });
      list.appendChild(lab);
    });
  }

  // Freitext: nur uebernehmen, wenn der Master nicht gerade tippt.
  const ta = $('wheel-text');
  if (document.activeElement !== ta && !wheelTextTimer && wheelParseTexts(ta.value).join('\n') !== adm.texts.join('\n')) {
    ta.value = adm.texts.join('\n');
  }

  // Gespeicherte Drehdauer (config.fun) uebernehmen, solange der Regler nicht bedient wird.
  const dur = $('wheel-duration');
  const fun = s.admin && s.admin.fun;
  if (fun && document.activeElement !== dur && dur.value !== String(fun.wheelDuration)) {
    dur.value = fun.wheelDuration;
    $('wheel-duration-v').textContent = dur.value + ' s';
  }

  $('wheel-show-btn').textContent = w.visible ? '🙈 Ausblenden' : '👁 Einblenden';
  $('wheel-spin-btn').disabled = w.spinning || w.entries.length === 0;
  $('wheel-remove-btn').disabled = w.spinning || !w.winner;
  $('wheel-info').textContent = w.spinning ? '🎡 Dreht …'
    : w.winner ? '🎯 Ergebnis: ' + (w.winner.avatar ? w.winner.avatar + ' ' : '') + w.winner.label
    : w.entries.length + ' Feld' + (w.entries.length === 1 ? '' : 'er') + ' im Rad';
}

function setupWheel() {
  if (!$('wheel-mode')) return;
  const sendEntries = (patch) => send(Object.assign({ type: 'master', action: 'wheelSetEntries' }, patch));
  document.querySelectorAll('#wheel-mode .seg-btn').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.mode === 'text') sendEntries({ mode: 'text', texts: wheelParseTexts($('wheel-text').value) });
    else sendEntries({ mode: 'players' });
  }));
  const pickPlayers = (filter) => sendEntries({ mode: 'players', playerIds: latestState ? proxyPlayers(latestState).filter(filter).map((p) => p.id) : [] });
  $('wheel-all-btn').addEventListener('click', () => pickPlayers(() => true));
  $('wheel-online-btn').addEventListener('click', () => pickPlayers((p) => p.online));
  $('wheel-none-btn').addEventListener('click', () => pickPlayers(() => false));

  const ta = $('wheel-text');
  ta.addEventListener('input', () => {
    clearTimeout(wheelTextTimer);
    wheelTextTimer = setTimeout(() => {
      wheelTextTimer = null;
      sendEntries({ mode: 'text', texts: wheelParseTexts(ta.value) });
    }, 400);
  });

  const dur = $('wheel-duration');
  const durLabel = () => { $('wheel-duration-v').textContent = dur.value + ' s'; };
  dur.addEventListener('input', durLabel);
  dur.addEventListener('change', () => sendFunSettings({ wheelDuration: +dur.value }));
  durLabel();

  $('wheel-show-btn').addEventListener('click', () => {
    const vis = !!(latestState && latestState.wheel && latestState.wheel.visible);
    send({ type: 'master', action: 'wheelShow', on: !vis });
  });
  $('wheel-spin-btn').addEventListener('click', () => {
    // Laufende Freitext-Eingabe vorher noch abschicken.
    if (wheelTextTimer) { clearTimeout(wheelTextTimer); wheelTextTimer = null; sendEntries({ mode: 'text', texts: wheelParseTexts(ta.value) }); }
    send({ type: 'master', action: 'wheelSpin', durationSec: +dur.value });
  });
  $('wheel-remove-btn').addEventListener('click', () => send({ type: 'master', action: 'wheelRemoveWinner' }));
}
