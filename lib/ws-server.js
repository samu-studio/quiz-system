'use strict';
/*
 * Hand-gerollter WebSocket-Server (RFC 6455) ueber den bestehenden HTTP-Server:
 * Upgrade-Handshake, Frame-Parsing/-Puffern, Nachrichten-Dispatch, Keepalive-Pings.
 */
const { acceptKey, encodeFrame, decodeFrame, MAX_FRAME_PAYLOAD } = require('./ws-protocol');
const { handleMessage, onDisconnect } = require('./handlers');

function createWsServer(server) {
  let nextConnSeq = 1;
  const connections = new Set();
  
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + acceptKey(key) + '\r\n\r\n'
    );
  
    const conn = {
      seq: nextConnSeq++,
      socket,
      clientId: null,
      role: null,
      authed: false,   // true nach erfolgreicher Master-/Admin-Anmeldung
      alive: true
    };
    connections.add(conn);
  
    let buffer = Buffer.alloc(0);
    let fragmentOpcode = null;
    let fragments = [];
    let fragmentsSize = 0;
  
    conn.send = (obj) => {
      if (socket.destroyed || !socket.writable) return;
      try { socket.write(encodeFrame(JSON.stringify(obj))); } catch (e) { /* ignore */ }
    };
  
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      let frame;
      try {
        while ((frame = decodeFrame(buffer))) {
          buffer = frame.rest;
          const op = frame.opcode;
          if (op === 0x8) { // close
            try { socket.write(encodeFrame(Buffer.alloc(0), 0x8)); } catch (e) {}
            socket.end();
            return;
          } else if (op === 0x9) { // ping -> pong
            try { socket.write(encodeFrame(frame.payload, 0xA)); } catch (e) {}
          } else if (op === 0xA) { // pong
            conn.alive = true;
          } else if (op === 0x0) { // continuation
            fragmentsSize += frame.payload.length;
            // Einzelne Frames sind schon in decodeFrame begrenzt; ueber viele kleine
            // Fragmente liesse sich eine Nachricht sonst trotzdem beliebig aufblasen.
            if (fragmentsSize > MAX_FRAME_PAYLOAD) { socket.destroy(); return; }
            fragments.push(frame.payload);
            if (frame.fin) {
              handleText(Buffer.concat(fragments).toString('utf8'));
              fragments = []; fragmentOpcode = null; fragmentsSize = 0;
            }
          } else if (op === 0x1 || op === 0x2) {
            if (frame.fin) {
              handleText(frame.payload.toString('utf8'));
            } else {
              fragmentOpcode = op;
              fragments = [frame.payload];
              fragmentsSize = frame.payload.length;
            }
          }
        }
      } catch (e) {
        // Ueberlange deklarierte Frame-Laenge (oder anderer Parse-Fehler) -> nur diese
        // Verbindung kappen statt den ganzen Server per unbehandelter Exception abzuschiessen.
        try { socket.destroy(); } catch (e2) { /* egal */ }
      }
    });
  
    function handleText(text) {
      let msg;
      try { msg = JSON.parse(text); } catch (e) { return; }
      handleMessage(conn, msg);
    }
  
    const cleanup = () => {
      connections.delete(conn);
      onDisconnect(conn);
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });
  
  // Keepalive: alle 25s ping; tote Verbindungen trennen
  const keepAliveTimer = setInterval(() => {
    for (const conn of connections) {
      if (conn.alive === false) {
        try { conn.socket.destroy(); } catch (e) {}
        connections.delete(conn);
        onDisconnect(conn);
        continue;
      }
      conn.alive = false;
      try { conn.socket.write(encodeFrame(Buffer.alloc(0), 0x9)); } catch (e) {}
    }
  }, 25000);

  return { connections, keepAliveTimer };
}

module.exports = { createWsServer };
