'use strict';
/*
 * Eigene Inhalte aus einem alten Quiz-Ordner in diese (neue) Version holen.
 *
 * Aufruf (normalerweise ueber GetOldData.bat / GetOldData.sh / GetOldData.command,
 * die den alten Ordner per Dialog abfragen):
 *     node tools/get-old-data.js <alter-Ordner> [--ja]
 *
 * Was passiert:
 *   - public/backgrounds, public/audio, public/pause, public/music, public/soundboard
 *     (hochgeladene Bilder/Audios/Hintergrundmusik/Soundboard-Sounds)
 *     und node/ (portable Node-Binaries): fehlende Dateien werden kopiert.
 *     Bereits vorhandene Dateien der neuen Version werden NIE ueberschrieben.
 *   - config.json: die alte Konfiguration (Profile, Fragen, Design, Spielplan,
 *     Passwort …) wird uebernommen und um alles ergaenzt, was die neue Version
 *     zusaetzlich kennt (neue Einstellungen, neue Spiele, neue Profilfelder).
 *     Danach laeuft dieselbe migrateConfig() wie beim Serverstart. Die bisherige
 *     config.json der neuen Version wird vorher als config.json.vor-import-<Zeit>
 *     gesichert.
 *
 * Nur Node-Bordmittel, keine Abhaengigkeiten (wie der Server selbst).
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const readline = require('readline');

const NEW_ROOT = path.join(__dirname, '..');
const NEW_CONFIG = path.join(NEW_ROOT, 'config.json');

// Ordner mit eigenen Inhalten (relativ zum App-Ordner)
const CONTENT_DIRS = [
  { rel: path.join('public', 'backgrounds'), label: 'Hintergrundbilder' },
  { rel: path.join('public', 'audio'), label: 'Audiodateien' },
  { rel: path.join('public', 'pause'), label: 'Pause-Bilder' },
  { rel: path.join('public', 'music'), label: 'Hintergrundmusik' },
  { rel: path.join('public', 'soundboard'), label: 'Soundboard-Sounds' },
  { rel: 'node', label: 'Portables Node', noList: true }   // Binaries – Namen sagen nichts
];
const MAX_LIST = 10;   // so viele Dateinamen je Ordner in der Vorschau, Rest nur gezaehlt
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

const isPlainObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

function fail(msg) {
  console.error('\n[FEHLER] ' + msg + '\n');
  process.exit(1);
}

// ---------- Dateien ----------

// Alle Dateien unter dir (rekursiv), als relative Pfade
function listFiles(dir, base = dir) {
  let out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    if (SKIP_FILES.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(listFiles(full, base));
    else if (e.isFile()) out.push(path.relative(base, full));
  }
  return out;
}

// Plan je Inhaltsordner: welche Dateien fehlen, welche gibt es schon
function planFiles(oldRoot) {
  return CONTENT_DIRS.map((d) => {
    const src = path.join(oldRoot, d.rel);
    const dst = path.join(NEW_ROOT, d.rel);
    const copy = [], same = [], differ = [];
    for (const rel of listFiles(src)) {
      const to = path.join(dst, rel);
      if (!fs.existsSync(to)) { copy.push(rel); continue; }
      // Gleiche Groesse = gleiche Datei (Inhaltsvergleich waere bei Node-Binaries zu teuer)
      if (fs.statSync(to).size === fs.statSync(path.join(src, rel)).size) same.push(rel);
      else differ.push(rel);
    }
    return { ...d, src, dst, copy, same, differ };
  });
}

function copyFiles(plan) {
  let n = 0;
  for (const d of plan) {
    for (const rel of d.copy) {
      const from = path.join(d.src, rel);
      const to = path.join(d.dst, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      // Ausfuehr-Bit (Node-Binaries) mitnehmen, falls das Dateisystem es kennt
      try { fs.chmodSync(to, fs.statSync(from).mode); } catch (e) { /* egal */ }
      n++;
    }
  }
  return n;
}

// ---------- config.json ----------

function readJson(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return undefined; }
  try { return JSON.parse(raw.replace(/^﻿/, '')); } catch (e) { return null; }
}

// Profilfelder nur mit „leeren" Standardwerten ergaenzen – keine Beispiel-Fragen
// o. ae. in eigene Profile kippen.
function isSimpleDefault(v) {
  if (Array.isArray(v)) return v.length === 0;
  if (isPlainObj(v)) return Object.keys(v).length === 0;
  return true;
}

