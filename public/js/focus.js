'use strict';
/*
 * Fokus-Ueberwachung (generisch, Tab ⚙️ Allgemein): Spieler-Seite und Bildschirm
 * melden, ob ihr Fenster im Vordergrund ist; der Master sieht es live (Badges in
 * der Geraeteliste) und als kurze Toasts. Kein Log. Die Karenzzeit laeuft auf dem
 * Server (eine eingefrorene Hintergrund-Seite kann keinen Timer mehr ausloesen).
 * Bildschirme werden Spielern per IP / „Wer bist du?"-Popup / Master zugeordnet.
 */

let focusLastSent = null;       // zuletzt gemeldeter Zustand (null = noch nichts gesendet)
let focusToastLayer = null;
let focusClaimToken = null;     // Token des aktuell gebauten „Wer bist du?"-Popups (Bildschirm)
let focusScreensSig = null;     // Signatur der Master-Bildschirmliste

const focusEnabled = (s) => !!(s && s.settings && s.settings.focus && s.settings.focus.enabled);

// ---------------------------------------------------------------------------
// Toasts (klein, stapelbar, verschwinden von selbst)
// ---------------------------------------------------------------------------
function showToast(html, kind, ms) {
  if (!focusToastLayer) {
    focusToastLayer = document.createElement('div');
    focusToastLayer.className = 'toast-layer';
    document.body.appendChild(focusToastLayer);
  }
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || 'info');
  el.innerHTML = html;
  focusToastLayer.appendChild(el);
  while (focusToastLayer.children.length > 5) focusToastLayer.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, ms || 4000);
}

// ---------------------------------------------------------------------------
// Spieler + Bildschirm: Sichtbarkeit melden
// ---------------------------------------------------------------------------
function focusIsHidden() {
  return document.hidden || !document.hasFocus();
}

function focusReport(force) {
  if (role !== 'player' && role !== 'screen') return;
  if (!focusEnabled(latestState)) { focusLastSent = null; return; }
  const hidden = focusIsHidden();
  if (!force && hidden === focusLastSent) return;
  focusLastSent = hidden;
  send({ type: 'visibility', hidden });
}

// Neue Verbindung: Zustand beim Server neu anmelden.
function focusOnWelcome() {
  focusLastSent = null;
}

function setupFocus() {
  if (role !== 'player' && role !== 'screen') return;
  document.addEventListener('visibilitychange', () => focusReport());
  window.addEventListener('blur', () => focusReport());
  window.addEventListener('focus', () => focusReport());
  window.addEventListener('pagehide', () => focusReport());
  window.addEventListener('pageshow', () => focusReport());
}

function focusOnState(s) {
  if (role === 'player' || role === 'screen') {
    focusReport();
    if (role === 'player') renderFocusHint(s);
    if (role === 'screen') renderScreenClaim(s);
  } else if (role === 'master') {
    renderFocusMaster(s);
  }
}

// Hinweis fuer Spieler (nur wenn „Spieler informieren" aktiv ist).
function renderFocusHint(s) {
  const f = s.settings.focus;
  let el = $('focus-hint');
  const show = f && f.enabled && f.notifyPlayer;
  if (!show) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'focus-hint';
    el.className = 'focus-hint';
    el.textContent = '👁 Der Master sieht, wenn du diese Seite verlässt.';
    $('view-player').appendChild(el);
  }
}

function focusOnNotice() {
  showToast('👁 Du hast die Seite verlassen – der Master wurde informiert.', 'warn', 5000);
}

// ---------------------------------------------------------------------------
// Bildschirm: „Wer bist du?"-Popup
// ---------------------------------------------------------------------------
function renderScreenClaim(s) {
  const claim = s.focusClaim || null;
  let el = $('screen-claim');
  if (!claim) {
    if (el) el.remove();
    focusClaimToken = null;
    return;
  }
  if (focusClaimToken === claim.token && el) return;
  focusClaimToken = claim.token;
  if (el) el.remove();
  el = document.createElement('div');
  el.id = 'screen-claim';
  el.className = 'screen-claim';
  const box = document.createElement('div');
  box.className = 'screen-claim-box';
  box.innerHTML = '<h2>👋 Wer bist du?</h2><p class="muted">Tippe auf deinen Namen, damit der Master dich zuordnen kann.</p>';
  const list = document.createElement('div');
  list.className = 'claim-list';
  if (!claim.players.length) {
    list.innerHTML = '<p class="muted">Kein freier Spieler gefunden.</p>';
  }
  claim.players.forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'claim-btn';
    b.innerHTML = avatarChip(p) + ' ' + escapeHtml(p.name);
    b.addEventListener('click', () => send({ type: 'screenClaim', token: claim.token, owner: p.id }));
    list.appendChild(b);
  });
  box.appendChild(list);
  el.appendChild(box);
  document.body.appendChild(el);
}

