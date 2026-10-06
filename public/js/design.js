'use strict';
// ---------------------------------------------------------------------------
// Design: Themes/Farben/Form/Hintergrund + Bildschirm-Extras (Bild/Effekte).
//  - applyDesign(theme, design): wendet das Design fuer JEDE Rolle an (aus core.js
//    applyState heraus). Palette/Form nur bei theme==='custom' (per Inline-Vars),
//    Hintergrund-Stil global, Bildschirm-Bild/Effekte nur fuer die Bildschirm-Rolle.
//  - Der Design-Tab (nur Master) baut die Regler, zeigt live vorschau und speichert.
// ---------------------------------------------------------------------------

// ---- Beschriftungen / Auswahllisten (Quelle der Wahrheit fuer die Dropdowns) ----
const THEME_ORDER = ['neon', 'minimal', 'playful', 'midnight', 'sunset', 'forest', 'ocean', 'candy', 'contrast', 'custom'];
const THEME_LABELS = {
  neon: 'Dark Gameshow / Neon', minimal: 'Clean & Minimal', playful: 'Verspielt & Bunt',
  midnight: 'Mitternacht', sunset: 'Sonnenuntergang', forest: 'Wald', ocean: 'Ozean',
  candy: 'Candy (hell)', contrast: 'Hoher Kontrast', custom: 'Eigenes (Custom)'
};
const FONT_STACKS = {
  system: '"Segoe UI", system-ui, sans-serif',
  rounded: '"Segoe UI Rounded", "Nunito", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"Cascadia Code", Consolas, monospace',
  condensed: '"Arial Narrow", "Segoe UI", sans-serif'
};
const FONT_LABELS = { system: 'System (Standard)', rounded: 'Abgerundet', serif: 'Serif', mono: 'Monospace', condensed: 'Schmal' };
const BGSTYLE_LABELS = { radial: 'Radial (Standard)', linear: 'Linear (Winkel)', solid: 'Einfarbig', mesh: 'Mesh (bunt)' };
const EFFECT_LABELS = { none: 'Kein Effekt', stars: 'Sterne', particles: 'Partikel', confetti: 'Konfetti', aurora: 'Aurora', grid: 'Raster' };
const TITLESTYLE_LABELS = { normal: 'Normal', huge: 'Groß', outline: 'Umriss' };
// Reihenfolge + Beschriftung der Farbfelder (Key ohne Bindestrich -> CSS-Var mit Bindestrich)
const COLOR_META = [
  ['bg', 'Hintergrund'], ['bg2', 'Hintergrund 2'], ['panel', 'Panel'], ['panel2', 'Panel 2'],
  ['text', 'Text'], ['muted', 'Text (gedämpft)'], ['accent', 'Akzent'], ['accent2', 'Akzent 2'],
  ['success', 'Erfolg'], ['warn', 'Warnung'], ['danger', 'Gefahr']
];
const COLOR_VAR = {
  bg: '--bg', bg2: '--bg2', panel: '--panel', panel2: '--panel-2', text: '--text',
  muted: '--muted', accent: '--accent', accent2: '--accent-2', success: '--success', warn: '--warn', danger: '--danger'
};

// Client-Fallback, falls (noch) kein Design vom Server vorliegt (spiegelt server.js).
function defaultDesign() {
  return {
    colors: {
      bg: '#0b0f1a', bg2: '#121a2e', panel: '#16203a', panel2: '#1d2a4a',
      text: '#eaf0ff', muted: '#8a97b8', accent: '#4dd0ff', accent2: '#b46bff',
      success: '#27e08a', warn: '#ffb020', danger: '#ff4d6d'
    },
    radius: 16, font: 'system', glow: 40, bgStyle: 'radial', bgAngle: 160,
    screen: { bgImage: '', imageDim: 45, imageBlur: 0, effect: 'none', effectSpeed: 100, vignette: false, titleStyle: 'normal' }
  };
}

