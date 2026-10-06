'use strict';
// Quiz-System Client – KERN: Rolle, WebSocket, State, gameCtx, render-Wrapper
// (Bildschirm/Spieler/Master), Master-Engine + Geräteliste, geteilte Helfer
// (renderLeaderboard, renderQuizDummy), Overlays/Utils. Lädt zuerst.
// Spiel-Module + GAMES-Registry (registry.js) folgen; startApp() steht in registry.js.

/* Quiz System – Client (Bildschirm / Master / Spieler)
 * Rolle wird ueber den Pfad bestimmt:
 *   /screen  -> Bildschirm (frei)
 *   /master  -> Master (Passwort noetig)  + Button "Ich bin doch Spieler"
 *   sonst    -> Spieler
 *
 * Spiele sind datengetrieben (siehe GAMES-Registry): jedes Spiel bringt Meta,
 * Konfig-Felder UND seine eigene Spieler-/Bildschirm-Oberflaeche mit. Spieler
 * und Bildschirm passen sich damit automatisch dem aktiven Spiel an. Ist kein
 * Spiel aktiv ('none'), zeigen beide einen neutralen Wartezustand.
 */
// ---------------------------------------------------------------------------
// Rolle aus Pfad
// ---------------------------------------------------------------------------
const cleanPath = location.pathname.replace(/\/+$/, '') || '/';
let role;
if (cleanPath === '/screen') role = 'screen';
else if (cleanPath === '/master') role = 'master';
else role = 'player';

const $ = (id) => document.getElementById(id);
const views = {
  screen: $('view-screen'),
  master: $('view-master'),
  player: $('view-player')
};

function showView(name) {
  for (const k of Object.keys(views)) {
    if (views[k]) views[k].classList.toggle('hidden', k !== name);
  }
}

// --- Eigener Bestaetigungs-Dialog (ersetzt das System-confirm) -------------
// Gibt IMMER ein Promise<boolean> zurueck. Aufrufer: `if (await confirmModal(..))`.
// opts: { title, okText, cancelText, danger }. `danger` faerbt den OK-Button rot.
// Hinweis: das echte „Seite verlassen?"-Popup beim Schliessen/Neuladen (beforeunload)
// laesst sich vom Browser aus NICHT durch ein eigenes Popup ersetzen und bleibt System.
function confirmModal(message, opts) {
  opts = opts || {};
  const overlay = $('confirm-overlay');
  if (!overlay) return Promise.resolve(window.confirm(message)); // Fallback
  const okBtn = $('confirm-ok');
  const cancelBtn = $('confirm-cancel');
  $('confirm-title').textContent = opts.title || 'Bestätigen';
  $('confirm-msg').textContent = message;
  okBtn.textContent = opts.okText || 'OK';
  cancelBtn.textContent = opts.cancelText || 'Abbrechen';
  okBtn.classList.toggle('btn-danger', !!opts.danger);
  okBtn.classList.toggle('btn-primary', !opts.danger);
  overlay.classList.remove('hidden');
  okBtn.focus();
  return new Promise((resolve) => {
    function cleanup(result) {
      overlay.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onBackdrop(e) { if (e.target === overlay) cleanup(false); }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(false); }
      else if (e.key === 'Enter') { e.preventDefault(); cleanup(true); }
    }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
  });
}

// Avatar/Farbe-Presets fuer das Ausklappmenue der Spieler-Kopfzeile – muessen mit
// PLAYER_AVATARS/PLAYER_COLORS in lib/state.js uebereinstimmen (der Server
// validiert setAvatar/setColor gegen genau diese Whitelist).
const PLAYER_AVATARS = [
  '🦊', '🐼', '🐵', '🐸', '🦁', '🐯', '🐨', '🐰',
  '🐻', '🐺', '🦄', '🐙', '🐢', '🦉', '🐧', '🦋',
  '🐝', '🐳', '🦖', '🐬', '🦔', '🐱', '🐶', '🐷'
];
const PLAYER_COLORS = ['#ef4444', '#22c55e', '#3b82f6', '#eab308', '#06b6d4', '#ec4899', '#f97316', '#8b5cf6'];

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------
let ws = null;
let clientId = localStorage.getItem('quizClientId_' + role) || null;
let myName = localStorage.getItem('quizName') || '';
let myAvatar = null;                // server-autoritativ (game.myAvatar), s. applyState
let myColor = null;                 // server-autoritativ (game.myColor), s. applyState
let masterPassword = sessionStorage.getItem('quizMasterPass') || null;
let authed = false;                 // Master erfolgreich angemeldet
let latestState = null;
let latestAdmin = null;             // nur beim Master gesetzt
let designPreviewActive = false;    // true, solange der Design-Tab live vorschaut (Broadcasts nicht anwenden)
let connected = false;

// Reaktions-Timing (Spieler)
let currentRoundId = -1;
let goLocalTime = null;
let localPressed = false;

// Aktuell gemountete Spiel-Oberflaechen je Rolle: { view, gid }
const mountedViews = {
  player: { view: null, gid: null },
  screen: { view: null, gid: null },
  master: { view: null, gid: null }
};

// Master-Konfig-Tab-Status
let activeTab = 'game';
let configGame = null;              // aktuell konfiguriertes Spiel (kann != aktivem Spiel sein)
let configOpen = false;            // true = Konfig-Seite offen (statt Spielauswahl)
let gameDragActive = false;        // true waehrend eine Spiele-Kachel per Drag umsortiert wird (blockt Rebuild)
let configProfile = null;          // aktuell im Editor geoeffnetes Profil (bleibt nach dem Speichern erhalten)
let configBaseline = null;         // JSON-Schnappschuss der Felder beim Laden (fuer „ungespeicherte Aenderungen")
let pendingAdminAction = null;     // letzte gesendete Admin-Aktion (fuer gezieltes Refresh)

// Gemeinsamer Kontext fuer alle Spiel-Module (Spieler + Bildschirm)
const gameCtx = {
  send: (obj) => send(obj),
  clientId: () => clientId,
  state: () => latestState,
  admin: () => latestAdmin,          // nur beim Master gesetzt (Konfig/Profile)
  goLocalTime: () => goLocalTime,
  pressed: () => localPressed,
  setPressed: (v) => { localPressed = v; }
};

// ---------------------------------------------------------------------------
// Wachhalten (nur /screen) – verhindert, dass der Bildschirm/PC einschlaeft
// ---------------------------------------------------------------------------
// Zwei Stufen: (1) Screen Wake Lock API – gibt es aber nur im sicheren Kontext
// (https oder localhost), ueber http://<LAN-IP>/screen fehlt sie komplett.
// (2) Fallback: unsichtbares, stummes Endlos-Video aus einem Canvas-Stream –
// solange ein Video laeuft, halten Browser Bildschirm/System wach (NoSleep-Trick,
// ohne Videodatei). Alle 30 s wird geprueft und ggf. neu angefordert.
let wakeLock = null;
let wakeLockPending = false;
let wakeVideo = null;
async function requestWakeLock() {
  if (document.visibilityState !== 'visible') return;
  if ('wakeLock' in navigator) {
    if (wakeLock || wakeLockPending) return;
    wakeLockPending = true;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
      stopWakeVideo();
      return;
    } catch { /* z.B. Tab im Hintergrund oder Policy – Fallback unten */ }
    finally { wakeLockPending = false; }
  }
  startWakeVideo();
}

function startWakeVideo() {
  if (!wakeVideo) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const c2d = canvas.getContext('2d');
    if (!c2d || !canvas.captureStream) return;
    let tick = 0;
    // Stream braucht sich aendernde Frames, sonst gilt das Video als "stehend".
    setInterval(() => {
      tick = (tick + 1) % 2;
      c2d.fillStyle = tick ? '#000' : '#010101';
      c2d.fillRect(0, 0, 16, 16);
    }, 1000);
    wakeVideo = document.createElement('video');
    wakeVideo.muted = true;
    wakeVideo.loop = true;
    wakeVideo.playsInline = true;
    wakeVideo.setAttribute('muted', '');
    wakeVideo.setAttribute('playsinline', '');
    wakeVideo.setAttribute('aria-hidden', 'true');
    // Nicht display:none/0px – manche Browser halten sonst keinen Lock.
    wakeVideo.style.cssText = 'position:fixed;right:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1';
    wakeVideo.srcObject = canvas.captureStream(1);
    document.body.appendChild(wakeVideo);
    // Autoplay blockiert? Beim ersten Klick/Tastendruck erneut starten.
    onAudioUnlock(() => { if (wakeVideo && wakeVideo.paused && !wakeLock) wakeVideo.play().catch(() => {}); });
  }
  if (wakeVideo.paused) wakeVideo.play().catch(() => {});
}

function stopWakeVideo() {
  if (wakeVideo && !wakeVideo.paused) wakeVideo.pause();
}

document.addEventListener('visibilitychange', () => {
  if (role === 'screen') requestWakeLock();
});
setInterval(() => {
  if (role === 'screen' && !wakeLock) requestWakeLock();
}, 30000);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
function startApp() {
  showView(role);
  if (role === 'player') { setupPlayerName(); setupPlayerAvatar(); setupPlayerReactions(); setupPlayerPoll(); }
  if (role === 'master') { setupMasterControls(); setupTabs(); setupConfigTab(); setupDesignTab(); setupPauseTab(); setupFunTab(); setupWheel(); setupMusic(); setupGate(); }
  if (role === 'screen') { requestWakeLock(); setupScreenAudioUnlock(); setupScreenVolume(); }
  connect();
}

// ---------------------------------------------------------------------------
// WebSocket-Verbindung
// ---------------------------------------------------------------------------
function connect() {
  showOverlay('conn', 'Verbinde…');
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);

  ws.addEventListener('open', () => {
    hideOverlay('conn');
    send({ type: 'hello', role, clientId, name: myName || undefined });
    if (role === 'master') afterMasterConnect();
  });

  ws.addEventListener('message', (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
    onMessage(msg);
  });

  ws.addEventListener('close', () => {
    connected = false; updateSelfStatus();
    showOverlay('conn', 'Verbindung verloren – neuer Versuch…');
    setTimeout(connect, 1000);
  });
  ws.addEventListener('error', () => { try { ws.close(); } catch (e) {} });
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// Admin-Aktion senden und die Aktion merken, damit handleAdminResult gezielt
// nur den betroffenen Teil der Oberflaeche aktualisiert (kein globaler Reset).
function sendAdmin(obj) {
  pendingAdminAction = obj.action || null;
  send(obj);
}

function onMessage(msg) {
  if (msg.type === 'welcome') {
    clientId = msg.clientId;
    localStorage.setItem('quizClientId_' + role, clientId);
    connected = true; updateSelfStatus();
  } else if (msg.type === 'state') {
    latestState = msg;
    if (msg.admin) latestAdmin = msg.admin;
    applyState(msg);
  } else if (msg.type === 'adminResult') {
    handleAdminResult(msg);
  } else if (msg.type === 'reaction') {
    spawnReactionFloat(msg);
  } else if (msg.type === 'flashbang') {
    triggerFlashbang();
  } else if (msg.type === 'kopfstand') {
    triggerKopfstand(msg.ms);
  } else if (msg.type === 'soundboard') {
    playSoundboardSound(msg);
  } else if (msg.type === 'soundboardStop') {
    stopSoundboardSounds();
  }
}

