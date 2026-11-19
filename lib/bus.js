'use strict';
/*
 * Kleiner Event-Bus: entkoppelt die Spiel-Logik (viele kleine Module) vom
 * Zustellungsschritt (Snapshot bauen + an alle Sockets senden). Jede Aktion,
 * die den Zustand aendert, ruft broadcast() auf; snapshot.js haengt sich mit
 * onChange() daran, um den neuen Zustand tatsaechlich zu verschicken.
 */
const { EventEmitter } = require('events');

const emitter = new EventEmitter();

// Aenderungen werden gebuendelt: viele broadcast()-Aufrufe kurz hintereinander
// (Buzzer, Antwort-Welle, mehrere Aktionen eines Handlers) ergeben nur EINEN
// Versand pro Tick statt je einen kompletten Snapshot pro Aufruf und Client.
const COALESCE_MS = 15;
let pending = null;

function broadcast() {
  if (pending) return;
  pending = setTimeout(flush, COALESCE_MS);
}

// Sofort senden (auch fuer den sauberen Shutdown) und einen wartenden Timer verwerfen.
function flush() {
  if (pending) { clearTimeout(pending); pending = null; }
  emitter.emit('change');
}

function onChange(fn) {
  emitter.on('change', fn);
}

module.exports = { broadcast, flush, onChange };