// ---------------------------------------------------------------------------
// Master: Einstellungen, Badges, Bildschirmliste, Toasts
// ---------------------------------------------------------------------------
function setupFocusMaster() {
  const sw = $('focus-switch'), notify = $('focus-notify'), tol = $('focus-tolerance');
  if (!sw) return;
  const push = (settings) => send({ type: 'master', action: 'setFocus', settings });
  sw.addEventListener('change', () => push({ enabled: sw.checked }));
  notify.addEventListener('change', () => push({ notifyPlayer: notify.checked }));
  tol.addEventListener('change', () => {
    const v = parseFloat(String(tol.value).replace(',', '.'));
    if (Number.isFinite(v)) push({ toleranceSec: v });
  });
  tol.addEventListener('keydown', (e) => { if (e.key === 'Enter') tol.blur(); });
  $('focus-ask-all').addEventListener('click', () => send({ type: 'master', action: 'screenAsk', clientId: 'all' }));
  $('focus-ask-clear').addEventListener('click', () => send({ type: 'master', action: 'screenAskClear', clientId: 'all' }));
}

// Kleines Status-Badge fuer eine Zeile der Geraeteliste.
function focusBadgeText(p) {
  const f = p.focus;
  if (!f) return '';
  let t = '';
  if (p.online && f.phone) t += '<span class="fb away" title="Spieler-Seite nicht im Vordergrund">📱 weg</span>';
  if (f.screen === true) t += '<span class="fb away" title="Bildschirm nicht im Vordergrund">🖥️ weg</span>';
  else if (f.screen === false) t += '<span class="fb ok" title="Bildschirm zugeordnet und im Vordergrund">🖥️</span>';
  return t;
}

function renderFocusMaster(s) {
  const f = s.settings.focus || { enabled: false, notifyPlayer: false, toleranceSec: 1.5 };
  const sw = $('focus-switch');
  if (!sw) return;
  sw.checked = f.enabled;
  $('focus-notify').checked = f.notifyPlayer;
  const tol = $('focus-tolerance');
  if (document.activeElement !== tol && tol.value !== String(f.toleranceSec)) tol.value = f.toleranceSec;
  $('focus-options').classList.toggle('hidden', !f.enabled);
  renderFocusScreens(s, f.enabled);
}

function renderFocusScreens(s, enabled) {
  const box = $('focus-screens');
  const parts = s.participants || [];
  const screens = enabled ? parts.filter((p) => p.role === 'screen' && p.online && !p.host) : [];
  const players = parts.filter((p) => p.role === 'player' && !p.local);
  box.classList.toggle('hidden', !screens.length);
  const sig = screens.map((p) => [p.id, p.owner, p.ownerManual, p.asking, p.away].join(':')).join('|') +
    '#' + players.map((p) => p.id + p.name).join(',');
  if (sig === focusScreensSig) return;
  focusScreensSig = sig;
  const list = $('focus-screen-list');
  list.innerHTML = '';
  screens.forEach((sc, i) => {
    const row = document.createElement('div');
    row.className = 'focus-screen-row';
    const label = document.createElement('span');
    label.className = 'dname';
    label.textContent = '🖥️ Bildschirm ' + (i + 1) + (sc.owner ? (sc.ownerManual ? '' : ' (auto)') : ' · unzugeordnet');
    const sel = document.createElement('select');
    sel.className = 'team-select';
    const none = document.createElement('option');
    none.value = ''; none.textContent = '— Automatik / keiner';
    sel.appendChild(none);
    players.forEach((p) => {
      const o = document.createElement('option');
      o.value = p.id; o.textContent = p.name;
      sel.appendChild(o);
    });
    sel.value = sc.owner && sc.ownerManual ? sc.owner : '';
    sel.addEventListener('change', () => send({ type: 'master', action: 'screenAssign', clientId: sc.id, owner: sel.value || null }));
    const ask = document.createElement('button');
    ask.type = 'button';
    ask.className = 'btn btn-ghost small';
    ask.textContent = sc.asking ? '❓ zurückziehen' : '❓ Wer bist du?';
    ask.addEventListener('click', () => send({
      type: 'master', action: sc.asking ? 'screenAskClear' : 'screenAsk', clientId: sc.id
    }));
    row.append(label, sel, ask);
    list.appendChild(row);
  });
}

// Statuswechsel als Toast beim Master.
function focusOnEvent(msg) {
  if (role !== 'master') return;
  const who = '<b>' + escapeHtml(msg.name) + '</b>';
  if (msg.kind === 'claim') {
    showToast('🖥️ Bildschirm gehört zu ' + who + ' (selbst gewählt)', 'info', 4000);
  } else {
    const scr = msg.kind === 'screen';
    showToast(msg.away
      ? (scr ? '🖥️ ' : '📱 ') + who + (scr ? ' hat den Bildschirm verlassen' : ' hat die Seite verlassen')
      : '✅ ' + who + ' ist zurück' + (scr ? ' (Bildschirm)' : ' (Seite)'),
    msg.away ? 'warn' : 'ok', msg.away ? 6000 : 3500);
  }
}
