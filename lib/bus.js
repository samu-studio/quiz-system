'use strict';
/*
 * Kleiner Event-Bus: entkoppelt die Spiel-Logik (viele kleine Module) vom
 * Zustellungsschritt (Snapshot bauen + an alle Sockets senden). Jede Aktion,
 * die den Zustand aendert, ruft broadcast() auf; snapshot.js haengt sich mit
 * onChange() daran, um den neuen Zustand tatsaechlich zu verschicken.
 */
const { EventEmitter } = require('events');

const emitter = new EventEmitter();

function broadcast() {
  emitter.emit('change');
}

function onChange(fn) {
  emitter.on('change', fn);
}

module.exports = { broadcast, onChange };