// Beliebiges (ggf. unvollstaendiges) Design robust auffuellen.
function normDesign(d) {
  const base = defaultDesign();
  if (!d || typeof d !== 'object') return base;
  if (d.colors) for (const k in base.colors) if (typeof d.colors[k] === 'string') base.colors[k] = d.colors[k];
  if (Number.isFinite(d.radius)) base.radius = d.radius;
  if (Number.isFinite(d.glow)) base.glow = d.glow;
  if (FONT_STACKS[d.font]) base.font = d.font;
  if (BGSTYLE_LABELS[d.bgStyle]) base.bgStyle = d.bgStyle;
  if (Number.isFinite(d.bgAngle)) base.bgAngle = d.bgAngle;
  if (d.screen) {
    const s = d.screen;
    if (typeof s.bgImage === 'string') base.screen.bgImage = s.bgImage;
    if (Number.isFinite(s.imageDim)) base.screen.imageDim = s.imageDim;
    if (Number.isFinite(s.imageBlur)) base.screen.imageBlur = s.imageBlur;
    if (EFFECT_LABELS[s.effect]) base.screen.effect = s.effect;
    if (Number.isFinite(s.effectSpeed)) base.screen.effectSpeed = s.effectSpeed;
    base.screen.vignette = !!s.vignette;
    if (TITLESTYLE_LABELS[s.titleStyle]) base.screen.titleStyle = s.titleStyle;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Anwenden (alle Rollen)
// ---------------------------------------------------------------------------
const CUSTOM_VARS = ['--bg', '--bg2', '--panel', '--panel-2', '--text', '--muted', '--accent', '--accent-2', '--success', '--warn', '--danger', '--radius', '--glow', '--font'];

function applyDesign(theme, design) {
  const d = normDesign(design);
  const root = document.documentElement;
  root.setAttribute('data-theme', THEME_LABELS[theme] ? theme : 'neon');

  if (theme === 'custom') {
    // Palette/Form als Inline-Variablen (ueberschreiben den [data-theme="custom"]-Block)
    const c = d.colors;
    for (const [key, cssVar] of Object.entries(COLOR_VAR)) root.style.setProperty(cssVar, c[key]);
    root.style.setProperty('--radius', d.radius + 'px');
    root.style.setProperty('--glow', '0 0 ' + d.glow + 'px');
    root.style.setProperty('--font', FONT_STACKS[d.font] || FONT_STACKS.system);
  } else {
    // Preset gilt -> etwaige Inline-Overrides entfernen
    CUSTOM_VARS.forEach((v) => root.style.removeProperty(v));
  }

  // Hintergrund-Stil (global, auf jeder Vorlage)
  root.setAttribute('data-bgstyle', d.bgStyle);
  root.style.setProperty('--bg-angle', d.bgAngle + 'deg');

  // Bildschirm-Extras nur fuer die Bildschirm-Rolle
  if (typeof role !== 'undefined' && role === 'screen') {
    const sv = document.getElementById('view-screen');
    if (sv) sv.setAttribute('data-titlestyle', d.screen.titleStyle);
    const cont = document.getElementById('screen-bg');
    if (cont) buildScreenBg(cont, d);
  }
}

// CSS fuer den Hintergrund-Stil (fuer die Vorschau-/Bild-Ebene, nutzt Palette-Vars)
function bgStyleCss(d) {
  switch (d.bgStyle) {
    case 'linear': return 'linear-gradient(' + d.bgAngle + 'deg, var(--bg2), var(--bg))';
    case 'solid': return 'var(--bg)';
    case 'mesh': return 'radial-gradient(900px 700px at 12% 8%, var(--bg2), transparent 60%),'
      + 'radial-gradient(900px 700px at 88% 22%, var(--accent-2), transparent 55%),'
      + 'radial-gradient(1000px 800px at 60% 100%, var(--accent), transparent 55%), var(--bg)';
    default: return 'radial-gradient(1200px 800px at 50% -10%, var(--bg2), var(--bg))';
  }
}

// Baut Bild-/Effekt-/Vignette-Ebene in einen Container (Bildschirm ODER Vorschau).
// Nur bei Signaturwechsel neu, damit laufende Animationen nicht staendig resetten.
function buildScreenBg(container, design) {
  const d = normDesign(design);
  const s = d.screen;
  let layer = container.__sbgLayer;
  if (!layer || layer.parentNode !== container) {
    layer = document.createElement('div');
    layer.style.position = 'absolute'; layer.style.inset = '0'; layer.style.overflow = 'hidden';
    container.insertBefore(layer, container.firstChild);
    container.__sbgLayer = layer;
  }
  const sig = [d.bgStyle, d.bgAngle, s.bgImage, s.imageDim, s.imageBlur, s.effect, s.effectSpeed, s.vignette].join('|');
  if (layer.__sig === sig) return;
  layer.__sig = sig;
  layer.innerHTML = '';
  layer.style.background = bgStyleCss(d);
  layer.style.backgroundSize = 'cover';
  layer.style.setProperty('--bg-img-dim', (s.imageDim / 100).toFixed(3));
  layer.style.setProperty('--bg-img-blur', s.imageBlur + 'px');

  if (s.bgImage) {
    const img = document.createElement('div');
    img.className = 'screen-bg-image';
    img.style.backgroundImage = 'url("/backgrounds/' + encodeURIComponent(s.bgImage) + '")';
    layer.appendChild(img);
    const dim = document.createElement('div');
    dim.className = 'screen-bg-dim';
    layer.appendChild(dim);
  }
  const fx = buildEffect(s.effect, s.effectSpeed);
  if (fx) layer.appendChild(fx);
  if (s.vignette) {
    const vg = document.createElement('div');
    vg.style.cssText = 'position:absolute;inset:0;pointer-events:none;background:radial-gradient(120% 90% at 50% 45%, transparent 55%, rgba(0,0,0,0.55) 100%);';
    layer.appendChild(vg);
  }
}

// Bewegter Effekt als DOM-Ebene (aurora/grid = reines CSS; stars/particles/confetti = erzeugte Knoten)
// speedPct skaliert das Tempo: hoeher = schneller. JS-Knoten teilen ihre Dauer durch den Faktor,
// aurora/grid lesen den Faktor als --fx-speed-Variable im CSS (calc(basis / var(--fx-speed))).
function buildEffect(kind, speedPct) {
  if (!kind || kind === 'none') return null;
  const factor = Math.max(0.25, (Number.isFinite(speedPct) ? speedPct : 100) / 100);
  const el = document.createElement('div');
  el.className = 'fx-' + kind;
  el.style.setProperty('--fx-speed', factor.toFixed(3));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const dur = (a, b) => (rnd(a, b) / factor); // schnelleres Tempo -> kuerzere Dauer
  if (kind === 'stars') {
    for (let i = 0; i < 70; i++) {
      const st = document.createElement('div'); st.className = 'star';
      st.style.left = rnd(0, 100).toFixed(2) + '%'; st.style.top = rnd(0, 100).toFixed(2) + '%';
      const sz = rnd(2, 4).toFixed(1); st.style.width = sz + 'px'; st.style.height = sz + 'px';
      st.style.setProperty('--dur', dur(2, 5).toFixed(2) + 's');
      st.style.setProperty('--delay', (rnd(0, 3) / factor).toFixed(2) + 's');
      el.appendChild(st);
    }
  } else if (kind === 'particles') {
    for (let i = 0; i < 26; i++) {
      const p = document.createElement('div'); p.className = 'pt';
      p.style.left = rnd(0, 100).toFixed(2) + '%';
      p.style.setProperty('--sz', Math.round(rnd(6, 16)) + 'px');
      p.style.setProperty('--dur', dur(10, 22).toFixed(1) + 's');
      p.style.setProperty('--delay', (rnd(0, 10) / factor).toFixed(1) + 's');
      p.style.setProperty('--drift', Math.round(rnd(-60, 60)) + 'px');
      el.appendChild(p);
    }
  } else if (kind === 'confetti') {
    const cols = ['var(--accent)', 'var(--accent-2)', 'var(--success)', 'var(--warn)', 'var(--danger)'];
    for (let i = 0; i < 40; i++) {
      const c = document.createElement('div'); c.className = 'cf';
      c.style.left = rnd(0, 100).toFixed(2) + '%';
      c.style.setProperty('--c', cols[i % cols.length]);
      c.style.setProperty('--dur', dur(4, 8).toFixed(1) + 's');
      c.style.setProperty('--delay', (rnd(0, 5) / factor).toFixed(1) + 's');
      el.appendChild(c);
    }
  }
  return el;
}

// ---------------------------------------------------------------------------
// Farb-Umrechnung (Hex <-> HSL) fuer die Slider
// ---------------------------------------------------------------------------
function hexToHsl(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex || '');
  if (!m) return { h: 0, s: 0, l: 0 };
  const n = parseInt(m[1], 16);
  let r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const dd = max - min;
    s = l > 0.5 ? dd / (2 - max - min) : dd / (max + min);
    if (max === r) h = (g - b) / dd + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / dd + 2;
    else h = (r - g) / dd + 4;
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}
function hslToHex(h, s, l) {
  h = (h % 360 + 360) % 360; s = Math.max(0, Math.min(100, s)) / 100; l = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  const to = (v) => ('0' + Math.round((v + m) * 255).toString(16)).slice(-2);
  return '#' + to(r) + to(g) + to(b);
}

// hex -> "rgba(r,g,b,a)", fuer dezente Farbwaschen (z.B. Team-Hintergrund).
function hexToRgba(hex, a) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex || '');
  if (!m) return 'rgba(0,0,0,' + a + ')';
  const n = parseInt(m[1], 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

// Dezenter, matter Team-Farbverlauf fuer den Spieler-Hintergrund (#player-team-bg):
// sanftes Glühen von oben + diagonale Waschung, niedrige Deckkraft statt satter
// Vollfarbe, damit es sich unter das aktuelle Theme mischt statt es zu ersetzen.
function teamBgGradient(hex) {
  return 'radial-gradient(1100px 750px at 50% -8%, ' + hexToRgba(hex, 0.32) + ', transparent 62%),'
    + 'linear-gradient(165deg, ' + hexToRgba(hex, 0.14) + ' 0%, transparent 60%)';
}

// ---------------------------------------------------------------------------
// Design-Tab (nur Master)
// ---------------------------------------------------------------------------
let dzOptionsReady = false;   // Dropdowns nur einmal befuellen
let dzSelectedBg = '';        // aktuell gewaehltes Hintergrundbild (Quelle der Wahrheit fuer bgImage)

function fillSelect(id, labels, order) {
  const sel = document.getElementById(id);
  if (!sel) return;
  sel.innerHTML = '';
  const keys = order || Object.keys(labels);
  for (const k of keys) {
    const o = document.createElement('option');
    o.value = k; o.textContent = labels[k];
    sel.appendChild(o);
  }
}

function ensureDesignOptions() {
  if (dzOptionsReady) return;
  fillSelect('dz-theme', THEME_LABELS, THEME_ORDER);
  fillSelect('dz-font', FONT_LABELS);
  fillSelect('dz-bgstyle', BGSTYLE_LABELS);
  fillSelect('dz-effect', EFFECT_LABELS);
  fillSelect('dz-titlestyle', TITLESTYLE_LABELS);
  dzOptionsReady = true;
}

// Farbzeilen bauen (Color-Picker + Hex-Feld + H/S/L-Slider). DOM ist Quelle der Wahrheit.
function buildColorRows(colors) {
  const wrap = document.getElementById('dz-colors');
  if (!wrap) return;
  wrap.innerHTML = '';
  for (const [key, label] of COLOR_META) {
    const val = colors[key] || '#000000';
    const row = document.createElement('div');
    row.className = 'color-row';
    row.dataset.key = key;
    row.innerHTML =
      '<div class="cr-top">'
      + '<input type="color" class="cr-color" />'
      + '<span class="cr-label"></span>'
      + '<input type="text" class="cr-hex" maxlength="7" spellcheck="false" />'
      + '</div>'
      + '<div class="cr-sliders">'
      + '<span>H</span><input type="range" class="cs-h" min="0" max="360"><span class="cs-val cs-hv"></span>'
      + '<span>S</span><input type="range" class="cs-s" min="0" max="100"><span class="cs-val cs-sv"></span>'
      + '<span>L</span><input type="range" class="cs-l" min="0" max="100"><span class="cs-val cs-lv"></span>'
      + '</div>';
    row.querySelector('.cr-label').textContent = label;
    const colorEl = row.querySelector('.cr-color');
    const hexEl = row.querySelector('.cr-hex');
    const h = row.querySelector('.cs-h'), s = row.querySelector('.cs-s'), l = row.querySelector('.cs-l');
    const hv = row.querySelector('.cs-hv'), sv = row.querySelector('.cs-sv'), lv = row.querySelector('.cs-lv');

    // H/S/L-Regler als echte Farbverlaeufe faerben (Regenbogen / Saettigung / Helligkeit),
    // damit man sieht, was man einstellt. Der Verlauf haengt vom jeweils anderen Wert ab.
    function paintSliders() {
      const hh = +h.value, ss = +s.value, ll = +l.value;
      const hue = [];
      for (let d = 0; d <= 360; d += 60) hue.push(hslToHex(d, ss || 100, ll || 50));
      h.style.background = 'linear-gradient(90deg,' + hue.join(',') + ')';
      s.style.background = 'linear-gradient(90deg,' + hslToHex(hh, 0, ll) + ',' + hslToHex(hh, 100, ll) + ')';
      l.style.background = 'linear-gradient(90deg,' + hslToHex(hh, ss, 0) + ',' + hslToHex(hh, ss, 50) + ',' + hslToHex(hh, ss, 100) + ')';
    }
    function setFromHex(hex) {
      colorEl.value = hex; hexEl.value = hex;
      const hsl = hexToHsl(hex);
      h.value = hsl.h; s.value = hsl.s; l.value = hsl.l;
      hv.textContent = hsl.h; sv.textContent = hsl.s; lv.textContent = hsl.l;
      paintSliders();
    }
    function setFromHsl() {
      const hex = hslToHex(+h.value, +s.value, +l.value);
      colorEl.value = hex; hexEl.value = hex;
      hv.textContent = h.value; sv.textContent = s.value; lv.textContent = l.value;
      paintSliders();
    }
    setFromHex(/^#[0-9a-fA-F]{6}$/.test(val) ? val : '#000000');

    colorEl.addEventListener('input', () => { setFromHex(colorEl.value); onDesignInput(); });
    hexEl.addEventListener('input', () => {
      let v = hexEl.value.trim(); if (v && v[0] !== '#') v = '#' + v;
      if (/^#[0-9a-fA-F]{6}$/.test(v)) { setFromHex(v.toLowerCase()); onDesignInput(); }
    });
    [h, s, l].forEach((sl) => sl.addEventListener('input', () => { setFromHsl(); onDesignInput(); }));
    wrap.appendChild(row);
  }
}

// Aktuelle Farben aus den Zeilen lesen
function readColorsFromRows() {
  const out = {};
  document.querySelectorAll('#dz-colors .color-row').forEach((row) => {
    out[row.dataset.key] = row.querySelector('.cr-hex').value;
  });
  return out;
}

// Alle Regler -> Design-Objekt
function gatherDesign() {
  const g = { colors: readColorsFromRows() };
  g.radius = +document.getElementById('dz-radius').value;
  g.glow = +document.getElementById('dz-glow').value;
  g.font = document.getElementById('dz-font').value;
  g.bgStyle = document.getElementById('dz-bgstyle').value;
  g.bgAngle = +document.getElementById('dz-angle').value;
  g.screen = {
    bgImage: dzSelectedBg || '',
    imageDim: +document.getElementById('dz-dim').value,
    imageBlur: +document.getElementById('dz-blur').value,
    effect: document.getElementById('dz-effect').value,
    effectSpeed: +document.getElementById('dz-speed').value,
    vignette: document.getElementById('dz-vignette').checked,
    titleStyle: document.getElementById('dz-titlestyle').value
  };
  return g;
}
function currentTheme() { return document.getElementById('dz-theme').value; }

// Sichtbarkeit/Aktivierung abhaengig von Theme/Hintergrund-Stil
function updateDesignConditionals() {
  const custom = currentTheme() === 'custom';
  document.getElementById('dz-colors-sec').classList.toggle('disabled', !custom);
  document.getElementById('dz-form-sec').classList.toggle('disabled', !custom);
  document.getElementById('dz-angle-row').style.display = (document.getElementById('dz-bgstyle').value === 'linear') ? '' : 'none';
  // Effekt-Tempo nur zeigen, wenn ueberhaupt ein bewegter Effekt aktiv ist
  document.getElementById('dz-speed-row').style.display = (document.getElementById('dz-effect').value === 'none') ? 'none' : '';
}
// Einfache Regler (kein Farbverlauf) mit gefuelltem Akzent-Track versehen (Fortschritt sichtbar).
function paintPlainRange(el) {
  if (!el) return;
  const min = +el.min || 0, max = +el.max || 100;
  const pct = max > min ? ((+el.value - min) / (max - min)) * 100 : 0;
  el.style.background = 'linear-gradient(90deg, var(--accent) 0 ' + pct + '%, var(--panel-2) ' + pct + '% 100%)';
}
function updateSliderLabels() {
  document.getElementById('dz-radius-v').textContent = document.getElementById('dz-radius').value + ' px';
  document.getElementById('dz-glow-v').textContent = document.getElementById('dz-glow').value + ' px';
  document.getElementById('dz-angle-v').textContent = document.getElementById('dz-angle').value + '°';
  document.getElementById('dz-dim-v').textContent = document.getElementById('dz-dim').value + ' %';
  document.getElementById('dz-blur-v').textContent = document.getElementById('dz-blur').value + ' px';
  document.getElementById('dz-speed-v').textContent = document.getElementById('dz-speed').value + ' %';
  ['dz-radius', 'dz-glow', 'dz-angle', 'dz-dim', 'dz-blur', 'dz-speed'].forEach((id) => paintPlainRange(document.getElementById(id)));
}

// Auf jede Aenderung: Live-Vorschau (Master) + Vorschau-Box aktualisieren
function onDesignInput() {
  designPreviewActive = true;
  updateDesignConditionals();
  updateSliderLabels();
  const theme = currentTheme();
  const design = gatherDesign();
  applyDesign(theme, design);          // Palette/Form/Hintergrund live auf der Master-Seite
  updatePreviewBox(design);            // Beamer-Bild/Effekte in der Vorschau-Box
}

// Vorschau-Box (#dz-preview) zeigt den Beamer-Hintergrund
function updatePreviewBox(design) {
  const box = document.getElementById('dz-preview');
  if (box) buildScreenBg(box, design || gatherDesign());
}

// Thumbnails der verfuegbaren Hintergrundbilder (+ „Kein" + Loeschen)
function refreshBgThumbs() {
  const wrap = document.getElementById('dz-bg-thumbs');
  if (!wrap) return;
  const list = (latestAdmin && latestAdmin.backgrounds) || [];
  if (dzSelectedBg && !list.includes(dzSelectedBg)) dzSelectedBg = '';
  wrap.innerHTML = '';

  const none = document.createElement('div');
  none.className = 'bg-thumb none-thumb' + (dzSelectedBg ? '' : ' active');
  none.textContent = 'Kein Bild';
  none.addEventListener('click', () => { dzSelectedBg = ''; refreshBgThumbs(); onDesignInput(); });
  wrap.appendChild(none);

  list.forEach((name) => {
    const t = document.createElement('div');
    t.className = 'bg-thumb' + (dzSelectedBg === name ? ' active' : '');
    t.style.backgroundImage = 'url("/backgrounds/' + encodeURIComponent(name) + '")';
    t.title = name;
    t.addEventListener('click', () => { dzSelectedBg = name; refreshBgThumbs(); onDesignInput(); });
    const del = document.createElement('button');
    del.className = 'bt-del'; del.textContent = '×'; del.title = 'Bild löschen';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!(await confirmModal('Hintergrundbild „' + name + '" löschen?', { title: 'Bild löschen', okText: 'Löschen', danger: true }))) return;
      sendAdmin({ type: 'admin', action: 'deleteBg', name });
    });
    t.appendChild(del);
    wrap.appendChild(t);
  });
}

