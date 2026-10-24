'use strict';
/*
 * Fokus-Ueberwachung (Tab ⚙️ Allgemein, generisch, spielunabhaengig). Spieler-
 * Seiten und Bildschirme melden per `visibility{hidden}`, ob ihr Fenster im
 * Vordergrund ist. Der Server haelt das rein als Laufzeitzustand am Teilnehmer
 * (kein Log) und zeigt es NUR dem Master – live in der Geraeteliste plus als
 * kurze Toasts (`focusEvent`, Einmal-Nachricht wie der Soundboard-Ton).
 *
 * - Karenzzeit (config.focus.toleranceSec) laeuft hier auf dem Server: eine
 *   eingefrorene Hintergrund-Seite kann keinen Client-Timer mehr auslaufen lassen.
 * - Bildschirme werden einem Spieler zugeordnet: automatisch per IP (genau ein
 *   Spieler mit derselben oeffentlichen IP, nie fuer den Host-Rechner/Beamer),
 *   sonst per Auswahl am Bildschirm („Wer bist du?", `screenClaim`) oder durch
 *   den Master (`screenAssign`). Nur zugeordnete Bildschirme zaehlen fuer einen Spieler.
 */
const bus = require('./bus');
const { config } = require('./config');
const { participants, publicPlayer } = require('./state');
const { localIPs } = require('./net');
const { genId } = require('./util');

function remoteIp(conn) {
  const a = (conn && conn.socket && conn.socket.remoteAddress) || '';
  return a.replace(/^::ffff:/, '');
}

// Beamer-Rechner (= Host): Loopback oder eine eigene LAN-IP.
function isHostIp(ip) {
  return !ip || ip === '127.0.0.1' || ip === '::1' || localIPs().includes(ip);
}

function sendToMasters(msg) {
  for (const p of participants.values()) {
    if (p.online && p.conn && p.conn.authed && p.role === 'master') { try { p.conn.send(msg); } catch (e) { /* egal */ } }
  }
}

function realPlayers() {
  const out = [];
  for (const p of participants.values()) if (p.role === 'player' && !p.local) out.push(p);
  return out;
}

// Zu welchem Spieler gehoert dieser Bildschirm? (null = unzugeordnet)
function ownerOf(screen) {
  if (screen.owner) {
    const o = participants.get(screen.owner);
    if (o && o.role === 'player') return o;
  }
  if (!screen.ip || isHostIp(screen.ip)) return null;
  const same = realPlayers().filter((p) => p.ip && p.ip === screen.ip);
  return same.length === 1 ? same[0] : null;
}

function ownedScreens(player) {
  const out = [];
  for (const p of participants.values()) {
    if (p.role === 'screen' && p.online && ownerOf(p) === player) out.push(p);
  }
  return out;
}

function clearTimer(p) {
  if (p.awayTimer) { clearTimeout(p.awayTimer); p.awayTimer = null; }
}

function setAway(p, away) {
  if (!!p.away === away) return;
  p.away = away;
  const target = p.role === 'player' ? p : ownerOf(p);
  if (target) {
    const who = publicPlayer(target.id);
    sendToMasters({
      type: 'focusEvent', kind: p.role === 'player' ? 'phone' : 'screen', away,
      id: who.id, name: who.name, avatar: who.avatar, color: who.color
    });
    // Spieler informieren (Einstellung): der Hinweis wartet auf der eingefrorenen
    // Verbindung, bis die Seite wieder vorne ist.
    if (away && config.focus.notifyPlayer && p.online && p.conn) p.conn.send({ type: 'focusNotice' });
  }
  bus.broadcast();
}

function onVisibility(conn, msg) {
  if (!config.focus.enabled) return;
  const p = participants.get(conn.clientId);
  if (!p || (p.role !== 'player' && p.role !== 'screen')) return;
  const hidden = msg.hidden === true;
  p.hidden = hidden;
  if (hidden) {
    if (p.away || p.awayTimer) return;
    p.awayTimer = setTimeout(() => { p.awayTimer = null; if (p.hidden) setAway(p, true); }, config.focus.toleranceSec * 1000);
  } else {
    clearTimer(p);
    if (p.away) setAway(p, false);
  }
}

