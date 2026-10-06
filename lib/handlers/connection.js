'use strict';
/*
 * Verbindungs-Lifecycle: Hello/Reconnect, Namensaenderung, Disconnect.
 */
const bus = require('../bus');
const { genId } = require('../util');
const { participants, game, assignAvatarColor, PLAYER_AVATARS, PLAYER_COLORS } = require('../state');

function onHello(conn, msg) {
  const role = ['screen', 'master', 'player'].includes(msg.role) ? msg.role : 'player';
  let clientId = msg.clientId;
  let p = clientId ? participants.get(clientId) : null;

  if (p) {
    // Reconnect: bestehenden Teilnehmer uebernehmen
    p.online = true;
    p.role = role;
    p.conn = conn;
    if (msg.name) p.name = String(msg.name).slice(0, 24);
  } else {
    clientId = clientId || genId();
    const n = playerCount();   // fuer Default-Name (Spieler)
    p = {
      id: clientId,
      role,
      name: msg.name ? String(msg.name).slice(0, 24) : defaultName(role, n),
      online: true,
      conn
    };
    // Avatar/Farbe sind ein reines Spieler-Feature: jeder neue Spieler bekommt
    // deterministisch das naechste Preset (zyklisch), editierbar per setAvatar/
    // setColor. Master/Bildschirm brauchen das nicht.
    if (role === 'player') assignAvatarColor(p);
    participants.set(clientId, p);
  }
  conn.clientId = clientId;
  conn.role = role;

  conn.send({ type: 'welcome', clientId, serverTime: Date.now() });
  bus.broadcast();
}

function playerCount() {
  let n = 0;
  for (const p of participants.values()) if (p.role === 'player') n++;
  return n;
}

function defaultName(role, n) {
  if (role === 'screen') return 'Bildschirm';
  if (role === 'master') return 'Master';
  return 'Spieler ' + (n + 1);
}

function onSetName(conn, msg) {
  const p = participants.get(conn.clientId);
  if (!p) return;
  p.name = String(msg.name || '').slice(0, 24) || p.name;
  bus.broadcast();
}

// Spieler waehlt sein eigenes Avatar-Emoji (Ausklappmenue in der Kopfzeile) –
// nur Werte aus der PLAYER_AVATARS-Whitelist sind gueltig (kein freier Text).
function onSetAvatar(conn, msg) {
  const p = participants.get(conn.clientId);
  if (!p || p.role !== 'player') return;
  const avatar = String(msg.avatar || '');
  if (!PLAYER_AVATARS.includes(avatar)) return;
  p.avatar = avatar;
  bus.broadcast();
}

// Spieler waehlt seine eigene Farbe – nur Werte aus der PLAYER_COLORS-Preset-
// Palette sind gueltig (kein freier Farbwaehler).
function onSetColor(conn, msg) {
  const p = participants.get(conn.clientId);
  if (!p || p.role !== 'player') return;
  const color = String(msg.color || '');
  if (!PLAYER_COLORS.includes(color)) return;
  p.color = color;
  bus.broadcast();
}

// Spieler hat sein Fake-Popup (Fun-Pannel) „erledigt" – nur das aktuelle (token
// muss passen, sonst kommt ein verspaeteter Klick einem neueren Popup in die Quere).
function onPopupDone(conn, msg) {
  const pop = game.popups[conn.clientId];
  if (!pop || pop.done || pop.token !== msg.token) return;
  pop.done = true;
  bus.broadcast();
}

// Spieler hat seine Nachricht (Fun-Pannel) weggeklickt – nur wenn sie wegklickbar
// ist und der token zur aktuellen passt (wie onPopupDone).
function onMessageDone(conn, msg) {
  const m = game.messages[conn.clientId];
  if (!m || m.done || !m.closable || m.token !== msg.token) return;
  m.done = true;
  bus.broadcast();
}

function onDisconnect(conn) {
  if (!conn.clientId) return;
  const p = participants.get(conn.clientId);
  if (p && p.conn === conn) {
    p.online = false;
    p.conn = null;
    bus.broadcast();
  }
}

module.exports = { onHello, defaultName, onSetName, onSetAvatar, onSetColor, onPopupDone, onMessageDone, onDisconnect };