// Vom handleAdminResult nach uploadBg/deleteBg aufgerufen (Liste hat sich geaendert)
function onBgListChanged(uploadedName) {
  const msg = document.getElementById('dz-bg-msg');
  if (uploadedName) {
    dzSelectedBg = uploadedName;
    if (msg) { msg.textContent = 'Hochgeladen ✓'; setTimeout(() => { msg.textContent = 'Bilder liegen in public/backgrounds/'; }, 1600); }
  }
  refreshBgThumbs();
  if (activeTab === 'design') onDesignInput();
}

// Regler aus dem gespeicherten Stand fuellen (beim Betreten des Design-Tabs)
function populateDesignForm() {
  ensureDesignOptions();
  const g = (latestAdmin && latestAdmin.global) || {};
  const theme = THEME_LABELS[g.theme] ? g.theme : 'neon';
  const design = normDesign(g.design);

  document.getElementById('dz-theme').value = theme;
  buildColorRows(design.colors);
  document.getElementById('dz-radius').value = design.radius;
  document.getElementById('dz-glow').value = design.glow;
  document.getElementById('dz-font').value = design.font;
  document.getElementById('dz-bgstyle').value = design.bgStyle;
  document.getElementById('dz-angle').value = design.bgAngle;
  document.getElementById('dz-titlestyle').value = design.screen.titleStyle;
  document.getElementById('dz-effect').value = design.screen.effect;
  document.getElementById('dz-speed').value = design.screen.effectSpeed;
  document.getElementById('dz-vignette').checked = design.screen.vignette;
  document.getElementById('dz-dim').value = design.screen.imageDim;
  document.getElementById('dz-blur').value = design.screen.imageBlur;

  dzSelectedBg = design.screen.bgImage || '';
  refreshBgThumbs();
  updateDesignConditionals();
  updateSliderLabels();
  updatePreviewBox(design);
}