// Ein per WS empfangenes Emoji als aufschwebendes Element auf dem Bildschirm
// einblenden. Rein clientseitige Animation, kein Teil des Spielzustands – daher
// separater Nachrichtentyp statt Snapshot (s. broadcastReaction in lib/state.js).
function spawnReactionFloat(msg) {
  const layer = $('screen-reactions');
  if (!layer) return;
  const el = document.createElement('div');
  el.className = 'reaction-float';
  el.textContent = msg.emoji;
  el.style.left = (4 + Math.random() * 92) + '%';
  el.style.setProperty('--drift', (Math.random() * 2 - 1).toFixed(2));
  el.style.animationDuration = (2.2 + Math.random() * 1.2).toFixed(2) + 's';
  if (msg.color) el.style.textShadow = '0 0 18px ' + msg.color;
  layer.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
  if (role === 'screen') hypeOnReaction();
  if (msg.sound && role === 'screen') {
    const vol = (latestState && latestState.settings && latestState.settings.reactions)
      ? latestState.settings.reactions.volume : 0;
    playReactionSound(vol);
  }
}

// ---------------------------------------------------------------------------
// Globale Bildschirm-Audio-Freischaltung: der Browser erlaubt Audio-Autoplay
// erst nach einer Nutzergeste; auf dem Bildschirm (Beamer, niemand tippt dort
// normalerweise hin) passiert die oft nie von selbst. Die Freischaltung gilt
// daher fuer die ganze Seite, ueberlebt jeden Spiel-/Modulwechsel und wird von
// den Emoji-Reaktions-Sounds (unten) und vom Audioquiz (game-aq.js) gemeinsam
// genutzt. Ein sichtbarer Fallback-Button (#screen-audio-activate, s. setupScreenAudioUnlock)
// deckt den Fall ab, dass nie irgendwo auf der Seite geklickt/getippt wird.
// ---------------------------------------------------------------------------
let audioUnlocked = false;
const audioUnlockListeners = [];
function onAudioUnlock(cb) {
  if (audioUnlocked) { try { cb(); } catch (e) {} return function () {}; }
  audioUnlockListeners.push(cb);
  return function () {
    const i = audioUnlockListeners.indexOf(cb);
    if (i >= 0) audioUnlockListeners.splice(i, 1);
  };
}
function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  audioUnlockListeners.slice().forEach((cb) => { try { cb(); } catch (e) {} });
}
(function initAudioUnlock() {
  if (typeof window === 'undefined') return;
  const evs = ['pointerdown', 'keydown', 'touchstart', 'click'];
  function handler() {
    unlockAudio();
    evs.forEach((ev) => window.removeEventListener(ev, handler, true));
  }
  evs.forEach((ev) => window.addEventListener(ev, handler, true));
})();

// Maximale Lautstaerke des Bildschirms: lokaler Faktor 0..1 (nur dieses Geraet,
// in localStorage gemerkt), mit dem jede Audioquelle multipliziert wird
// (Musik, Soundboard, Audioquiz, Reaktions-Sounds, Countdown-Toene). Regler
// (#screen-volume) erscheint, wenn die Maus an den linken Bildschirmrand geht.
const SCREEN_VOL_KEY = 'quizScreenMaxVol';
let screenMaxVolume = (function () {
  try {
    const v = parseFloat(localStorage.getItem(SCREEN_VOL_KEY));
    if (v >= 0 && v <= 1) return v;
  } catch (e) {}
  return 1;
})();
const screenVolumeListeners = [];
function onScreenVolumeChange(cb) {
  screenVolumeListeners.push(cb);
  return function () {
    const i = screenVolumeListeners.indexOf(cb);
    if (i >= 0) screenVolumeListeners.splice(i, 1);
  };
}
function screenVol(v) {
  return Math.min(1, Math.max(0, Number(v) || 0)) * screenMaxVolume;
}
function setScreenMaxVolume(v) {
  screenMaxVolume = Math.min(1, Math.max(0, Number(v) || 0));
  try { localStorage.setItem(SCREEN_VOL_KEY, String(screenMaxVolume)); } catch (e) {}
  screenVolumeListeners.slice().forEach((cb) => { try { cb(); } catch (e) {} });
}
function setupScreenVolume() {
  const range = $('screen-volume-range');
  if (!range) return;
  const val = $('screen-volume-val');
  const show = () => {
    const pct = Math.round(screenMaxVolume * 100);
    range.value = pct;
    val.textContent = pct + ' %';
    $('screen-volume-icon').textContent = pct === 0 ? '🔇' : (pct < 50 ? '🔉' : '🔊');
  };
  range.addEventListener('input', () => { setScreenMaxVolume(Number(range.value) / 100); show(); });
  show();
}

// Sichtbarer Fallback-Button auf dem Bildschirm, falls die Seite nie eine
// Nutzergeste bekommt (typischer Kiosk-/Beamer-Betrieb) – einmal antippen
// schaltet Audio fuer die ganze Sitzung frei.
function setupScreenAudioUnlock() {
  const btn = $('screen-audio-activate');
  if (!btn) return;
  btn.classList.toggle('hidden', audioUnlocked);
  btn.addEventListener('click', unlockAudio);
  onAudioUnlock(() => btn.classList.add('hidden'));
}

// Emoji-Reaktionen: kurzer Party-Sound auf dem Bildschirm (nicht beim Spieler
// selbst), aus ein paar mitgelieferten Audio-Dateien (public/sounds/, lizenzfrei)
// zufaellig ausgewaehlt.
const REACTION_SOUND_FILES = [
  '/sounds/reaction-alarm.mp3',
  '/sounds/reaction-horn.mp3',
  '/sounds/reaction-boing.mp3',
  '/sounds/reaction-bonus.mp3',
  '/sounds/reaction-pop.mp3'
];

function playReactionSound(volume) {
  if (!audioUnlocked || !(volume > 0)) return;
  try {
    const src = REACTION_SOUND_FILES[Math.floor(Math.random() * REACTION_SOUND_FILES.length)];
    const audio = new Audio(src);
    audio.volume = screenVol(volume);
    const pr = audio.play();
    if (pr && pr.catch) pr.catch(() => { /* Autoplay evtl. noch blockiert */ });
  } catch (e) { /* egal, Sound ist nur Zierde */ }
}

// ---------------------------------------------------------------------------
// Master-Anmeldung / Gate
// ---------------------------------------------------------------------------
function afterMasterConnect() {
  if (masterPassword) {
    // Automatische (Re-)Anmeldung mit gemerktem Passwort
    send({ type: 'admin', action: 'auth', password: masterPassword });
  } else {
    showGate();
  }
}

function setupGate() {
  $('gate-login').addEventListener('click', submitGate);
  $('gate-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitGate(); });
  $('gate-player').addEventListener('click', () => { location.href = '/'; });
}

function submitGate() {
  const pass = $('gate-pass').value;
  if (!pass) { $('gate-pass').focus(); return; }
  masterPassword = pass;
  send({ type: 'admin', action: 'auth', password: pass });
}

function showGate() {
  $('master-gate').classList.remove('hidden');
  setTimeout(() => { const el = $('gate-pass'); if (el) el.focus(); }, 100);
}
function hideGate() { $('master-gate').classList.add('hidden'); }

// ---------------------------------------------------------------------------
// Zustand anwenden
// ---------------------------------------------------------------------------
function applyState(s) {
  // Design anwenden (Theme/Farben/Form/Hintergrund/Bildschirm-Extras).
  // Waehrend der Live-Vorschau im Design-Tab NICHT ueberschreiben.
  if (!designPreviewActive) applyDesign(s.settings.theme, s.settings.design);
  document.title = s.settings.title;
  const st = $('screen-title'); if (st) st.textContent = s.settings.title;
  const mt = $('master-title'); if (mt) mt.textContent = s.settings.title;

  // Rundenwechsel erkennen -> lokales Timing zuruecksetzen (Spieler)
  if (s.game.roundId !== currentRoundId) {
    currentRoundId = s.game.roundId;
    goLocalTime = null;
    localPressed = false;
  }
  if (s.game.phase === 'go' && goLocalTime === null) {
    goLocalTime = performance.now();
  }

  applyDisco(!!s.game.disco);

  if (role === 'screen') { hypeApplySettings(s.settings.hype); renderScreen(s); }
  else if (role === 'master') { renderFunTab(s); renderMaster(s); }
  else if (role === 'player') renderPlayer(s);
}

// ---------------------------------------------------------------------------
// Eigener Verbindungs-Status (kleines Symbol) – Spieler/Bildschirm/Master
// ---------------------------------------------------------------------------
function updateSelfStatus() {
  document.querySelectorAll('.self-dot').forEach((d) => d.classList.toggle('online', connected));
}

// ---------------------------------------------------------------------------
// Rollenspezifische Spiel-Oberflaeche mounten (Spieler + Bildschirm)
// Sorgt dafuer, dass beim Spielwechsel die passende UI (neu) aufgebaut wird.
// ---------------------------------------------------------------------------
function mountGameView(kind, gid, spec, root) {
  const slot = mountedViews[kind];
  if (slot.gid === gid && slot.view) return slot.view;

  if (slot.view && typeof slot.view.destroy === 'function') { try { slot.view.destroy(); } catch (e) {} }
  root.innerHTML = '';
  slot.view = spec[kind](root, gameCtx);
  slot.gid = gid;
  return slot.view;
}

function unmountGameView(kind, root) {
  const slot = mountedViews[kind];
  if (slot.view && typeof slot.view.destroy === 'function') { try { slot.view.destroy(); } catch (e) {} }
  root.innerHTML = '';
  slot.view = null; slot.gid = null;
}

// ---------------------------------------------------------------------------
// BILDSCHIRM – waehlt Wartezustand oder die Oberflaeche des aktiven Spiels
// ---------------------------------------------------------------------------
function renderScreen(s) {
  const gid = s.settings.activeGame;
  const spec = (GAMES[gid] && typeof GAMES[gid].screen === 'function') ? GAMES[gid] : null;
  const waitEl = $('screen-wait');
  const mountEl = $('screen-game');
  const lockEl = $('screen-locked');

  // Scoreboard-Overlay ist unabhaengig vom aktiven Spiel (auch im Standby sichtbar).
  renderScoreboard(s);
  // Session-Endscreen (Zusammenfassung am Ende des Spielplans) ebenfalls spielunabhaengig.
  renderSessionEnd(s);
  // QR-Code zum Mitspielen ist ebenfalls spielunabhaengig (auch im Standby sichtbar).
  renderQr(s);
  // Hintergrundmusik laeuft spielunabhaengig (Spiele koennen sie serverseitig pausieren).
  renderScreenMusic(s);
  // Fun-Countdown (Master-Tab „🎉 Fun") ebenfalls spielunabhaengig, s. fun.js.
  renderScreenCountdown(s);
  // Gluecksrad (Fun-Pannel) ebenfalls spielunabhaengig.
  renderScreenWheel(s);
  // Schnellumfrage-Ergebnis aus dem Fun-Pannel (klein, spielunabhaengig).
  renderScreenPoll(s);

  // Killswitch generisch (funktioniert spielunabhaengig, auch im Standby); Inhalt
  // des Pause-Bildschirms kommt aus s.settings.pauseScreen (Master-Tab „⏸ Pause").
  const locked = !!s.game.locked;
  lockEl.classList.toggle('hidden', !locked);
  if (locked) renderPauseVisual(lockEl, s.settings.pauseScreen);

  if (!spec) {
    // Kein (bekanntes) Spiel aktiv -> neutraler Wartezustand.
    unmountGameView('screen', mountEl);
    waitEl.classList.remove('hidden');
    mountEl.classList.add('hidden');
    return;
  }

  waitEl.classList.add('hidden');
  mountEl.classList.remove('hidden');
  const view = mountGameView('screen', gid, spec, mountEl);
  view.update(s);
}

// ---------------------------------------------------------------------------
// BILDSCHIRM – QR-Code zum Mitspielen (generisch, ueber allen Spielen)
// Zeigt die Beitritts-URL (s.settings.joinUrl) als QR-Code, sobald der Master
// den Schalter aktiviert. Der QR wird nur bei URL-Wechsel neu gebaut (Snapshots
// kommen haeufig), erzeugt aus dem abhaengigkeitsfreien QR-Encoder (js/qr.js).
// ---------------------------------------------------------------------------
function renderQr(s) {
  const card = $('screen-qr');
  if (!card) return;
  const show = !!(s.settings && s.settings.showQr);
  card.classList.toggle('hidden', !show);
  if (!show) return;
  const url = (s.settings && s.settings.joinUrl) || '';
  const codeEl = $('qr-code');
  if (codeEl && codeEl.dataset.url !== url) {
    try {
      codeEl.innerHTML = (window.QR && url) ? QR.svg(url, { ecLevel: 'M' }) : '';
      codeEl.dataset.url = url;
    } catch (e) { codeEl.innerHTML = ''; codeEl.dataset.url = ''; }
  }
  const urlEl = $('qr-url');
  if (urlEl) urlEl.textContent = url.replace(/^https?:\/\//, '');
  const titleEl = $('qr-card-title');
  if (titleEl) titleEl.textContent = (s.settings && s.settings.qrTitle) || '📱 Zum Mitspielen scannen';
}

// Kleiner Avatar-Chip (Emoji, Hintergrund in Spielerfarbe) als HTML-String –
// ueberall wiederverwendbar, wo ein Spielername mit Avatar/Farbe angezeigt wird
// (Bestenliste, Scoreboard, Podium, Geraeteliste, Buzzer-/Gewinner-Meldungen).
// `entry` braucht nur `avatar`/`color` (beide optional -> leerer String).
function avatarChip(entry) {
  if (!entry || !entry.avatar) return '';
  const col = entry.color || 'var(--panel-2)';
  return '<span class="p-avatar" style="--p-col:' + escapeHtml(col) + '">' + escapeHtml(entry.avatar) + '</span>';
}

// ---------------------------------------------------------------------------
// MASTER – Nur-Master-Modus: generische Stellvertreter-Steuerelemente. Im
// Master-State kommt s.participants nur beim Master mit (echte + lokale
// Spieler); diese Helfer bauen daraus Buzzer-Reihen bzw. Auswahllisten, die
// jedes Spiel-Master-Modul fuer seine masterPress/masterGuess/... Aktionen
// wiederverwenden kann, statt das selbst zu bauen.
// ---------------------------------------------------------------------------
function proxyPlayers(s) {
  return (s.participants || []).filter((p) => p.role === 'player');
}

// Eine Reihe Buzzer-Buttons (ein Klick je Teilnehmer) – fuer Reaktion, Falsche
// Woerter, Detektivquiz-Buzzermodus. `onPick(playerId)` wird pro Klick gerufen.
function renderProxyBuzzRow(container, players, onPick, disabledIds) {
  container.innerHTML = '';
  if (players.length === 0) {
    container.innerHTML = '<p class="muted small">Keine Spieler/Teilnehmer vorhanden.</p>';
    return;
  }
  const disabled = disabledIds || new Set();
  players.forEach((p) => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost proxy-btn';
    btn.disabled = disabled.has(p.id);
    btn.innerHTML = avatarChip(p) + '<span>' + escapeHtml(p.name) + '</span>';
    btn.addEventListener('click', () => onPick(p.id));
    container.appendChild(btn);
  });
}

// Eine <select>-Teilnehmerauswahl fuer Aktionen mit Textfeld/Optionen (MC,
// Zeitdruck, Schaetzquiz, Detektivquiz-Freitext, Audioquiz, Wortliste).
function fillProxySelect(select, players, keepValue) {
  const prev = keepValue ? select.value : '';
  select.innerHTML = '<option value="">– Teilnehmer wählen –</option>';
  players.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    select.appendChild(opt);
  });
  if (prev && players.some((p) => p.id === prev)) select.value = prev;
}

