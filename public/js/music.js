'use strict';
/*
 * Hintergrundmusik (generisch, spielunabhaengig) – drei Teile:
 * - Bildschirm: renderScreenMusic(s) folgt dem Server-Snapshot (s.music) mit
 *   EINEM Audio-Element; Play/Pause werden weich ein-/ausgeblendet (fadeMs),
 *   ein neues token laedt den naechsten Titel. Endet ein Titel, meldet der
 *   Bildschirm das per `musicEnded` – der Server entscheidet, wie es weitergeht.
 * - Master „🎮 Controls": renderMusicControls(s) – Play/Pause, ⏮/⏭, Shuffle,
 *   Wiederholen (aus/Playlist/Titel), Lautstaerke.
 * - Master „⚙️ Allgemein": renderMusicSettings(s) – Playlist (Upload,
 *   Reihenfolge, Entfernen), Fade-Dauer, Spiele, die die Musik pausieren.
 * Server-Gegenstueck: lib/music.js.
 */

// ---------------------------------------------------------------------------
// BILDSCHIRM – Wiedergabe
// ---------------------------------------------------------------------------
let musicAudio = null;
let musicState = null;          // letzter s.music-Stand
let musicLoadedToken = null;    // token des aktuell geladenen Titels
let musicGain = 0;              // Fade-Faktor 0..1 (mal Lautstaerke)
let musicFadeTimer = null;
let musicFadeTarget = null;
let musicFadeDone = null;
let musicSwitching = false;     // gerade beim Ausblenden vor einem Titelwechsel

function musicApplyVolume() {
  if (!musicAudio || !musicState) return;
  // Quadratisch: klingt beim Ein-/Ausblenden gleichmaessiger als linear.
  musicAudio.volume = screenVol(musicState.volume * musicGain * musicGain);
}
onScreenVolumeChange(musicApplyVolume);

// Gain weich auf `target` fahren. Laeuft schon ein Fade zum selben Ziel, bleibt
// er unangetastet (Snapshots kommen oft – sonst wuerde er staendig neu starten).
function musicFade(target, ms, done) {
  if (musicFadeTarget === target && musicFadeTimer) { musicFadeDone = done || null; return; }
  if (musicFadeTimer) { clearInterval(musicFadeTimer); musicFadeTimer = null; }
  musicFadeTarget = target;
  musicFadeDone = done || null;
  const from = musicGain;
  const dur = Math.max(0, ms) * Math.abs(target - from);
  const finish = () => {
    musicGain = target;
    musicApplyVolume();
    if (musicFadeTimer) { clearInterval(musicFadeTimer); musicFadeTimer = null; }
    const cb = musicFadeDone; musicFadeDone = null;
    if (cb) cb();
  };
  if (dur < 20) { finish(); return; }
  const t0 = performance.now();
  // setInterval statt requestAnimationFrame: laeuft (gedrosselt) auch weiter,
  // wenn der Bildschirm-Tab mal im Hintergrund liegt.
  musicFadeTimer = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / dur);
    musicGain = from + (target - from) * k;
    musicApplyVolume();
    if (k >= 1) finish();
  }, 30);
}

function musicLoad() {
  const m = musicState;
  musicLoadedToken = m.token;
  // Evtl. noch laufendes Ausblenden (mit „danach pausieren") verwerfen – es
  // gehoert zum alten Titel.
  if (musicFadeTimer) { clearInterval(musicFadeTimer); musicFadeTimer = null; }
  musicFadeDone = null;
  musicFadeTarget = null;
  musicGain = 0;
  if (m.track) {
    musicAudio.src = '/music/' + encodeURIComponent(m.track);
  } else {
    musicAudio.removeAttribute('src');
  }
  try { musicAudio.load(); } catch (e) { /* egal */ }
  musicApplyVolume();
}

