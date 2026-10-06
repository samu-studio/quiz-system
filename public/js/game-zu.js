'use strict';
// Spiel: Zuordnungsquiz – Drag&Drop, Bildschirm/Spieler/Master-Module.

// ===========================================================================
// SPIEL: Zuordnungsquiz (zu) – Drag & Drop, ganzes Board pro Runde
// ===========================================================================

// Karten-Element (rechtes Kaertchen) bauen. draggable nur in der Matching-Phase.
function zuMakeCard(right, draggable) {
  const card = document.createElement('div');
  card.className = 'zu-card' + (draggable ? ' draggable' : '');
  card.dataset.right = right.id;
  card.textContent = right.text;
  return card;
}

// Baut Slots + Kaertchen-Pool eines Zuordnungs-Boards in beliebige Ziel-Elemente.
// Wird sowohl vom Spieler-Board (interaktiv) als auch vom Bildschirm-Live-Board
// (nur Anzeige, Nur-Master-Modus) verwendet, damit beide optisch identisch sind.
function zuFillBoard(els, opts) {
  const { leftsEl, poolCardsEl, poolCapEl } = els;
  const { lefts, rights, placement, phase, solution, distractors, draggable, poolCapText } = opts;
  leftsEl.innerHTML = '';
  poolCardsEl.innerHTML = '';

  lefts.forEach((l) => {
    const slot = document.createElement('div');
    slot.className = 'zu-slot';
    const label = document.createElement('div');
    label.className = 'zu-left-label';
    label.textContent = l.text;
    const zone = document.createElement('div');
    zone.className = 'zu-dropzone';
    zone.dataset.left = l.id;
    zone.dataset.drop = 'slot';
    slot.appendChild(label);
    slot.appendChild(zone);

    // Auflösung: richtig/falsch je Slot markieren.
    if (phase === 'reveal' && solution) {
      const correctRid = solution[l.id] || null;
      const placedRid = (placement && placement[l.id]) || null;
      const ok = placedRid === correctRid;
      slot.classList.add(ok ? 'correct' : 'wrong');
      const tag = document.createElement('div');
      tag.className = 'zu-soltag';
      const correctText = correctRid ? (rights.find((r) => r.id === correctRid) || {}).text : '— keine Verbindung';
      tag.textContent = '→ ' + (correctText || '?');
      slot.appendChild(tag);
    }
    leftsEl.appendChild(slot);
  });

  rights.forEach((r) => {
    const isDistractor = phase === 'reveal' && distractors && distractors.indexOf(r.id) >= 0;
    const card = zuMakeCard(r, draggable);
    if (isDistractor) card.classList.add('distractor');
    const leftId = placement ? Object.keys(placement).find((lid) => placement[lid] === r.id) : null;
    if (leftId) {
      const zone = leftsEl.querySelector('.zu-dropzone[data-left="' + leftId + '"]');
      if (zone) { zone.appendChild(card); zone.classList.add('filled'); return; }
    }
    poolCardsEl.appendChild(card);
  });

  if (poolCapEl) {
    poolCapEl.textContent = poolCapText != null ? poolCapText : (phase === 'reveal' ? 'Übrig / Ablenker' : 'Kärtchen hierher zurück');
  }
}

