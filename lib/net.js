'use strict';
/*
 * LAN-IPv4-Adressen dieses Rechners ermitteln (fuer die Start-Banner-Ausgabe
 * und die Beitritts-URL/QR-Code am Bildschirm).
 */
const os = require('os');

function localIPs() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

module.exports = { localIPs };
