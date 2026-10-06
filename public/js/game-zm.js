'use strict';
// Spiel: Zeichenquiz ("Kritzelquiz") – Bildschirm/Spieler/Master-Module.

// ===========================================================================
// SPIEL: Zeichenquiz (zm) – ein Begriff wird gezeichnet, dann wird abgestimmt
// ===========================================================================

const ZM_COLORS = ['#1a1a1a', '#e11d48', '#2563eb', '#16a34a', '#f59e0b', '#7c3aed'];
const ZM_SIZES = [3, 6, 10, 16];
const ZM_UNDO_LIMIT = 20;

// Restsekunden aus einem Server-Deadline-Zeitstempel (oder null = kein Limit).
function zmSecondsLeft(deadline) {
  if (!deadline) return null;
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

// Skaliert ein Bildschirm-Element so herunter, dass es komplett ohne
// Scrollbalken in die verbleibende Vertikale passt (z.B. Auswertung mit
// vielen Zeichnungen). Skaliertes Element bleibt an seiner Layout-Position,
// nur die sichtbare (und damit fuer Overflow relevante) Groesse schrumpft.
function zmFitToViewport(el) {
  el.style.transform = '';
  requestAnimationFrame(() => {
    const rect = el.getBoundingClientRect();
    const avail = window.innerHeight - rect.top - 16;
    const natural = el.scrollHeight;
    el.style.transform = (avail > 0 && natural > avail)
      ? 'scale(' + Math.max(0.35, avail / natural) + ')'
      : '';
  });
}

// --- Spieler: Canvas zum Zeichnen, danach Abstimmungsgalerie, danach Ergebnis
function createZmPlayer(root, ctx) {
  root.className = 'game-mount';
  root.innerHTML =
    '<div class="zm-player">' +
      '<div class="zm-p-counter" data-el="counter"></div>' +
      '<div class="zm-p-begriff" data-el="begriff"></div>' +
      '<div class="zm-p-timer" data-el="timer"></div>' +
      '<div class="zm-draw" data-el="draw">' +
        '<canvas class="zm-canvas" data-el="canvas" width="600" height="450"></canvas>' +
        '<div class="zm-tools" data-el="tools">' +
          '<div class="zm-palette" data-el="palette"></div>' +
          '<div class="zm-sizes" data-el="sizes"></div>' +
          '<button class="btn btn-ghost small" data-act="eraser">🧹 Radierer</button>' +
          '<button class="btn btn-ghost small" data-act="undo">↩️ Rückgängig</button>' +
          '<button class="btn btn-ghost small" data-act="clear">🗑 Löschen</button>' +
          '<button class="btn btn-primary big" data-act="fertig">✔ Fertig</button>' +
        '</div>' +
        '<div class="zm-draw-status" data-el="drawstatus"></div>' +
      '</div>' +
      '<div class="zm-gallery zm-p-gallery" data-el="gallery"></div>' +
      '<div class="zm-results" data-el="results"></div>' +
      '<div class="mc-final" data-el="final">' +
        '<div class="mc-final-title">🏁 Endstand</div>' +
        '<div class="leaderboard"></div>' +
      '</div>' +
      '<div class="zm-p-score" data-el="score"></div>' +
    '</div>';

  const counterEl = root.querySelector('[data-el="counter"]');
  const begriffEl = root.querySelector('[data-el="begriff"]');
  const timerEl = root.querySelector('[data-el="timer"]');
  const drawEl = root.querySelector('[data-el="draw"]');
  const canvas = root.querySelector('[data-el="canvas"]');
  const drawStatusEl = root.querySelector('[data-el="drawstatus"]');
  const paletteEl = root.querySelector('[data-el="palette"]');
  const sizesEl = root.querySelector('[data-el="sizes"]');
  const galleryEl = root.querySelector('[data-el="gallery"]');
  const resultsEl = root.querySelector('[data-el="results"]');
  const finalEl = root.querySelector('[data-el="final"]');
  const scoreEl = root.querySelector('[data-el="score"]');
  const eraserBtn = root.querySelector('[data-act="eraser"]');
  const undoBtn = root.querySelector('[data-act="undo"]');
  const clearBtn = root.querySelector('[data-act="clear"]');
  const fertigBtn = root.querySelector('[data-act="fertig"]');

  const cx = canvas.getContext('2d');
  let color = ZM_COLORS[0];
  let brushSize = ZM_SIZES[1];
  let erasing = false;
  let drawing = false;
  let builtRound = null;      // Runden-Kennung (pos), fuer die die Canvas zuletzt geleert wurde
  let mySubmittedDataUrl = null; // eigenes zuletzt gesendetes Bild (fuer "das bin ich" in der Galerie)
  let undoStack = [];         // ImageData-Schnappschuesse vor jedem Strich/Löschen (Rückgängig)
  let raf = 0;

  function clearCanvas() {
    cx.fillStyle = '#ffffff';
    cx.fillRect(0, 0, canvas.width, canvas.height);
  }
  clearCanvas();

  // Vor jeder veraendernden Aktion (Strich, Löschen) den bisherigen Stand
  // sichern, damit "Rückgängig" ihn wiederherstellen kann.
  function pushUndoSnapshot() {
    try {
      undoStack.push(cx.getImageData(0, 0, canvas.width, canvas.height));
      if (undoStack.length > ZM_UNDO_LIMIT) undoStack.shift();
    } catch (err) {}
  }

  function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function strokeStart(e) {
    if (canvas.classList.contains('locked')) return;
    e.preventDefault();
    drawing = true;
    pushUndoSnapshot();
    const p = canvasPoint(e);
    cx.beginPath();
    cx.moveTo(p.x, p.y);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  }
  function strokeMove(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = canvasPoint(e);
    cx.lineCap = 'round';
    cx.lineJoin = 'round';
    cx.lineWidth = erasing ? brushSize * 4 : brushSize;
    cx.strokeStyle = erasing ? '#ffffff' : color;
    cx.lineTo(p.x, p.y);
    cx.stroke();
  }
  function strokeEnd() { drawing = false; }

  canvas.addEventListener('pointerdown', strokeStart);
  canvas.addEventListener('pointermove', strokeMove);
  canvas.addEventListener('pointerup', strokeEnd);
  canvas.addEventListener('pointercancel', strokeEnd);

  ZM_COLORS.forEach((c) => {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'zm-swatch';
    sw.style.setProperty('--sw-col', c);
    sw.addEventListener('click', () => {
      color = c;
      erasing = false;
      eraserBtn.classList.remove('active');
      paletteEl.querySelectorAll('.zm-swatch').forEach((s) => s.classList.remove('active'));
      sw.classList.add('active');
    });
    if (c === color) sw.classList.add('active');
    paletteEl.appendChild(sw);
  });

  ZM_SIZES.forEach((sz) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'zm-sizebtn';
    b.title = sz + 'px';
    b.innerHTML = '<span class="zm-sizedot" style="width:' + sz + 'px;height:' + sz + 'px"></span>';
    b.addEventListener('click', () => {
      brushSize = sz;
      sizesEl.querySelectorAll('.zm-sizebtn').forEach((s) => s.classList.remove('active'));
      b.classList.add('active');
    });
    if (sz === brushSize) b.classList.add('active');
    sizesEl.appendChild(b);
  });

  eraserBtn.addEventListener('click', () => {
    erasing = !erasing;
    eraserBtn.classList.toggle('active', erasing);
  });
  undoBtn.addEventListener('click', () => {
    if (canvas.classList.contains('locked')) return;
    const snap = undoStack.pop();
    if (snap) cx.putImageData(snap, 0, 0);
  });
  clearBtn.addEventListener('click', () => {
    if (canvas.classList.contains('locked')) return;
    pushUndoSnapshot();
    clearCanvas();
  });

  function submitDrawing() {
    if (canvas.classList.contains('locked')) return;
    const dataUrl = canvas.toDataURL('image/png');
    mySubmittedDataUrl = dataUrl;
    ctx.send({ type: 'zmSubmit', data: dataUrl });
    canvas.classList.add('locked');
  }
  fertigBtn.addEventListener('click', submitDrawing);

  function tick() {
    raf = 0;
    const s = ctx.state();
    const zm = s && s.game && s.game.zm;
    if (!zm || zm.phase !== 'drawing' || !zm.deadline) return;
    const left = zmSecondsLeft(zm.deadline);
    timerEl.textContent = '⏱ ' + left + 's';
    if (left <= 0) {
      if (!s.game.zmMySubmitted) submitDrawing();
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  function update(s) {
    const zm = s.game.zm;
    if (!zm) return;
    const pts = s.game.scores[ctx.clientId()] || 0;
    scoreEl.textContent = pts > 0 ? 'Deine Punkte: ' + pts : '';

    counterEl.textContent = (zm.phase === 'lobby' || zm.phase === 'done')
      ? (zm.total ? zm.total + ' Begriffe' : '')
      : 'Begriff ' + zm.pos + ' / ' + zm.total;

    drawEl.classList.add('hidden');
    galleryEl.classList.add('hidden');
    resultsEl.classList.add('hidden');
    finalEl.classList.add('hidden');

    if (zm.phase === 'lobby') {
      begriffEl.textContent = 'Warte auf den Start …';
      timerEl.textContent = '';
      return;
    }

    if (zm.phase === 'done') {
      begriffEl.textContent = '🏁 Geschafft!';
      timerEl.textContent = '';
      finalEl.classList.remove('hidden');
      renderLeaderboard(finalEl, s);
      return;
    }

    if (zm.phase === 'drawing') {
      drawEl.classList.remove('hidden');
      begriffEl.textContent = zm.begriff || '';
      const submitted = !!s.game.zmMySubmitted;
      if (builtRound !== zm.pos) {
        builtRound = zm.pos;
        mySubmittedDataUrl = null;
        undoStack = [];
        clearCanvas();
      }
      canvas.classList.toggle('locked', submitted || !!s.game.locked);
      fertigBtn.disabled = submitted || !!s.game.locked;
      drawStatusEl.textContent = submitted
        ? 'Abgegeben – warte auf die anderen … (' + (zm.submittedCount || 0) + ' bisher)'
        : '';
      if (zm.deadline && !raf) raf = requestAnimationFrame(tick);
      else if (!zm.deadline) timerEl.textContent = '';
      return;
    }

    if (zm.phase === 'voting') {
      galleryEl.classList.remove('hidden');
      begriffEl.textContent = zm.begriff || '';
      timerEl.textContent = '';
      const myVoteSlot = s.game.zmMyVote != null ? s.game.zmMyVote : null;
      galleryEl.innerHTML = '';
      (zm.entries || []).forEach((entry) => {
        const isMine = mySubmittedDataUrl && entry.image === mySubmittedDataUrl;
        const isVoted = myVoteSlot === entry.slotIdx;
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'zm-thumb' + (isMine ? ' mine' : '') + (isVoted ? ' voted' : '');
        cell.disabled = isMine;
        cell.innerHTML = (entry.image ? '<img src="' + entry.image + '" alt="Zeichnung">' : '') +
          (isMine ? '<span class="zm-thumb-tag">Deine Zeichnung</span>' : '') +
          (isVoted ? '<span class="zm-thumb-check">✔</span>' : '');
        if (!cell.disabled) {
          cell.addEventListener('click', () => ctx.send({ type: 'zmVote', slotIdx: entry.slotIdx }));
        }
        galleryEl.appendChild(cell);
      });
      if (!(zm.entries || []).length) {
        galleryEl.innerHTML = '<p class="muted small">Keine Zeichnungen abgegeben.</p>';
      } else {
        const hint = document.createElement('p');
        hint.className = 'muted small zm-vote-hint';
        hint.textContent = myVoteSlot != null ? 'Du kannst deine Wahl bis zur Auswertung ändern.' : 'Wähle deinen Favoriten.';
        galleryEl.appendChild(hint);
      }
      return;
    }

    if (zm.phase === 'reveal') {
      resultsEl.classList.remove('hidden');
      begriffEl.textContent = zm.begriff || '';
      timerEl.textContent = '';
      resultsEl.innerHTML = '';
      (zm.results || []).forEach((r, i) => {
        const row = document.createElement('div');
        row.className = 'zm-result-row' + (i === 0 ? ' winner' : '');
        row.innerHTML =
          (r.image ? '<img class="zm-result-thumb" src="' + r.image + '" alt="">' : '') +
          '<span class="zm-result-name">' + avatarChip(r) + escapeHtml(r.name) + '</span>' +
          '<span class="zm-result-votes">🗳️ ' + r.votes + '</span>' +
          '<span class="zm-result-pts">+' + r.points + '</span>';
        resultsEl.appendChild(row);
      });
      return;
    }
  }

  return {
    update,
    destroy() { if (raf) cancelAnimationFrame(raf); }
  };
}

// --- Bildschirm: Begriff + Countdown/Abgabestand, Galerie, Rangliste --------
function createZmScreen(root, ctx) {
  root.innerHTML =
    '<div class="zm-screen">' +
      '<div class="mc-topline"><span class="mc-intro" data-el="intro"></span>' +
        '<span class="mc-counter" data-el="counter"></span></div>' +
      '<div class="zm-s-begriff" data-el="begriff"></div>' +
      '<div class="zm-s-status" data-el="status"></div>' +
      '<div class="zm-gallery zm-s-gallery" data-el="gallery"></div>' +
      '<div class="zm-results zm-s-results" data-el="results">' +
        '<div class="zm-s-winners" data-el="winners"></div>' +
        '<div class="zm-s-resultlist" data-el="resultlist"></div>' +
      '</div>' +
      '<div class="mc-final" data-el="final">' +
        '<div class="mc-final-title">🏁 Endstand</div>' +
        '<div class="leaderboard"></div>' +
      '</div>' +
    '</div>';
  const introEl = root.querySelector('[data-el="intro"]');
  const counterEl = root.querySelector('[data-el="counter"]');
  const begriffEl = root.querySelector('[data-el="begriff"]');
  const statusEl = root.querySelector('[data-el="status"]');
  const galleryEl = root.querySelector('[data-el="gallery"]');
  const resultsEl = root.querySelector('[data-el="results"]');
  const winnersEl = root.querySelector('[data-el="winners"]');
  const resultlistEl = root.querySelector('[data-el="resultlist"]');
  const finalEl = root.querySelector('[data-el="final"]');
  let raf = 0;

  function tick() {
    raf = 0;
    const s = ctx.state();
    const zm = s && s.game && s.game.zm;
    if (!zm || zm.phase !== 'drawing' || !zm.deadline) return;
    statusEl.textContent = '⏱ ' + zmSecondsLeft(zm.deadline) + 's · ' + (zm.submittedCount || 0) + ' Zeichnung' + ((zm.submittedCount || 0) === 1 ? '' : 'en') + ' abgegeben';
    raf = requestAnimationFrame(tick);
  }

  function update(s) {
    const zm = s.game.zm;
    if (!zm) return;
    introEl.textContent = zm.intro || '';

    galleryEl.classList.add('hidden');
    resultsEl.classList.add('hidden');
    finalEl.classList.add('hidden');
    begriffEl.classList.remove('hidden');
    statusEl.classList.remove('hidden');

    if (zm.phase === 'lobby') {
      counterEl.textContent = zm.total ? zm.total + ' Begriffe' : '';
      begriffEl.textContent = 'Gleich geht’s los …';
      statusEl.textContent = '';
      return;
    }
    if (zm.phase === 'done') {
      counterEl.textContent = zm.total + ' Begriffe';
      begriffEl.classList.add('hidden'); statusEl.classList.add('hidden');
      finalEl.classList.remove('hidden');
      renderLeaderboard(finalEl, s);
      return;
    }

    counterEl.textContent = 'Begriff ' + zm.pos + ' / ' + zm.total;
    begriffEl.textContent = zm.begriff || '';

    if (zm.phase === 'drawing') {
      statusEl.textContent = (zm.submittedCount || 0) + ' Zeichnung' + ((zm.submittedCount || 0) === 1 ? '' : 'en') + ' abgegeben';
      if (zm.deadline && !raf) raf = requestAnimationFrame(tick);
      return;
    }

    statusEl.classList.add('hidden');
    if (zm.phase === 'voting') {
      galleryEl.classList.remove('hidden');
      galleryEl.innerHTML = '';
      (zm.entries || []).forEach((entry) => {
        const cell = document.createElement('div');
        cell.className = 'zm-thumb';
        cell.innerHTML = entry.image ? '<img src="' + entry.image + '" alt="Zeichnung">' : '';
        galleryEl.appendChild(cell);
      });
      statusEl.classList.remove('hidden');
      statusEl.textContent = (zm.voteCount || 0) + ' / ' + (zm.voterTotal || 0) + ' Stimmen';
      zmFitToViewport(galleryEl);
      return;
    }
    if (zm.phase === 'reveal') {
      resultsEl.classList.remove('hidden');
      const results = zm.results || [];
      const maxVotes = results.length ? results[0].votes : 0;
      // bei Unentschieden um Platz 1 zeigen wir alle Erstplatzierten gross nebeneinander
      const winners = maxVotes > 0 ? results.filter((r) => r.votes === maxVotes) : [];
      winnersEl.classList.toggle('hidden', winners.length === 0);
      winnersEl.innerHTML = '';
      winners.forEach((r) => {
        const card = document.createElement('div');
        card.className = 'zm-s-winner-card';
        card.innerHTML =
          (r.image ? '<img class="zm-s-winner-img" src="' + r.image + '" alt="">' : '') +
          '<div class="zm-s-winner-name">' + avatarChip(r) + escapeHtml(r.name) + '</div>' +
          '<div class="zm-s-winner-votes">🗳️ ' + r.votes + ' · +' + r.points + '</div>';
        winnersEl.appendChild(card);
      });
      resultlistEl.innerHTML = '';
      results.forEach((r) => {
        const row = document.createElement('div');
        row.className = 'zm-result-row' + (maxVotes > 0 && r.votes === maxVotes ? ' winner' : '');
        row.innerHTML =
          (r.image ? '<img class="zm-result-thumb" src="' + r.image + '" alt="">' : '') +
          '<span class="zm-result-name">' + avatarChip(r) + escapeHtml(r.name) + '</span>' +
          '<span class="zm-result-votes">🗳️ ' + r.votes + '</span>' +
          '<span class="zm-result-pts">+' + r.points + '</span>';
        resultlistEl.appendChild(row);
      });
      zmFitToViewport(resultsEl);
    }
  }

  return {
    update,
    destroy() { if (raf) cancelAnimationFrame(raf); }
  };
}

// --- Master: Ablaufsteuerung + Live-Abgabenliste (Avatar-Chip + Mini-Bild) --
function createZmMaster(root, ctx) {
  root.innerHTML =
    '<section class="panel">' +
      '<div class="phase-indicator" data-el="phase">–</div>' +
      '<div class="control-grid">' +
        '<button class="btn btn-primary big" data-act="zmStart">▶ Starten</button>' +
        '<button class="btn btn-warn big" data-act="zmToVoting">🗳 Zur Abstimmung</button>' +
        '<button class="btn btn-warn" data-act="zmReveal">📢 Auswerten</button>' +
        '<button class="btn btn-success" data-act="zmNext">⏭ Nächste Runde</button>' +
        '<button class="btn btn-ghost" data-act="zmReset">↺ Zurücksetzen</button>' +
      '</div>' +
      '<p class="muted small" data-el="hint"></p>' +
    '</section>' +
    '<section class="panel">' +
      '<h3>Begriff (<span data-el="prog">0/0</span>)</h3>' +
      '<div class="zm-m-begriff" data-el="begriff"></div>' +
    '</section>' +
    '<section class="panel">' +
      '<h3>Abgaben (<span data-el="acount">0</span>)</h3>' +
      '<div class="zm-m-players" data-el="players"></div>' +
    '</section>';

  const phaseEl = root.querySelector('[data-el="phase"]');
  const hintEl = root.querySelector('[data-el="hint"]');
  const progEl = root.querySelector('[data-el="prog"]');
  const begriffEl = root.querySelector('[data-el="begriff"]');
  const acountEl = root.querySelector('[data-el="acount"]');
  const playersEl = root.querySelector('[data-el="players"]');
  const startBtn = root.querySelector('[data-act="zmStart"]');
  const votingBtn = root.querySelector('[data-act="zmToVoting"]');
  const revealBtn = root.querySelector('[data-act="zmReveal"]');
  const nextBtn = root.querySelector('[data-act="zmNext"]');
  const PHASE_LABEL = { lobby: '⚪ Bereit', drawing: '✏️ Zeichnen', voting: '🗳 Abstimmung', reveal: '📢 Aufgelöst', done: '🏁 Endstand' };

  root.querySelectorAll('[data-act]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (b.dataset.act === 'zmReset' && !(await confirmModal('Quiz zurücksetzen? (Punkte bleiben erhalten)', { title: 'Zurücksetzen', okText: 'Zurücksetzen' }))) return;
      ctx.send({ type: 'master', action: b.dataset.act });
    });
  });

  function update(s) {
    const zm = s.game.zm || { phase: 'lobby', total: 0 };
    const admin = ctx.admin();
    const cfg = (admin && admin.zmCfg) || null;
    const totalC = cfg ? cfg.begriffe.length : zm.total;
    const phase = zm.phase;

    phaseEl.textContent = PHASE_LABEL[phase] || phase;
    progEl.textContent = (phase === 'lobby' || phase === 'done') ? (totalC + ' Begriffe') : (zm.pos + '/' + zm.total);

    const isLast = zm.pos >= zm.total;
    nextBtn.textContent = (phase === 'reveal' && isLast) ? '🏁 Endstand' : '⏭ Nächste Runde';

    startBtn.disabled = phase !== 'lobby' || totalC === 0;
    votingBtn.disabled = phase !== 'drawing';
    revealBtn.disabled = phase !== 'voting';
    nextBtn.disabled = phase !== 'reveal';

    if (totalC === 0) {
      hintEl.textContent = 'Keine Begriffe in diesem Profil. Lege sie im Tab „🎲 Spiele" → „⚙️ Konfigurieren" an.';
    } else if (phase === 'lobby') {
      hintEl.textContent = totalC + ' Begriff' + (totalC === 1 ? '' : 'e') + ' bereit' + (cfg && cfg.zeitlimit ? ' · ' + cfg.zeitlimit + 's Zeitlimit' : ' · kein Zeitlimit');
    } else if (phase === 'drawing') {
      hintEl.textContent = 'Spieler zeichnen am Handy. „Zur Abstimmung" beendet die Runde vorzeitig.';
    } else if (phase === 'voting') {
      hintEl.textContent = 'Spieler stimmen für ihre Favoriten. „Auswerten" vergibt die Punkte.';
    } else if (phase === 'reveal') {
      hintEl.textContent = isLast ? 'Letzte Runde – „Endstand" zeigt die Gesamtwertung.' : '„Nächste Runde" geht weiter.';
    } else {
      hintEl.textContent = 'Quiz beendet. „Zurücksetzen" für einen neuen Durchlauf.';
    }

    begriffEl.textContent = (phase === 'drawing' || phase === 'voting' || phase === 'reveal') ? (zm.begriff || '') : '–';

    const players = (s.participants || []).filter((p) => p.role === 'player');
    const drawings = s.game.zmDrawings || {};
    const results = zm.results || [];
    const resultById = {};
    results.forEach((r) => { resultById[r.id] = r; });
    acountEl.textContent = Object.keys(drawings).length + (players.length ? ' / ' + players.length : '');
    playersEl.innerHTML = '';
    players.forEach((p) => {
      const img = drawings[p.id];
      const res = resultById[p.id];
      const row = document.createElement('div');
      row.className = 'zm-m-prow' + (img ? ' has' : '');
      row.innerHTML =
        '<span class="dev-dot' + (p.online ? ' online' : '') + '"><span class="led"></span></span>' +
        (img ? '<img class="zm-m-thumb" src="' + img + '" alt="">' : '<span class="zm-m-thumb empty"></span>') +
        avatarChip(p) +
        '<span class="zm-m-pname">' + escapeHtml(p.name) + '</span>' +
        '<span class="zm-m-pstat">' + (res ? ('🗳️ ' + res.votes + ' · +' + res.points) : (img ? 'abgegeben' : '–')) + '</span>';
      playersEl.appendChild(row);
    });
    if (players.length === 0) playersEl.innerHTML = '<p class="muted small">Noch keine Spieler verbunden.</p>';
  }

  return { update };
}