// Audio-Element an den Soll-Zustand angleichen (Titel + Play/Pause).
function musicReconcile() {
  const m = musicState;
  if (!m || !musicAudio || musicSwitching) return;
  if (m.token !== musicLoadedToken) {
    if (!musicAudio.paused && musicGain > 0.01) {
      // Laufenden Titel kurz ausblenden, dann den neuen laden.
      musicSwitching = true;
      musicFade(0, Math.min(600, m.fadeMs), () => {
        musicSwitching = false;
        musicAudio.pause();
        musicLoad();
        musicReconcile();
      });
      return;
    }
    musicLoad();
  }
  const want = !!(m.audible && m.track && audioUnlocked);
  if (want) {
    if (musicAudio.paused) {
      const pr = musicAudio.play();
      if (pr && pr.catch) pr.catch(() => { /* Autoplay evtl. noch blockiert */ });
    }
    musicFade(1, m.fadeMs);
  } else if (!musicAudio.paused) {
    musicFade(0, m.fadeMs, () => musicAudio.pause());
  }
  musicApplyVolume();
}

function renderScreenMusic(s) {
  if (!s.music) return;
  musicState = s.music;
  if (!musicAudio) {
    musicAudio = new Audio();
    musicAudio.preload = 'auto';
    musicAudio.addEventListener('ended', () => {
      send({ type: 'musicEnded', token: musicLoadedToken });
    });
    // Datei fehlt/kaputt: nach kurzer Pause weiterschalten (Server prueft das token).
    musicAudio.addEventListener('error', () => {
      const tok = musicLoadedToken;
      if (!musicAudio.getAttribute('src')) return;
      setTimeout(() => {
        if (tok === musicLoadedToken && musicState && musicState.audible) send({ type: 'musicEnded', token: tok });
      }, 1500);
    });
    onAudioUnlock(() => musicReconcile());
  }
  musicReconcile();
}

// ---------------------------------------------------------------------------
// MASTER – Steuerung im Tab „🎮 Controls"
// ---------------------------------------------------------------------------
const MUSIC_REPEAT_NEXT = { off: 'all', all: 'one', one: 'off' };
const MUSIC_REPEAT_INFO = {
  off: { icon: '🔁', title: 'Wiederholen: aus (stoppt am Ende der Playlist)' },
  all: { icon: '🔁', title: 'Wiederholen: Playlist' },
  one: { icon: '🔂', title: 'Wiederholen: aktueller Titel' }
};

function musicAdminState() {
  return (latestAdmin && latestAdmin.music) || null;
}

function setupMusic() {
  const sendM = (action, extra) => send(Object.assign({ type: 'master', action }, extra || {}));
  $('music-toggle').addEventListener('click', () => {
    const m = musicAdminState();
    if (m) sendM(m.playing ? 'musicPause' : 'musicPlay');
  });
  $('music-prev').addEventListener('click', () => sendM('musicPrev'));
  $('music-next').addEventListener('click', () => sendM('musicNext'));
  $('music-shuffle').addEventListener('click', () => {
    const m = musicAdminState();
    if (m) sendM('musicShuffle', { on: !m.shuffle });
  });
  $('music-repeat').addEventListener('click', () => {
    const m = musicAdminState();
    if (m) sendM('musicRepeat', { mode: MUSIC_REPEAT_NEXT[m.repeat] || 'all' });
  });
  const vol = $('music-volume');
  vol.addEventListener('input', () => {
    $('music-volume-val').textContent = vol.value + ' %';
    sendM('musicVolume', { value: Number(vol.value) / 100 });
  });

  // Allgemein-Tab: Upload (mehrere Dateien nacheinander), Fade-Dauer
  const upBtn = $('music-upload-btn');
  const upFile = $('music-upload-file');
  upBtn.addEventListener('click', () => upFile.click());
  upFile.addEventListener('change', () => {
    const files = Array.from(upFile.files || []);
    upFile.value = '';
    const ok = files.filter((f) => f.size <= 30 * 1024 * 1024);
    musicUpload = { files: ok, i: 0, errors: files.length - ok.length };
    musicUploadNext();
  });
  const fade = $('music-fade');
  fade.addEventListener('input', () => {
    $('music-fade-v').textContent = fade.value + ' s';
    paintPlainRange(fade);
  });
  fade.addEventListener('change', () => sendM('musicFade', { value: Number(fade.value) }));
}

