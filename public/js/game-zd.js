'use strict';
// Spiel: Zeitdruck – Bildschirm/Spieler/Master-Module (baut auf MC-Technik).

// ===========================================================================
// SPIEL: Zeitdruck – rollenspezifische Oberflaechen (baut auf der MC-Technik auf)
// ===========================================================================
// Punktwert lokal berechnen: linearer Verfall bis zum Boden. Muss zur Server-
// Formel (zdPointsFor) passen; die Zeit misst jedes Geraet selbst (Fairness).
function zdLivePoints(zd, elapsedMs) {
  let p = zd.startPoints - zd.drainPerSec * (Math.max(0, elapsedMs) / 1000);
  p = Math.round(p);
  if (p < zd.minPoints) p = zd.minPoints;
  if (p > zd.startPoints) p = zd.startPoints;
  return p;
}

// --- Bildschirm: grosser Live-Punktezaehler + Frage + Antwort-Kacheln --------
function createZdScreen(root, ctx) {
  root.innerHTML =
    '<div class="mc-screen zd-screen">' +
      '<div class="mc-topline"><span class="mc-intro" data-el="intro"></span>' +
        '<span class="mc-counter" data-el="counter"></span></div>' +
      '<div class="zd-points" data-el="points"></div>' +
      '<div class="zd-points-cap" data-el="pcap"></div>' +
      '<div class="mc-question" data-el="question"></div>' +
      '<div class="mc-answers" data-el="answers"></div>' +
      '<div class="mc-answered" data-el="answered"></div>' +
      '<div class="mc-group-pick" data-el="grouppick"></div>' +
      '<div class="mc-final" data-el="final">' +
        '<div class="mc-final-title">🏁 Endstand</div>' +
        '<div class="leaderboard"></div>' +
      '</div>' +
    '</div>';
  const introEl = root.querySelector('[data-el="intro"]');
  const counterEl = root.querySelector('[data-el="counter"]');
  const pointsEl = root.querySelector('[data-el="points"]');
  const pcapEl = root.querySelector('[data-el="pcap"]');
  const qEl = root.querySelector('[data-el="question"]');
  const ansEl = root.querySelector('[data-el="answers"]');
  const answeredEl = root.querySelector('[data-el="answered"]');
  const groupPickEl = root.querySelector('[data-el="grouppick"]');
  const finalEl = root.querySelector('[data-el="final"]');
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
  let lastState = null;
  let qKey = null;        // aktuelle Frage-Kennung (Nummer) fuer Timer-Reset
  let startTime = 0;      // lokaler Fragenstart (performance.now)
  let raf = 0;

  function tick() {
    raf = 0;
    const s = lastState; if (!s) return;
    const zd = s.game.zd; if (!zd || zd.phase !== 'question') return;
    const val = zdLivePoints(zd, performance.now() - startTime);
    pointsEl.textContent = val;
    pointsEl.classList.toggle('low', val <= zd.minPoints);
    raf = requestAnimationFrame(tick);
  }

  function update(s) {
    lastState = s;
    const zd = s.game.zd;
    if (!zd) return;
    introEl.textContent = zd.intro || '';

    // Endstand
    if (zd.phase === 'done') {
      qKey = null;
      qEl.classList.add('hidden'); ansEl.classList.add('hidden'); answeredEl.classList.add('hidden');
      pointsEl.classList.add('hidden'); pcapEl.classList.add('hidden'); groupPickEl.classList.add('hidden');
      counterEl.textContent = zd.total + ' Fragen';
      finalEl.classList.remove('hidden');
      renderLeaderboard(finalEl, s);
      return;
    }
    finalEl.classList.add('hidden');

    // Lobby (noch nicht gestartet) -> Dummy-Frage + Punkte-Vorschau, Layout steht
    if (zd.phase === 'lobby' || !zd.question) {
      qKey = null;
      counterEl.textContent = zd.total ? (zd.total + ' Fragen') : '';
      qEl.classList.remove('hidden'); ansEl.classList.remove('hidden');
      answeredEl.classList.remove('hidden'); answeredEl.textContent = '';
      groupPickEl.classList.add('hidden');
      pointsEl.classList.remove('hidden', 'low'); pointsEl.classList.add('dummy');
      pointsEl.textContent = zd.startPoints;
      pcapEl.classList.remove('hidden'); pcapEl.textContent = 'Startpunkte';
      renderQuizDummy(qEl, ansEl);
      return;
    }

    // Frage-/Aufloesungsphase
    qEl.classList.remove('hidden'); ansEl.classList.remove('hidden');
    pointsEl.classList.remove('dummy');
    counterEl.textContent = 'Frage ' + zd.number + ' / ' + zd.total;
    qEl.textContent = zd.question;

    // Neue Frage? -> lokalen Zeitpunkt merken (Zaehler startet bei Startpunkten)
    if (qKey !== zd.number) { qKey = zd.number; startTime = performance.now(); }

    const reveal = zd.phase === 'reveal';
    const totalVotes = reveal && zd.dist ? zd.dist.reduce((a, b) => a + b, 0) : 0;
    ansEl.innerHTML = '';
    (zd.answers || []).forEach((text, i) => {
      const cell = document.createElement('div');
      let cls = 'mc-cell';
      if (reveal) { cls += (i === zd.correct) ? ' correct' : ' dim'; }
      else if (zd.groupPick && i === zd.groupPick.option) { cls += ' chosen'; }
      cell.className = cls;
      const votes = reveal && zd.dist ? (zd.dist[i] || 0) : 0;
      const pct = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
      cell.innerHTML =
        (reveal ? '<span class="mc-bar" style="width:' + pct + '%"></span>' : '') +
        '<span class="mc-letter">' + LETTERS[i] + '</span>' +
        '<span class="mc-atext">' + escapeHtml(text) + '</span>' +
        (reveal ? '<span class="mc-votes">' + votes + '</span>' : '');
      ansEl.appendChild(cell);
    });

    // Antwort-Zaehler-Zeile bleibt immer sichtbar (leer bei reveal), Layout stabil.
    answeredEl.classList.remove('hidden');
    if (reveal) {
      // Aufgeloest: kein laufender Zaehler mehr, Boden-Punkte einfrieren.
      pointsEl.classList.remove('hidden', 'low'); pcapEl.classList.remove('hidden');
      pointsEl.textContent = '⏱';
      pcapEl.textContent = 'Aufgelöst';
      answeredEl.textContent = '';
      groupPickEl.classList.add('hidden');
    } else {
      pointsEl.classList.remove('hidden'); pcapEl.classList.remove('hidden');
      pcapEl.textContent = 'Punkte JETZT';
      answeredEl.textContent = zd.answeredCount + ' Antwort' + (zd.answeredCount === 1 ? '' : 'en') + ' abgegeben';
      if (!raf) raf = requestAnimationFrame(tick);   // Live-Countdown

      // Live-Tendenz der Allgemeinheit (Master-Auswahl ohne Teilnehmerbindung).
      if (zd.groupPick && zd.answers[zd.groupPick.option] != null) {
        groupPickEl.classList.remove('hidden');
        groupPickEl.textContent = '🗳️ Die Allgemeinheit einigt sich auf: ' +
          LETTERS[zd.groupPick.option] + ' – ' + zd.answers[zd.groupPick.option];
      } else {
        groupPickEl.classList.add('hidden');
      }
    }
  }

  return { update, destroy() { if (raf) cancelAnimationFrame(raf); } };
}