// Mountet das ECHTE Spieler-Modul eines Spiels im Master-Panel, damit der Master
// im Nur-Master-Modus exakt so klickt/zieht wie ein Spieler – ohne Teilnehmer-
// Auswahl, keine Punktevergabe (die Aktion haengt an keinem Teilnehmer). `translate`
// uebersetzt die vom Spieler-Modul gesendete Nachricht (z.B. {type:'answer',...})
// in die passende masterOnly-*GroupPick-Aktion; `mirror` spiegelt game.<x>.groupPick
// als game.<x>MyAnswer in einen lokalen Kopie-State, damit das Modul seine eigene
// Auswahl (gewaehlt/gesperrt) genauso anzeigt wie bei einem echten Spieler.
function mountPlayerProxy(root, outerCtx, playerFactory, { translate, mirror }) {
  let mirrored = null;
  const proxyCtx = {
    send: (msg) => {
      const out = translate(msg);
      if (out) outerCtx.send(Object.assign({ type: 'master' }, out));
    },
    clientId: () => '',                 // keine echte Teilnehmer-Bindung -> nie ein Score-Treffer
    state: () => mirrored,
    admin: () => outerCtx.admin(),
    goLocalTime: () => outerCtx.goLocalTime(),
    pressed: () => outerCtx.pressed(),
    setPressed: (v) => outerCtx.setPressed(v)
  };
  const inst = playerFactory(root, proxyCtx);
  return {
    update(s) {
      const game = Object.assign({}, s.game);
      mirror(game);
      mirrored = Object.assign({}, s, { game });
      inst.update(mirrored);
    },
    destroy: inst.destroy
  };
}

// ---------------------------------------------------------------------------
// BILDSCHIRM – Scoreboard-Overlay (generisch, ueber allen Spielen)
// Modus kommt vom Master: 'off' | 'side' (schmale Leiste, Spiel bleibt sichtbar)
// | 'full' (Vollbild, verdeckt das Spiel). Daten (Namen + Punkte, ALLE Spieler)
// kommen fertig aufgeloest vom Server (s.game.scoreboardList).
// ---------------------------------------------------------------------------
function renderScoreboard(s) {
  const overlay = $('screen-scoreboard');
  const stage = $('screen-stage');
  if (!overlay) return;
  const mode = (s.game && s.game.scoreboardMode) || 'off';
  const scale = (s.game && s.game.scoreboardScale) || 100;
  overlay.style.setProperty('--sb-scale', scale / 100);

  overlay.classList.toggle('hidden', mode === 'off');
  overlay.classList.toggle('mode-side', mode === 'side');
  overlay.classList.toggle('mode-full', mode === 'full');
  overlay.classList.toggle('mode-podium', mode === 'podium');
  if (stage) {
    stage.classList.toggle('sb-side', mode === 'side');
    stage.classList.toggle('sb-full', mode === 'full' || mode === 'podium');
  }
  // Kopfzeile + welche Ansicht (Liste vs. Podium) sichtbar ist.
  const headLabel = $('sb-head-label');
  if (headLabel) headLabel.textContent = (mode === 'podium') ? 'Sieger' : 'Punktestand';
  const listEl = $('sb-list');
  const podEl = $('sb-podium');
  if (listEl) listEl.classList.toggle('hidden', mode === 'podium');
  if (podEl) podEl.classList.toggle('hidden', mode !== 'podium');
  if (mode === 'off') return;

  // Podium (Sieger-Abschluss): Top 3 als klassisches Treppchen (2 · 1 · 3).
  if (mode === 'podium') { renderPodium(s, podEl); return; }

  const list = listEl;
  list.innerHTML = '';

  // Team-Modus: Teams (nach Summe sortiert) statt Einzelspieler anzeigen.
  if (s.game && s.game.teamMode) {
    const teams = (s.game.teams || []);
    if (teams.length === 0) {
      list.innerHTML = '<div class="sb-empty">Noch keine Teams.</div>';
      return;
    }
    let rank = 0, prev = null;
    teams.forEach((t, i) => {
      if (prev === null || t.pts !== prev) { rank = i + 1; prev = t.pts; }
      const row = document.createElement('div');
      row.className = 'sb-row sb-team' + (rank <= 3 ? ' top top' + rank : '');
      row.style.setProperty('--team-col', t.color);
      const members = (t.members || [])
        .map((m) => '<span class="sb-mem' + (m.online ? '' : ' offline') + '">' +
          avatarChip(m) + escapeHtml(m.name) + ' <b>' + m.pts + '</b></span>').join('');
      row.innerHTML =
        '<span class="sb-rank">' + rank + '</span>' +
        '<span class="sb-teamcol">' +
          '<span class="sb-name">' + escapeHtml(t.name) + '</span>' +
          (members ? '<span class="sb-members">' + members + '</span>' : '') +
        '</span>' +
        '<span class="sb-pts">' + t.pts + '</span>';
      list.appendChild(row);
    });
    updateSbFade();
    return;
  }

  const data = (s.game && s.game.scoreboardList) || [];
  if (data.length === 0) {
    list.innerHTML = '<div class="sb-empty">Noch keine Spieler.</div>';
    return;
  }
  // Standard-Wettkampf-Ranking (gleiche Punkte = gleicher Platz, 1,1,3,…)
  let rank = 0, prev = null;
  data.forEach((e, i) => {
    if (prev === null || e.pts !== prev) { rank = i + 1; prev = e.pts; }
    const row = document.createElement('div');
    row.className = 'sb-row' + (e.online ? '' : ' offline') + (rank <= 3 ? ' top top' + rank : '');
    row.innerHTML =
      '<span class="sb-rank">' + rank + '</span>' +
      '<span class="sb-name">' + avatarChip(e) + escapeHtml(e.name) + '</span>' +
      '<span class="sb-pts">' + e.pts + '</span>';
    list.appendChild(row);
  });
  updateSbFade();
}

// Scoreboard-Liste scrollt nicht: laeuft sie ueber, wird unten per Maske
// ausgeblendet (nur dann, sonst wuerde die letzte Zeile grundlos verblassen).
function updateSbFade() {
  const list = $('sb-list');
  if (!list) return;
  list.classList.toggle('sb-fade', list.scrollHeight > list.clientHeight + 1);
}
window.addEventListener('resize', updateSbFade);

// ---------------------------------------------------------------------------
// BILDSCHIRM – Podium (Sieger-Abschluss, generisch). Zeigt die Top 3 als
// klassisches Treppchen: 2. links, 1. (am höchsten) in der Mitte, 3. rechts.
// Datenquelle wie das Scoreboard: im Team-Modus die Teams (nach Summe), sonst
// die Einzelspieler – beide kommen fertig sortiert vom Server.
// ---------------------------------------------------------------------------
// Podium-Enthuellung: modul-weiter State, ueberlebt einzelne renderPodium()-Aufrufe,
// damit ein zwischenzeitlicher Snapshot (z.B. eine Punktkorrektur) eine laufende
// Sequenz nicht abbricht/neu startet. Ausgeloest durch g.podiumToken (steigt server-
// seitig bei jeder Aktivierung des Podium-Modus bzw. per „Wiederholen"-Button).
let podiumAnim = { token: null, animating: false, sig: null, timers: [] };

