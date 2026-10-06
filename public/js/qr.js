'use strict';
/*
 * Minimaler QR-Code-Encoder – ohne jede Abhaengigkeit (nur reines JS).
 * ---------------------------------------------------------------------------
 * Erzeugt aus einem kurzen Text (z. B. der Beitritts-URL) eine QR-Matrix.
 * Unterstuetzt: Byte-Modus (UTF-8), Fehlerkorrektur-Stufen L und M,
 * automatische Versionswahl (1..10 – reicht locker fuer eine LAN-URL) und
 * die 8 Standard-Masken mit Strafpunkt-Auswahl nach QR-Spezifikation.
 *
 * API:
 *   QR.generate(text, { ecLevel:'M'|'L' }) -> { size, modules[][], version, level }
 *   QR.svg(text, { ecLevel, quiet })       -> SVG-String (schwarz auf weiss)
 *
 * modules[r][c] === true  => dunkles Modul.
 */
(function () {
  // --- Galois-Feld GF(256), Primitivpolynom 0x11d ---------------------------
  var EXP = new Array(256);
  var LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 256; i++) { EXP[i] = x; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (var j = 0; j < 255; j++) LOG[EXP[j]] = j;
  })();
  function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[(LOG[a] + LOG[b]) % 255]; }

  // Reed-Solomon-Generatorpolynom vom Grad n (Koeffizienten hoechster Grad zuerst)
  function rsGen(n) {
    var g = [1];
    for (var i = 0; i < n; i++) {
      var ng = new Array(g.length + 1).fill(0);
      for (var j = 0; j < g.length; j++) {
        ng[j] ^= g[j];                        // g[j] * x
        ng[j + 1] ^= gmul(g[j], EXP[i]);      // g[j] * a^i
      }
      g = ng;
    }
    return g;
  }
  // Fehlerkorrektur-Codewoerter eines Datenblocks (Polynomdivision)
  function rsEncode(data, n) {
    var gen = rsGen(n);
    var res = data.concat(new Array(n).fill(0));
    for (var i = 0; i < data.length; i++) {
      var coef = res[i];
      if (coef !== 0) for (var j = 0; j < gen.length; j++) res[i + j] ^= gmul(gen[j], coef);
    }
    return res.slice(data.length);
  }

  // --- Fehlerkorrektur-Tabelle (Version 1..10, Stufen L + M) ----------------
  // ec = EC-Codewoerter pro Block; blocks = [{ count, dataCount }, ...]
  var EC_TABLE = {
    L: {
      1: { ec: 7, blocks: [{ count: 1, dataCount: 19 }] },
      2: { ec: 10, blocks: [{ count: 1, dataCount: 34 }] },
      3: { ec: 15, blocks: [{ count: 1, dataCount: 55 }] },
      4: { ec: 20, blocks: [{ count: 1, dataCount: 80 }] },
      5: { ec: 26, blocks: [{ count: 1, dataCount: 108 }] },
      6: { ec: 18, blocks: [{ count: 2, dataCount: 68 }] },
      7: { ec: 20, blocks: [{ count: 2, dataCount: 78 }] },
      8: { ec: 24, blocks: [{ count: 2, dataCount: 97 }] },
      9: { ec: 30, blocks: [{ count: 2, dataCount: 116 }] },
      10: { ec: 18, blocks: [{ count: 2, dataCount: 68 }, { count: 2, dataCount: 69 }] }
    },
    M: {
      1: { ec: 10, blocks: [{ count: 1, dataCount: 16 }] },
      2: { ec: 16, blocks: [{ count: 1, dataCount: 28 }] },
      3: { ec: 26, blocks: [{ count: 1, dataCount: 44 }] },
      4: { ec: 18, blocks: [{ count: 2, dataCount: 32 }] },
      5: { ec: 24, blocks: [{ count: 2, dataCount: 43 }] },
      6: { ec: 16, blocks: [{ count: 4, dataCount: 27 }] },
      7: { ec: 18, blocks: [{ count: 4, dataCount: 31 }] },
      8: { ec: 22, blocks: [{ count: 2, dataCount: 38 }, { count: 2, dataCount: 39 }] },
      9: { ec: 22, blocks: [{ count: 3, dataCount: 36 }, { count: 2, dataCount: 37 }] },
      10: { ec: 26, blocks: [{ count: 4, dataCount: 43 }, { count: 1, dataCount: 44 }] }
    }
  };
  var EC_INDICATOR = { L: 1, M: 0 };   // Formatbits (2 Bit): M=00, L=01
  // Ausrichtungsmuster-Positionen je Version (Version 1 hat keine)
  var ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };

  // --- Bitpuffer -------------------------------------------------------------
  function BitBuffer() { this.bits = []; }
  BitBuffer.prototype.put = function (num, len) { for (var i = len - 1; i >= 0; i--) this.bits.push(((num >>> i) & 1) === 1); };
  BitBuffer.prototype.toBytes = function () {
    var out = [];
    for (var i = 0; i < this.bits.length; i += 8) {
      var b = 0;
      for (var k = 0; k < 8; k++) { b <<= 1; if (this.bits[i + k]) b |= 1; }
      out.push(b);
    }
    return out;
  };

  function utf8bytes(str) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(str));
    var out = [], enc = unescape(encodeURIComponent(str));
    for (var i = 0; i < enc.length; i++) out.push(enc.charCodeAt(i));
    return out;
  }

  // Kleinste Version (1..10) waehlen, in die die Daten passen.
  function chooseVersion(len, level) {
    for (var v = 1; v <= 10; v++) {
      var info = EC_TABLE[level][v];
      var totalData = info.blocks.reduce(function (s, b) { return s + b.count * b.dataCount; }, 0);
      var cci = v < 10 ? 8 : 16;             // Zeichenzahl-Indikator (Byte-Modus)
      var need = 4 + cci + 8 * len;
      if (need <= totalData * 8) return v;
    }
    throw new Error('QR: Daten zu lang (max. Version 10).');
  }

  // Datenbits erzeugen: Modus + Laenge + Daten + Terminator + Padding.
  function encodeData(bytes, version, totalDataCw) {
    var cci = version < 10 ? 8 : 16;
    var bb = new BitBuffer();
    bb.put(4, 4);                            // Byte-Modus (0100)
    bb.put(bytes.length, cci);
    for (var i = 0; i < bytes.length; i++) bb.put(bytes[i], 8);
    var capacity = totalDataCw * 8;
    var term = Math.min(4, capacity - bb.bits.length);
    if (term > 0) bb.put(0, term);
    while (bb.bits.length % 8 !== 0) bb.bits.push(false);
    var pad = [0xEC, 0x11], pi = 0;
    while (bb.bits.length < capacity) { bb.put(pad[pi % 2], 8); pi++; }
    return bb.toBytes();
  }

  // Datenbloecke bilden, EC anhaengen, dann Daten- und EC-Codewoerter verschachteln.
  function interleave(dataCw, info) {
    var dcList = [], ecList = [], offset = 0, maxDc = 0, maxEc = 0;
    info.blocks.forEach(function (b) {
      for (var i = 0; i < b.count; i++) {
        var dc = dataCw.slice(offset, offset + b.dataCount); offset += b.dataCount;
        dcList.push(dc); if (dc.length > maxDc) maxDc = dc.length;
        var ec = rsEncode(dc, info.ec); ecList.push(ec); if (ec.length > maxEc) maxEc = ec.length;
      }
    });
    var out = [];
    for (var i = 0; i < maxDc; i++) dcList.forEach(function (dc) { if (i < dc.length) out.push(dc[i]); });
    for (var j = 0; j < maxEc; j++) ecList.forEach(function (ec) { if (j < ec.length) out.push(ec[j]); });
    return out;
  }

  // --- BCH-Codes fuer Format- und Versionsinformation ------------------------
  function bitLen(d) { var n = 0; while (d !== 0) { n++; d >>>= 1; } return n; }
  function bchFormat(data) {
    var d = data << 10;
    while (bitLen(d) >= bitLen(0x537)) d ^= 0x537 << (bitLen(d) - bitLen(0x537));
    return ((data << 10) | d) ^ 0x5412;
  }
  function bchVersion(data) {
    var d = data << 12;
    while (bitLen(d) >= bitLen(0x1f25)) d ^= 0x1f25 << (bitLen(d) - bitLen(0x1f25));
    return (data << 12) | d;
  }

  function maskFn(mask, r, c) {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return (((r * c) % 3) + ((r + c) % 2)) % 2 === 0;
    }
  }

  // Strafpunkte einer fertigen (maskierten) Matrix nach QR-Spezifikation.
  function penalty(m) {
    var n = m.length, p = 0, r, c, run;
    for (r = 0; r < n; r++) { run = 1; for (c = 1; c < n; c++) { if (m[r][c] === m[r][c - 1]) run++; else { if (run >= 5) p += 3 + (run - 5); run = 1; } } if (run >= 5) p += 3 + (run - 5); }
    for (c = 0; c < n; c++) { run = 1; for (r = 1; r < n; r++) { if (m[r][c] === m[r - 1][c]) run++; else { if (run >= 5) p += 3 + (run - 5); run = 1; } } if (run >= 5) p += 3 + (run - 5); }
    for (r = 0; r < n - 1; r++) for (c = 0; c < n - 1; c++) { var v = m[r][c]; if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3; }
    var pat1 = [true, false, true, true, true, false, true, false, false, false, false];
    var pat2 = [false, false, false, false, true, false, true, true, true, false, true];
    function match(arr, idx, pat) { for (var k = 0; k < 11; k++) if (arr[idx + k] !== pat[k]) return false; return true; }
    for (r = 0; r < n; r++) { var row = m[r]; for (c = 0; c <= n - 11; c++) if (match(row, c, pat1) || match(row, c, pat2)) p += 40; }
    for (c = 0; c < n; c++) { var col = []; for (r = 0; r < n; r++) col.push(m[r][c]); for (r = 0; r <= n - 11; r++) if (match(col, r, pat1) || match(col, r, pat2)) p += 40; }
    var dark = 0; for (r = 0; r < n; r++) for (c = 0; c < n; c++) if (m[r][c]) dark++;
    var ratio = dark * 100 / (n * n), low = Math.floor(ratio / 5) * 5, high = low + 5;
    p += Math.min(Math.abs(low - 50), Math.abs(high - 50)) / 5 * 10;
    return p;
  }

  function generate(text, opts) {
    opts = opts || {};
    var level = opts.ecLevel === 'L' ? 'L' : 'M';
    var bytes = utf8bytes(String(text));
    var version = chooseVersion(bytes.length, level);
    var info = EC_TABLE[level][version];
    var totalData = info.blocks.reduce(function (s, b) { return s + b.count * b.dataCount; }, 0);
    var data = interleave(encodeData(bytes, version, totalData), info);

    var size = version * 4 + 17;
    var modules = [], func = [], r, c;
    for (r = 0; r < size; r++) { modules.push(new Array(size).fill(null)); func.push(new Array(size).fill(false)); }
    function setF(rr, cc, val) { modules[rr][cc] = val; func[rr][cc] = true; }

    // Sucher-Muster (inkl. umlaufender Trennlinie) an den drei Ecken
    function probe(row, col) {
      for (var dr = -1; dr <= 7; dr++) for (var dc = -1; dc <= 7; dc++) {
        var rr = row + dr, cc = col + dc;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        var on = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) ||
                 (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6)) ||
                 (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
        setF(rr, cc, on);
      }
    }
    probe(0, 0); probe(size - 7, 0); probe(0, size - 7);

    // Ausrichtungsmuster
    var pos = ALIGN[version];
    for (var pi = 0; pi < pos.length; pi++) for (var pj = 0; pj < pos.length; pj++) {
      var ar = pos[pi], ac = pos[pj];
      if (modules[ar][ac] !== null) continue;   // ueberlappt Sucher-Muster -> weglassen
      for (var dr = -2; dr <= 2; dr++) for (var dc = -2; dc <= 2; dc++) {
        var on = (dr === -2 || dr === 2 || dc === -2 || dc === 2 || (dr === 0 && dc === 0));
        setF(ar + dr, ac + dc, on);
      }
    }

    // Timing-Muster
    for (var i = 8; i < size - 8; i++) {
      if (modules[i][6] === null) setF(i, 6, i % 2 === 0);
      if (modules[6][i] === null) setF(6, i, i % 2 === 0);
    }
    // Dunkles Modul + Format-/Versions-Bereiche reservieren
    setF(size - 8, 8, true);
    function eachFormat(cb) {
      for (var i = 0; i < 15; i++) {
        var vr = i < 6 ? i : (i < 8 ? i + 1 : size - 15 + i);
        cb(i, vr, 8);
        var hc = i < 8 ? size - i - 1 : (i < 9 ? 7 : 15 - i - 1);
        cb(i, 8, hc);
      }
    }
    function eachVersion(cb) {
      for (var i = 0; i < 18; i++) { var a = Math.floor(i / 3), b = i % 3; cb(i, a, b + size - 11); cb(i, b + size - 11, a); }
    }
    eachFormat(function (i, rr, cc) { setF(rr, cc, false); });
    if (version >= 7) eachVersion(function (i, rr, cc) { setF(rr, cc, false); });

    // Datenbits im Zickzack platzieren (Spalte 6 ueberspringen)
    var dir = -1, row = size - 1, bit = 7, byte = 0;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      while (true) {
        for (var k = 0; k < 2; k++) {
          var cc = col - k;
          if (!func[row][cc]) {
            var dark = false;
            if (byte < data.length) dark = ((data[byte] >>> bit) & 1) === 1;
            modules[row][cc] = dark; bit--;
            if (bit < 0) { byte++; bit = 7; }
          }
        }
        row += dir;
        if (row < 0 || row >= size) { row -= dir; dir = -dir; break; }
      }
    }

    // Beste Maske ueber Strafpunkte waehlen; Format-/Versionsinfo eintragen.
    var best = null, ecInd = EC_INDICATOR[level];
    for (var mask = 0; mask < 8; mask++) {
      var cand = modules.map(function (rw) { return rw.slice(); });
      for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (!func[r][c] && maskFn(mask, r, c)) cand[r][c] = !cand[r][c];
      var fmt = bchFormat((ecInd << 3) | mask);
      eachFormat(function (i, rr, cc) { cand[rr][cc] = ((fmt >> i) & 1) === 1; });
      if (version >= 7) { var vinfo = bchVersion(version); eachVersion(function (i, rr, cc) { cand[rr][cc] = ((vinfo >> i) & 1) === 1; }); }
      var pen = penalty(cand);
      if (best === null || pen < best.pen) best = { pen: pen, m: cand, mask: mask };
    }
    return { size: size, modules: best.m, version: version, level: level, mask: best.mask };
  }

  // SVG-String (1 Modul = 1 Einheit) mit weisser Ruhezone.
  function svg(text, opts) {
    opts = opts || {};
    var res = generate(text, opts);
    var quiet = (opts.quiet != null) ? opts.quiet : 4;
    var dim = res.size + quiet * 2, rects = '';
    for (var r = 0; r < res.size; r++) for (var c = 0; c < res.size; c++) {
      if (res.modules[r][c]) rects += '<rect x="' + (c + quiet) + '" y="' + (r + quiet) + '" width="1" height="1"/>';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim +
      '" shape-rendering="crispEdges"><rect width="' + dim + '" height="' + dim +
      '" fill="#ffffff"/><g fill="#000000">' + rects + '</g></svg>';
  }

  var QR = { generate: generate, svg: svg };
  if (typeof module !== 'undefined' && module.exports) module.exports = QR;
  if (typeof window !== 'undefined') window.QR = QR;
})();
