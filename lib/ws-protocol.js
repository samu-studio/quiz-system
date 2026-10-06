'use strict';
/*
 * Minimaler WebSocket-Wire-Protokoll-Layer (RFC 6455) – nur mit crypto, kein
 * npm-Paket. Frame-Encoding/-Decoding + der Accept-Key fuer den Handshake.
 */
const crypto = require('crypto');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
// Obergrenze fuer ein einzelnes Frame-Payload: RFC 6455 selbst begrenzt die Laenge nicht,
// ein boesartiger/kaputter Client koennte sonst eine beliebig grosse Laenge deklarieren
// und den Server per Speicher-Erschoepfung lahmlegen. Groesster legitimer Payload ist ein
// Base64-Audio-Upload (max. 30 MB Binaerdaten -> ca. 40 MB als Base64-String), daher
// grosszuegig, aber endlich bemessen.
const MAX_FRAME_PAYLOAD = 45 * 1024 * 1024;

function acceptKey(key) {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
}

function encodeFrame(data, opcode = 0x1) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeUInt32BE(Math.floor(len / 4294967296), 2);
    header.writeUInt32BE(len >>> 0, 6);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const b1 = buf[1];
  const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < offset + 2) return null;
    len = buf.readUInt16BE(offset); offset += 2;
  } else if (len === 127) {
    if (buf.length < offset + 8) return null;
    const hi = buf.readUInt32BE(offset);
    const lo = buf.readUInt32BE(offset + 4);
    len = hi * 4294967296 + lo; offset += 8;
  }
  if (len > MAX_FRAME_PAYLOAD) {
    const err = new Error('WS-Frame ueberschreitet die maximale Payload-Groesse');
    err.wsFrameTooLarge = true;
    throw err;
  }
  let maskKey = null;
  if (masked) {
    if (buf.length < offset + 4) return null;
    maskKey = buf.slice(offset, offset + 4); offset += 4;
  }
  if (buf.length < offset + len) return null;
  let payload = buf.slice(offset, offset + len);
  if (masked) {
    const out = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i & 3];
    payload = out;
  }
  return {
    fin: (buf[0] & 0x80) !== 0,
    opcode: buf[0] & 0x0f,
    payload,
    rest: buf.slice(offset + len)
  };
}

module.exports = { acceptKey, encodeFrame, decodeFrame, MAX_FRAME_PAYLOAD };
