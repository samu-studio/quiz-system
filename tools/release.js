'use strict';
/*
 * Release-ZIP zum Verschicken bauen – nur das Noetigste, getrennt nach Betriebssystem.
 *
 * Aufruf (normalerweise ueber Release.sh / Release.bat, die interaktiv fragen):
 *     node tools/release.js [win|linux|mac|alle] [Versionsname]
 *
 * Ins ZIP kommen:
 *   - server.js, lib/ (Server)
 *   - public/index.html, public/styles.css, public/js/, public/sounds/ (Oberflaeche + Spiel-
 *     und mitgelieferte Soundboard-Sounds)
 *   - tools/get-old-data.js, README.md
 *   - Start- und GetOldData-Skript NUR des gewaehlten Systems
 *     (.bat fuer Windows, .sh fuer Linux, .command fuer macOS + GetOldData.sh)
 * NICHT ins ZIP kommen:
 *   - node/ (portables Node – zu gross, holt GetOldData aus der alten Version)
 *   - eigene Inhalte: public/backgrounds, public/audio, public/pause, public/music, public/soundboard
 *   - config.json (Server startet dann mit den Standard-Einstellungen; eigene
 *     Einstellungen uebernimmt GetOldData aus der alten Version)
 *   - Entwickler-Kram: .git, .claude, .graphify, CLAUDE.md, commit-/Release-Skripte
 *
 * Ergebnis: release/quiz_system_<Version>-<system>.zip
 * Nur Node-Bordmittel, keine Abhaengigkeiten (wie der Server selbst) – der
 * ZIP-Writer ist hier selbst implementiert, damit die Ausfuehrrechte der
 * .sh/.command-Skripte erhalten bleiben.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'release');

const PLATFORMS = {
  win:   { label: 'Windows', scripts: ['Start-Windows.bat', 'GetOldData.bat'] },
  linux: { label: 'Linux',   scripts: ['Start-Linux.sh', 'GetOldData.sh'] },
  // GetOldData.command ist nur der Doppelklick-Starter fuer GetOldData.sh – beide mitliefern
  mac:   { label: 'macOS',   scripts: ['Start-macOS.command', 'GetOldData.command', 'GetOldData.sh'] }
};

// Gemeinsame Dateien/Ordner (relativ zum App-Ordner); Ordner werden rekursiv gepackt
const COMMON = [
  'server.js',
  'README.md',
  'lib',
  path.join('public', 'index.html'),
  path.join('public', 'styles.css'),
  path.join('public', 'js'),
  path.join('public', 'sounds'),
  path.join('tools', 'get-old-data.js')
];
const SKIP_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.graphify']);

function fail(msg) {
  console.error('\n[FEHLER] ' + msg + '\n');
  process.exit(1);
}

// ---------- Dateien sammeln ----------

function collect(rel, out) {
  const full = path.join(ROOT, rel);
  let st;
  try { st = fs.statSync(full); } catch (e) { fail('Fehlt: ' + rel); }
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(full).sort()) {
      if (SKIP_NAMES.has(name) || name.startsWith('.')) continue;
      collect(path.join(rel, name), out);
    }
  } else if (st.isFile()) {
    out.push(rel);
  }
  return out;
}

// ---------- ZIP (Store/Deflate, Unix-Rechte im externen Attribut) ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

// entries: [{ name (mit '/'), data: Buffer, mtime: Date, exec: bool }]
function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const deflated = zlib.deflateRawSync(e.data, { level: 9 });
    const useDeflate = deflated.length < e.data.length;
    const body = useDeflate ? deflated : e.data;
    const method = useDeflate ? 8 : 0;
    const { time, date } = dosDateTime(e.mtime);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);            // benoetigte Version
    lh.writeUInt16LE(0x0800, 6);        // Flag: Dateinamen in UTF-8
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, body);

    const mode = 0o100000 | (e.exec ? 0o755 : 0o644);   // regulaere Datei + Rechte
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE((3 << 8) | 20, 4); // erstellt unter "Unix" -> Rechte werden beim Entpacken beachtet
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(e.data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);            // Extra
    ch.writeUInt16LE(0, 32);            // Kommentar
    ch.writeUInt16LE(0, 34);            // Disk
    ch.writeUInt16LE(0, 36);            // interne Attribute
    ch.writeUInt32LE((mode << 16) >>> 0, 38);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + body.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

// ---------- Release bauen ----------

function buildRelease(platform, version) {
  const p = PLATFORMS[platform];
  const files = [];
  for (const rel of COMMON) collect(rel, files);
  for (const rel of p.scripts) collect(rel, files);

  const entries = files.map((rel) => {
    const full = path.join(ROOT, rel);
    return {
      name: rel.split(path.sep).join('/'),
      data: fs.readFileSync(full),
      mtime: fs.statSync(full).mtime,
      exec: /\.(sh|command)$/.test(rel)
    };
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, 'quiz_system_' + version + '-' + platform + '.zip');
  const zip = buildZip(entries);
  fs.writeFileSync(outFile, zip);
  console.log('  ' + p.label.padEnd(8) + ' -> ' + path.relative(ROOT, outFile) +
    '  (' + entries.length + ' Dateien, ' + (zip.length / 1024).toFixed(0) + ' KB)');
}

// Vorschlag fuer den Versionsnamen: hoechstes vorhandenes quiz_system_V<n>*.zip + 1
function suggestVersion() {
  let max = 0;
  for (const dir of [ROOT, OUT_DIR]) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { continue; }
    for (const n of names) {
      const m = /^quiz_system_V(\d+).*\.zip$/i.exec(n);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return 'V' + (max + 1);
}

function ask(rl, q) {
  return new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));
}

async function main() {
  let [platArg, version] = process.argv.slice(2);
  const rl = (!platArg || !version) ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;

  if (!platArg) {
    console.log('Fuer welches System soll das Release gebaut werden?');
    console.log('  1) Windows');
    console.log('  2) Linux');
    console.log('  3) macOS');
    console.log('  4) alle drei');
    platArg = ({ 1: 'win', 2: 'linux', 3: 'mac', 4: 'alle' })[await ask(rl, 'Auswahl [1-4]: ')] || '';
  }
  platArg = platArg.toLowerCase();
  if (platArg === 'windows') platArg = 'win';
  if (platArg === 'macos' || platArg === 'osx') platArg = 'mac';
  if (platArg === 'all') platArg = 'alle';
  const platforms = platArg === 'alle' ? Object.keys(PLATFORMS) : [platArg];
  if (!platforms.every((x) => PLATFORMS[x])) {
    if (rl) rl.close();
    fail('Unbekanntes System "' + platArg + '" – erlaubt: win, linux, mac, alle');
  }

  if (!version) {
    const def = suggestVersion();
    version = (await ask(rl, 'Versionsname [' + def + ']: ')) || def;
  }
  if (rl) rl.close();
  version = version.replace(/[^A-Za-z0-9._-]/g, '_');

  console.log('\nBaue Release ' + version + ' ...');
  for (const plat of platforms) buildRelease(plat, version);
  console.log('\nFertig. Ohne node/, Bilder/Audios/Musik und config.json –');
  console.log('beim Empfaenger: entpacken, dann GetOldData (alte Version) oder direkt Start-Skript.');
}

main().catch((e) => fail(e.stack || String(e)));
