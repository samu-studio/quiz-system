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

// Aufloesungs-Ansicht: die richtige Reihenfolge als nummerierte Schritte mit
// Pfeilen dazwischen (umbrechend). Schritt + folgender Pfeil bilden je eine
// Einheit, damit ein Pfeil nie allein am Zeilenanfang steht.
const RO_ARROW_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>';
function roFlowHtml(order, textOf) {
  return order.map((id, i) =>
    '<div class="ro-flow-unit" style="--i:' + i + '">' +
      '<div class="ro-step"><span class="ro-step-nr">' + (i + 1) + '</span>' +
      '<span class="ro-step-text">' + escapeHtml(textOf[id] || '?') + '</span></div>' +
      (i + 1 < order.length ? '<span class="ro-arrow">' + RO_ARROW_SVG + '</span>' : '') +
    '</div>').join('');
}

// --- Gemeinsame Drag-Steuerung (Pointer Events, Touch + Maus) -----------------
// Maus: Ziehen startet sofort. Touch/Stift: Ziehen am Griff (⠿) startet sofort, auf
// dem restlichen Kaertchen erst nach kurzem Halten – ein normaler Wisch scrollt so
// weiterhin die Seite (wichtig bei vielen Kaertchen). Waehrend des Ziehens scrollt
// die Seite automatisch, wenn der Finger/Zeiger am oberen/unteren Rand ist.
// h = { start(card, x, y), move(x, y), end() }
function roScrollParent(el) {
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;   // = Fenster
}

function roDragController(roots, isEnabled, h) {
  const HOLD_MS = 220, SLOP = 10, EDGE = 90, MAX_STEP = 20;
  let pending = null;
  let active = false;
  let last = { x: 0, y: 0 };
  let raf = 0;
  let scroller = null;

  function cancelPending() {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending = null;
    window.removeEventListener('pointermove', onPendingMove);
    window.removeEventListener('pointerup', cancelPending);
    window.removeEventListener('pointercancel', cancelPending);
  }
  function onPendingMove(e) {
    if (!pending || e.pointerId !== pending.id) return;
    last = { x: e.clientX, y: e.clientY };
    if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > SLOP) cancelPending();   // Wisch -> Browser scrollt
  }

  function onDown(e) {
    if (active || pending) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const card = e.target.closest('.ro-card.draggable');
    if (!card || !isEnabled()) return;
    last = { x: e.clientX, y: e.clientY };
    if (e.pointerType === 'mouse' || e.target.closest('.ro-handle')) {
      e.preventDefault();
      begin(card, e.pointerId);
      return;
    }
    pending = {
      card, id: e.pointerId, x: e.clientX, y: e.clientY,
      timer: setTimeout(() => {
        const c = pending && pending.card, id = pending && pending.id;
        cancelPending();
        if (c && c.isConnected && isEnabled()) {
          try { if (navigator.vibrate) navigator.vibrate(15); } catch (err) {}
          begin(c, id);
        }
      }, HOLD_MS)
    };
    window.addEventListener('pointermove', onPendingMove);
    window.addEventListener('pointerup', cancelPending);
    window.addEventListener('pointercancel', cancelPending);
  }

  function begin(card, pointerId) {
    active = true;
    scroller = roScrollParent(card);
    h.start(card, last.x, last.y);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('touchmove', blockTouch, { passive: false });
    raf = requestAnimationFrame(tick);
  }
  function blockTouch(e) { if (e.cancelable) e.preventDefault(); }
  function onMove(e) {
    if (!active) return;
    e.preventDefault();
    last = { x: e.clientX, y: e.clientY };
    h.move(last.x, last.y);
  }
  function onUp() {
    if (!active) return;
    finish();
    h.end();
  }
  function finish() {
    active = false;
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('touchmove', blockTouch);
  }

  // Auto-Scroll am Rand; danach Platzhalter neu berechnen (Seite hat sich unter dem Zeiger bewegt).
  function tick() {
    if (!active) return;
    let vt = 0, vb = window.innerHeight;
    if (scroller) { const r = scroller.getBoundingClientRect(); vt = Math.max(vt, r.top); vb = Math.min(vb, r.bottom); }
    let dy = 0;
    if (last.y < vt + EDGE) dy = -MAX_STEP * Math.min(1, (vt + EDGE - last.y) / EDGE);
    else if (last.y > vb - EDGE) dy = MAX_STEP * Math.min(1, (last.y - (vb - EDGE)) / EDGE);
    if (dy) {
      dy = dy < 0 ? Math.min(-1, Math.round(dy)) : Math.max(1, Math.round(dy));
      if (scroller) scroller.scrollTop += dy; else window.scrollBy(0, dy);
      h.move(last.x, last.y);
    }
    raf = requestAnimationFrame(tick);
  }

  const noMenu = (e) => { if (e.target.closest && e.target.closest('.ro-card.draggable')) e.preventDefault(); };
  roots.forEach((r) => { r.addEventListener('pointerdown', onDown); r.addEventListener('contextmenu', noMenu); });
  return {
    dragging: () => active,
    destroy() {
      roots.forEach((r) => { r.removeEventListener('pointerdown', onDown); r.removeEventListener('contextmenu', noMenu); });
      cancelPending();
      if (active) { finish(); h.end(true); }
    }
  };
}