function renderPodium(s, root) {
  if (!root) return;
  const g = s.game || {};
  const isTeam = !!g.teamMode;
  // Auf eine gemeinsame Form normalisieren; Reihenfolge (absteigend) kommt vom Server.
  const src = isTeam ? (g.teams || []) : (g.scoreboardList || []);
  const entries = src.map((e) => ({
    name: e.name, pts: e.pts, color: e.color || null,
    avatar: isTeam ? null : (e.avatar || null)   // Team-Podium zeigt keine Einzel-Avatare
  }));
  podiumAnim = renderPodiumAnimated(root, entries.slice(0, 3), isTeam, g.podiumToken || 0, g.podiumSpeed || 900, podiumAnim);
}

// Gemeinsamer Kern fuer Scoreboard-Podium und Session-Endscreen: spielt bei neuem
// Token die Spotlight-Enthuellung ab, sonst nur statisches Update bei Datenaenderung.
// anim = der modul-weite State des Aufrufers; gibt den (evtl. neuen) State zurueck.
function renderPodiumAnimated(root, top, isTeam, token, speedMs, anim, onDone) {
  if (top.length === 0) {
    anim.timers.forEach(clearTimeout);
    root.innerHTML = '<div class="sb-empty">' +
      (isTeam ? 'Noch keine Teams.' : 'Noch keine Spieler.') + '</div>';
    if (onDone) onDone();
    return { token: null, animating: false, sig: null, timers: [] };
  }

  const sig = JSON.stringify(top);
  if (token !== anim.token) {
    // Neue Aktivierung/Wiederholung: eine evtl. laufende Sequenz abbrechen, neu starten.
    anim.timers.forEach(clearTimeout);
    const next = { token, animating: true, sig, timers: [] };
    runPodiumReveal(root, top, isTeam, speedMs, next, onDone);
    return next;
  }
  if (anim.animating) return anim;       // laufende Sequenz nicht durch Zwischen-Snapshots stoeren
  if (sig === anim.sig) return anim;     // unveraendert -> nichts zu tun
  anim.sig = sig;
  buildPodiumStatic(root, top, isTeam);  // z.B. Punktkorrektur nach Ende der Sequenz -> sofort aktualisieren
  return anim;
}

function podiumCardHtml(e, idx) {
  const medals = ['🥇', '🥈', '🥉'];
  return '<div class="pod-card">' +
      '<span class="pod-medal">' + medals[idx] + '</span>' +
      '<span class="pod-name">' + avatarChip(e) + escapeHtml(e.name) + '</span>' +
      '<span class="pod-pts">' + e.pts + '</span>' +
    '</div>' +
    '<div class="pod-bar"><span class="pod-rank">' + (idx + 1) + '</span></div>';
}

// Statischer Aufbau (keine Animation) – Ausgangszustand nach Ende der Sequenz
// bzw. Fallback fuer Aenderungen, waehrend keine Sequenz laeuft.
function buildPodiumStatic(root, top, isTeam) {
  root.classList.remove('pod-seq');
  root.innerHTML = '';
  const slotOrder = [1, 0, 2]; // Anzeige links->rechts: 2. · 1. · 3.
  slotOrder.forEach((idx) => {
    if (idx >= top.length) return;
    const e = top[idx];
    const place = document.createElement('div');
    place.className = 'pod-place p' + (idx + 1) + (isTeam ? ' pod-team' : '');
    if (e.color) place.style.setProperty('--team-col', e.color);
    place.innerHTML = podiumCardHtml(e, idx);
    root.appendChild(place);
  });
}

// Animierte Sieger-Enthuellung: abgedunkelte Buehne, ein wanderndes Spotlight
// deckt die Plaetze in der Reihenfolge 3. -> 2. -> 1. auf (Spannungsbogen), beim
// 1. Platz zusaetzlich ein Konfetti-Burst (wiederverwendet den Design-Effekt).
function runPodiumReveal(root, top, isTeam, speedMs, anim, onDone) {
  root.classList.add('pod-seq');
  root.innerHTML = '';
  const slotOrder = [1, 0, 2];
  const placeEls = {}; // idx (0=1.,1=2.,2=3.) -> Element
  slotOrder.forEach((idx) => {
    if (idx >= top.length) return;
    const e = top[idx];
    const place = document.createElement('div');
    place.className = 'pod-place p' + (idx + 1) + (isTeam ? ' pod-team' : '') + ' pod-pending';
    if (e.color) place.style.setProperty('--team-col', e.color);
    place.innerHTML = podiumCardHtml(e, idx);
    root.appendChild(place);
    placeEls[idx] = place;
  });

  const spot = document.createElement('div');
  spot.className = 'pod-spot';
  root.appendChild(spot);

  function moveSpotTo(el) {
    const rb = root.getBoundingClientRect();
    const card = el.querySelector('.pod-card');
    const cb = (card || el).getBoundingClientRect();
    spot.style.left = (cb.left - rb.left + cb.width / 2) + 'px';
    spot.style.top = (cb.top - rb.top + cb.height / 2) + 'px';
    spot.classList.add('on');
  }

  const revealOrder = [2, 1, 0].filter((idx) => placeEls[idx]); // 3. -> 2. -> 1.
  const step = Math.max(300, Math.min(3000, speedMs || 900));
  const travel = Math.round(step * 0.4);
  const timers = [];
  let t = 0;
  revealOrder.forEach((idx) => {
    timers.push(setTimeout(() => moveSpotTo(placeEls[idx]), t));
    timers.push(setTimeout(() => {
      placeEls[idx].classList.remove('pod-pending');
      placeEls[idx].classList.add('pod-revealed');
      if (idx === 0) fireConfettiBurst(root); // 1. Platz = grosses Finale
    }, t + travel));
    t += step;
  });
  timers.push(setTimeout(() => spot.classList.remove('on'), t + 150));
  timers.push(setTimeout(() => { anim.animating = false; if (onDone) onDone(); }, t + 500));
  anim.timers = timers;
}

function fireConfettiBurst(root) {
  if (typeof buildEffect !== 'function') return;
  const layer = document.createElement('div');
  layer.className = 'pod-confetti-burst';
  const fx = buildEffect('confetti', 130);
  if (fx) layer.appendChild(fx);
  root.appendChild(layer);
  setTimeout(() => layer.remove(), 6000);
}

// ---------------------------------------------------------------------------
// BILDSCHIRM – Session-Endscreen (Zusammenfassung nach dem letzten Spielplan-
// Schritt). Zeigt das Gesamt-Podium (wie das Scoreboard-Podium, aber ueber die
// ganze Session) + Fun-Fact-Kacheln aus s.game.sessionSummary. Die Spotlight-
// Enthuellung des Podiums (Tempo = podiumSpeed) laeuft einmal pro sessionEndToken
// (Erstanzeige oder "erneut zeigen"); die Kacheln blenden danach ein.
// ---------------------------------------------------------------------------
// Eigene Animations-State-Instanz (unabhaengig vom Scoreboard-Podium), gleiche
// Enthuellung + gleiches Tempo (g.podiumSpeed) + gleiche Textgroesse (scoreboardScale).
let sessionEndAnim = { token: null, animating: false, sig: null, timers: [] };
function renderSessionEnd(s) {
  const overlay = $('screen-sessionend');
  if (!overlay) return;
  const g = s.game || {};
  const active = !!g.sessionEndActive;
  overlay.classList.toggle('hidden', !active);
  if (!active) {
    // Beim naechsten Einblenden (auch mit gleichem Token) wieder neu enthuellen.
    sessionEndAnim.timers.forEach(clearTimeout);
    sessionEndAnim = { token: null, animating: false, sig: null, timers: [] };
    return;
  }
  overlay.style.setProperty('--sb-scale', (g.scoreboardScale || 100) / 100);

  const isTeam = !!g.teamMode;
  const src = isTeam ? (g.teams || []) : (g.scoreboardList || []);
  const top = src.map((e) => ({
    name: e.name, pts: e.pts, color: e.color || null,
    avatar: isTeam ? null : (e.avatar || null)
  })).slice(0, 3);
  const podEl = $('se-podium');
  const factsEl = $('se-facts');
  if (podEl) {
    const token = g.sessionEndToken || 0;
    // Fun-Fact-Kacheln erst nach der Podium-Enthuellung einblenden.
    if (factsEl && token !== sessionEndAnim.token) factsEl.classList.add('se-facts-pending');
    sessionEndAnim = renderPodiumAnimated(podEl, top, isTeam, token, g.podiumSpeed || 900, sessionEndAnim,
      () => { if (factsEl) factsEl.classList.remove('se-facts-pending'); });
  }

  const facts = (s.settings && s.settings.sessionFacts) || {};
  const summary = g.sessionSummary || {};
  const tiles = [];
  if (facts.fastest !== false && summary.fastest) {
    tiles.push(sessionFactTile('⚡', 'Schnellste Reaktion/Buzz', summary.fastest, summary.fastest.ms + ' ms'));
  }
  if (facts.jump !== false && summary.biggestJump) {
    tiles.push(sessionFactTile('🚀', 'Größter Punktesprung', summary.biggestJump, '+' + summary.biggestJump.pts + ' Punkte'));
  }
  if (facts.closest !== false && summary.closestGuess) {
    tiles.push(sessionFactTile('🎯', 'Genaueste Schätzung', summary.closestGuess, (summary.closestGuess.dev * 100).toFixed(1) + '% Abw.'));
  }
  if (facts.correct !== false && summary.mostCorrect) {
    tiles.push(sessionFactTile('✅', 'Meiste richtige Antworten', summary.mostCorrect, summary.mostCorrect.count + '×'));
  }
  if (factsEl) factsEl.innerHTML = tiles.join('') || '<p class="muted small">Noch keine Fun Facts in dieser Session.</p>';
}

function sessionFactTile(emoji, label, entry, valueText) {
  return '<div class="se-fact">' +
      '<span class="se-fact-emoji">' + emoji + '</span>' +
      '<span class="se-fact-label">' + label + '</span>' +
      '<span class="se-fact-name">' + avatarChip(entry) + escapeHtml(entry.name) + '</span>' +
      '<span class="se-fact-value">' + escapeHtml(String(valueText)) + '</span>' +
    '</div>';
}

// ---------------------------------------------------------------------------
// SPIELER – waehlt Wartezustand oder die Oberflaeche des aktiven Spiels
// ---------------------------------------------------------------------------
function renderPlayer(s) {
  // Team-Abzeichen in der Kopfzeile (nur im Team-Modus, sonst versteckt).
  renderPlayerTeamBadge(s);
  // Avatar-Chip in der Kopfzeile (server-autoritativ: game.myAvatar/myColor).
  renderPlayerAvatar(s);
  // Fake-Popup vom Master (Fun-Tab), generisch ueber allen Spielen.
  renderPlayerPopup(s);
  // Nachricht vom Master (Fun-Tab) als Overlay ueber allem.
  renderPlayerMessage(s);
  // Sabotage-Karte (Fun-Pannel): verfluchtes Handy verschwimmt + wird gesperrt.
  renderPlayerCurse(s);
  // Emoji-Reaktionen-Leiste (generisch, ueber allen Spielen) ein-/ausblenden.
  const reactionsBar = $('player-reactions');
  if (reactionsBar) reactionsBar.classList.toggle('hidden', !(s.settings.reactions && s.settings.reactions.enabled));
  // Schnellumfrage aus dem Fun-Pannel (Ja/Nein-Karte ueber dem Spiel).
  renderPlayerPoll(s);

  const gid = s.settings.activeGame;
  const spec = (GAMES[gid] && typeof GAMES[gid].player === 'function') ? GAMES[gid] : null;
  const waitEl = $('player-wait');
  const mountEl = $('player-game');
  const lockEl = $('player-locked');

  // Killswitch generisch: Hinweis anzeigen, auch spielunabhaengig im Standby.
  const locked = !!s.game.locked;
  lockEl.classList.toggle('hidden', !locked);

  if (!spec) {
    // Kein Spiel aktiv -> keine Controls, nur "Warten auf das naechste Spiel".
    unmountGameView('player', mountEl);
    waitEl.classList.remove('hidden');
    mountEl.classList.add('hidden');
    return;
  }

  waitEl.classList.add('hidden');
  mountEl.classList.remove('hidden');
  const view = mountGameView('player', gid, spec, mountEl);
  // Spiel-UI im Killswitch-Fall zusaetzlich abdunkeln + Interaktion sperren.
  mountEl.classList.toggle('locked', locked);
  view.update(s);
}