// Fehlende Schluessel aus src in dst eintragen (dst = alte, eigene Daten, bleibt fuehrend).
// Arrays und vorhandene Werte werden nie angefasst. added sammelt die Pfade fuers Protokoll.
function fillMissing(dst, src, keyPath, added) {
  for (const key of Object.keys(src)) {
    const p = keyPath.concat(key);
    if (!(key in dst)) {
      dst[key] = clone(src[key]);
      added.push(p.join('.'));
    } else if (p.length === 3 && p[0] === 'games' && key === 'profiles') {
      fillProfiles(dst[key], src[key], p, added);
    } else if (isPlainObj(dst[key]) && isPlainObj(src[key])) {
      fillMissing(dst[key], src[key], p, added);
    }
  }
}

// games.<id>.profiles: eigene Profile behalten (keine Beispielprofile dazumischen),
// aber neue Einstellungsfelder mit dem Standardwert der neuen Version ergaenzen.
function fillProfiles(dstProfiles, srcProfiles, keyPath, added) {
  if (!isPlainObj(dstProfiles) || !isPlainObj(srcProfiles)) return;
  const template = Object.values(srcProfiles).find(isPlainObj);
  if (!template) return;
  for (const name of Object.keys(dstProfiles)) {
    const prof = dstProfiles[name];
    if (!isPlainObj(prof)) continue;
    for (const key of Object.keys(template)) {
      if (key in prof || !isSimpleDefault(template[key])) continue;
      prof[key] = clone(template[key]);
      added.push(keyPath.concat(name, key).join('.'));
    }
  }
}

function mergeConfig(oldCfg) {
  // Vorlage: Standardwerte der neuen Version, ergaenzt um deren config.json
  let DEFAULT_CONFIG = {}, migrateConfig = null;
  try {
    ({ DEFAULT_CONFIG, migrateConfig } = require(path.join(NEW_ROOT, 'lib', 'config.js')));
  } catch (e) {
    console.warn('[warn] lib/config.js der neuen Version nicht ladbar (' + e.message + ') – ergaenze nur aus config.json.');
  }
  const newCfg = readJson(NEW_CONFIG);
  const template = clone(DEFAULT_CONFIG || {});
  if (isPlainObj(newCfg)) fillMissing(template, newCfg, [], []);

  const merged = clone(oldCfg);
  const added = [];
  fillMissing(merged, template, [], added);
  // Dieselbe Reparatur/Validierung wie beim Serverstart (falsche Typen, unbekanntes Spiel …)
  const result = typeof migrateConfig === 'function' ? migrateConfig(merged) : merged;
  return { result, added };
}

function writeConfig(cfg) {
  if (fs.existsSync(NEW_CONFIG)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = NEW_CONFIG + '.vor-import-' + stamp;
    fs.copyFileSync(NEW_CONFIG, backup);
    console.log('  Bisherige config.json gesichert als: ' + path.basename(backup));
  }
  const tmp = NEW_CONFIG + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, NEW_CONFIG);
}

// ---------- Hilfen ----------

// Ergaenzte Config-Pfade fuer die Vorschau: neue Profilfelder je Spiel zu einer Zeile
// zusammenfassen (sonst eine Zeile pro Feld und Profil), alles andere einzeln.
function summarizeAdded(added) {
  const lines = [], perGame = new Map();
  for (const p of added) {
    const m = /^games\.([^.]+)\.profiles\.(.+)\.([^.]+)$/.exec(p);
    if (!m) { lines.push(p); continue; }
    const g = perGame.get(m[1]) || { fields: new Set(), profiles: new Set() };
    g.fields.add(m[3]); g.profiles.add(m[2]);
    perGame.set(m[1], g);
  }
  for (const [id, g] of perGame) {
    lines.push('games.' + id + ': neue Profilfelder ' + [...g.fields].join(', ') +
      ' (in ' + g.profiles.size + ' Profil' + (g.profiles.size === 1 ? '' : 'en') + ')');
  }
  return lines;
}

// Laeuft der Server dieser Version gerade? Dann wuerde er die neue config.json beim
// naechsten Speichern mit seinem Stand im Speicher ueberschreiben.
function serverRunning(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port }, () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.setTimeout(800, () => { s.destroy(); resolve(false); });
  });
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => { rl.close(); resolve(a.trim().toLowerCase()); });
  });
}

// ---------- Ablauf ----------

