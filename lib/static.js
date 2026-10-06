'use strict';
/*
 * Statischer Datei-Server fuer public/ (Web-App + hochgeladene Hintergrund-
 * bilder/Audiodateien), inkl. Range-Requests (fuers Durchspulen von Audio).
 */
const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('./config');

const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.weba': 'audio/webm',
  '.webm': 'audio/webm'
};

// Pfade, die die Web-App (index.html) ausliefern; die Rolle bestimmt der Client
// anhand von location.pathname.
const APP_ROUTES = new Set(['/', '/master', '/screen', '/player']);

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (APP_ROUTES.has(urlPath)) urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  // Verhindere Ausbruch aus dem public-Ordner
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const total = stat.size;

    // Range-Requests (nötig, damit sich Audio/Video im Player durchspulen lässt).
    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m) {
        let start = m[1] === '' ? NaN : parseInt(m[1], 10);
        let end = m[2] === '' ? NaN : parseInt(m[2], 10);
        // Suffix-Range („bytes=-500") = letzte N Bytes.
        if (isNaN(start)) { start = Math.max(0, total - (isNaN(end) ? total : end)); end = total - 1; }
        else if (isNaN(end)) { end = total - 1; }
        if (start > end || start >= total) {
          res.writeHead(416, { 'Content-Range': 'bytes */' + total });
          res.end(); return;
        }
        res.writeHead(206, {
          'Content-Type': type,
          'Content-Range': 'bytes ' + start + '-' + end + '/' + total,
          'Accept-Ranges': 'bytes',
          'Content-Length': (end - start + 1)
        });
        if (req.method === 'HEAD') { res.end(); return; }
        fs.createReadStream(filePath, { start, end }).pipe(res);
        return;
      }
    }

    res.writeHead(200, {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Content-Length': total
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(filePath).pipe(res);
  });
}

module.exports = { serveStatic, PUBLIC_DIR };