// Team-Abzeichen des Spielers (Kopfzeile). Zeigt Team-Name + aktuelle Team-Summe
// in der Team-Farbe; im Einzelmodus / ohne Team ausgeblendet.
function renderPlayerTeamBadge(s) {
  const g = s.game || {};
  const myId = g.myTeamId;
  const team = (g.teamMode && myId) ? (g.teams || []).find((t) => t.id === myId) : null;

  // Team-Hintergrund (dezent/matt, s. #player-team-bg in styles.css).
  const bg = $('player-team-bg');
  if (bg) {
    if (team) { bg.style.background = teamBgGradient(team.color); bg.classList.add('active'); }
    else { bg.classList.remove('active'); }
  }

  const badge = $('player-team');
  if (!badge) return;
  if (!team) { badge.classList.add('hidden'); return; }
  badge.classList.remove('hidden');
  badge.style.setProperty('--team-col', team.color);
  badge.innerHTML = '<span class="tb-dot"></span>' + escapeHtml(team.name) +
    ' <b>' + team.pts + '</b>';
}

// Avatar-Chip in der Kopfzeile: haelt myAvatar/myColor synchron mit dem Server
// (game.myAvatar/myColor – vom Server bei der ersten Verbindung vergeben bzw.
// nach jeder setAvatar/setColor-Aktion zurueckgespiegelt) und markiert im
// offenen Ausklappmenue die aktuell gewaehlten Presets.
function renderPlayerAvatar(s) {
  const chip = $('avatar-emoji');
  const toggle = $('avatar-toggle');
  if (!chip || !toggle) return;
  const g = s.game || {};
  myAvatar = g.myAvatar || null;
  myColor = g.myColor || null;
  chip.textContent = myAvatar || '🙂';
  toggle.style.setProperty('--p-col', myColor || 'var(--panel-2)');
  document.querySelectorAll('#avatar-grid .avatar-emoji-btn').forEach((b) => {
    b.classList.toggle('selected', b.dataset.avatar === myAvatar);
  });
  document.querySelectorAll('#avatar-colors .color-swatch').forEach((b) => {
    b.classList.toggle('selected', b.dataset.color === myColor);
  });
}

// Gesamtwertung (kommt fertig sortiert vom Server)
function renderLeaderboard(root, s) {
  const container = root.querySelector('.leaderboard');
  if (!container) return;
  container.innerHTML = '';
  // Team-Modus: Team-Summen als farbige Chips statt der Einzelspieler.
  if (s.game && s.game.teamMode) {
    (s.game.teamLeaderboard || []).forEach((t) => {
      const chip = document.createElement('span');
      chip.className = 'lb-chip lb-team';
      chip.style.setProperty('--team-col', t.color);
      chip.innerHTML = escapeHtml(t.name) + '<span class="pts">' + t.pts + '</span>';
      container.appendChild(chip);
    });
    return;
  }
  (s.game.leaderboard || []).forEach((e) => {
    const chip = document.createElement('span');
    chip.className = 'lb-chip';
    chip.innerHTML = avatarChip(e) + escapeHtml(e.name) + '<span class="pts">' + e.pts + '</span>';
    container.appendChild(chip);
  });
}

// Platzhalter-Layout fuer die Lobby (MC + Zeitdruck): dieselbe Struktur wie
// eine echte Frage, nur mit Dummy-Inhalt. So springt das Layout beim Start
// nicht (die Kacheln stehen schon da) und der Zustand signalisiert klar, dass
// das Spiel laeuft, aber noch nicht gestartet ist.
function renderQuizDummy(qEl, ansEl) {
  qEl.innerHTML = '<span class="mc-ready">das Quiz startet gleich …</span>';
  ansEl.innerHTML = '';
  ['A', 'B', 'C', 'D'].forEach((L) => {
    const cell = document.createElement('div');
    cell.className = 'mc-cell dummy';
    cell.innerHTML = '<span class="mc-letter">' + L + '</span><span class="mc-atext">…</span>';
    ansEl.appendChild(cell);
  });
}

// --- Bildschirm: Frage + Antwort-Kacheln + Aufloesung + Endstand ------------
// ---------------------------------------------------------------------------
// MASTER – generische Steuerung (Killswitch, Geräte) + spiel-spezifischer Mount
// ---------------------------------------------------------------------------
function setupMasterControls() {
  // Generische, spielunabhaengige Steuerungen (Live-Spielsteuerung kommt aus dem
  // Master-Modul des aktiven Spiels).
  const map = { 'ctrl-resetscores': 'resetScores', 'ctrl-cleanup': 'cleanup' };
  for (const [id, action] of Object.entries(map)) {
    const el = $(id); if (el) el.addEventListener('click', () => send({ type: 'master', action }));
  }
  // Killswitch
  $('ctrl-lock').addEventListener('click', () => {
    const locked = latestState && latestState.game.locked;
    send({ type: 'master', action: 'setLocked', locked: !locked });
  });
  // Scoreboard-Umschalter (Aus / Seitenleiste / Vollbild)
  document.querySelectorAll('#sb-toggle .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => send({ type: 'master', action: 'setScoreboard', mode: btn.dataset.mode }));
  });
  // Scoreboard-Textgroesse (%)
  const sbScale = $('sb-scale');
  if (sbScale) {
    sbScale.addEventListener('input', () => {
      $('sb-scale-v').textContent = sbScale.value + ' %';
      paintPlainRange(sbScale);
    });
    sbScale.addEventListener('change', () => send({ type: 'master', action: 'setScoreboardScale', value: +sbScale.value }));
  }
  // Podium-Tempo (ms pro Platz) + Wiederholen-Button
  const podiumSpeed = $('podium-speed');
  if (podiumSpeed) {
    podiumSpeed.addEventListener('input', () => {
      $('podium-speed-v').textContent = (podiumSpeed.value / 1000).toFixed(1) + ' s';
      paintPlainRange(podiumSpeed);
    });
    podiumSpeed.addEventListener('change', () => send({ type: 'master', action: 'setPodiumSpeed', value: +podiumSpeed.value }));
  }
  const podiumReplay = $('podium-replay-btn');
  if (podiumReplay) podiumReplay.addEventListener('click', () => send({ type: 'master', action: 'replayPodium' }));
  // Session-Endscreen: erneut zeigen + welche Fun-Fact-Kacheln + manueller Reset
  const sessionEndReplay = $('sessionend-replay-btn');
  if (sessionEndReplay) sessionEndReplay.addEventListener('click', () => send({ type: 'master', action: 'replaySessionEnd' }));
  const sessionFactIds = { fastest: 'sf-fastest', jump: 'sf-jump', closest: 'sf-closest', correct: 'sf-correct' };
  Object.values(sessionFactIds).forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('change', () => {
      const facts = {};
      for (const [key, cid] of Object.entries(sessionFactIds)) facts[key] = !!$(cid).checked;
      send({ type: 'master', action: 'setSessionFacts', facts });
    });
  });
  const sessionResetBtn = $('session-reset-btn');
  if (sessionResetBtn) sessionResetBtn.addEventListener('click', () => send({ type: 'master', action: 'resetSession' }));
  // QR-Code-Schalter (Beitritts-URL am Bildschirm ein-/ausblenden)
  const qrSwitch = $('qr-switch');
  if (qrSwitch) qrSwitch.addEventListener('change', () => send({ type: 'master', action: 'setQr', on: qrSwitch.checked }));
  // Eigene QR-Code-URL (leer = automatisch erkannte LAN-Adresse)
  const qrUrlInput = $('qr-url-input');
  if (qrUrlInput) {
    qrUrlInput.addEventListener('change', () => send({ type: 'master', action: 'setQrUrl', url: qrUrlInput.value }));
    qrUrlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') qrUrlInput.blur(); });
  }
  // Eigene Überschrift der QR-Karte (leer = Standardtext, serverseitig persistiert)
  const qrTitleInput = $('qr-title-input');
  if (qrTitleInput) {
    qrTitleInput.addEventListener('change', () => send({ type: 'master', action: 'setQrTitle', title: qrTitleInput.value }));
    qrTitleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') qrTitleInput.blur(); });
  }
  // Team-Modus-Umschalter (Einzel / Teams) + neues Team anlegen
  document.querySelectorAll('#team-toggle .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => send({ type: 'master', action: 'setTeamMode', on: btn.dataset.team === 'on' }));
  });
  // Nur-Master-Modus-Schalter + lokalen Teilnehmer anlegen (kein Spieler-Handy noetig)
  const masterOnlySwitch = $('master-only-switch');
  if (masterOnlySwitch) {
    masterOnlySwitch.addEventListener('change', () =>
      send({ type: 'master', action: 'setMasterOnlyMode', on: masterOnlySwitch.checked }));
  }
  // Emoji-Reaktionen: Ein/Aus-Schalter + Rate-Limit-Auswahl (beides sofort wirksam)
  const reactionsSwitch = $('reactions-switch');
  if (reactionsSwitch) {
    reactionsSwitch.addEventListener('change', () =>
      send({ type: 'master', action: 'setReactionsEnabled', on: reactionsSwitch.checked }));
  }
  document.querySelectorAll('#reactions-limit .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => send({ type: 'master', action: 'setReactionsRateLimit', limit: btn.dataset.limit }));
  });
  const reactionsVolume = $('reactions-volume');
  const reactionsVolumeVal = $('reactions-volume-val');
  if (reactionsVolume) {
    reactionsVolume.addEventListener('input', () => {
      if (reactionsVolumeVal) reactionsVolumeVal.textContent = reactionsVolume.value + ' %';
      send({ type: 'master', action: 'setReactionsVolume', value: Number(reactionsVolume.value) / 100 });
    });
  }
  const localPlayerAddBtn = $('local-player-add-btn');
  if (localPlayerAddBtn) {
    localPlayerAddBtn.addEventListener('click', () => {
      const nameInput = $('local-player-name');
      send({ type: 'master', action: 'addLocalPlayer', name: nameInput.value.trim() });
      nameInput.value = '';
    });
  }
  const teamAdd = $('team-add');
  if (teamAdd) teamAdd.addEventListener('click', () => send({ type: 'master', action: 'addTeam' }));
  // Spielplan-Steuerung (Run-Leiste im Spiel-Tab): vor/zurueck durch die Schritte.
  // Es sind Admin-Aktionen (aktivieren Spiel+Profil), darum type:'admin'.
  $('pl-prev').addEventListener('click', () => send({ type: 'admin', action: 'playlistPrev' }));
  $('pl-next').addEventListener('click', () => send({ type: 'admin', action: 'playlistNext' }));
}