// Schwebende Kopie + Platzhalter fuer einen Drag aufbauen.
function roDragVisuals(card, x, y) {
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
  card.parentNode.insertBefore(placeholder, card);
  card.classList.add('dragging');
  card.style.display = 'none';
  return { card, ghost, placeholder, offX: x - rect.left, offY: y - rect.top };
}

// --- Drag-to-Reorder einer einzelnen Liste -----------------------------------
// Gemeinsam von Spieler-Board und Master-Selbstspiel-Board genutzt: `onChange`
// wird mit der neuen ID-Reihenfolge aufgerufen, sobald losgelassen wurde.
function roMakeSortable(listEl, isEnabled, onChange) {
  let drag = null;

  function cardsArray() {
    return Array.from(listEl.querySelectorAll('.ro-card'));
  }

  const ctl = roDragController([listEl], isEnabled, {
    start(card, x, y) { drag = roDragVisuals(card, x, y); },
    move(x, y) {
      if (!drag) return;
      drag.ghost.style.left = (x - drag.offX) + 'px';
      drag.ghost.style.top = (y - drag.offY) + 'px';
      // Platzhalter vor das erste Kaertchen setzen, dessen Mitte unter dem Zeiger liegt.
      let before = null;
      for (const c of cardsArray()) {
        if (c === drag.placeholder || c === drag.card) continue;
        const r = c.getBoundingClientRect();
        if (y < r.top + r.height / 2) { before = c; break; }
      }
      listEl.insertBefore(drag.placeholder, before);
    },
    end(aborted) {
      if (!drag) return;
      const { card, ghost, placeholder } = drag;
      drag = null;
      if (placeholder.parentNode) placeholder.parentNode.insertBefore(card, placeholder);
      if (placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
      card.classList.remove('dragging');
      card.style.display = '';
      if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
      if (!aborted) onChange(cardsArray().map((c) => c.dataset.id));
    }
  });
  return ctl;
}

// --- Staffel-Modus (s. lib/staffel.js): Brett + Pool ---------------------------
// Zeichnet das Brett (gesetzte Woerter gesperrt, ein neues Wort aus dem Entwurf
// ziehbar) und – falls poolEl gegeben – den Pool der noch freien Woerter.
// In der Aufloesung zeigt das Brett die komplette Loesung (alles gesperrt).
function roStaffelFill(boardEl, poolEl, ro, enabled) {
  const st = ro.staffel;
  const items = ro.items || [];
  const textOf = {};
  items.forEach((it) => { textOf[it.id] = it.text; });
  const reveal = ro.phase === 'reveal' && ro.solution;
  const order = reveal ? ro.solution : (st.draft || st.board);
  const placed = new Set(st.board);
  boardEl.innerHTML = '';
  order.forEach((id) => {
    const isNew = !reveal && !placed.has(id);
    const card = roMakeCard({ id, text: textOf[id] || '?' }, isNew && enabled);
    card.classList.add(isNew ? 'draft' : 'locked');
    boardEl.appendChild(card);
  });
  if (poolEl) {
    poolEl.innerHTML = '';
    if (!reveal) {
      const inBoard = new Set(order);
      items.forEach((it) => { if (!inBoard.has(it.id)) poolEl.appendChild(roMakeCard(it, enabled)); });
    }
  }
}

// Drag & Drop zwischen Pool und Brett (Pointer Events, Touch + Maus). Ziehbar sind
// nur Pool-Woerter und das eine Entwurfs-Wort; ein neu eingesetztes Wort ersetzt
// ein bereits eingesetztes (es gibt nur EINEN Entwurf, das alte geht zurueck in den
// Pool). onChange(ids) bekommt die neue Reihenfolge des Bretts inkl. Entwurf.
function roStaffelDnD(boardEl, poolEl, isEnabled, onChange) {
  boardEl.dataset.stDrop = 'board';
  poolEl.dataset.stDrop = 'pool';
  let drag = null;

  return roDragController([boardEl, poolEl], isEnabled, {
    start(card, x, y) { drag = roDragVisuals(card, x, y); },
    move(x, y) {
      if (!drag) return;
      drag.ghost.style.left = (x - drag.offX) + 'px';
      drag.ghost.style.top = (y - drag.offY) + 'px';
      const el = document.elementFromPoint(x, y);
      const zone = el && el.closest('[data-st-drop]');
      if (!zone) return;
      if (zone.dataset.stDrop === 'pool') { poolEl.appendChild(drag.placeholder); return; }
      // Brett: Platzhalter vor das erste Kaertchen setzen, dessen Mitte unter dem Zeiger liegt.
      let before = null;
      for (const c of boardEl.querySelectorAll('.ro-card')) {
        if (c === drag.card) continue;
        const r = c.getBoundingClientRect();
        if (y < r.top + r.height / 2) { before = c; break; }
      }
      boardEl.insertBefore(drag.placeholder, before);
    },
    end(aborted) {
      if (!drag) return;
      const { card, ghost, placeholder } = drag;
      drag = null;
      placeholder.parentNode.insertBefore(card, placeholder);
      placeholder.parentNode.removeChild(placeholder);
      card.classList.remove('dragging');
      card.style.display = '';
      if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
      if (aborted) return;
      const toBoard = card.parentNode === boardEl;
      card.classList.toggle('draft', toBoard);
      // Nur ein Entwurf: ein zuvor eingesetztes anderes Wort zurueck in den Pool.
      boardEl.querySelectorAll('.ro-card.draft').forEach((c) => {
        if (c !== card || !toBoard) { c.classList.remove('draft'); poolEl.appendChild(c); }
      });
      onChange(Array.from(boardEl.querySelectorAll('.ro-card')).map((c) => c.dataset.id));
    }
  });
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
      '<div class="ro-staffel hidden" data-el="staffel">' +
        '<div class="st-banner" data-el="stbanner"></div>' +
        '<div class="ro-list ro-st-board" data-el="stboard"></div>' +
        '<div class="ro-st-pool" data-el="stpool"></div>' +
        '<button class="btn btn-primary big" data-el="stsubmit">📤 Abschicken</button>' +
      '</div>' +
      '<div class="ro-p-feedback" data-el="feedback"></div>' +
    '</div>';
  const titleEl = root.querySelector('[data-el="title"]');
  const frageEl = root.querySelector('[data-el="frage"]');
  const hintEl = root.querySelector('[data-el="hint"]');
  const listEl = root.querySelector('[data-el="list"]');
  const stEl = root.querySelector('[data-el="staffel"]');
  const stBannerEl = root.querySelector('[data-el="stbanner"]');
  const stBoardEl = root.querySelector('[data-el="stboard"]');
  const stPoolEl = root.querySelector('[data-el="stpool"]');
  const stSubmitEl = root.querySelector('[data-el="stsubmit"]');
  const feedbackEl = root.querySelector('[data-el="feedback"]');

  let order = [];         // aktuelle lokale Reihenfolge (Array von ids)
  let textOf = {};
  let builtFor = '';
  let locked = false;

  const sortable = roMakeSortable(listEl, () => !locked, (newOrder) => {
    order = newOrder;
    ctx.send({ type: 'order', order });
    updateFeedback();
  });

  // Staffel-Modus: nur das aktive Team sieht Brett + Pool und zieht gemeinsam am Entwurf.
  let stBuiltFor = '';
  let stMyTurn = false;
  const stDnD = roStaffelDnD(stBoardEl, stPoolEl, () => stMyTurn, (ids) => ctx.send({ type: 'order', order: ids }));
  stSubmitEl.addEventListener('click', () => ctx.send({ type: 'staffelSubmit' }));

  function renderStaffel(s, ro) {
    const st = ro.staffel;
    const reveal = ro.phase === 'reveal';
    const isActive = !!s.game.staffelMyTurn;                         // gehoert zur aktiven Einheit
    stMyTurn = !reveal && isActive && st.status === 'working' && !s.game.locked;   // darf gerade ziehen
    stBannerEl.innerHTML = reveal ? '🏁 Alle Wörter sind gesetzt!' : staffelBannerHtml(st, stMyTurn);
    // Nur wer dran ist (und in der Aufloesung alle) sieht die Aufgabe.
    const show = reveal || isActive;
    stBoardEl.classList.toggle('hidden', !show);
    stPoolEl.classList.toggle('hidden', !show || reveal);
    frageEl.classList.toggle('hidden', !show);
    stSubmitEl.classList.toggle('hidden', !stMyTurn);
    stSubmitEl.disabled = !st.draft;
    hintEl.textContent = '';
    feedbackEl.textContent = '';
    const sig = [ro.phase, st.board.join(','), (st.draft || []).join(','), st.status, stMyTurn ? 1 : 0, show ? 1 : 0,
      (ro.items || []).map((it) => it.id).join(',')].join('|');
    if (sig !== stBuiltFor && !stDnD.dragging()) {
      stBuiltFor = sig;
      if (show) roStaffelFill(stBoardEl, stPoolEl, ro, stMyTurn);
    }
  }

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

    if (ro.phase !== 'question' && ro.phase !== 'reveal') {
      builtFor = ''; stBuiltFor = '';
      listEl.classList.add('hidden');
      stEl.classList.add('hidden');
      frageEl.textContent = '';
      feedbackEl.className = 'ro-p-feedback';
      feedbackEl.textContent = '';
      hintEl.textContent = ro.phase === 'done' ? '🏁 Alle Fragen geschafft!' : 'Warte auf den Start …';
      return;
    }
    listEl.classList.toggle('hidden', !!ro.staffel);
    stEl.classList.toggle('hidden', !ro.staffel);
    frageEl.textContent = ro.frage || '';
    frageEl.classList.remove('hidden');
    locked = !!s.game.locked;
    if (ro.staffel) { feedbackEl.className = 'ro-p-feedback'; renderStaffel(s, ro); return; }
    const items = ro.items || [];
    textOf = {};
    items.forEach((it) => { textOf[it.id] = it.text; });

    const sig = ro.phase + '|' + items.map((it) => it.id).join(',') + '|' + (locked ? 'L' : 'U');
    if (builtFor !== sig && !sortable.dragging()) {
      const mine = s.game.roMyAnswer;
      order = (Array.isArray(mine) && mine.length === items.length) ? mine.slice() : items.map((it) => it.id);
      const marks = {};
      const reveal = ro.phase === 'reveal' && ro.solution;
      if (reveal) {
        order.forEach((id, i) => { marks[id] = (ro.solution[i] === id) ? 'correct' : 'wrong'; });
      }
      roFillList(listEl, order, textOf, ro.phase === 'question' && !locked, marks);
      // Aufloesung: neutrale Karten mit ✓ bzw. dem richtigen Platz statt der Akzent-Kaertchen.
      listEl.classList.toggle('ro-reveal', !!reveal);
      if (reveal) {
        listEl.querySelectorAll('.ro-card').forEach((card) => {
          const pos = document.createElement('span');
          pos.className = 'ro-pos';
          pos.textContent = card.classList.contains('correct') ? '✓' : '→ ' + (ro.solution.indexOf(card.dataset.id) + 1);
          card.appendChild(pos);
        });
      }
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
      feedbackEl.className = 'ro-p-feedback ' + (exact ? 'good' : (correctPairs > 0 ? '' : 'false'));
      feedbackEl.textContent = exact
        ? 'Perfekt!'
        : (correctPairs + ' richtige Paare');
    }
  }

  return {
    update,
    destroy() { sortable.destroy(); stDnD.destroy(); }
  };
}