// --- Spieler: Board mit Drag & Drop (Pointer Events -> Touch + Maus) ----------
function createZuPlayer(root, ctx) {
  root.className = 'game-mount';
  root.innerHTML =
    '<div class="zu-player">' +
      '<div class="zu-p-title" data-el="title"></div>' +
      '<div class="zu-p-hint" data-el="hint"></div>' +
      '<div class="zu-board" data-el="board">' +
        '<div class="zu-lefts" data-el="lefts"></div>' +
        '<div class="zu-pool" data-el="pool" data-drop="pool">' +
          '<div class="zu-pool-cap" data-el="poolcap">Kärtchen</div>' +
          '<div class="zu-pool-cards" data-el="poolcards"></div>' +
        '</div>' +
      '</div>' +
      '<div class="zu-p-feedback" data-el="feedback"></div>' +
      '<div class="zu-p-score" data-el="score"></div>' +
    '</div>';
  const titleEl = root.querySelector('[data-el="title"]');
  const hintEl = root.querySelector('[data-el="hint"]');
  const boardEl = root.querySelector('[data-el="board"]');
  const leftsEl = root.querySelector('[data-el="lefts"]');
  const poolEl = root.querySelector('[data-el="pool"]');
  const poolCapEl = root.querySelector('[data-el="poolcap"]');
  const poolCardsEl = root.querySelector('[data-el="poolcards"]');
  const feedbackEl = root.querySelector('[data-el="feedback"]');
  const scoreEl = root.querySelector('[data-el="score"]');

  let placement = {};      // leftId -> rightId (lokale Quelle der Wahrheit)
  let lefts = [];          // [{id,text}]
  let rights = [];         // [{id,text}] in Anzeigereihenfolge
  let builtFor = '';       // Signatur, fuer die das Board zuletzt gebaut wurde
  let drag = null;         // laufender Drag-Zustand

  // Board (Slots + Pool + Karten) fuer die aktuelle Phase neu aufbauen.
  function buildBoard(phase, solution, distractors, locked) {
    const draggable = phase === 'matching' && !locked;
    zuFillBoard({ leftsEl, poolCardsEl, poolCapEl }, { lefts, rights, placement, phase, solution, distractors, draggable });
  }

  // --- Drag & Drop via Pointer Events ---------------------------------------
  function dropTargetAt(x, y) {
    if (drag && drag.ghost) drag.ghost.style.display = 'none';
    const el = document.elementFromPoint(x, y);
    if (drag && drag.ghost) drag.ghost.style.display = '';
    if (!el) return null;
    return el.closest('[data-drop]');
  }

  function clearHighlights() {
    root.querySelectorAll('.zu-dropzone.drag-over, .zu-pool.drag-over').forEach((e) => e.classList.remove('drag-over'));
  }

  function onPointerDown(e) {
    const card = e.target.closest('.zu-card.draggable');
    if (!card) return;
    const s = ctx.state();
    if (!s || s.game.locked) return;
    if (!s.game.zu || s.game.zu.phase !== 'matching') return;
    e.preventDefault();

    const rect = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.classList.add('zu-ghost');
    ghost.style.width = rect.width + 'px';
    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';
    document.body.appendChild(ghost);

    drag = {
      card, ghost, rightId: card.dataset.right,
      offX: e.clientX - rect.left, offY: e.clientY - rect.top
    };
    card.classList.add('dragging');
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
    clearHighlights();
    const t = dropTargetAt(e.clientX, e.clientY);
    if (t) t.classList.add('drag-over');
  }

  function onPointerUp(e) {
    if (!drag) return;
    const t = dropTargetAt(e.clientX, e.clientY);
    const rightId = drag.rightId;
    const card = drag.card;
    // Aufräumen
    card.classList.remove('dragging');
    card.removeEventListener('pointermove', onPointerMove);
    card.removeEventListener('pointerup', onPointerUp);
    card.removeEventListener('pointercancel', onPointerUp);
    if (drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
    clearHighlights();
    drag = null;

    if (!t) return;   // kein gültiges Ziel -> Karte bleibt, wo sie war

    const sourceLeft = Object.keys(placement).find((lid) => placement[lid] === rightId) || null;

    if (t.dataset.drop === 'slot') {
      const targetLeft = t.dataset.left;
      if (placement[targetLeft] === rightId) return;   // schon dort
      // evtl. dort liegende Karte verdrängen (zurück in den Pool)
      const displaced = placement[targetLeft] || null;
      if (sourceLeft) delete placement[sourceLeft];
      placement[targetLeft] = rightId;
      // DOM: Karte in die Zielzone; verdrängte Karte in den Pool
      const zone = leftsEl.querySelector('.zu-dropzone[data-left="' + targetLeft + '"]');
      if (displaced) {
        const dcard = zone.querySelector('.zu-card[data-right="' + displaced + '"]');
        if (dcard) poolCardsEl.appendChild(dcard);
      }
      zone.appendChild(card);
      refreshZoneStates();
      ctx.send({ type: 'assign', leftId: targetLeft, rightId });
    } else {
      // Pool: Karte aus ihrem Slot lösen
      if (sourceLeft) {
        delete placement[sourceLeft];
        poolCardsEl.appendChild(card);
        refreshZoneStates();
        ctx.send({ type: 'assign', leftId: sourceLeft, rightId: null });
      } else {
        poolCardsEl.appendChild(card);   // war eh im Pool
      }
    }
  }

  function refreshZoneStates() {
    leftsEl.querySelectorAll('.zu-dropzone').forEach((z) => {
      z.classList.toggle('filled', !!z.querySelector('.zu-card'));
    });
  }

  boardEl.addEventListener('pointerdown', onPointerDown);

  function update(s) {
    const zu = s.game.zu;
    if (!zu) return;
    titleEl.textContent = zu.titel || '';
    titleEl.classList.toggle('hidden', !zu.titel);
    const pts = s.game.scores[ctx.clientId()] || 0;
    scoreEl.textContent = pts > 0 ? 'Deine Punkte: ' + pts : '';

    // Lobby / kein Board -> Wartezustand
    if (zu.phase !== 'matching' && zu.phase !== 'reveal') {
      builtFor = '';
      boardEl.classList.add('hidden');
      hintEl.textContent = 'Warte auf den Start …';
      feedbackEl.textContent = '';
      feedbackEl.className = 'zu-p-feedback';
      return;
    }
    boardEl.classList.remove('hidden');
    lefts = zu.lefts || [];
    rights = zu.rights || [];

    const locked = !!s.game.locked;
    const sig = zu.phase + '|' + lefts.map((l) => l.id).join(',') + '|' + rights.map((r) => r.id).join(',') + '|' + (locked ? 'L' : 'U');

    if (builtFor !== sig) {
      // Beim (Neu-)Aufbau die lokale Zuordnung aus der Server-Antwort übernehmen.
      placement = Object.assign({}, s.game.zuMyAnswer || {});
      buildBoard(zu.phase, zu.solution, zu.distractors, locked);
      refreshZoneStates();
      builtFor = sig;
    }

    // Hinweise + Feedback
    if (zu.phase === 'matching') {
      hintEl.textContent = 'Ziehe die Kärtchen auf die passenden Einträge.';
      const placed = Object.keys(placement).length;
      feedbackEl.className = 'zu-p-feedback';
      feedbackEl.textContent = placed + ' von ' + lefts.length + ' zugeordnet';
    } else {
      // reveal
      let correct = 0;
      lefts.forEach((l) => {
        const sol = zu.solution ? (zu.solution[l.id] || null) : null;
        const mine = (s.game.zuMyAnswer && s.game.zuMyAnswer[l.id]) || null;
        if (mine === sol) correct++;
      });
      hintEl.textContent = 'Auflösung – deine Treffer sind grün markiert.';
      feedbackEl.className = 'zu-p-feedback ' + (correct === lefts.length ? 'good' : 'false');
      feedbackEl.textContent = correct + ' von ' + lefts.length + ' richtig  ·  +' + (correct * (zu.punkte || 0));
    }
  }

  return {
    update,
    destroy() {
      boardEl.removeEventListener('pointerdown', onPointerDown);
      if (drag && drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
    }
  };
}

// --- Bildschirm: Board (Referenz) bzw. Auflösung + Bestenliste ----------------
function createZuScreen(root, ctx) {
  root.innerHTML =
    '<div class="zu-screen">' +
      '<div class="zu-s-title" data-el="title"></div>' +
      '<div class="zu-s-cols" data-el="cols">' +
        '<div class="zu-s-col"><div class="zu-s-head" data-el="lhead"></div><div class="zu-s-lefts" data-el="lefts"></div></div>' +
        '<div class="zu-s-col"><div class="zu-s-head" data-el="rhead"></div><div class="zu-s-rights" data-el="rights"></div></div>' +
      '</div>' +
      '<div class="zu-s-status" data-el="status"></div>' +
      '<div class="zu-s-live" data-el="live"></div>' +
      '<div class="mc-final" data-el="final">' +
        '<div class="mc-final-title">🏁 Endstand</div>' +
        '<div class="leaderboard"></div>' +
      '</div>' +
    '</div>';
  const titleEl = root.querySelector('[data-el="title"]');
  const colsEl = root.querySelector('[data-el="cols"]');
  const lheadEl = root.querySelector('[data-el="lhead"]');
  const rheadEl = root.querySelector('[data-el="rhead"]');
  const leftsEl = root.querySelector('[data-el="lefts"]');
  const rightsEl = root.querySelector('[data-el="rights"]');
  const statusEl = root.querySelector('[data-el="status"]');
  const liveEl = root.querySelector('[data-el="live"]');
  const finalEl = root.querySelector('[data-el="final"]');
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  function update(s) {
    const zu = s.game.zu;
    if (!zu) return;
    titleEl.textContent = zu.titel || 'Zuordnung';

    if (zu.phase !== 'matching' && zu.phase !== 'reveal') {
      colsEl.classList.add('hidden'); finalEl.classList.add('hidden');
      statusEl.classList.remove('hidden');
      statusEl.textContent = zu.total ? ('Gleich geht’s los … (' + zu.total + ' Zuordnungen)') : 'Keine Zuordnungen im Profil';
      return;
    }

    statusEl.classList.remove('hidden');
    const lefts = zu.lefts || [];
    const rights = zu.rights || [];
    const reveal = zu.phase === 'reveal';
    const masterOnly = !!(s.settings && s.settings.masterOnlyMode);
    // Nur-Master-Modus vor der Aufloesung: statt der reinen Referenzliste zeigt der
    // Bildschirm das Live-Board (s.u.) – identischer Inhalt, aber als Drag&Drop-
    // Board wie beim Spieler, daher bleibt die Liste hier ausgeblendet.
    colsEl.classList.toggle('hidden', masterOnly && !reveal);
    lheadEl.textContent = zu.linksLabel || '';
    rheadEl.textContent = zu.rechtsLabel || '';

    // Rechte Kärtchen: Buchstaben-Index (zum Vorlesen/Diskutieren im Raum).
    const letterOf = {};
    rights.forEach((r, i) => { letterOf[r.id] = LETTERS[i] || '?'; });

    // Linke Spalte
    leftsEl.innerHTML = '';
    lefts.forEach((l) => {
      const row = document.createElement('div');
      row.className = 'zu-s-item';
      if (reveal && zu.solution) {
        const rid = zu.solution[l.id] || null;
        const cnt = zu.correctCounts ? (zu.correctCounts[l.id] || 0) : 0;
        row.classList.add(rid ? 'has' : 'none');
        row.innerHTML = '<span class="zu-s-text">' + escapeHtml(l.text) + '</span>' +
          '<span class="zu-s-arrow">→</span>' +
          '<span class="zu-s-ans">' + (rid ? (letterOf[rid] + ' · ' + escapeHtml((rights.find((r) => r.id === rid) || {}).text || '')) : 'keine Verbindung') + '</span>' +
          '<span class="zu-s-cnt" title="richtig zugeordnet">' + cnt + '×</span>';
      } else {
        row.innerHTML = '<span class="zu-s-text">' + escapeHtml(l.text) + '</span>';
      }
      leftsEl.appendChild(row);
    });

    // Rechte Spalte (Kärtchen)
    rightsEl.innerHTML = '';
    rights.forEach((r) => {
      const isDist = reveal && zu.distractors && zu.distractors.indexOf(r.id) >= 0;
      const cell = document.createElement('div');
      cell.className = 'zu-s-card' + (isDist ? ' distractor' : '');
      cell.innerHTML = '<span class="zu-s-letter">' + letterOf[r.id] + '</span>' +
        '<span class="zu-s-ctext">' + escapeHtml(r.text) + '</span>' +
        (isDist ? '<span class="zu-s-dbadge">Ablenker</span>' : '');
      rightsEl.appendChild(cell);
    });

    if (reveal) {
      statusEl.textContent = '';
      finalEl.classList.remove('hidden');
      renderLeaderboard(finalEl, s);
    } else {
      finalEl.classList.add('hidden');
      statusEl.textContent = masterOnly ? '🎯 Der Master ordnet zu …' : '📱 Ordne am Handy zu!';
    }

    // Nur-Master-Modus: statt der Handy-Liste zeigt der Bildschirm live dasselbe
    // Drag&Drop-Board wie ein Spieler (s. zuFillBoard) – der Master zieht im
    // Master-Panel (mountPlayerProxy), das Ergebnis (game.zu.groupPick) landet
    // hier 1:1, aber rein zur Anzeige, ohne Teilnehmerbindung/Punktevergabe.
    if (!reveal && masterOnly) {
      liveEl.classList.remove('hidden');
      liveEl.innerHTML =
        '<div class="zu-s-livetitle">🗳️ Gruppen-Wahl</div>' +
        '<div class="zu-board zu-s-board">' +
          '<div class="zu-lefts" data-el="livelefts"></div>' +
          '<div class="zu-pool" data-drop="pool">' +
            '<div class="zu-pool-cap" data-el="livepoolcap"></div>' +
            '<div class="zu-pool-cards" data-el="livepoolcards"></div>' +
          '</div>' +
        '</div>';
      zuFillBoard({
        leftsEl: liveEl.querySelector('[data-el="livelefts"]'),
        poolCardsEl: liveEl.querySelector('[data-el="livepoolcards"]'),
        poolCapEl: liveEl.querySelector('[data-el="livepoolcap"]')
      }, {
        lefts, rights, placement: zu.groupPick, phase: 'matching', draggable: false,
        poolCapText: 'Noch offene Kärtchen'
      });
    } else {
      liveEl.classList.add('hidden');
      liveEl.innerHTML = '';
    }
  }

  return { update };
}

// --- Master: Ablaufsteuerung + Lösung + Zuordnungsstatus je Spieler -----------
function createZuMaster(root, ctx) {
  root.innerHTML =
    '<section class="panel">' +
      '<div class="phase-indicator" data-el="phase">–</div>' +
      '<div class="control-grid">' +
        '<button class="btn btn-primary big" data-act="zuStart">▶ Starten</button>' +
        '<button class="btn btn-warn big" data-act="zuReveal">💡 Auflösen</button>' +
        '<button class="btn btn-ghost" data-act="zuReset">↺ Zurücksetzen</button>' +
      '</div>' +
      '<p class="muted small" data-el="hint"></p>' +
    '</section>' +
    '<section class="panel">' +
      '<h3>Lösung</h3>' +
      '<div class="zu-m-solution" data-el="solution"></div>' +
    '</section>' +
    '<section class="panel" data-el="selfplaysec">' +
      '<h3>Nur-Master-Modus: selbst spielen</h3>' +
      '<p class="muted small">Ziehen wie am Spieler-Handy – ohne Teilnehmerbindung, keine Punktevergabe, live auf dem Bildschirm sichtbar.</p>' +
      '<div data-el="selfplay"></div>' +
    '</section>' +
    '<section class="panel">' +
      '<h3>Zuordnungen (<span data-el="acount">0</span>)</h3>' +
      '<div class="mc-m-players" data-el="players"></div>' +
    '</section>';

  const phaseEl = root.querySelector('[data-el="phase"]');
  const hintEl = root.querySelector('[data-el="hint"]');
  const solutionEl = root.querySelector('[data-el="solution"]');
  const playersEl = root.querySelector('[data-el="players"]');
  const acountEl = root.querySelector('[data-el="acount"]');
  const startBtn = root.querySelector('[data-act="zuStart"]');
  const revealBtn = root.querySelector('[data-act="zuReveal"]');
  const PHASE_LABEL = { lobby: '⚪ Bereit', matching: '🔗 Zuordnen läuft', reveal: '💡 Aufgelöst' };
  const selfplaySecEl = root.querySelector('[data-el="selfplaysec"]');
  const selfplay = mountPlayerProxy(root.querySelector('[data-el="selfplay"]'), ctx, createZuPlayer, {
    translate: (msg) => msg.type === 'assign' ? { action: 'zuGroupPick', leftId: msg.leftId, rightId: msg.rightId } : null,
    mirror: (game) => { game.zuMyAnswer = (game.zu && game.zu.groupPick) ? game.zu.groupPick : null; }
  });

  root.querySelectorAll('[data-act]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (b.dataset.act === 'zuReset' && !(await confirmModal('Spiel zurücksetzen? (Punkte bleiben erhalten)', { title: 'Zurücksetzen', okText: 'Zurücksetzen' }))) return;
      ctx.send({ type: 'master', action: b.dataset.act });
    });
  });

  function update(s) {
    const zu = s.game.zu || { phase: 'lobby', total: 0 };
    const admin = ctx.admin();
    const cfg = (admin && admin.zuCfg) || null;
    // Anzahl bewertbarer linker Slots aus der Konfig (auch in der Lobby korrekt).
    const totalLefts = cfg ? cfg.paare.filter((p) => p.links).length : zu.total;
    const phase = zu.phase;

    phaseEl.textContent = PHASE_LABEL[phase] || phase;
    startBtn.disabled = !(phase === 'lobby') || totalLefts === 0;
    revealBtn.disabled = phase !== 'matching';

    if (totalLefts === 0) {
      hintEl.textContent = 'Keine Zuordnungen in diesem Profil. Lege sie im Tab „🎲 Spiele" → „⚙️ Konfigurieren" an.';
    } else if (phase === 'lobby') {
      hintEl.textContent = totalLefts + ' Zuordnung' + (totalLefts === 1 ? '' : 'en') + ' bereit · ' + (cfg ? cfg.punkte : '?') + ' Punkte je Treffer.';
    } else if (phase === 'matching') {
      hintEl.textContent = 'Spieler ordnen am Handy zu. „Auflösen" wertet und vergibt Punkte.';
    } else {
      hintEl.textContent = 'Aufgelöst. „Zurücksetzen" für eine neue Runde.';
    }

    // Lösung (master-exklusiv über zuSolution). In der Lobby aus der Konfig ableiten.
    const lefts = zu.lefts && zu.lefts.length ? zu.lefts : null;
    const rights = zu.rights || [];
    const rTextOf = {};
    rights.forEach((r) => { rTextOf[r.id] = r.text; });
    solutionEl.innerHTML = '';
    if (lefts && s.game.zuSolution) {
      lefts.forEach((l) => {
        const rid = s.game.zuSolution[l.id] || null;
        const row = document.createElement('div');
        row.className = 'zu-m-srow' + (rid ? '' : ' none');
        row.innerHTML = '<span class="zu-m-l">' + escapeHtml(l.text) + '</span>' +
          '<span class="zu-m-arrow">→</span>' +
          '<span class="zu-m-r">' + (rid ? escapeHtml(rTextOf[rid] || '?') : '— keine Verbindung') + '</span>';
        solutionEl.appendChild(row);
      });
      const dist = s.game.zuDistractors || [];
      if (dist.length) {
        const d = document.createElement('div');
        d.className = 'zu-m-dist';
        d.textContent = 'Ablenker: ' + dist.map((id) => rTextOf[id] || '?').join(', ');
        solutionEl.appendChild(d);
      }
    } else if (cfg) {
      // Lobby: Vorschau aus der Konfig.
      cfg.paare.forEach((p) => {
        if (!p.links) return;
        const row = document.createElement('div');
        row.className = 'zu-m-srow' + (p.rechts ? '' : ' none');
        row.innerHTML = '<span class="zu-m-l">' + escapeHtml(p.links) + '</span>' +
          '<span class="zu-m-arrow">→</span>' +
          '<span class="zu-m-r">' + (p.rechts ? escapeHtml(p.rechts) : '— keine Verbindung') + '</span>';
        solutionEl.appendChild(row);
      });
      const dist = cfg.paare.filter((p) => !p.links && p.rechts).map((p) => p.rechts);
      if (dist.length) {
        const d = document.createElement('div');
        d.className = 'zu-m-dist';
        d.textContent = 'Ablenker: ' + dist.join(', ');
        solutionEl.appendChild(d);
      }
    } else {
      solutionEl.innerHTML = '<span class="muted">–</span>';
    }

    // Zuordnungsstatus je Spieler: platziert / (reveal) richtig.
    const players = (s.participants || []).filter((p) => p.role === 'player');
    const answers = s.game.zuAnswers || {};
    const solution = s.game.zuSolution || {};
    const nLefts = lefts ? lefts.length : totalLefts;
    acountEl.textContent = Object.keys(answers).length + (players.length ? ' / ' + players.length : '');
    playersEl.innerHTML = '';
    players.forEach((p) => {
      const map = answers[p.id] || {};
      const placed = Object.keys(map).length;
      let correct = 0;
      if (lefts) lefts.forEach((l) => { if (((map[l.id]) || null) === (solution[l.id] || null)) correct++; });
      const row = document.createElement('div');
      row.className = 'mc-m-prow' + (placed ? ' answered' : '') +
        (phase === 'reveal' ? (correct === nLefts ? ' correct' : (correct > 0 ? '' : ' wrong')) : '');
      const info = phase === 'reveal'
        ? correct + '/' + nLefts + ' ✓'
        : placed + '/' + nLefts;
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