// Mehrfach-Upload: eine Datei nach der anderen – die naechste startet erst,
// wenn der Server die vorige quittiert hat (onMusicUploadResult aus core.js
// handleAdminResult), damit nicht mehrere grosse Dateien gleichzeitig im
// Speicher/auf der Leitung liegen.
let musicUpload = null;   // { files, i, errors }

function musicUploadNext() {
  const u = musicUpload;
  const msg = $('music-upload-msg');
  if (!u) return;
  if (u.i >= u.files.length) {
    msg.textContent = u.errors
      ? u.errors + ' Datei(en) nicht übernommen (zu groß, max 30 MB, oder ungültig).'
      : 'Hochgeladen ✓';
    musicUpload = null;
    return;
  }
  const f = u.files[u.i++];
  msg.textContent = 'Lade hoch … (' + u.i + '/' + u.files.length + ')';
  const reader = new FileReader();
  reader.onload = () => sendAdmin({ type: 'admin', action: 'uploadMusic', name: f.name, data: String(reader.result) });
  reader.onerror = () => { u.errors++; musicUploadNext(); };
  reader.readAsDataURL(f);
}

function onMusicUploadResult(msg) {
  if (!musicUpload) return;
  if (!msg.ok) musicUpload.errors++;
  musicUploadNext();
}

function renderMusicControls(s) {
  const m = s.admin && s.admin.music;
  if (!m) return;
  const has = m.count > 0;
  let status;
  if (!has) status = '';
  else if (m.playing && m.blockedBy) {
    const g = GAMES[m.blockedBy];
    status = '🔇 pausiert durch ' + (g ? g.emoji + ' ' + g.name : m.blockedBy);
  } else status = m.playing ? '▶ läuft' : '⏸ pausiert';
  $('music-status').textContent = status;
  $('music-now').textContent = has
    ? m.title + '  (' + m.pos + '/' + m.count + ')'
    : 'Keine Musik – Playlist im Tab „⚙️ Allgemein" anlegen.';
  $('music-now').classList.toggle('muted', !has);

  const toggle = $('music-toggle');
  toggle.textContent = m.playing ? '⏸' : '▶';
  toggle.title = m.playing ? 'Pause (ausblenden)' : 'Play (einblenden)';
  ['music-toggle', 'music-prev', 'music-next'].forEach((id) => { $(id).disabled = !has; });
  $('music-shuffle').classList.toggle('active', !!m.shuffle);
  const rep = MUSIC_REPEAT_INFO[m.repeat] || MUSIC_REPEAT_INFO.all;
  const repBtn = $('music-repeat');
  repBtn.textContent = rep.icon;
  repBtn.title = rep.title;
  repBtn.classList.toggle('active', m.repeat !== 'off');

  const vol = $('music-volume');
  if (document.activeElement !== vol) {
    const pct = Math.round(Math.min(1, Math.max(0, m.volume)) * 100);
    vol.value = String(pct);
    $('music-volume-val').textContent = pct + ' %';
  }
  renderMusicSettings(m);
}

// ---------------------------------------------------------------------------
// MASTER – Playlist + Optionen im Tab „⚙️ Allgemein"
// ---------------------------------------------------------------------------
function musicTrackTitle(file) {
  return String(file || '').replace(/\.[^.]+$/, '').replace(/_+/g, ' ').trim();
}