// --- Bildschirm: Liste (Referenz) bzw. Auflösung + Bestenliste ----------------
function createRoScreen(root, ctx) {
  root.innerHTML =
    '<div class="ro-screen">' +
      '<div class="ro-s-title" data-el="title"></div>' +
      '<div class="ro-s-frage" data-el="frage"></div>' +
      '<div class="ro-s-list" data-el="list"></div>' +
      '<div class="ro-s-staffel hidden" data-el="staffel">' +
        '<div class="st-banner st-s-banner" data-el="stbanner"></div>' +
        '<div class="ro-list ro-s-list" data-el="stboard"></div>' +
        '<div class="ro-st-pool ro-s-pool" data-el="stpool"></div>' +
      '</div>' +
      '<div class="ro-s-reveal hidden" data-el="reveal">' +
        '<div class="ro-flow" data-el="flow"></div>' +
      '</div>' +
      '<div class="ro-s-status" data-el="status"></div>' +
      '<div class="ro-s-live" data-el="live"></div>' +
      '<div class="mc-final ro-s-final hidden" data-el="final">' +
        '<div class="mc-final-title">🏁 Quiz beendet</div>' +
      '</div>' +
    '</div>';
  const screenEl = root.querySelector('.ro-screen');
  const revealEl = root.querySelector('[data-el="reveal"]');
  const flowEl = root.querySelector('[data-el="flow"]');
  let flowSig = '';
  const titleEl = root.querySelector('[data-el="title"]');
  const frageEl = root.querySelector('[data-el="frage"]');
  const listEl = root.querySelector('[data-el="list"]');
  const stEl = root.querySelector('[data-el="staffel"]');
  const stBannerEl = root.querySelector('[data-el="stbanner"]');
  const stBoardEl = root.querySelector('[data-el="stboard"]');
  const stPoolEl = root.querySelector('[data-el="stpool"]');
  const statusEl = root.querySelector('[data-el="status"]');
  const liveEl = root.querySelector('[data-el="live"]');
  const finalEl = root.querySelector('[data-el="final"]');

  function update(s) {
    const ro = s.game.ro;
    if (!ro) return;
    titleEl.textContent = ro.intro || 'Reihenfolge-Quiz';
    // Staffel-Modus: waehrend der Frage Brett + Pool (read-only) statt Liste; in der
    // Aufloesung normal (Loesung + Bestenliste).
    const staffelLive = !!ro.staffel && ro.phase === 'question';
    stEl.classList.toggle('hidden', !staffelLive);
    if (staffelLive) {
      stBannerEl.innerHTML = staffelBannerHtml(ro.staffel, false);
      roStaffelFill(stBoardEl, stPoolEl, ro, false);
    }

    const reveal = ro.phase === 'reveal';
    // Aufloesung + Ende bekommen die volle Breite.
    screenEl.classList.toggle('wide', reveal || ro.phase === 'done');
    revealEl.classList.toggle('hidden', !reveal);
    finalEl.classList.toggle('hidden', ro.phase !== 'done');
    if (!reveal) flowSig = '';

    // Quiz beendet (nach der letzten Frage): Punkte zeigt das Scoreboard.
    if (ro.phase === 'done') {
      listEl.classList.add('hidden'); frageEl.classList.add('hidden'); statusEl.classList.add('hidden');
      liveEl.classList.add('hidden'); liveEl.innerHTML = '';
      return;
    }

    if (ro.phase !== 'question' && !reveal) {
      listEl.classList.add('hidden'); frageEl.classList.add('hidden');
      liveEl.classList.add('hidden'); liveEl.innerHTML = '';
      statusEl.classList.remove('hidden');
      statusEl.textContent = ro.total ? ('Gleich geht’s los … (' + ro.total + ' Frage' + (ro.total === 1 ? '' : 'n') + ')') : 'Keine Fragen im Profil';
      return;
    }

    frageEl.classList.remove('hidden');
    frageEl.textContent = ro.frage || '';
    const items = ro.items || [];
    const textOf = {};
    items.forEach((it) => { textOf[it.id] = it.text; });
    const masterOnly = !!(s.settings && s.settings.masterOnlyMode) && !ro.staffel;

    // Fragephase: Referenzliste (ausser Nur-Master/Staffel); Aufloesung: Pfeil-Ablauf.
    listEl.classList.toggle('hidden', reveal || masterOnly || staffelLive);
    if (!reveal && !masterOnly && !staffelLive) roFillList(listEl, items.map((it) => it.id), textOf, false, null);

    if (reveal) {
      statusEl.classList.add('hidden');
      // Nur bei Aenderung neu bauen, sonst starten die Einblend-Animationen bei jedem Snapshot neu.
      const sig = (ro.solution || []).map((id) => id + ':' + textOf[id]).join('|');
      if (sig !== flowSig) { flowSig = sig; flowEl.innerHTML = roFlowHtml(ro.solution || [], textOf); }
    } else {
      statusEl.classList.remove('hidden');
      statusEl.textContent = staffelLive ? '' : (masterOnly ? '🎯 Der Master sortiert …' : '📱 Sortiere am Handy!');
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
    '<section class="panel hidden" data-el="stsec">' +
      '<h3>Staffel</h3>' +
      '<div data-el="stpanel"></div>' +
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
    '<section class="panel" data-el="answersec">' +
      '<h3>Antworten (<span data-el="acount">0</span>)</h3>' +
      '<div class="mc-m-players" data-el="players"></div>' +
    '</section>';

  const stSecEl = root.querySelector('[data-el="stsec"]');
  const answerSecEl = root.querySelector('[data-el="answersec"]');
  const stPanel = createStaffelMasterPanel(root.querySelector('[data-el="stpanel"]'), ctx);
  const stBoardEl = document.createElement('div');
  stBoardEl.className = 'ro-list ro-st-board';
  stPanel.previewEl.appendChild(stBoardEl);
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
      if (b.dataset.act === 'roReveal') {
        const warn = revealWarning(ctx.state());
        if (warn && !(await confirmModal(warn, { title: 'Auflösen', okText: 'Trotzdem auflösen' }))) return;
      }
      ctx.send({ type: 'master', action: b.dataset.act });
    });
  });

  // Rueckfrage vor dem Aufloesen, solange die Frage noch nicht "fertig" ist:
  // Staffel = noch Woerter im Pool (Abbruch ohne Punkte), sonst = nicht alle
  // online Spieler haben sortiert. Nur-Master-Modus ohne Spielerantworten: keine.
  function revealWarning(s) {
    const ro = (s && s.game.ro) || {};
    if (ro.phase !== 'question') return '';
    if (ro.staffel) {
      const open = (ro.items || []).length - ro.staffel.board.length;
      return open > 0 ? 'Es ' + (open === 1 ? 'ist noch 1 Wort' : 'sind noch ' + open + ' Wörter') +
        ' nicht gesetzt. Auflösen bricht die Staffel-Frage ohne weitere Punkte ab.' : '';
    }
    if (s.settings && s.settings.masterOnlyMode) return '';
    const online = (s.participants || []).filter((p) => p.role === 'player' && p.online);
    const answers = s.game.roAnswers || {};
    const missing = online.filter((p) => !answers[p.id]).length;
    if (!missing) return '';
    return (online.length - missing) + ' von ' + online.length + ' Spielern haben sortiert' +
      ' (' + missing + ' noch nicht). Wer nichts verschoben hat, bekommt keine Punkte. Trotzdem auflösen?';
  }

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
    nextBtn.textContent = (phase === 'reveal' && ro.number >= ro.total) ? '🏁 Beenden' : '⏭ Weiter';

    const stMode = !!ro.staffel;
    const cfgStaffel = !!(cfg && cfg.modus === 'staffel');
    // Staffel: Panel mit Wer-ist-dran, Hinweis und Richtig/Falsch statt Antwortliste/Selbstspiel.
    stSecEl.classList.toggle('hidden', !stMode);
    answerSecEl.classList.toggle('hidden', stMode);
    if (stMode) {
      stPanel.update(s, ro.staffel);
      roStaffelFill(stBoardEl, null, ro, false);
    }

    if (total === 0) {
      hintEl.textContent = 'Keine Fragen in diesem Profil. Lege sie im Tab „🎲 Spiele" → „⚙️ Konfigurieren" an.';
    } else if (phase === 'lobby') {
      hintEl.textContent = total + ' Frage' + (total === 1 ? '' : 'n') + ' bereit · ' +
        (cfgStaffel ? 'Staffel-Modus: ' + (cfg ? cfg.punkte : '?') + ' Punkte je richtigem Zug (im Team geteilt).'
                    : 'bis zu ' + (cfg ? cfg.punkte : '?') + ' Punkte je Frage.');
    } else if (phase === 'question' && stMode) {
      hintEl.textContent = 'Das aktive Team setzt je Zug ein Wort. Unten bewerten; „Auflösen" bricht die Frage ohne Punkte ab.';
    } else if (phase === 'question') {
      hintEl.textContent = 'Spieler sortieren am Handy. „Auflösen" wertet und vergibt Punkte.';
    } else if (phase === 'reveal') {
      hintEl.textContent = '„Weiter" zeigt die nächste Frage bzw. beendet das Quiz.';
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
    // Punkte dieser Frage je Spieler (nur in der Aufloesung, Staffel hat keine Rundenergebnisse).
    const ptsOf = {};
    (ro.results || []).forEach((r) => { ptsOf[r.id] = r.pts; });
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
        '<span class="zu-m-pstat">' + info + '</span>' +
        (phase === 'reveal' && submitted ? '<span class="zd-m-pts">+' + (ptsOf[p.id] || 0) + '</span>' : '');
      playersEl.appendChild(row);
    });
    if (players.length === 0) playersEl.innerHTML = '<p class="muted small">Noch keine Spieler verbunden.</p>';

    const masterOnly = !!(s.settings && s.settings.masterOnlyMode) && !stMode && !cfgStaffel;   // Staffel hat keinen Nur-Master-Modus
    selfplaySecEl.classList.toggle('hidden', !masterOnly);
    if (masterOnly) selfplay.update(s);
  }

  return { update, destroy() { if (selfplay.destroy) selfplay.destroy(); } };
}
