'use strict';
/*
 * Statischer Datei-Server fuer public/ (Web-App + hochgeladene Hintergrund-
 * bilder/Audiodateien), inkl. Range-Requests (fuers Durchspulen von Audio).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { ROOT_DIR } = require('./config');
const { zmImageFor } = require('./games/zm');

// Textdateien werden (bei Accept-Encoding: gzip) komprimiert ausgeliefert; die
// komprimierte Fassung wird je Datei gemerkt, bis sich mtime/Groesse aendern.
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg']);
const gzCache = new Map();   // filePath -> { sig, buf }

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

// Kritzelquiz-Zeichnungen (liegen nur im RAM, s. games/zm.js) – ueber einen
// zufaelligen Schluessel ausgeliefert statt im Snapshot mitgeschickt zu werden.
function serveZmImage(req, res, key) {
  const img = zmImageFor(key);
  if (!img) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': img.mime, 'Content-Length': img.buf.length, 'Cache-Control': 'private, max-age=86400, immutable' });
  res.end(req.method === 'HEAD' ? undefined : img.buf);
}

function serveStatic(req, res) {
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); res.end('Bad request'); return; }
  const zmm = /^\/zmimg\/([a-f0-9]{8,64})$/.exec(urlPath);
  if (zmm) { serveZmImage(req, res, zmm[1]); return; }
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

    // Validierung per ETag (mtime+Groesse): unveraenderte Dateien kosten nur einen 304
    // statt Hunderte KB JS/CSS/Bilder bei jedem Seitenaufruf neu zu laden.
    const sig = total.toString(36) + '-' + Math.floor(stat.mtimeMs).toString(36);
    const etag = '"' + sig + '"';
    const base = { 'Content-Type': type, 'ETag': etag, 'Cache-Control': 'no-cache' };
    if (req.headers['if-none-match'] === etag || req.headers['if-none-match'] === 'W/' + etag) {
      res.writeHead(304, base); res.end(); return;
    }
    const wantGz = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '') && total > 512;
    if (wantGz) {
      const hit = gzCache.get(filePath);
      const send = (buf) => {
        res.writeHead(200, Object.assign({}, base, { 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding', 'Content-Length': buf.length }));
        res.end(req.method === 'HEAD' ? undefined : buf);
      };
      if (hit && hit.sig === sig) { send(hit.buf); return; }
      fs.readFile(filePath, (e2, data) => {
        if (e2) { res.writeHead(404); res.end('Not found'); return; }
        zlib.gzip(data, (e3, buf) => {
          if (e3) { res.writeHead(500); res.end(); return; }
          gzCache.set(filePath, { sig, buf });
          send(buf);
        });
      });
      return;
    }
    res.writeHead(200, Object.assign({}, base, { 'Accept-Ranges': 'bytes', 'Content-Length': total }));
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(filePath).pipe(res);
  });
}

module.exports = { serveStatic, PUBLIC_DIR };
