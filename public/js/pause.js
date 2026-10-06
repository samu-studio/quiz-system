'use strict';
// ---------------------------------------------------------------------------
// Pause-Bildschirm: Inhalt (Text/Symbol/Hintergrund/Bilder) fuer den bestehenden
// Killswitch (game.locked, s. core.js renderScreen). Der Killswitch selbst
// bleibt unveraendert (Spieler-Sperre + #player-locked-Banner) – hier wird nur
// festgelegt, WIE der Bildschirm waehrend einer Sperre aussieht.
// - renderPauseVisual(container, pauseScreen): baut Hintergrund+Text in einen
//   Container (Bildschirm-Overlay ODER Master-Vorschau), analog zu
//   design.js buildScreenBg().
// - Der Pause-Tab (nur Master) baut die Regler, zeigt live vorschau und speichert.
// ---------------------------------------------------------------------------
const PAUSE_BG_LABELS = { design: 'Design-Hintergrund', color: 'Eigene Farbe', images: 'Bilder' };

// Feste Auswahl an Symbolen ueber der Ueberschrift, mit Beschriftung fuers Auswahlfeld
// (Reihenfolge/Werte muessen mit PAUSE_ICONS in lib/config.js uebereinstimmen, die dort
// zugleich die Server-Whitelist ist) – '' = „Kein Symbol" (Symbol wird ausgeblendet).
const PAUSE_ICON_LABELS = {
  '⏸️': '⏸️ Pause', '⏯️': '⏯️ Play/Pause', '⏹️': '⏹️ Stop', '🔒': '🔒 Schloss',
  '☕': '☕ Kaffeepause', '🖥️': '🖥️ Bildschirm', '🎬': '🎬 Filmklappe',
  '⏳': '⏳ Sanduhr', '🔔': '🔔 Glocke', '': 'Kein Symbol'
};

function defaultPauseScreen() {
  return { text: 'Pause', icon: '⏸️', background: 'design', color: '#0b0f1a', images: [], interval: 6, dim: 35, blur: 0 };
}

// Beliebiges (ggf. unvollstaendiges) Pause-Objekt robust auffuellen.
function normPauseScreen(p) {
  const base = defaultPauseScreen();
  if (!p || typeof p !== 'object') return base;
  if (typeof p.text === 'string') base.text = p.text;
  if (typeof p.icon === 'string' && PAUSE_ICON_LABELS[p.icon] !== undefined) base.icon = p.icon;
  if (PAUSE_BG_LABELS[p.background]) base.background = p.background;
  if (typeof p.color === 'string') base.color = p.color;
  if (Array.isArray(p.images)) base.images = p.images.slice();
  if (Number.isFinite(p.interval)) base.interval = p.interval;
  if (Number.isFinite(p.dim)) base.dim = p.dim;
  if (Number.isFinite(p.blur)) base.blur = p.blur;
  return base;
}

// Hintergrund + Text in einen Container bauen/aktualisieren. Nur bei
// Signaturwechsel neu (Diashow-Bilder), damit ein laufender Wechsel-Timer nicht
// staendig zurueckgesetzt wird. `container` braucht die Kindstruktur aus
// index.html (.pause-bg, .pause-content .pause-text).
function renderPauseVisual(container, pauseScreen) {
  if (!container) return;
  const ps = normPauseScreen(pauseScreen);
  const bg = container.querySelector('.pause-bg');
  const textEl = container.querySelector('.pause-text');
  if (textEl) textEl.textContent = ps.text || 'Pause';
  const iconEl = container.querySelector('.pause-icon');
  if (iconEl) { iconEl.textContent = ps.icon; iconEl.classList.toggle('hidden', !ps.icon); }

  const sig = [ps.icon, ps.background, ps.color, ps.images.join(','), ps.interval, ps.dim, ps.blur].join('|');
  if (bg.__sig === sig) return;
  bg.__sig = sig;
  if (container.__pauseTimer) { clearInterval(container.__pauseTimer); container.__pauseTimer = null; }
  bg.innerHTML = '';
  bg.style.setProperty('--pause-dim', (ps.dim / 100).toFixed(3));
  bg.style.setProperty('--pause-blur', ps.blur + 'px');

  if (ps.background === 'color') {
    bg.style.background = ps.color;
  } else if (ps.background === 'images' && ps.images.length > 0) {
    bg.style.background = '';
    const imgs = ps.images.map((name) => {
      const el = document.createElement('div');
      el.className = 'pause-bg-image';
      el.style.backgroundImage = 'url("/pause/' + encodeURIComponent(name) + '")';
      bg.appendChild(el);
      return el;
    });
    const dim = document.createElement('div');
    dim.className = 'pause-bg-dim';
    bg.appendChild(dim);
    let idx = 0;
    imgs[0].classList.add('on');
    if (imgs.length > 1) {
      container.__pauseTimer = setInterval(() => {
        imgs[idx].classList.remove('on');
        idx = (idx + 1) % imgs.length;
        imgs[idx].classList.add('on');
      }, Math.max(3, ps.interval) * 1000);
    }
  } else {
    // 'design' (oder 'images' ohne Bilder) -> aktuelles Design-Hintergrund durchscheinen lassen
    bg.style.background = 'transparent';
  }
}

