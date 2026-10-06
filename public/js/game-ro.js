'use strict';
// Spiel: Reihenfolge-Quiz – Drag&Drop-Umsortieren einer einzelnen Liste,
// Bildschirm/Spieler/Master-Module.

// ===========================================================================
// SPIEL: Reihenfolge-Quiz (ro) – Drag & Drop, eine sortierbare Liste pro Runde
// ===========================================================================

// Kaertchen-Element bauen. draggable nur in der Fragephase.
function roMakeCard(item, draggable) {
  const card = document.createElement('div');
  card.className = 'ro-card' + (draggable ? ' draggable' : '');
  card.dataset.id = item.id;
  const handle = document.createElement('span');
  handle.className = 'ro-handle';
  handle.textContent = '⠿';
  const text = document.createElement('span');
  text.className = 'ro-text';
  text.textContent = item.text;
  card.appendChild(handle);
  card.appendChild(text);
  return card;
}

// Baut eine sortierbare Kaertchen-Liste in ein Ziel-Element, in der gegebenen
// Reihenfolge (Array von ids). Wird sowohl vom Spieler-Board (interaktiv) als
// auch vom Bildschirm-Live-Board (nur Anzeige, Nur-Master-Modus) verwendet.
function roFillList(listEl, order, textOf, draggable, marks) {
  listEl.innerHTML = '';
  order.forEach((id, i) => {
    const card = roMakeCard({ id, text: textOf[id] || '?' }, draggable);
    if (marks && marks[id]) card.classList.add(marks[id]);
    listEl.appendChild(card);
  });
}