function setupDesignTab() {
  ensureDesignOptions();
  // Alle Regler live verdrahten
  ['dz-theme', 'dz-radius', 'dz-glow', 'dz-font', 'dz-bgstyle', 'dz-angle',
    'dz-titlestyle', 'dz-effect', 'dz-speed', 'dz-vignette', 'dz-dim', 'dz-blur'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) { el.addEventListener('input', onDesignInput); el.addEventListener('change', onDesignInput); }
    });

  // Bild-Upload: Datei -> Data-URL -> ueber WS an den Server (schreibt public/backgrounds/)
  const file = document.getElementById('dz-bg-file');
  if (file) file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    const msg = document.getElementById('dz-bg-msg');
    if (!f) return;
    if (f.size > 12 * 1024 * 1024) { if (msg) msg.textContent = 'Bild zu groß (max 12 MB).'; file.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (msg) msg.textContent = 'Lade hoch …';
      sendAdmin({ type: 'admin', action: 'uploadBg', name: f.name, data: String(reader.result) });
    };
    reader.onerror = () => { if (msg) msg.textContent = 'Bild konnte nicht gelesen werden.'; };
    reader.readAsDataURL(f);
    file.value = '';
  });

  // Speichern -> Theme + Design an alle verteilen (Titel/Passwort bleiben unberuehrt)
  const save = document.getElementById('design-save');
  if (save) save.addEventListener('click', () => {
    sendAdmin({ type: 'admin', action: 'settings', settings: { theme: currentTheme(), design: gatherDesign() } });
  });
}