// Verbindung weg: Zustand leise zuruecksetzen (der Online-Punkt zeigt es ohnehin).
function focusOnDisconnect(p) {
  clearTimer(p);
  p.hidden = false;
  p.away = false;
}

// Feature wird ausgeschaltet: alles zuruecksetzen.
function focusReset() {
  for (const p of participants.values()) {
    clearTimer(p);
    p.hidden = false;
    p.away = false;
    p.claimToken = null;
  }
}

function onScreenClaim(conn, msg) {
  if (!config.focus.enabled) return;
  const s = participants.get(conn.clientId);
  if (!s || s.role !== 'screen' || !s.claimToken || s.claimToken !== msg.token) return;
  const owner = participants.get(String(msg.owner || ''));
  if (!owner || owner.role !== 'player' || owner.local) return;
  s.owner = owner.id;
  s.ownerManual = true;
  s.claimToken = null;
  const who = publicPlayer(owner.id);
  sendToMasters({ type: 'focusEvent', kind: 'claim', id: who.id, name: who.name, avatar: who.avatar, color: who.color });
  bus.broadcast();
}

function screenAsk(clientId) {
  if (!config.focus.enabled) return;
  const targets = [];
  if (clientId === 'all') {
    for (const p of participants.values()) {
      if (p.role === 'screen' && p.online && !isHostIp(p.ip) && !ownerOf(p)) targets.push(p);
    }
  } else {
    const p = participants.get(clientId);
    if (p && p.role === 'screen' && p.online) targets.push(p);
  }
  targets.forEach((p) => { p.claimToken = genId(); });
  if (targets.length) bus.broadcast();
}

function screenAskClear(clientId) {
  for (const p of participants.values()) {
    if (p.role === 'screen' && p.claimToken && (clientId === 'all' || p.id === clientId)) p.claimToken = null;
  }
  bus.broadcast();
}

// Master ordnet einen Bildschirm manuell zu (owner null = zurueck auf Automatik).
function screenAssign(clientId, owner) {
  const s = participants.get(clientId);
  if (!s || s.role !== 'screen') return;
  if (owner) {
    const o = participants.get(owner);
    if (!o || o.role !== 'player' || o.local) return;
    s.owner = o.id;
    s.ownerManual = true;
  } else {
    s.owner = null;
    s.ownerManual = false;
  }
  s.claimToken = null;
  bus.broadcast();
}

function setFocusSettings(next) {
  const was = config.focus.enabled;
  config.focus = next;
  if (was && !next.enabled) focusReset();
}

// Auswahl fuer das „Wer bist du?"-Popup: Spieler ohne eigenen Bildschirm.
function claimPublicFor(screen) {
  if (!config.focus.enabled || !screen || !screen.claimToken) return null;
  const taken = new Set();
  for (const p of participants.values()) {
    if (p.role === 'screen' && p !== screen) { const o = ownerOf(p); if (o) taken.add(o.id); }
  }
  return {
    token: screen.claimToken,
    players: realPlayers().filter((p) => !taken.has(p.id))
      .map((p) => ({ id: p.id, name: p.name, avatar: p.avatar || null, color: p.color || null, online: !!p.online }))
  };
}

// Anreicherung der Teilnehmerliste (nur Master): Fokus-Status je Spieler / Zuordnung je Bildschirm.
function focusFields(p) {
  if (!config.focus.enabled) return {};
  if (p.role === 'player') {
    const scr = ownedScreens(p);
    return { focus: { phone: !!p.away, screen: scr.length ? scr.every((s) => s.away) : null } };
  }
  if (p.role === 'screen') {
    const o = ownerOf(p);
    return { owner: o ? o.id : null, ownerManual: !!(p.owner && p.ownerManual), away: !!p.away, host: isHostIp(p.ip), asking: !!p.claimToken };
  }
  return {};
}

module.exports = {
  remoteIp, onVisibility, onScreenClaim, focusOnDisconnect, focusReset, setFocusSettings,
  screenAsk, screenAskClear, screenAssign, claimPublicFor, focusFields
};