function renderMusicSettings(m) {
  const fade = $('music-fade');
  if (document.activeElement !== fade && +fade.value !== m.fadeSec) {
    fade.value = String(m.fadeSec);
    $('music-fade-v').textContent = m.fadeSec + ' s';
    paintPlainRange(fade);
  }

  // Listen nur bei Aenderung neu aufbauen (Snapshots kommen oft).
  const cont = $('music-tracks');
  const sig = JSON.stringify([m.tracks, m.files, m.currentIndex, m.pauseGames]);
  if (cont._musicSig === sig) return;
  cont._musicSig = sig;
  const sendTracks = (tracks) => send({ type: 'master', action: 'musicSetTracks', tracks });
  const mkBtn = (text, title, onClick, disabled) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-ghost small';
    b.textContent = text; b.title = title;
    b.disabled = !!disabled;
    b.addEventListener('click', onClick);
    return b;
  };

  cont.innerHTML = '';
  if (!m.tracks.length) {
    const p = document.createElement('p');
    p.className = 'muted small pl-empty';
    p.textContent = 'Noch keine Titel – lade Musikdateien hoch.';
    cont.appendChild(p);
  }
  m.tracks.forEach((file, i) => {
    const row = document.createElement('div');
    row.className = 'pl-step-row music-track-row' + (i === m.currentIndex ? ' current' : '');
    const num = document.createElement('span');
    num.className = 'pl-step-num';
    num.textContent = i === m.currentIndex ? '♪' : String(i + 1);
    row.appendChild(num);
    const name = document.createElement('span');
    name.className = 'music-track-name';
    name.textContent = musicTrackTitle(file);
    name.title = file;
    row.appendChild(name);
    const ctrls = document.createElement('div');
    ctrls.className = 'pl-step-ctrls';
    ctrls.appendChild(mkBtn('▶', 'Diesen Titel jetzt abspielen', () =>
      send({ type: 'master', action: 'musicGoto', index: i })));
    ctrls.appendChild(mkBtn('▲', 'Nach oben', () => {
      const t = m.tracks.slice(); [t[i - 1], t[i]] = [t[i], t[i - 1]]; sendTracks(t);
    }, i === 0));
    ctrls.appendChild(mkBtn('▼', 'Nach unten', () => {
      const t = m.tracks.slice(); [t[i + 1], t[i]] = [t[i], t[i + 1]]; sendTracks(t);
    }, i === m.tracks.length - 1));
    ctrls.appendChild(mkBtn('✕', 'Aus der Playlist nehmen (Datei bleibt erhalten)', () =>
      sendTracks(m.tracks.filter((_, j) => j !== i))));
    row.appendChild(ctrls);
    cont.appendChild(row);
  });

  // Dateien im Ordner, die (noch) nicht in der Playlist sind
  const extra = m.files.filter((f) => !m.tracks.includes(f));
  $('music-extra-wrap').classList.toggle('hidden', extra.length === 0);
  const ex = $('music-extra');
  ex.innerHTML = '';
  extra.forEach((file) => {
    const row = document.createElement('div');
    row.className = 'pl-step-row music-track-row';
    const name = document.createElement('span');
    name.className = 'music-track-name';
    name.textContent = musicTrackTitle(file);
    name.title = file;
    row.appendChild(name);
    const ctrls = document.createElement('div');
    ctrls.className = 'pl-step-ctrls';
    ctrls.appendChild(mkBtn('＋', 'Zur Playlist hinzufügen', () => sendTracks(m.tracks.concat(file))));
    ctrls.appendChild(mkBtn('🗑', 'Datei löschen', async () => {
      const ok = await confirmModal('„' + file + '" endgültig löschen?', { title: 'Musikdatei löschen', okText: 'Löschen', danger: true });
      if (ok) sendAdmin({ type: 'admin', action: 'deleteMusic', name: file });
    }));
    row.appendChild(ctrls);
    ex.appendChild(row);
  });

  // Spiele, die die Musik pausieren (Audioquiz & Co. fest, nicht abwaehlbar)
  const pg = $('music-pausegames');
  pg.innerHTML = '';
  Object.keys(GAMES).filter((gid) => gid !== 'none').forEach((gid) => {
    const always = m.pauseAlways.includes(gid);
    const label = document.createElement('label');
    label.className = 'music-pg-chip' + (always ? ' always' : '');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = always || m.pauseGames.includes(gid);
    cb.disabled = always;
    cb.addEventListener('change', () => {
      const set = m.pauseGames.filter((g) => g !== gid);
      if (cb.checked) set.push(gid);
      send({ type: 'master', action: 'musicPauseGames', games: set });
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + GAMES[gid].emoji + ' ' + GAMES[gid].name + (always ? ' (eigener Ton – immer)' : '')));
    pg.appendChild(label);
  });
}
