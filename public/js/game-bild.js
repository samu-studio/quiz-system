'use strict';
// Spiel: Bildanzeige – Bildschirm/Spieler/Master-Module.

// ===========================================================================
// SPIEL: Bildanzeige – eine „Folie" zwischen Spielen (keine Punkte)
// ===========================================================================

// CSS-Filter je Profil-Einstellung (Unschaerfe kommt separat ueber --bild-blur).
const BILD_FILTER_CSS = { none: '', grau: 'grayscale(1)', sepia: 'sepia(.85)', invert: 'invert(1)' };

// Baut die Bild-Buehne (Bild + Hintergrundflaeche + Abdunklung + Effekt + Vignette +
// Beschriftung) in `stage`. Geteilt von Bildschirm, Spieler-Handy und Master-Vorschau.
// Nur bei Signaturwechsel neu (laufende Effekt-/Zoom-Animationen nicht resetten);
// Unschaerfe/Abdunklung/Filter sind reine CSS-Vars (kein Neuaufbau, z.B. beim
// Ziehen eines Reglers), sichtbar/scharf schalten nur Klassen um (CSS-Uebergaenge).
function renderBildStage(stage, b) {
  stage.style.setProperty('--bild-blur', b.unschaerfe + 'px');
  stage.style.setProperty('--bild-filter', BILD_FILTER_CSS[b.filter] || '');
  stage.style.setProperty('--bild-dim', (b.abdunkeln / 100).toFixed(2));
  const sig = [b.bild, b.anzeige, b.hintergrund, b.vignette, b.zoom, b.effekt, b.effektTempo,
    b.titel, b.untertitel].join('|');
  if (stage.__sig !== sig) {
    stage.__sig = sig;
    stage.innerHTML = '';
    const url = b.bild ? 'url("/backgrounds/' + encodeURIComponent(b.bild) + '")' : '';

    // Flaeche neben dem Bild (nur sichtbar, wenn das ganze Bild eingepasst wird)
    if (url && b.anzeige === 'contain' && b.hintergrund !== 'design') {
      const back = document.createElement('div');
      back.className = 'bild-back bild-back-' + b.hintergrund;
      if (b.hintergrund === 'unscharf') back.style.backgroundImage = url;
      stage.appendChild(back);
    }
    const img = document.createElement('div');
    img.className = 'bild-img bild-' + b.anzeige + (b.zoom ? ' bild-zoom' : '');
    if (url) img.style.backgroundImage = url;
    else img.innerHTML = '<div class="bild-leer">🖼️<span>Kein Bild gewählt</span></div>';
    stage.appendChild(img);
    const dim = document.createElement('div');
    dim.className = 'bild-dim';
    stage.appendChild(dim);
    const fx = buildEffect(b.effekt, b.effektTempo);   // design.js – gleiche Effekte wie der Bildschirm-Hintergrund
    if (fx) stage.appendChild(fx);
    if (b.vignette) {
      const vg = document.createElement('div');
      vg.className = 'bild-vignette';
      stage.appendChild(vg);
    }
    if (b.titel || b.untertitel) {
      const cap = document.createElement('div');
      cap.className = 'bild-caption';
      cap.innerHTML = (b.titel ? '<div class="bild-titel">' + escapeHtml(b.titel) + '</div>' : '') +
        (b.untertitel ? '<div class="bild-untertitel">' + escapeHtml(b.untertitel) + '</div>' : '');
      stage.appendChild(cap);
    }
  }
  stage.classList.toggle('bild-verborgen', !b.sichtbar);
  stage.classList.toggle('bild-scharf', !!b.scharf);
}

// Kleine Vorschau-Buehne: Unschaerfe auf die Vorschau-Breite herunterrechnen (bezogen
// auf einen 1920 px breiten Beamer), sonst wirkt sie in der Mini-Box viel zu stark.
function renderBildPreview(stage, b) {
  const scale = Math.min(1, (stage.clientWidth || 480) / 1920);
  renderBildStage(stage, Object.assign({}, b, { unschaerfe: Math.round(b.unschaerfe * scale * 10) / 10 }));
}

// Live-Vorschau auf der Konfig-Seite (GAMES.bild.preview): zeigt das Profil so, wie es
// beim Start auf dem Bildschirm erscheint (immer sichtbar, Unschaerfe aktiv).
function previewBild(box, data) {
  if (!box.classList.contains('bild-stage')) box.className = 'bild-stage bild-preview bild-live';
  renderBildPreview(box, Object.assign({}, data, { sichtbar: true, scharf: false }));
}