// --- Drag-to-Reorder via Pointer Events (Touch + Maus) einer einzelnen Liste --
// Gemeinsam von Spieler-Board und Master-Selbstspiel-Board genutzt: `onChange`
// wird mit der neuen ID-Reihenfolge aufgerufen, sobald sich per Drag etwas
// verschoben hat (nicht erst beim Loslassen – fuehlt sich direkter an).
function roMakeSortable(listEl, isEnabled, onChange) {
  let drag = null;

  function cardsArray() {
    return Array.from(listEl.querySelectorAll('.ro-card'));
  }

  function onPointerDown(e) {
    const card = e.target.closest('.ro-card.draggable');
    if (!card || !isEnabled()) return;
    e.preventDefault();
    const rect = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.classList.add('ro-ghost');
    ghost.style.width = rect.width + 'px';
    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';
    document.body.appendChild(ghost);
    const placeholder = document.createElement('div');
    placeholder.className = 'ro-placeholder';
    placeholder.style.height = rect.height + 'px';
    listEl.insertBefore(placeholder, card);
    card.classList.add('dragging');
    card.style.display = 'none';

    drag = { card, ghost, placeholder, offX: e.clientX - rect.left, offY: e.clientY - rect.top };
    try { card.setPointerCapture(e.pointerId); } catch (err) {}
    card.addEventListener('pointermove', onPointerMove);
    card.addEventListener('pointerup', onPointerUp);
    card.addEventListener('pointercancel', onPointerUp);
  }

  function onPointerMove(e) {
    if (!drag) return;
    e.preventDefault();
    drag.ghost.style.left = (e.clientX - drag.offX) + 'px';
    drag.ghost.style.top = (e.clientY - drag.offY) + 'px';
    // Platzhalter an die Position verschieben, ueber deren Kaertchen-Mitte
    // der Zeiger gerade schwebt (Vergleich der Y-Mittelpunkte).
    const y = e.clientY;
    const others = cardsArray().filter((c) => c !== drag.placeholder && c !== drag.card);
    let before = null;
    for (const c of others) {
      const r = c.getBoundingClientRect();
      if (y < r.top + r.height / 2) { before = c; break; }
    }
    if (before) listEl.insertBefore(drag.placeholder, before);
    else listEl.appendChild(drag.placeholder);
  }

  function onPointerUp() {
    if (!drag) return;
    const { card, ghost, placeholder } = drag;
    listEl.insertBefore(card, placeholder);
    listEl.removeChild(placeholder);
    card.classList.remove('dragging');
    card.style.display = '';
    card.removeEventListener('pointermove', onPointerMove);
    card.removeEventListener('pointerup', onPointerUp);
    card.removeEventListener('pointercancel', onPointerUp);
    if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
    drag = null;
    onChange(cardsArray().map((c) => c.dataset.id));
  }

  listEl.addEventListener('pointerdown', onPointerDown);
  return {
    destroy() {
      listEl.removeEventListener('pointerdown', onPointerDown);
      if (drag && drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
    }
  };
}

// --- Spieler: Liste per Drag & Drop umsortieren -------------------------------
function createRoPlayer(root, ctx) {
  root.className = 'game-mount';
  root.innerHTML =
    '<div class="ro-player">' +
      '<div class="ro-p-title" data-el="title"></div>' +
      '<div class="ro-p-frage" data-el="frage"></div>' +
      '<div class="ro-p-hint" data-el="hint"></div>' +
      '<div class="ro-list" data-el="list"></div>' +
      '<div class="ro-p-feedback" data-el="feedback"></div>' +
      '<div class="ro-p-score" data-el="score"></div>' +
    '</div>';
  const titleEl = root.querySelector('[data-el="title"]');
  const frageEl = root.querySelector('[data-el="frage"]');
  const hintEl = root.querySelector('[data-el="hint"]');
  const listEl = root.querySelector('[data-el="list"]');
  const feedbackEl = root.querySelector('[data-el="feedback"]');
  const scoreEl = root.querySelector('[data-el="score"]');

  let order = [];         // aktuelle lokale Reihenfolge (Array von ids)
  let textOf = {};
  let builtFor = '';
  let locked = false;

  const sortable = roMakeSortable(listEl, () => !locked, (newOrder) => {
    order = newOrder;
    ctx.send({ type: 'order', order });
    updateFeedback();
  });

  function updateFeedback() {
    const s = ctx.state();
    const ro = s && s.game.ro;
    if (!ro) return;
    if (ro.phase === 'question') {
      feedbackEl.className = 'ro-p-feedback';
      feedbackEl.textContent = 'Reihenfolge gespeichert – änderbar bis zum Auflösen.';
    }
  }

  function update(s) {
    const ro = s.game.ro;
    if (!ro) return;
    titleEl.textContent = ro.intro || '';
    titleEl.classList.toggle('hidden', !ro.intro);
    const pts = s.game.scores[ctx.clientId()] || 0;
    scoreEl.textContent = pts > 0 ? 'Deine Punkte: ' + pts : '';

    if (ro.phase !== 'question' && ro.phase !== 'reveal') {
      builtFor = '';
      listEl.classList.add('hidden');
      frageEl.textContent = '';
      hintEl.textContent = 'Warte auf den Start …';
      feedbackEl.textContent = '';
      feedbackEl.className = 'ro-p-feedback';
      return;
    }
    listEl.classList.remove('hidden');
    frageEl.textContent = ro.frage || '';
    locked = !!s.game.locked;
    const items = ro.items || [];
    textOf = {};
    items.forEach((it) => { textOf[it.id] = it.text; });

    const sig = ro.phase + '|' + items.map((it) => it.id).join(',') + '|' + (locked ? 'L' : 'U');
    if (builtFor !== sig) {
      const mine = s.game.roMyAnswer;
      order = (Array.isArray(mine) && mine.length === items.length) ? mine.slice() : items.map((it) => it.id);
      const marks = {};
      if (ro.phase === 'reveal' && ro.solution) {
        order.forEach((id, i) => { marks[id] = (ro.solution[i] === id) ? 'correct' : 'wrong'; });
      }
      roFillList(listEl, order, textOf, ro.phase === 'question' && !locked, marks);
      builtFor = sig;
    }

    if (ro.phase === 'question') {
      hintEl.textContent = 'Ziehe die Kärtchen in die richtige Reihenfolge.';
      if (!feedbackEl.textContent) { feedbackEl.className = 'ro-p-feedback'; feedbackEl.textContent = 'Reihenfolge änderbar bis zum Auflösen.'; }
    } else {
      const exact = ro.solution && order.every((id, i) => id === ro.solution[i]);
      let correctPairs = 0;
      if (ro.solution) {
        const idx = {}; ro.solution.forEach((id, i) => { idx[id] = i; });
        for (let i = 0; i + 1 < order.length; i++) {
          if (idx[order[i + 1]] === idx[order[i]] + 1) correctPairs++;
        }
      }
      hintEl.textContent = 'Auflösung – deine Reihenfolge mit Markierung.';
      const mine = (s.game.roMyAnswer || []).join(',');
      const result = (ro.results || []).find((r) => r.id === ctx.clientId());
      feedbackEl.className = 'ro-p-feedback ' + (exact ? 'good' : (correctPairs > 0 ? '' : 'false'));
      feedbackEl.textContent = exact
        ? ('Perfekt!  ·  +' + (result ? result.pts : 0))
        : (correctPairs + ' richtige Paare  ·  +' + (result ? result.pts : 0));
    }
  }

  return {
    update,
    destroy() { sortable.destroy(); }
  };
}

// --- Bildschirm: Liste (Referenz) bzw. Auflösung + Bestenliste ----------------
function createRoScreen(root, ctx) {
  root.innerHTML =
    '<div class="ro-screen">' +
      '<div class="ro-s-title" data-el="title"></div>' +
      '<div class="ro-s-frage" data-el="frage"></div>' +
      '<div class="ro-s-list" data-el="list"></div>' +
      '<div class="ro-s-status" data-el="status"></div>' +
      '<div class="ro-s-live" data-el="live"></div>' +
      '<div class="mc-final" data-el="final">' +
        '<div class="mc-final-title">🏁 Endstand</div>' +
        '<div class="leaderboard"></div>' +
      '</div>' +
    '</div>';
  const titleEl = root.querySelector('[data-el="title"]');
  const frageEl = root.querySelector('[data-el="frage"]');
  const listEl = root.querySelector('[data-el="list"]');
  const statusEl = root.querySelector('[data-el="status"]');
  const liveEl = root.querySelector('[data-el="live"]');
  const finalEl = root.querySelector('[data-el="final"]');

  function update(s) {
    const ro = s.game.ro;
    if (!ro) return;
    titleEl.textContent = ro.intro || 'Reihenfolge-Quiz';

    if (ro.phase !== 'question' && ro.phase !== 'reveal') {
      listEl.classList.add('hidden'); frageEl.classList.add('hidden'); finalEl.classList.add('hidden');
      liveEl.classList.add('hidden'); liveEl.innerHTML = '';
      statusEl.classList.remove('hidden');
      statusEl.textContent = ro.total ? ('Gleich geht’s los … (' + ro.total + ' Frage' + (ro.total === 1 ? '' : 'n') + ')') : 'Keine Fragen im Profil';
      return;
    }

    statusEl.classList.remove('hidden');
    frageEl.classList.remove('hidden');
    frageEl.textContent = ro.frage || '';
    const items = ro.items || [];
    const textOf = {};
    items.forEach((it) => { textOf[it.id] = it.text; });
    const reveal = ro.phase === 'reveal';
    const masterOnly = !!(s.settings && s.settings.masterOnlyMode);

    listEl.classList.toggle('hidden', masterOnly && !reveal);
    if (!(masterOnly && !reveal)) {
      const order = reveal ? ro.solution : items.map((it) => it.id);
      roFillList(listEl, order, textOf, false, null);
    }

    if (reveal) {
      statusEl.textContent = '';
      finalEl.classList.remove('hidden');
      renderLeaderboard(finalEl, s);
    } else {
      finalEl.classList.add('hidden');
      statusEl.textContent = masterOnly ? '🎯 Der Master sortiert …' : '📱 Sortiere am Handy!';
    }

    // Nur-Master-Modus: statt der reinen Referenzliste zeigt der Bildschirm live
    // dasselbe Drag&Drop-Board wie ein Spieler – der Master zieht im Master-Panel
    // (mountPlayerProxy), das Ergebnis (game.ro.groupPick) landet hier 1:1, aber
    // rein zur Anzeige, ohne Teilnehmerbindung/Punktevergabe.
    if (!reveal && masterOnly) {
      liveEl.classList.remove('hidden');
      liveEl.innerHTML =
        '<div class="ro-s-livetitle">🗳️ Gruppen-Wahl</div>' +
        '<div class="ro-list ro-s-list" data-el="livelist"></div>';
      const order = (Array.isArray(ro.groupPick) && ro.groupPick.length === items.length) ? ro.groupPick : items.map((it) => it.id);
      roFillList(liveEl.querySelector('[data-el="livelist"]'), order, textOf, false, null);
    } else {
      liveEl.classList.add('hidden');
      liveEl.innerHTML = '';
    }
  }

  return { update };
}

// --- Master: Ablaufsteuerung + Lösung + Sortierstatus je Spieler --------------
function createRoMaster(root, ctx) {
  root.innerHTML =
    '<section class="panel">' +
      '<div class="phase-indicator" data-el="phase">–</div>' +
      '<div class="control-grid">' +
        '<button class="btn btn-primary big" data-act="roStart">▶ Starten</button>' +
        '<button class="btn btn-warn big" data-act="roReveal">💡 Auflösen</button>' +
        '<button class="btn" data-act="roNext">⏭ Weiter</button>' +
        '<button class="btn btn-ghost" data-act="roReset">↺ Zurücksetzen</button>' +
      '</div>' +
      '<p class="muted small" data-el="hint"></p>' +
    '</section>' +
    '<section class="panel">' +
      '<h3>Richtige Reihenfolge</h3>' +
      '<div class="ro-m-solution" data-el="solution"></div>' +
    '</section>' +
    '<section class="panel" data-el="selfplaysec">' +
      '<h3>Nur-Master-Modus: selbst spielen</h3>' +
      '<p class="muted small">Ziehen wie am Spieler-Handy – ohne Teilnehmerbindung, keine Punktevergabe, live auf dem Bildschirm sichtbar.</p>' +
      '<div data-el="selfplay"></div>' +
    '</section>' +
    '<section class="panel">' +
      '<h3>Antworten (<span data-el="acount">0</span>)</h3>' +
      '<div class="mc-m-players" data-el="players"></div>' +
    '</section>';

  const phaseEl = root.querySelector('[data-el="phase"]');
  const hintEl = root.querySelector('[data-el="hint"]');
  const solutionEl = root.querySelector('[data-el="solution"]');
  const playersEl = root.querySelector('[data-el="players"]');
  const acountEl = root.querySelector('[data-el="acount"]');
  const startBtn = root.querySelector('[data-act="roStart"]');
  const revealBtn = root.querySelector('[data-act="roReveal"]');
  const nextBtn = root.querySelector('[data-act="roNext"]');
  const PHASE_LABEL = { lobby: '⚪ Bereit', question: '🔀 Sortieren läuft', reveal: '💡 Aufgelöst', done: '🏁 Fertig' };
  const selfplaySecEl = root.querySelector('[data-el="selfplaysec"]');
  const selfplay = mountPlayerProxy(root.querySelector('[data-el="selfplay"]'), ctx, createRoPlayer, {
    translate: (msg) => msg.type === 'order' ? { action: 'roGroupPick', order: msg.order } : null,
    mirror: (game) => { game.roMyAnswer = (game.ro && game.ro.groupPick) ? game.ro.groupPick : null; }
  });

  root.querySelectorAll('[data-act]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (b.dataset.act === 'roReset' && !(await confirmModal('Spiel zurücksetzen? (Punkte bleiben erhalten)', { title: 'Zurücksetzen', okText: 'Zurücksetzen' }))) return;
      // Weiter vor dem Auflösen = Frage ohne Punkte überspringen → Rückfrage
      if (b.dataset.act === 'roNext' && (ctx.state().game.ro || {}).phase === 'question' &&
          !(await confirmModal('Die Frage ist noch nicht aufgelöst. Wirklich überspringen?', { title: 'Weiter', okText: 'Überspringen' }))) return;
      ctx.send({ type: 'master', action: b.dataset.act });
    });
  });

  function update(s) {
    const ro = s.game.ro || { phase: 'lobby', total: 0 };
    const admin = ctx.admin();
    const cfg = (admin && admin.roCfg) || null;
    const total = cfg ? cfg.fragen.length : ro.total;
    const phase = ro.phase;

    phaseEl.textContent = PHASE_LABEL[phase] || phase;
    startBtn.disabled = !(phase === 'lobby') || total === 0;
    revealBtn.disabled = phase !== 'question';
    nextBtn.disabled = !(phase === 'question' || phase === 'reveal');

    if (total === 0) {
      hintEl.textContent = 'Keine Fragen in diesem Profil. Lege sie im Tab „🎲 Spiele" → „⚙️ Konfigurieren" an.';
    } else if (phase === 'lobby') {
      hintEl.textContent = total + ' Frage' + (total === 1 ? '' : 'n') + ' bereit · bis zu ' + (cfg ? cfg.punkte : '?') + ' Punkte je Frage.';
    } else if (phase === 'question') {
      hintEl.textContent = 'Spieler sortieren am Handy. „Auflösen" wertet und vergibt Punkte.';
    } else if (phase === 'reveal') {
      hintEl.textContent = '„Weiter" zeigt die nächste Frage bzw. den Endstand.';
    } else {
      hintEl.textContent = 'Alle Fragen durch. „Zurücksetzen" für eine neue Runde.';
    }

    // Loesung (master-exklusiv über roSolution). In der Lobby aus der Konfig ableiten.
    const items = ro.items || [];
    const textOf = {};
    items.forEach((it) => { textOf[it.id] = it.text; });
    solutionEl.innerHTML = '';
    if (items.length && s.game.roSolution) {
      const ol = document.createElement('ol');
      ol.className = 'ro-m-sol-list';
      s.game.roSolution.forEach((id) => {
        const li = document.createElement('li');
        li.textContent = textOf[id] || '?';
        ol.appendChild(li);
      });
      solutionEl.appendChild(ol);
    } else if (cfg && cfg.fragen[0]) {
      const ol = document.createElement('ol');
      ol.className = 'ro-m-sol-list';
      cfg.fragen[0].items.forEach((text) => {
        const li = document.createElement('li');
        li.textContent = text;
        ol.appendChild(li);
      });
      solutionEl.appendChild(ol);
      const cap = document.createElement('p');
      cap.className = 'muted small';
      cap.textContent = '(Vorschau der ersten Frage)';
      solutionEl.appendChild(cap);
    } else {
      solutionEl.innerHTML = '<span class="muted">–</span>';
    }

    // Sortierstatus je Spieler: abgegeben / (reveal) richtig.
    const players = (s.participants || []).filter((p) => p.role === 'player');
    const answers = s.game.roAnswers || {};
    const solution = s.game.roSolution || [];
    acountEl.textContent = Object.keys(answers).length + (players.length ? ' / ' + players.length : '');
    playersEl.innerHTML = '';
    players.forEach((p) => {
      const order = answers[p.id];
      const submitted = !!order;
      let exact = false, pairs = 0;
      if (submitted && solution.length) {
        exact = order.length === solution.length && order.every((id, i) => id === solution[i]);
        const idx = {}; solution.forEach((id, i) => { idx[id] = i; });
        for (let i = 0; i + 1 < order.length; i++) { if (idx[order[i + 1]] === idx[order[i]] + 1) pairs++; }
      }
      const row = document.createElement('div');
      row.className = 'mc-m-prow' + (submitted ? ' answered' : '') +
        (phase === 'reveal' ? (exact ? ' correct' : (pairs > 0 ? '' : ' wrong')) : '');
      const info = phase === 'reveal'
        ? (exact ? '✓ perfekt' : pairs + '/' + Math.max(0, solution.length - 1) + ' Paare')
        : (submitted ? 'abgegeben' : '–');
      row.innerHTML =
        '<span class="dev-dot' + (p.online ? ' online' : '') + '"><span class="led"></span></span>' +
        avatarChip(p) +
        '<span class="mc-m-pname">' + escapeHtml(p.name) + '</span>' +
        '<span class="zu-m-pstat">' + info + '</span>';
      playersEl.appendChild(row);
    });
    if (players.length === 0) playersEl.innerHTML = '<p class="muted small">Noch keine Spieler verbunden.</p>';

    const masterOnly = !!(s.settings && s.settings.masterOnlyMode);
    selfplaySecEl.classList.toggle('hidden', !masterOnly);
    if (masterOnly) selfplay.update(s);
  }

  return { update, destroy() { if (selfplay.destroy) selfplay.destroy(); } };
}