// Aktuelle Punkte-Schrittweite (±x) aus dem Eingabefeld, mindestens 1.
function scoreStep() {
  const el = $('score-step');
  const v = el ? parseInt(el.value, 10) : 1;
  return (Number.isFinite(v) && v > 0) ? v : 1;
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}
async function switchTab(tab) {
  // Verlassen des Spiele-Tabs mit offener Konfig-Seite: ungespeicherte Aenderungen abfragen.
  if (tab !== 'config' && activeTab === 'config' && !(await confirmLeaveConfig())) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === activeTab));
    return;
  }
  // Verlassen des Design-Tabs: laufende Vorschau verwerfen und den gespeicherten Stand zeigen.
  if (tab !== 'design' && activeTab === 'design' && designPreviewActive) {
    designPreviewActive = false;
    if (latestState) applyDesign(latestState.settings.theme, latestState.settings.design);
  }
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('tab-game').classList.toggle('hidden', tab !== 'game');
  $('tab-config').classList.toggle('hidden', tab !== 'config');
  $('tab-design').classList.toggle('hidden', tab !== 'design');
  $('tab-pause').classList.toggle('hidden', tab !== 'pause');
  $('tab-fun').classList.toggle('hidden', tab !== 'fun');
  $('tab-general').classList.toggle('hidden', tab !== 'general');
  // Beim Betreten des Spiele-Tabs immer mit der Spielauswahl starten.
  if (tab === 'config') showGamesBrowse();
  // Beim Betreten des Design-Tabs die Regler aus dem gespeicherten Stand fuellen.
  if (tab === 'design') populateDesignForm();
  // Beim Betreten des Pause-Tabs die Regler aus dem gespeicherten Stand fuellen -
  // aber nur beim allerersten Mal, damit ungespeicherte Aenderungen beim
  // Tab-Wechsel nicht verloren gehen (anders als Design/Allgemein, die bewusst
  // eine verworfene Live-Vorschau haben).
  if (tab === 'pause' && !pauseFormInitialized) populatePauseForm();
  // Beim Betreten des Allgemein-Tabs die Felder aus dem gespeicherten Stand fuellen.
  if (tab === 'general') populateGeneralForm();
}

function renderMaster(s) {
  // Killswitch-Zustand (generisch, spielunabhaengig)
  const locked = !!s.game.locked;
  const lockBtn = $('ctrl-lock');
  lockBtn.classList.toggle('active', locked);
  lockBtn.textContent = locked ? '🔓 Spieler entsperren' : '🔒 Spieler sperren';
  $('lock-hint').textContent = locked
    ? 'GESPERRT – Spieler haben keine Interaktionen.'
    : 'Spieler können aktuell interagieren.';

  // Spielplan-Steuerung (Run-Leiste)
  renderPlaylistRunbar(s);
  // Hintergrundmusik: Steuerung (Controls-Tab) + Playlist/Optionen (Allgemein-Tab)
  renderMusicControls(s);
  // Fun-Tab: Fake-Popups je Spieler (Status-Liste)
  renderFunPopups(s);
  // Spieler-Nachrichten (Fun-Tab): Vorlagen/Empfaenger/Bildauswahl
  renderFunMessages(s);
  // Fun-Pannel: Spielerliste der Sabotage-Karte
  renderCurseList(s);
  // Fun-Tab: Countdown-Status/Buttons
  renderFunCountdown(s);
  // Soundboard (Fun-Tab)
  renderSoundboard(s);
  // Fun-Pannel: Gluecksrad-Steuerung
  renderFunWheel(s);
  // Schnellumfrage-Status im Fun-Tab
  renderMasterPoll(s);

  // Scoreboard-Umschalter: aktiven Modus markieren
  const sbMode = (s.game && s.game.scoreboardMode) || 'off';
  document.querySelectorAll('#sb-toggle .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === sbMode));
  // Scoreboard-Textgroesse: Regler nur aktualisieren, wenn der Master ihn nicht
  // gerade selbst bedient (sonst wuerde ein Snapshot den laufenden Zug zuruecksetzen).
  const sbScale = $('sb-scale');
  if (sbScale && document.activeElement !== sbScale) {
    const scale = (s.game && s.game.scoreboardScale) || 100;
    if (+sbScale.value !== scale) {
      sbScale.value = scale;
      $('sb-scale-v').textContent = scale + ' %';
      paintPlainRange(sbScale);
    }
  }
  // Podium-Tempo: Regler nur aktualisieren, wenn der Master ihn nicht gerade bedient.
  const podiumSpeedEl = $('podium-speed');
  if (podiumSpeedEl && document.activeElement !== podiumSpeedEl) {
    const speed = (s.game && s.game.podiumSpeed) || 900;
    if (+podiumSpeedEl.value !== speed) {
      podiumSpeedEl.value = speed;
      $('podium-speed-v').textContent = (speed / 1000).toFixed(1) + ' s';
      paintPlainRange(podiumSpeedEl);
    }
  }

  // QR-Code-Schalter: aktuellen Zustand spiegeln
  const qrSwitch = $('qr-switch');
  if (qrSwitch) qrSwitch.checked = !!(s.settings && s.settings.showQr);
  // Eigene QR-Code-URL: Wert spiegeln, ohne ein gerade fokussiertes Feld zu ueberschreiben
  const qrUrlInput = $('qr-url-input');
  if (qrUrlInput && document.activeElement !== qrUrlInput) {
    const v = (s.settings && s.settings.qrUrlOverride) || '';
    if (qrUrlInput.value !== v) qrUrlInput.value = v;
  }
  // Ueberschrift der QR-Karte: Wert spiegeln, ohne ein gerade fokussiertes Feld zu ueberschreiben
  const qrTitleInput = $('qr-title-input');
  if (qrTitleInput && document.activeElement !== qrTitleInput) {
    const t = (s.settings && s.settings.qrTitle) || '';
    if (qrTitleInput.value !== t) qrTitleInput.value = t;
  }

  // Nur-Master-Modus-Schalter: aktuellen Zustand spiegeln + lokale-Teilnehmer-
  // Zeile im Geräte-Panel nur zeigen, wenn der Modus aktiv ist.
  const masterOnly = !!(s.settings && s.settings.masterOnlyMode);
  const moSwitch = $('master-only-switch');
  if (moSwitch) moSwitch.checked = masterOnly;
  const localAdd = $('local-player-add');
  if (localAdd) localAdd.classList.toggle('hidden', !masterOnly);

  // Emoji-Reaktionen: Ein/Aus-Schalter + aktive Rate-Limit-Stufe spiegeln
  const reactions = (s.settings && s.settings.reactions) || { enabled: true, rateLimit: 'none', volume: 0.5 };
  const reactionsSwitch = $('reactions-switch');
  if (reactionsSwitch) reactionsSwitch.checked = !!reactions.enabled;
  document.querySelectorAll('#reactions-limit .seg-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.limit === reactions.rateLimit));
  const reactionsVolume = $('reactions-volume');
  const reactionsVolumeVal = $('reactions-volume-val');
  if (reactionsVolume && document.activeElement !== reactionsVolume && typeof reactions.volume === 'number') {
    const pct = Math.round(Math.min(1, Math.max(0, reactions.volume)) * 100);
    reactionsVolume.value = String(pct);
    if (reactionsVolumeVal) reactionsVolumeVal.textContent = pct + ' %';
  }

  // Session-Endscreen: Fun-Fact-Checkliste spiegeln + "erneut zeigen" nur sichtbar,
  // solange der Endscreen aktuell aktiv ist (sonst gibt es nichts zu wiederholen).
  const sessionFacts = (s.settings && s.settings.sessionFacts) || {};
  const sfMap = { fastest: 'sf-fastest', jump: 'sf-jump', closest: 'sf-closest', correct: 'sf-correct' };
  for (const [key, id] of Object.entries(sfMap)) {
    const el = $(id);
    if (el) el.checked = sessionFacts[key] !== false;
  }
  const sessionEndReplayBtn = $('sessionend-replay-btn');
  if (sessionEndReplayBtn) sessionEndReplayBtn.classList.toggle('hidden', !(s.game && s.game.sessionEndActive));

  // Team-Verwaltung (generisch): Umschalter + Team-Liste
  renderTeams(s);

  // Spiel-spezifische Live-Steuerung + Ergebnisse (datengetrieben) bzw. Standby.
  // Analog zu Spieler/Bildschirm: das aktive Spiel bringt sein eigenes Master-Modul.
  const gid = s.settings.activeGame;
  const spec = (GAMES[gid] && typeof GAMES[gid].master === 'function') ? GAMES[gid] : null;
  const waitEl = $('master-wait');
  const mountEl = $('master-game');
  const infoEl = $('active-game-info');
  if (!spec) {
    unmountGameView('master', mountEl);
    waitEl.classList.remove('hidden');
    mountEl.classList.add('hidden');
    if (infoEl) infoEl.classList.add('hidden');
  } else {
    waitEl.classList.add('hidden');
    mountEl.classList.remove('hidden');
    const view = mountGameView('master', gid, spec, mountEl);
    view.update(s);
    if (infoEl) {
      infoEl.classList.remove('hidden');
      $('agi-emoji').textContent = GAMES[gid].emoji || '';
      $('agi-name').textContent = GAMES[gid].name || gid;
      const gd = s.admin && s.admin.games && s.admin.games[gid];
      $('agi-profile').textContent = gd && gd.activeProfile ? 'Profil: ' + gd.activeProfile : '';
    }
  }

  // Geräteliste (generisch): Zähler für Bildschirme/Master oben, Liste nur Spieler.
  renderDevices(s);
}

// Spielplan-Run-Leiste im Spiel-Tab: aktuellen Schritt zeigen + vor/zurueck. Nur
// sichtbar, wenn der Spielplan Schritte hat. Daten kommen aus dem Master-Snapshot
// (s.admin.playlist). Die Aktivierung erledigt der Server (playlistNext/-Prev/-Goto).
function renderPlaylistRunbar(s) {
  const bar = $('playlist-runbar');
  if (!bar) return;
  const pl = (s.admin && s.admin.playlist) || null;
  const steps = (pl && pl.steps) || [];
  if (steps.length === 0) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');

  const pos = pl.pos;
  const n = steps.length;
  const started = pos >= 0 && pos < n;

  $('pl-run-pos').textContent = started ? ('Schritt ' + (pos + 1) + ' / ' + n)
    : (n + ' Schritte – noch nicht gestartet');

  // Buttons: Zurueck (ab Schritt 2), Nächstes/Start/Fertig.
  const prev = $('pl-prev');
  const next = $('pl-next');
  prev.disabled = !(started && pos > 0);
  const atEnd = started && pos >= n - 1;
  // "Nächstes" bleibt auch am letzten Schritt klickbar: dieser Klick ist es, der
  // den Session-Endscreen am Bildschirm auslöst (bzw. erneut zeigt).
  next.disabled = false;
  next.textContent = !started ? 'Start ▶' : (atEnd ? '🎉 Zusammenfassung ▶' : 'Nächstes ▶');

  // Vertikales Karussell: max. 5 Schritte übereinander, das aktive (bzw. vor dem
  // Start das erste) möglichst mittig, ohne Scrollbar (overflow:hidden + translateY
  // am Track). Sind es mehr als 5 Schritte, wird ein 5er-Fenster gezeigt, das an den
  // Rändern anschlägt (damit kein Schritt verborgen bleibt) und oben/unten ausfadet.
  const rows = Math.min(n, 5);                 // sichtbares Fenster (max 5)
  const centerIdx = started ? pos : 0;         // vor dem Start das erste Element zentrieren
  // Oberster sichtbarer Index: aktives zentrieren, aber im Bereich [0, n-rows] klemmen.
  const top = n > rows ? Math.min(Math.max(centerIdx - Math.floor(rows / 2), 0), n - rows) : 0;
  const carousel = $('pl-run-carousel');
  const track = $('pl-run-track');
  carousel.style.setProperty('--pl-rows', rows);
  carousel.classList.toggle('faded', n > rows);   // Fade nur bei echtem Overflow (>5)
  track.style.transform = 'translateY(calc(' + (-top) + ' * var(--pl-row-h)))';

  track.innerHTML = '';
  steps.forEach((step, i) => {
    const info = playlistStepLabel(step);
    const rowEl = document.createElement('button');
    rowEl.className = 'pl-car-step' + (i === centerIdx ? (started ? ' active' : ' next') : '');
    if (i < top || i >= top + rows) rowEl.classList.add('pl-off');   // ausserhalb des Fensters
    rowEl.title = info.name + ' · ' + info.profileText;
    rowEl.innerHTML =
      '<span class="pl-car-n">' + (i + 1) + '</span>' +
      '<span class="pl-car-emoji">' + info.emoji + '</span>' +
      '<span class="pl-car-body">' +
        '<span class="pl-car-name">' + escapeHtml(info.name) + '</span>' +
        '<span class="pl-car-prof">' + escapeHtml(info.profileText) + '</span>' +
      '</span>';
    rowEl.addEventListener('click', () => send({ type: 'admin', action: 'playlistGoto', index: i }));
    track.appendChild(rowEl);
  });
}

// Bildschirm-/Master-Zähler (verbunden = online) + reine Spielerliste.
function renderDevices(s) {
  const parts = s.participants || [];
  let screens = 0, masters = 0;
  parts.forEach((p) => {
    if (!p.online) return;
    if (p.role === 'screen') screens++;
    else if (p.role === 'master') masters++;
  });
  $('count-screens').textContent = screens;
  $('count-masters').textContent = masters;

  const dl = $('master-players');
  const players = parts.filter((p) => p.role === 'player');
  const scores = (s.game && s.game.scores) || {};
  const teamMode = !!(s.game && s.game.teamMode);
  const teamDefs = (s.game && s.game.teamDefs) || [];
  dl.classList.toggle('team-mode', teamMode);   // blendet die Team-Auswahl je Zeile ein

  if (players.length === 0) {
    dl.innerHTML = '<p class="muted small">Noch keine Spieler verbunden.</p>';
    renderDevices._sig = null; renderDevices._rows = null; renderDevices._teamsSig = null;
    return;
  }

  // Struktur nur bei Spieler-Wechsel neu aufbauen – sonst wuerde ein gerade
  // editiertes Punkte-Feld bei jedem Snapshot den Fokus/Wert verlieren.
  const sig = players.map((p) => p.id).join(',');
  if (renderDevices._sig !== sig) {
    dl.innerHTML = '';
    renderDevices._rows = {};
    players.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'device-row';

      const dot = document.createElement('span');
      dot.className = 'dev-dot' + (p.online ? ' online' : '') + (p.local ? ' local' : '');
      dot.title = p.local ? 'Lokaler Teilnehmer (kein eigenes Gerät)' : '';
      dot.innerHTML = p.local ? '🖥️' : '<span class="led"></span>';

      const avatarEl = document.createElement('span');
      avatarEl.className = 'p-avatar';
      avatarEl.textContent = p.avatar || '';
      avatarEl.style.setProperty('--p-col', p.color || 'var(--panel-2)');

      const name = document.createElement('span');
      name.className = 'dname';
      name.textContent = p.name;

      // Team-Auswahl (nur im Team-Modus sichtbar, per CSS über .team-mode gesteuert)
      const teamSel = document.createElement('select');
      teamSel.className = 'team-select';
      teamSel.title = 'Team zuordnen';
      teamSel.addEventListener('change', () => send({
        type: 'master', action: 'assignTeam', clientId: p.id, teamId: teamSel.value || null
      }));

      const minus = document.createElement('button');
      minus.className = 'score-btn'; minus.type = 'button'; minus.textContent = '−';
      minus.title = 'Punkte abziehen';
      minus.addEventListener('click', () => send({ type: 'master', action: 'adjustScore', clientId: p.id, delta: -scoreStep() }));

      const input = document.createElement('input');
      input.className = 'score-input'; input.type = 'number'; input.setAttribute('inputmode', 'numeric');
      input.title = 'Punkte direkt setzen';
      const commit = () => {
        const v = parseInt(input.value, 10);
        if (Number.isFinite(v)) send({ type: 'master', action: 'setScore', clientId: p.id, value: v });
      };
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });

      const plus = document.createElement('button');
      plus.className = 'score-btn'; plus.type = 'button'; plus.textContent = '+';
      plus.title = 'Punkte hinzufügen';
      plus.addEventListener('click', () => send({ type: 'master', action: 'adjustScore', clientId: p.id, delta: scoreStep() }));

      const kick = document.createElement('button');
      kick.className = 'kick'; kick.type = 'button'; kick.textContent = '✕';
      kick.title = 'Entfernen';
      kick.addEventListener('click', () => send({ type: 'master', action: 'kick', clientId: p.id }));

      row.append(dot, avatarEl, name, teamSel, minus, input, plus, kick);
      dl.appendChild(row);
      renderDevices._rows[p.id] = { dot, avatarEl, name, input, teamSel };
    });
    renderDevices._sig = sig;
    renderDevices._teamsSig = null;   // Optionen der neuen Selects gleich neu füllen
  }

  // Team-Dropdown-Optionen nur neu aufbauen, wenn sich die Teams geändert haben
  // (Name/Farbe/Reihenfolge) – nicht bei jedem Snapshot (stört ein offenes Menü).
  const teamsSig = teamDefs.map((t) => t.id + ':' + t.name).join('|');
  const rebuildOpts = renderDevices._teamsSig !== teamsSig;
  if (rebuildOpts) renderDevices._teamsSig = teamsSig;

  // Werte aktualisieren (ohne ein gerade fokussiertes Punkte-Feld zu ueberschreiben)
  players.forEach((p) => {
    const r = renderDevices._rows[p.id];
    if (!r) return;
    r.dot.classList.toggle('online', p.online);
    r.avatarEl.textContent = p.avatar || '';
    r.avatarEl.style.setProperty('--p-col', p.color || 'var(--panel-2)');
    r.name.textContent = p.name;
    const val = String(scores[p.id] || 0);
    if (document.activeElement !== r.input && r.input.value !== val) r.input.value = val;
    if (rebuildOpts) fillTeamOptions(r.teamSel, teamDefs);
    if (document.activeElement !== r.teamSel) r.teamSel.value = p.teamId || '';
  });
}