// ---------------------------------------------------------------------------
// Pause-Tab (nur Master)
// ---------------------------------------------------------------------------
let pzOptionsReady = false;
let pzSelectedImages = []; // aktuell gewaehlte Diashow-Bilder (Reihenfolge = Auswahl-Reihenfolge)
// Wird true, sobald der Pause-Tab einmal aus dem gespeicherten Stand befuellt wurde;
// verhindert, dass ein erneutes Betreten des Tabs ungespeicherte Aenderungen ueberschreibt
// (s. switchTab in core.js).
let pauseFormInitialized = false;

function ensurePauseOptions() {
  if (pzOptionsReady) return;
  const sel = document.getElementById('pz-bgtype');
  if (sel) {
    sel.innerHTML = '';
    for (const k of ['design', 'color', 'images']) {
      const o = document.createElement('option');
      o.value = k; o.textContent = PAUSE_BG_LABELS[k];
      sel.appendChild(o);
    }
  }
  const iconSel = document.getElementById('pz-icon');
  if (iconSel) {
    iconSel.innerHTML = '';
    for (const k of Object.keys(PAUSE_ICON_LABELS)) {
      const o = document.createElement('option');
      o.value = k; o.textContent = PAUSE_ICON_LABELS[k];
      iconSel.appendChild(o);
    }
  }
  pzOptionsReady = true;
}

function updatePauseConditionals() {
  const type = document.getElementById('pz-bgtype').value;
  document.getElementById('pz-color-row').style.display = (type === 'color') ? '' : 'none';
  document.getElementById('pz-images-sec').style.display = (type === 'images') ? '' : 'none';
  document.getElementById('pz-interval-row').style.display = (type === 'images' && pzSelectedImages.length > 1) ? '' : 'none';
}
function updatePauseSliderLabel() {
  document.getElementById('pz-interval-v').textContent = document.getElementById('pz-interval').value + ' s';
  document.getElementById('pz-dim-v').textContent = document.getElementById('pz-dim').value + ' %';
  document.getElementById('pz-blur-v').textContent = document.getElementById('pz-blur').value + ' px';
  ['pz-dim', 'pz-blur', 'pz-interval'].forEach((id) => paintPlainRange(document.getElementById(id)));
}

function gatherPauseScreen() {
  return {
    text: document.getElementById('pz-text').value,
    icon: document.getElementById('pz-icon').value,
    background: document.getElementById('pz-bgtype').value,
    color: document.getElementById('pz-color').value,
    images: pzSelectedImages.slice(),
    interval: +document.getElementById('pz-interval').value,
    dim: +document.getElementById('pz-dim').value,
    blur: +document.getElementById('pz-blur').value
  };
}

function onPauseInput() {
  updatePauseConditionals();
  updatePauseSliderLabel();
  const box = document.getElementById('pz-preview');
  if (box) renderPauseVisual(box, gatherPauseScreen());
}