// --- Spieler: Live-Punktezaehler + Antwort-Buttons + eingefrorene Punkte -----
function createZdPlayer(root, ctx) {
  root.innerHTML =
    '<div class="mc-player zd-player">' +
      '<div class="mc-p-counter" data-el="counter"></div>' +
      '<div class="zd-p-points" data-el="points"></div>' +
      '<div class="mc-p-question" data-el="question"></div>' +
      '<div class="mc-p-answers" data-el="answers"></div>' +
      '<div class="mc-p-feedback" data-el="feedback"></div>' +
      '<div class="mc-p-score" data-el="score"></div>' +
    '</div>';
  const counterEl = root.querySelector('[data-el="counter"]');
  const pointsEl = root.querySelector('[data-el="points"]');
  const qEl = root.querySelector('[data-el="question"]');
  const ansEl = root.querySelector('[data-el="answers"]');
  const fbEl = root.querySelector('[data-el="feedback"]');
  const scoreEl = root.querySelector('[data-el="score"]');
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
  let lastState = null;
  let qKey = null;        // aktuelle Frage-Kennung fuer Timer-Reset
  let startTime = 0;      // lokaler Fragenstart (performance.now)
  let raf = 0;

  function tick() {
    raf = 0;
    const s = lastState; if (!s) return;
    const zd = s.game.zd; if (!zd || zd.phase !== 'question') return;
    if (s.game.zdMyAnswer != null) return;   // schon geantwortet -> eingefroren
    const val = zdLivePoints(zd, performance.now() - startTime);
    pointsEl.textContent = val;
    pointsEl.classList.toggle('low', val <= zd.minPoints);
    raf = requestAnimationFrame(tick);
  }

  function update(s) {
    lastState = s;
    const zd = s.game.zd;
    if (!zd) return;
    const myAnswer = s.game.zdMyAnswer || null;
    const pts = s.game.scores[ctx.clientId()] || 0;
    scoreEl.textContent = pts > 0 ? 'Deine Punkte: ' + pts : '';

    // Lobby / Endstand -> keine Buttons
    if (zd.phase === 'lobby') {
      qKey = null;
      counterEl.textContent = '';
      pointsEl.textContent = ''; pointsEl.className = 'zd-p-points';
      qEl.textContent = 'Warte auf den Start …';
      ansEl.innerHTML = ''; fbEl.textContent = ''; fbEl.className = 'mc-p-feedback';
      return;
    }
    if (zd.phase === 'done') {
      qKey = null;
      counterEl.textContent = 'Quiz beendet';
      pointsEl.textContent = ''; pointsEl.className = 'zd-p-points';
      qEl.textContent = '🏁 Geschafft!';
      ansEl.innerHTML = '';
      fbEl.className = 'mc-p-feedback';
      fbEl.textContent = pts > 0 ? 'Du hast ' + pts + ' Punkte geholt.' : '';
      return;
    }

    counterEl.textContent = 'Frage ' + zd.number + ' / ' + zd.total;
    qEl.textContent = zd.question || '';

    // Neue Frage? -> lokalen Zeitpunkt merken
    if (qKey !== zd.number) { qKey = zd.number; startTime = performance.now(); }

    const reveal = zd.phase === 'reveal';
    const locked = !!s.game.locked;

    // Punkteanzeige: eingefroren (nach Antwort) oder live (waehrend Frage)
    pointsEl.className = 'zd-p-points';
    if (myAnswer) {
      pointsEl.textContent = myAnswer.points;
      pointsEl.classList.add('locked');
    } else if (reveal) {
      pointsEl.textContent = '–';
    }
    // (der Live-Wert wird sonst von tick() gesetzt)

    // Antwort-Buttons
    ansEl.innerHTML = '';
    (zd.answers || []).forEach((text, i) => {
      const btn = document.createElement('button');
      let cls = 'mc-choice';
      const chosen = myAnswer && myAnswer.option === i;
      if (reveal) {
        if (i === zd.correct) cls += ' correct';
        else if (chosen) cls += ' wrong';
        else cls += ' dim';
      } else if (chosen) {
        cls += ' chosen';
      }
      btn.className = cls;
      btn.innerHTML = '<span class="mc-letter">' + LETTERS[i] + '</span>' +
        '<span class="mc-atext">' + escapeHtml(text) + '</span>';
      btn.disabled = reveal || myAnswer != null || locked;
      if (!btn.disabled) {
        btn.addEventListener('click', () => {
          if (s.game.zdMyAnswer != null) return;
          const elapsedMs = performance.now() - startTime;
          ctx.send({ type: 'answer', option: i, elapsedMs });
        });
      }
      ansEl.appendChild(btn);
    });

    // Feedback
    fbEl.className = 'mc-p-feedback';
    if (reveal) {
      if (!myAnswer) { fbEl.textContent = 'Keine Antwort'; fbEl.classList.add('miss'); }
      else if (myAnswer.option === zd.correct) { fbEl.textContent = '✓ Richtig! +' + myAnswer.points; fbEl.classList.add('good'); }
      else { fbEl.textContent = '✗ Leider falsch'; fbEl.classList.add('false'); }
    } else if (myAnswer) {
      fbEl.textContent = '🔒 Gesichert: ' + myAnswer.points + ' Punkte';
    } else {
      fbEl.textContent = 'Schnell wählen – der Zähler läuft!';
    }

    // Live-Countdown starten (nur Fragephase, noch nicht geantwortet)
    if (zd.phase === 'question' && !myAnswer && !raf) raf = requestAnimationFrame(tick);
  }

  return { update, destroy() { if (raf) cancelAnimationFrame(raf); } };
}