// Optionen eines Team-Dropdowns aus den Team-Definitionen aufbauen
// (erste Option = „kein Team").
function fillTeamOptions(sel, teamDefs) {
  sel.innerHTML = '';
  const none = document.createElement('option');
  none.value = ''; none.textContent = '— kein Team';
  sel.appendChild(none);
  teamDefs.forEach((t) => {
    const o = document.createElement('option');
    o.value = t.id; o.textContent = t.name;
    sel.appendChild(o);
  });
}

// ---------------------------------------------------------------------------
// MASTER – Team-Verwaltung (Umschalter Einzel/Teams + Team-Liste)
// ---------------------------------------------------------------------------
function renderTeams(s) {
  const g = s.game || {};
  const teamMode = !!g.teamMode;
  // Umschalter markieren
  document.querySelectorAll('#team-toggle .seg-btn').forEach((b) =>
    b.classList.toggle('active', (b.dataset.team === 'on') === teamMode));
  const mgr = $('teams-manager');
  if (mgr) mgr.classList.toggle('hidden', !teamMode);

  const list = $('teams-list');
  if (!list) return;
  const defs = g.teamDefs || [];
  const standings = g.teamStandings || [];
  const ptsById = {};
  standings.forEach((t) => { ptsById[t.id] = t.pts; });

  // Struktur nur bei Team-Wechsel (Anzahl/Reihenfolge) neu bauen – sonst würde ein
  // gerade editiertes Namensfeld bei jedem Snapshot Fokus/Wert verlieren.
  const sig = defs.map((t) => t.id).join(',');
  if (renderTeams._sig !== sig) {
    list.innerHTML = '';
    renderTeams._rows = {};
    defs.forEach((t) => {
      const row = document.createElement('div');
      row.className = 'team-row';
      row.style.setProperty('--team-col', t.color);

      const color = document.createElement('input');
      color.type = 'color'; color.className = 'team-color'; color.value = t.color;
      color.title = 'Team-Farbe';
      color.addEventListener('change', () => send({
        type: 'master', action: 'setTeamColor', teamId: t.id, color: color.value
      }));

      const name = document.createElement('input');
      name.type = 'text'; name.className = 'team-name'; name.maxLength = 24; name.value = t.name;
      const commit = () => {
        const v = name.value.trim();
        if (v) send({ type: 'master', action: 'renameTeam', teamId: t.id, name: v });
      };
      name.addEventListener('change', commit);
      name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });

      const pts = document.createElement('span');
      pts.className = 'team-pts';

      const del = document.createElement('button');
      del.className = 'team-del'; del.type = 'button'; del.textContent = '✕';
      del.title = 'Team löschen';
      del.addEventListener('click', async () => {
        if (await confirmModal('Team „' + t.name + '" löschen? Die Zuordnungen der Spieler gehen verloren.',
          { title: 'Team löschen', okText: 'Löschen', danger: true })) {
          send({ type: 'master', action: 'removeTeam', teamId: t.id });
        }
      });

      row.append(color, name, pts, del);
      list.appendChild(row);
      renderTeams._rows[t.id] = { row, color, name, pts };
    });
    renderTeams._sig = sig;
  }

  // Werte aktualisieren (Farbe/Name/Punkte), ohne fokussierte Felder zu überschreiben
  defs.forEach((t) => {
    const r = renderTeams._rows[t.id];
    if (!r) return;
    r.row.style.setProperty('--team-col', t.color);
    if (document.activeElement !== r.color && r.color.value !== t.color) r.color.value = t.color;
    if (document.activeElement !== r.name && r.name.value !== t.name) r.name.value = t.name;
    r.pts.textContent = (ptsById[t.id] || 0) + ' Pkt';
  });

  if (defs.length === 0) list.innerHTML = '<p class="muted small">Noch keine Teams – „＋ Team hinzufügen".</p>';
}