async function main() {
  const args = process.argv.slice(2);
  const yes = args.includes('--ja') || args.includes('-y');
  const oldArg = args.find((a) => !a.startsWith('-'));
  if (!oldArg) fail('Kein alter Ordner angegeben.\n        Aufruf: node tools/get-old-data.js <alter-Ordner> [--ja]');

  let oldRoot = path.resolve(oldArg.replace(/^"|"$/g, ''));
  if (!fs.existsSync(oldRoot) || !fs.statSync(oldRoot).isDirectory()) fail('Ordner nicht gefunden: ' + oldRoot);
  if (fs.realpathSync(oldRoot) === fs.realpathSync(NEW_ROOT)) {
    fail('Das ist der Ordner dieser (neuen) Version selbst – bitte den ALTEN Quiz-Ordner waehlen.');
  }
  // Falls der Ordner UEBER der App gewaehlt wurde (z. B. der entpackte ZIP-Ordner): eine Ebene tiefer suchen
  const looksLikeApp = (d) => fs.existsSync(path.join(d, 'config.json')) || fs.existsSync(path.join(d, 'public'));
  if (!looksLikeApp(oldRoot)) {
    const sub = fs.readdirSync(oldRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory()).map((e) => path.join(oldRoot, e.name)).filter(looksLikeApp);
    if (sub.length === 1) oldRoot = sub[0];
    else fail('In "' + oldRoot + '" liegt keine Quiz-App (weder config.json noch public/ gefunden).');
  }

  console.log('\nAlte Version:  ' + oldRoot);
  console.log('Neue Version:  ' + NEW_ROOT + '\n');

  // --- Plan: Dateien ---
  const plan = planFiles(oldRoot);
  for (const d of plan) {
    let line = '  ' + (d.label + ':').padEnd(20) + d.copy.length + ' neu';
    if (d.same.length) line += ', ' + d.same.length + ' schon vorhanden';
    if (d.differ.length) line += ', ' + d.differ.length + ' gleichnamig aber anders (neue Version bleibt)';
    console.log(line);
    if (d.noList) continue;
    for (const rel of d.copy.slice(0, MAX_LIST)) console.log('      + ' + rel);
    if (d.copy.length > MAX_LIST) console.log('      … und ' + (d.copy.length - MAX_LIST) + ' weitere');
  }

  // --- Plan: config.json ---
  const oldCfg = readJson(path.join(oldRoot, 'config.json'));
  let merged = null;
  if (oldCfg === undefined) {
    console.log('  config.json:        im alten Ordner nicht vorhanden – bleibt unveraendert');
  } else if (!isPlainObj(oldCfg)) {
    console.log('  config.json:        im alten Ordner fehlerhaft (kein gueltiges JSON) – bleibt unveraendert');
  } else {
    merged = mergeConfig(oldCfg);
    const nProf = Object.values(merged.result.games || {})
      .reduce((n, g) => n + (isPlainObj(g && g.profiles) ? Object.keys(g.profiles).length : 0), 0);
    console.log('  config.json:        alte wird uebernommen (' + nProf + ' Profile), ' + merged.added.length + ' neue Einstellung(en) ergaenzt\n' +
                '                      (ersetzt die config.json dieser Version, Sicherung wird angelegt)');
    for (const line of summarizeAdded(merged.added)) console.log('      + ' + line);
  }

  const nCopy = plan.reduce((n, d) => n + d.copy.length, 0);
  if (!nCopy && !merged) { console.log('\nNichts zu tun.\n'); return; }

  if (merged) {
    const port = (readJson(NEW_CONFIG) || {}).port || 8080;
    if (await serverRunning(port)) {
      fail('Auf Port ' + port + ' laeuft gerade ein Quiz-Server. Bitte erst beenden (STRG+C im Server-Fenster), dann erneut starten.');
    }
  }

  if (!yes) {
    const a = await ask('\nJetzt uebernehmen? (j/n) ');
    if (a !== 'j' && a !== 'ja' && a !== 'y' && a !== 'yes') { console.log('Abgebrochen – nichts geaendert.\n'); return; }
  }

  console.log('');
  const copied = copyFiles(plan);
  console.log('  ' + copied + ' Datei(en) kopiert.');
  if (merged) {
    // Erst NACH dem Kopieren endgueltig zusammenfuehren: migrateConfig() behaelt nur
    // Dateien, die im neuen Ordner liegen (Pause-Bilder, Design-Hintergrund,
    // Musik-Playlist) – vor dem Kopieren wuerden sie sonst still verworfen.
    writeConfig(mergeConfig(oldCfg).result);
    console.log('  config.json uebernommen.');
  }
  console.log('\nFertig. Jetzt einfach die Start-Datei dieser Version benutzen.\n');
}

main().catch((e) => fail(e && e.stack || String(e)));