// --- Master: Ablaufsteuerung + aktuelle Frage (mit Loesung) + Antwortstatus --
function createZdMaster(root, ctx) {
  root.innerHTML =
    '<section class="panel">' +
      '<div class="phase-indicator" data-el="phase">–</div>' +
      '<div class="control-grid">' +
        '<button class="btn btn-primary big" data-act="zdStart">▶ Quiz starten</button>' +
        '<button class="btn btn-warn big" data-act="zdReveal">💡 Auflösen</button>' +
        '<button class="btn btn-success" data-act="zdNext">⏭ Weiter</button>' +
        '<button class="btn btn-ghost" data-act="zdReset">↺ Zurücksetzen</button>' +
      '</div>' +
      '<p class="muted small" data-el="hint"></p>' +
    '</section>' +
    '<section class="panel">' +
      '<h3>Aktuelle Frage <span class="muted small">(nur für dich, zum Vorlesen)</span></h3>' +
      '<div class="mc-m-question" data-el="question"></div>' +
      '<div class="mc-m-answers" data-el="answers"></div>' +
      '<p class="muted small" data-el="grouphint">Antwort anklicken: „Die Allgemeinheit einigt sich auf …" – bis zur Auflösung änderbar.</p>' +
    '</section>' +
    '<section class="panel">' +
      '<h3>Antworten (<span data-el="acount">0</span>)</h3>' +
      '<div class="mc-m-players" data-el="players"></div>' +
    '</section>';

  const phaseEl = root.querySelector('[data-el="phase"]');
  const hintEl = root.querySelector('[data-el="hint"]');
  const qEl = root.querySelector('[data-el="question"]');
  const ansEl = root.querySelector('[data-el="answers"]');
  const playersEl = root.querySelector('[data-el="players"]');
  const acountEl = root.querySelector('[data-el="acount"]');
  const grouphintEl = root.querySelector('[data-el="grouphint"]');
  const startBtn = root.querySelector('[data-act="zdStart"]');
  const revealBtn = root.querySelector('[data-act="zdReveal"]');
  const nextBtn = root.querySelector('[data-act="zdNext"]');
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
  const PHASE_LABEL = { lobby: '⚪ Bereit', question: '❓ Frage läuft', reveal: '💡 Aufgelöst', done: '🏁 Endstand' };
  let qKey = null;        // aktuelle Frage-Kennung fuer Timer-Reset (Nur-Master-Klick)
  let startTime = 0;      // lokaler Fragenstart (performance.now), fuer elapsedMs beim Klick

  root.querySelectorAll('[data-act]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (b.dataset.act === 'zdReset' && !(await confirmModal('Quiz zurücksetzen? (Punkte bleiben erhalten)', { title: 'Zurücksetzen', okText: 'Zurücksetzen' }))) return;
      // Weiter vor dem Auflösen = Frage ohne Punkte überspringen → Rückfrage
      if (b.dataset.act === 'zdNext' && (ctx.state().game.zd || {}).phase === 'question' &&
          !(await confirmModal('Die Frage ist noch nicht aufgelöst. Wirklich überspringen?', { title: 'Weiter', okText: 'Überspringen' }))) return;
      ctx.send({ type: 'master', action: b.dataset.act });
    });
  });

  function update(s) {
    const zd = s.game.zd || { phase: 'lobby', total: 0 };
    const admin = ctx.admin();
    const cfg = (admin && admin.zdCfg) || null;
    const totalQ = cfg ? cfg.questions.length : zd.total;

    phaseEl.textContent = PHASE_LABEL[zd.phase] || zd.phase;

    const phase = zd.phase;
    const masterOnly = !!(s.settings && s.settings.masterOnlyMode);
    grouphintEl.classList.toggle('hidden', !masterOnly);
    startBtn.disabled = !(phase === 'lobby') || totalQ === 0;
    revealBtn.disabled = phase !== 'question';
    nextBtn.disabled = !(phase === 'question' || phase === 'reveal');

    if (totalQ === 0) {
      hintEl.textContent = 'Keine Fragen in diesem Profil. Lege sie im Tab „🎲 Spiele" → „⚙️ Konfigurieren" an.';
    } else if (phase === 'lobby') {
      const rate = cfg ? (cfg.startPoints + ' → ' + cfg.minPoints + ', −' + cfg.drainPerSec + '/s') : '';
      hintEl.textContent = totalQ + ' Frage' + (totalQ === 1 ? '' : 'n') + ' bereit.' + (rate ? '  Punkte: ' + rate : '');
    } else if (phase === 'question') {
      hintEl.textContent = 'Spieler antworten – je schneller, desto mehr Punkte. „Auflösen" vergibt sie.';
    } else if (phase === 'reveal') {
      hintEl.textContent = zd.number >= zd.total ? 'Letzte Frage – „Weiter" zeigt den Endstand.' : '„Weiter" für die nächste Frage.';
    } else {
      hintEl.textContent = 'Quiz beendet. „Zurücksetzen" für einen neuen Durchlauf.';
    }

    // Aktuelle Frage mit markierter Loesung (master-exklusiv als zdCorrect).
    const players = (s.participants || []).filter((p) => p.role === 'player');
    const answers = zd.answers || [];
    const correctIdx = (typeof s.game.zdCorrect === 'number') ? s.game.zdCorrect : -1;
    if ((phase === 'question' || phase === 'reveal') && answers.length) {
      if (qKey !== zd.number) { qKey = zd.number; startTime = performance.now(); }
      qEl.textContent = zd.question || '';
      ansEl.innerHTML = '';
      answers.forEach((text, i) => {
        const isCorrect = i === correctIdx;
        const isGroupPick = phase === 'question' && zd.groupPick && i === zd.groupPick.option;
        const row = document.createElement('div');
        row.className = 'mc-m-arow' + (isCorrect ? ' correct' : '') + (isGroupPick ? ' chosen' : '');
        row.innerHTML = '<span class="mc-letter">' + LETTERS[i] + '</span>' +
          '<span class="mc-atext">' + escapeHtml(text) + '</span>' +
          (isCorrect ? '<span class="mc-m-badge">richtig</span>' : '');
        if (phase === 'question' && masterOnly) {
          row.classList.add('clickable');
          row.title = 'Als Wahl der Allgemeinheit setzen';
          row.addEventListener('click', () => {
            const elapsedMs = performance.now() - startTime;
            ctx.send({ type: 'master', action: 'zdGroupPick', option: i, elapsedMs });
          });
        }
        ansEl.appendChild(row);
      });
    } else {
      qKey = null;
      if (phase === 'lobby') {
        qEl.innerHTML = '<span class="muted">Noch nicht gestartet.</span>';
      } else {
        qEl.innerHTML = '<span class="muted">–</span>';
      }
      ansEl.innerHTML = '';
    }

    // Antwortstatus je Spieler (mit eingefrorenen Punkten)
    const zdAnswers = s.game.zdAnswers || {};   // clientId -> { option, points } (nur Master)
    acountEl.textContent = Object.keys(zdAnswers).length + (players.length ? ' / ' + players.length : '');
    playersEl.innerHTML = '';
    players.forEach((p) => {
      const a = zdAnswers[p.id];
      const hasAns = a != null;
      const letter = hasAns ? LETTERS[a.option] : '–';
      const isCorrect = (phase === 'reveal' && hasAns && a.option === correctIdx);
      const row = document.createElement('div');
      row.className = 'mc-m-prow' + (hasAns ? ' answered' : '') +
        (phase === 'reveal' && hasAns ? (isCorrect ? ' correct' : ' wrong') : '');
      row.innerHTML =
        '<span class="dev-dot' + (p.online ? ' online' : '') + '"><span class="led"></span></span>' +
        avatarChip(p) +
        '<span class="mc-m-pname">' + escapeHtml(p.name) + '</span>' +
        (hasAns ? '<span class="zd-m-pts">' + a.points + '</span>' : '') +
        '<span class="mc-m-pchoice">' + letter + '</span>';
      playersEl.appendChild(row);
    });
    if (players.length === 0) playersEl.innerHTML = '<p class="muted small">Noch keine Spieler verbunden.</p>';
  }

  return { update };
}