// ---------------------------------------------------------------------------
// Admin-Ergebnis (Anmeldung + gespeicherte Aktionen)
// ---------------------------------------------------------------------------
function handleAdminResult(msg) {
  const action = pendingAdminAction;
  pendingAdminAction = null;
  // Musik-Upload (Allgemein-Tab) laedt mehrere Dateien nacheinander – naechste starten.
  if (action === 'uploadMusic') onMusicUploadResult(msg);
  // Soundboard-Upload (Fun-Tab) genauso.
  if (action === 'uploadSound') onSoundUploadResult(msg);

  if (msg.ok) {
    if (!authed) {
      authed = true;
      sessionStorage.setItem('quizMasterPass', masterPassword);
      hideGate();
      $('gate-msg').textContent = '';
      if (activeTab === 'config') showGamesBrowse();
      if (activeTab === 'general') populateGeneralForm();
      if (activeTab === 'design') populateDesignForm();
      if (activeTab === 'pause') populatePauseForm();
    }

    // Gezieltes Refresh je nach Aktion – KEIN kompletter Neuaufbau, damit
    // insbesondere die Allgemein-Eingaben ihren Stand behalten.
    const profileActions = ['saveProfile', 'deleteProfile', 'selectProfile', 'importProfiles', 'importFull'];
    if (activeTab === 'config') {
      if (configOpen && profileActions.includes(action)) {
        renderConfigPanel();                 // Profil-Auswahl/Felder auf gespeicherten Stand
      } else if (!configOpen) {
        renderGamesTab();                    // Spielauswahl (Spiel-/Profilwechsel) aktualisieren
      }
    }

    // Rueckmeldung passend zur ausgeloesten Aktion anzeigen
    if (action === 'settings') {
      const sm = $('admin-save-msg'); if (sm) { sm.textContent = 'Gespeichert ✓'; setTimeout(() => sm.textContent = '', 1500); }
      // Kam der Speichern-Klick aus dem Design-Tab: dort quittieren und Vorschau freigeben,
      // damit der (identische) Server-Stand ab jetzt wieder normal angewandt wird.
      const dm = $('design-save-msg'); if (dm && activeTab === 'design') { dm.textContent = 'Gespeichert ✓'; setTimeout(() => dm.textContent = '', 1500); }
      if (activeTab === 'design') designPreviewActive = false;
      // Kam der Speichern-Klick aus dem Pause-Tab: dort ebenfalls quittieren.
      const pm = $('pause-save-msg'); if (pm && activeTab === 'pause') { pm.textContent = 'Gespeichert ✓'; setTimeout(() => pm.textContent = '', 1500); }
    } else if (action === 'uploadBg' || action === 'deleteBg') {
      // Upload aus dem Fun-Tab (Spieler-Nachricht) waehlt das Bild dort statt im Design-Tab aus.
      const fromFun = activeTab === 'fun' && action === 'uploadBg';
      if (fromFun) onMessageImgUploaded(msg.uploadedBg);
      if (typeof onBgListChanged === 'function') onBgListChanged(action === 'uploadBg' && !fromFun ? msg.uploadedBg : null);
      if (typeof onBildwahlListChanged === 'function') onBildwahlListChanged(action === 'uploadBg' ? msg.uploadedBg : null);
    } else if (action === 'uploadPauseImg' || action === 'deletePauseImg') {
      if (typeof onPauseImgListChanged === 'function') onPauseImgListChanged(action === 'uploadPauseImg' ? msg.uploadedPauseImg : null);
    } else if (action === 'uploadAudio' || action === 'deleteAudio') {
      if (typeof onAudioListChanged === 'function') onAudioListChanged(action === 'uploadAudio' ? msg.uploadedAudio : null);
    } else if (action === 'deleteMusic') {
      const mm = $('music-upload-msg'); if (mm) { mm.textContent = 'Gelöscht ✓'; setTimeout(() => mm.textContent = '', 1500); }
    } else if (action === 'importProfiles' || action === 'importFull') {
      const n = msg.imported || 0;
      const text = 'Importiert ✓ (' + n + ' Profil' + (n === 1 ? '' : 'e') + ')';
      setConfigMsg(text); setTimeout(() => setConfigMsg(''), 2500);
      if (typeof setBackupMsg === 'function') { setBackupMsg(text); setTimeout(() => setBackupMsg(''), 2500); }
    } else if (profileActions.includes(action)) {
      setConfigMsg('Gespeichert ✓');
      setTimeout(() => setConfigMsg(''), 1500);
    }
  } else {
    if (!authed) {
      // Anmeldung fehlgeschlagen
      masterPassword = null;
      sessionStorage.removeItem('quizMasterPass');
      showGate();
      $('gate-msg').textContent = 'Falsches Passwort.';
      $('gate-pass').value = '';
    } else {
      const text = msg.error || 'Aktion nicht möglich.';
      setConfigMsg(text);
      if (typeof setBackupMsg === 'function') setBackupMsg(text);
    }
  }
}

// ---------------------------------------------------------------------------
// SPIELER – Name (die Spiel-Oberflaeche selbst kommt aus der GAMES-Registry)
// ---------------------------------------------------------------------------
function setupPlayerName() {
  const nameEdit = $('player-name');
  nameEdit.value = myName;
  const commit = () => {
    const v = nameEdit.value.trim().slice(0, 24);
    if (v && v !== myName) { myName = v; localStorage.setItem('quizName', v); send({ type: 'setName', name: v }); }
  };
  nameEdit.addEventListener('change', commit);
  nameEdit.addEventListener('blur', commit);

  if (!myName) {
    showOverlay('name');
    const input = $('name-input');
    const submit = () => {
      const v = input.value.trim().slice(0, 24);
      if (!v) { input.focus(); return; }
      myName = v; localStorage.setItem('quizName', v);
      nameEdit.value = v;
      send({ type: 'setName', name: v });
      hideOverlay('name');
    };
    $('name-submit').addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    setTimeout(() => input.focus(), 100);
  }
}

// Rate-Limit-Stufe -> Mindestabstand in ms, rein fuer die client-seitige Button-
// Sperre (Server setzt dieselben Werte serverseitig durch, s. lib/state.js).
const REACTION_RATE_LIMIT_MS = { none: 0, '5s': 200, '1s': 1000, '10s': 10000 };

// Lustige Platzhalterwoerter fuer den eingeklappten Reaktions-Button (sonst nur
// ein leerer Kreis) – rein kosmetisch, keine Server-Bedeutung.
const REACTION_PLACEHOLDER_WORDS = [
  'Bling!', 'Tada!', 'Juhu!', 'Zack!', 'Boah!', 'Achtung!', 'Wusch!', 'Kaboom!',
  'Yeah!', 'Party!', 'Hui!', 'Nice!', 'Woohoo!', 'Olé!', 'Karacho!', 'Wow!'
];

// ---------------------------------------------------------------------------
// SPIELER – Emoji-Reaktionen (generisch, ueber allen Spielen). Feste Buttons
// aus dem HTML (s. index.html); sendet nur den Emoji-Wert, der Server prueft
// gegen dieselbe Preset-Liste (REACTION_EMOJIS in lib/state.js) + Rate-Limit.
// ---------------------------------------------------------------------------
function setupPlayerReactions() {
  const bar = $('player-reactions');
  if (!bar) return;
  let lastSentAt = 0;
  // Kleiner Schalter direkt in der Leiste: gibt frei, ob DIESER Spieler seine
  // eigenen Reaktionen zusaetzlich mit einem Sound am Bildschirm versieht
  // (rein clientseitige Praeferenz, in localStorage gemerkt).
  const soundToggle = $('reactions-sound-toggle');
  let soundOn = localStorage.getItem('quizReactionsSound') !== '0';
  const reflectSound = () => {
    if (!soundToggle) return;
    soundToggle.textContent = soundOn ? '🔊' : '🔇';
    soundToggle.setAttribute('aria-pressed', String(soundOn));
    soundToggle.classList.toggle('off', !soundOn);
  };
  reflectSound();
  if (soundToggle) {
    soundToggle.addEventListener('click', () => {
      soundOn = !soundOn;
      localStorage.setItem('quizReactionsSound', soundOn ? '1' : '0');
      reflectSound();
    });
  }
  bar.querySelectorAll('.emoji-reaction-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const rateLimit = (latestState && latestState.settings.reactions && latestState.settings.reactions.rateLimit) || 'none';
      const minMs = REACTION_RATE_LIMIT_MS[rateLimit] || 0;
      const now = Date.now();
      if (minMs > 0 && now - lastSentAt < minMs) return;
      lastSentAt = now;
      send({ type: 'reaction', emoji: btn.dataset.emoji, sound: soundOn });
      btn.classList.remove('sent'); void btn.offsetWidth; btn.classList.add('sent');
    });
  });
  const toggle = $('reactions-toggle');
  const toggleLabel = $('reactions-toggle-label');
  if (toggle) {
    const setCollapsed = (collapsed) => {
      bar.classList.toggle('collapsed', collapsed);
      toggle.setAttribute('aria-expanded', String(!collapsed));
      // Im eingeklappten Zustand bleibt sonst nur ein leerer Kreis-Button uebrig –
      // stattdessen zeigt er ein zufaelliges lustiges Platzhalterwort (neu bei
      // jedem Einklappen), damit die Leiste nicht komplett leer wirkt.
      if (collapsed && toggleLabel) {
        toggleLabel.textContent = REACTION_PLACEHOLDER_WORDS[Math.floor(Math.random() * REACTION_PLACEHOLDER_WORDS.length)];
      }
    };
    setCollapsed(localStorage.getItem('quizReactionsCollapsed') === '1');
    toggle.addEventListener('click', () => {
      const collapsed = !bar.classList.contains('collapsed');
      setCollapsed(collapsed);
      localStorage.setItem('quizReactionsCollapsed', collapsed ? '1' : '0');
    });
  }
}

// ---------------------------------------------------------------------------
// SPIELER – Avatar/Farbe (dezentes Ausklappmenue in der Kopfzeile). Baut das
// Emoji-Raster + die Farb-Swatches EINMAL aus den Presets auf; ausgewaehlt wird
// serverseitig (setAvatar/setColor), die Auswahl selbst kommt per Snapshot
// zurueck (renderPlayerAvatar setzt/markiert dann myAvatar/myColor).
// ---------------------------------------------------------------------------
function setupPlayerAvatar() {
  const toggle = $('avatar-toggle');
  const menu = $('avatar-menu');
  const grid = $('avatar-grid');
  const colors = $('avatar-colors');
  if (!toggle || !menu || !grid || !colors) return;

  const closeMenu = () => { menu.classList.add('hidden'); toggle.setAttribute('aria-expanded', 'false'); };

  PLAYER_AVATARS.forEach((emo) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'avatar-emoji-btn'; b.textContent = emo; b.dataset.avatar = emo;
    b.addEventListener('click', () => { send({ type: 'setAvatar', avatar: emo }); closeMenu(); });
    grid.appendChild(b);
  });
  PLAYER_COLORS.forEach((col) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'color-swatch'; b.style.setProperty('--p-col', col); b.dataset.color = col;
    b.addEventListener('click', () => { send({ type: 'setColor', color: col }); closeMenu(); });
    colors.appendChild(b);
  });

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const hidden = menu.classList.toggle('hidden');
    toggle.setAttribute('aria-expanded', hidden ? 'false' : 'true');
  });
  document.addEventListener('click', (e) => {
    if (!menu.classList.contains('hidden') && !menu.contains(e.target) && e.target !== toggle) closeMenu();
  });
}

// ---------------------------------------------------------------------------
// Overlays / Utils
// ---------------------------------------------------------------------------
function showOverlay(which, text) {
  if (which === 'conn') { $('conn-overlay').classList.remove('hidden'); if (text) $('conn-text').textContent = text; }
  if (which === 'name') $('name-overlay').classList.remove('hidden');
}
function hideOverlay(which) {
  if (which === 'conn') $('conn-overlay').classList.add('hidden');
  if (which === 'name') $('name-overlay').classList.add('hidden');
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
