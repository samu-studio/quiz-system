'use strict';
// Staffel-Modus (Reihenfolge-/Zuordnungsquiz) – gemeinsame Client-Helfer, s. lib/staffel.js.
// Spielspezifisches (Brett zeichnen, Drag & Drop) steht in game-ro.js / game-zu.js.

// Name der aktiven Einheit (Team/Spieler) als farbiges Etikett.
function staffelWhoHtml(active) {
  if (!active) return '<span class="muted">niemand</span>';
  return '<span class="st-who" style="--st-col:' + escapeHtml(active.color || 'var(--accent)') + '">' +
    (active.avatar ? escapeHtml(active.avatar) + ' ' : '') + escapeHtml(active.name) + '</span>';
}

// Banner-Text fuer Spieler/Bildschirm (HTML) – wer ist dran / wartet auf den Master.
function staffelBannerHtml(staffel, myTurn) {
  if (staffel.status === 'judging') return staffelWhoHtml(staffel.active) + ' hat abgeschickt – der Master bewertet …';
  if (myTurn) return '🎯 Ihr seid dran! Zieht <b>ein</b> Wort an die richtige Stelle.';
  return staffelWhoHtml(staffel.active) + ' ist dran …';
}

// Master-Panel (fuer ro und zu gleich): wer ist dran, Wahl der naechsten Einheit,
// Server-Hinweis zum abgeschickten Zug und Richtig/Falsch. `previewEl` ist der
// Platz fuer das spielspezifische Live-Brett (fuellt das Spiel selbst).
function createStaffelMasterPanel(root, ctx) {
  root.innerHTML =
    '<div class="st-m-who">Am Zug: <span data-el="who"></span></div>' +
    '<div class="st-m-units" data-el="units"></div>' +
    '<div class="st-m-status" data-el="status"></div>' +
    '<div class="st-m-preview" data-el="preview"></div>' +
    '<div class="control-grid">' +
      '<button class="btn btn-primary big" data-ok="1">✅ Richtig</button>' +
      '<button class="btn btn-warn big" data-ok="0">❌ Falsch</button>' +
    '</div>';
  const whoEl = root.querySelector('[data-el="who"]');
  const unitsEl = root.querySelector('[data-el="units"]');
  const statusEl = root.querySelector('[data-el="status"]');
  const previewEl = root.querySelector('[data-el="preview"]');
  const okBtn = root.querySelector('[data-ok="1"]');
  const badBtn = root.querySelector('[data-ok="0"]');
  let unitsSig = '';

  root.querySelectorAll('[data-ok]').forEach((b) => {
    b.addEventListener('click', () => ctx.send({ type: 'master', action: 'staffelJudge', ok: b.dataset.ok === '1' }));
  });

  // staffel = game.<id>.staffel (public), s.game.staffelUnits/staffelHint nur beim Master.
  function update(s, staffel) {
    const act = staffel.active;
    whoEl.innerHTML = staffelWhoHtml(act);
    const judging = staffel.status === 'judging';
    okBtn.disabled = badBtn.disabled = !judging;

    if (judging) {
      const h = s.game.staffelHint;
      statusEl.className = 'st-m-status ' + (h ? 'good' : 'bad');
      statusEl.textContent = 'Abgeschickt – Server-Hinweis: ' + (h ? '✓ stimmt mit der Lösung überein' : '✗ stimmt nicht mit der Lösung überein');
    } else {
      statusEl.className = 'st-m-status';
      statusEl.textContent = !act ? 'Niemand ist dran – unten ein Team/einen Spieler wählen.'
        : (staffel.draft ? 'Entwurf wird gelegt …' : 'Überlegt noch …');
    }

    const units = s.game.staffelUnits || [];
    const sig = units.map((u) => [u.kind, u.id, u.name, u.color, u.online ? 1 : 0].join(':')).join('|') + '#' + (act ? act.kind + act.id : '');
    if (sig !== unitsSig) {
      unitsSig = sig;
      unitsEl.innerHTML = '';
      units.forEach((u) => {
        const b = document.createElement('button');
        const isAct = act && act.kind === u.kind && act.id === u.id;
        b.className = 'btn small st-unit' + (isAct ? ' btn-primary' : ' btn-ghost') + (u.online ? '' : ' offline');
        b.style.setProperty('--st-col', u.color || 'var(--accent)');
        b.textContent = (u.avatar ? u.avatar + ' ' : '') + u.name;
        b.title = 'Jetzt dran (verwirft einen offenen Entwurf)';
        b.addEventListener('click', () => ctx.send({ type: 'master', action: 'staffelSetActive', kind: u.kind, id: u.id }));
        unitsEl.appendChild(b);
      });
      if (!units.length) unitsEl.innerHTML = '<span class="muted small">Keine Spieler/Teams verfügbar.</span>';
    }
    return previewEl;
  }

  return { update, previewEl };
}