// Galerie der hochgeladenen Pause-Bilder: Klick schaltet Aufnahme in die
// Diashow-Auswahl um (Mehrfachauswahl, anders als der Design-Hintergrund).
function refreshPauseThumbs() {
  const wrap = document.getElementById('pz-img-thumbs');
  if (!wrap) return;
  const list = (latestAdmin && latestAdmin.pauseImages) || [];
  pzSelectedImages = pzSelectedImages.filter((n) => list.includes(n));
  wrap.innerHTML = '';
  list.forEach((name) => {
    const t = document.createElement('div');
    t.className = 'bg-thumb' + (pzSelectedImages.includes(name) ? ' active' : '');
    t.style.backgroundImage = 'url("/pause/' + encodeURIComponent(name) + '")';
    t.title = name;
    t.addEventListener('click', () => {
      const i = pzSelectedImages.indexOf(name);
      if (i >= 0) pzSelectedImages.splice(i, 1); else pzSelectedImages.push(name);
      refreshPauseThumbs();
      onPauseInput();
    });
    const del = document.createElement('button');
    del.className = 'bt-del'; del.textContent = '×'; del.title = 'Bild löschen';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!(await confirmModal('Pause-Bild „' + name + '" löschen?', { title: 'Bild löschen', okText: 'Löschen', danger: true }))) return;
      sendAdmin({ type: 'admin', action: 'deletePauseImg', name });
    });
    t.appendChild(del);
    wrap.appendChild(t);
  });
  if (list.length === 0) wrap.innerHTML = '<p class="muted small">Noch keine Bilder hochgeladen.</p>';
}

// Vom handleAdminResult nach uploadPauseImg/deletePauseImg aufgerufen
function onPauseImgListChanged(uploadedName) {
  const msg = document.getElementById('pz-img-msg');
  if (uploadedName) {
    if (!pzSelectedImages.includes(uploadedName)) pzSelectedImages.push(uploadedName);
    if (msg) { msg.textContent = 'Hochgeladen ✓'; setTimeout(() => { msg.textContent = 'Bilder liegen in public/pause/'; }, 1600); }
  }
  refreshPauseThumbs();
  if (activeTab === 'pause') onPauseInput();
}

// Regler aus dem gespeicherten Stand fuellen (beim Betreten des Pause-Tabs)
function populatePauseForm() {
  ensurePauseOptions();
  const g = (latestAdmin && latestAdmin.global) || {};
  const ps = normPauseScreen(g.pauseScreen);

  document.getElementById('pz-text').value = ps.text;
  document.getElementById('pz-icon').value = ps.icon;
  document.getElementById('pz-bgtype').value = ps.background;
  document.getElementById('pz-color').value = ps.color;
  document.getElementById('pz-interval').value = ps.interval;
  document.getElementById('pz-dim').value = ps.dim;
  document.getElementById('pz-blur').value = ps.blur;
  pzSelectedImages = ps.images.slice();

  refreshPauseThumbs();
  updatePauseConditionals();
  updatePauseSliderLabel();
  const box = document.getElementById('pz-preview');
  if (box) renderPauseVisual(box, ps);
  pauseFormInitialized = true;
}

function setupPauseTab() {
  ensurePauseOptions();
  ['pz-text', 'pz-icon', 'pz-bgtype', 'pz-color', 'pz-interval', 'pz-dim', 'pz-blur'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) { el.addEventListener('input', onPauseInput); el.addEventListener('change', onPauseInput); }
  });

  const file = document.getElementById('pz-img-file');
  if (file) file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    const msg = document.getElementById('pz-img-msg');
    if (!f) return;
    if (f.size > 12 * 1024 * 1024) { if (msg) msg.textContent = 'Bild zu groß (max 12 MB).'; file.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (msg) msg.textContent = 'Lade hoch …';
      sendAdmin({ type: 'admin', action: 'uploadPauseImg', name: f.name, data: String(reader.result) });
    };
    reader.onerror = () => { if (msg) msg.textContent = 'Bild konnte nicht gelesen werden.'; };
    reader.readAsDataURL(f);
    file.value = '';
  });

  const save = document.getElementById('pause-save');
  if (save) save.addEventListener('click', () => {
    sendAdmin({ type: 'admin', action: 'settings', settings: { pauseScreen: gatherPauseScreen() } });
  });
}