// --- Bildschirm: Bild vollflaechig ueber der Buehne ---
function createBildScreen(root, ctx) {
  root.innerHTML = '<div class="bild-stage bild-screen" data-el="stage"></div>';
  const stageEl = root.querySelector('[data-el="stage"]');

  function update(s) {
    const b = s.game.bild;
    if (b) renderBildStage(stageEl, b);
  }
  return { update };
}

// --- Spieler: Hinweis „Schau auf den Bildschirm" oder (optional) das Bild selbst ---
function createBildPlayer(root, ctx) {
  root.innerHTML =
    '<div class="bild-player">' +
      '<div class="bild-stage bild-mini" data-el="stage"></div>' +
      '<div class="wait-state" data-el="hint">' +
        '<div class="wait-emoji">🖼️</div>' +
        '<div class="wait-text" data-el="hinttext">Schau auf den Bildschirm!</div>' +
      '</div>' +
    '</div>';
  const stageEl = root.querySelector('[data-el="stage"]');
  const hintEl = root.querySelector('[data-el="hint"]');
  const hintTextEl = root.querySelector('[data-el="hinttext"]');

  function update(s) {
    const b = s.game.bild;
    if (!b) return;
    const zeigen = b.aufHandy && b.sichtbar && !!b.bild;
    stageEl.classList.toggle('hidden', !zeigen);
    hintEl.classList.toggle('hidden', zeigen);
    if (zeigen) renderBildStage(stageEl, b);
    hintTextEl.textContent = b.titel || 'Schau auf den Bildschirm!';
  }
  return { update };
}

// --- Master: Ein-/Ausblenden, Unschaerfe aufheben, Mini-Vorschau ---
function createBildMaster(root, ctx) {
  root.innerHTML =
    '<section class="panel">' +
      '<div class="phase-indicator" data-el="phase">–</div>' +
      '<div class="control-grid">' +
        '<button class="btn btn-primary big" data-el="sichtbar"></button>' +
        '<button class="btn btn-success big" data-el="scharf"></button>' +
        '<button class="btn btn-ghost" data-act="bildReset">↺ Reset</button>' +
      '</div>' +
      '<p class="muted small" data-el="info"></p>' +
    '</section>' +
    '<section class="panel">' +
      '<h3>Vorschau Bildschirm</h3>' +
      '<div class="bild-stage bild-preview" data-el="stage"></div>' +
    '</section>';

  const phaseEl = root.querySelector('[data-el="phase"]');
  const infoEl = root.querySelector('[data-el="info"]');
  const stageEl = root.querySelector('[data-el="stage"]');
  const sichtbarBtn = root.querySelector('[data-el="sichtbar"]');
  const scharfBtn = root.querySelector('[data-el="scharf"]');

  root.querySelector('[data-act="bildReset"]').addEventListener('click', () => {
    ctx.send({ type: 'master', action: 'bildReset' });
  });
  sichtbarBtn.addEventListener('click', () => {
    const b = ctx.state().game.bild;
    if (b) ctx.send({ type: 'master', action: 'bildSichtbar', on: !b.sichtbar });
  });
  scharfBtn.addEventListener('click', () => {
    const b = ctx.state().game.bild;
    if (b) ctx.send({ type: 'master', action: 'bildScharf', on: !b.scharf });
  });

  function update(s) {
    const b = s.game.bild;
    if (!b) return;
    phaseEl.textContent = b.sichtbar ? '🖼️ Bild wird angezeigt' : '🙈 Bild ausgeblendet';
    sichtbarBtn.textContent = b.sichtbar ? '🙈 Ausblenden' : '👁 Einblenden';
    scharfBtn.textContent = b.scharf ? '🌫 Unschärfe wieder an' : '🔍 Scharf stellen';
    scharfBtn.classList.toggle('hidden', !(b.unschaerfe > 0));
    const teile = [b.bild ? 'Datei: ' + b.bild : 'Kein Bild gewählt – im Tab 🎲 Spiele ein Bild auswählen/hochladen.'];
    if (b.aufHandy) teile.push('Wird auch auf den Handys gezeigt.');
    infoEl.textContent = teile.join(' ');
    renderBildPreview(stageEl, b);
  }
  return { update };
}
