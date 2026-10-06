'use strict';
// Spiel: Multiple Choice – Bildschirm/Spieler/Master-Module.

// ===========================================================================
// SPIEL: Multiple Choice – rollenspezifische Oberflaechen
// ===========================================================================

function createMcScreen(root, ctx) {
  root.innerHTML =
    '<div class="mc-screen">' +
      '<div class="mc-topline"><span class="mc-intro" data-el="intro"></span>' +
        '<span class="mc-counter" data-el="counter"></span></div>' +
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
  const qEl = root.querySelector('[data-el="question"]');
  const ansEl = root.querySelector('[data-el="answers"]');
  const answeredEl = root.querySelector('[data-el="answered"]');
  const groupPickEl = root.querySelector('[data-el="grouppick"]');
  const finalEl = root.querySelector('[data-el="final"]');
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

  function update(s) {
    const mc = s.game.mc;
    if (!mc) return;
    introEl.textContent = mc.intro || '';

    // Endstand
    if (mc.phase === 'done') {
      qEl.classList.add('hidden'); ansEl.classList.add('hidden'); answeredEl.classList.add('hidden');
      groupPickEl.classList.add('hidden');
      counterEl.textContent = mc.total + ' Fragen';
      finalEl.classList.remove('hidden');
      renderLeaderboard(finalEl, s);
      return;
    }
    finalEl.classList.add('hidden');

    // Lobby (noch nicht gestartet) -> Dummy-Frage, damit das Layout steht
    if (mc.phase === 'lobby' || !mc.question) {
      counterEl.textContent = mc.total ? (mc.total + ' Fragen') : '';
      qEl.classList.remove('hidden'); ansEl.classList.remove('hidden');
      answeredEl.classList.remove('hidden'); answeredEl.textContent = '';
      groupPickEl.classList.add('hidden');
      renderQuizDummy(qEl, ansEl);
      return;
    }

    // Frage-/Aufloesungsphase
    qEl.classList.remove('hidden'); ansEl.classList.remove('hidden');
    counterEl.textContent = 'Frage ' + mc.number + ' / ' + mc.total;
    qEl.textContent = mc.question;

    const reveal = mc.phase === 'reveal';
    const totalVotes = reveal && mc.dist ? mc.dist.reduce((a, b) => a + b, 0) : 0;
    ansEl.innerHTML = '';
    (mc.answers || []).forEach((text, i) => {
      const cell = document.createElement('div');
      let cls = 'mc-cell';
      if (reveal) {
        if (i === mc.correct) cls += ' correct';
        else cls += ' dim';
      } else if (i === mc.groupPick) {
        cls += ' chosen';
      }
      cell.className = cls;
      const votes = reveal && mc.dist ? (mc.dist[i] || 0) : 0;
      const pct = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
      cell.innerHTML =
        (reveal ? '<span class="mc-bar" style="width:' + pct + '%"></span>' : '') +
        '<span class="mc-letter">' + LETTERS[i] + '</span>' +
        '<span class="mc-atext">' + escapeHtml(text) + '</span>' +
        (reveal ? '<span class="mc-votes">' + votes + '</span>' : '');
      ansEl.appendChild(cell);
    });

    // Antwort-Zaehler-Zeile bleibt immer sichtbar (leer bei reveal), damit die
    // Hoehe zwischen Frage- und Aufloesungsphase konstant bleibt.
    answeredEl.classList.remove('hidden');
    if (reveal) {
      answeredEl.textContent = '';
    } else {
      answeredEl.textContent = mc.answeredCount + ' Antwort' + (mc.answeredCount === 1 ? '' : 'en') + ' abgegeben';
    }

    // Live-Tendenz der Allgemeinheit (Master-Auswahl ohne Teilnehmerbindung),
    // nur vor der Aufloesung sichtbar.
    if (!reveal && mc.groupPick != null && mc.answers[mc.groupPick] != null) {
      groupPickEl.classList.remove('hidden');
      groupPickEl.textContent = '🗳️ Die Allgemeinheit einigt sich auf: ' +
        LETTERS[mc.groupPick] + ' – ' + mc.answers[mc.groupPick];
    } else {
      groupPickEl.classList.add('hidden');
    }
  }

  return { update };
}

// --- Spieler: Antwort-Buttons + eigene Auswahl + Ergebnis -------------------
function createMcPlayer(root, ctx) {
  root.innerHTML =
    '<div class="mc-player">' +
      '<div class="mc-p-counter" data-el="counter"></div>' +
      '<div class="mc-p-question" data-el="question"></div>' +
      '<div class="mc-p-answers" data-el="answers"></div>' +
      '<div class="mc-p-feedback" data-el="feedback"></div>' +
      '<div class="mc-p-score" data-el="score"></div>' +
    '</div>';
  const counterEl = root.querySelector('[data-el="counter"]');
  const qEl = root.querySelector('[data-el="question"]');
  const ansEl = root.querySelector('[data-el="answers"]');
  const fbEl = root.querySelector('[data-el="feedback"]');
  const scoreEl = root.querySelector('[data-el="score"]');
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

  function update(s) {
    const mc = s.game.mc;
    if (!mc) return;
    const myAnswer = (s.game.mcMyAnswer === undefined ? null : s.game.mcMyAnswer);
    const pts = s.game.scores[ctx.clientId()] || 0;
    scoreEl.textContent = pts > 0 ? 'Deine Punkte: ' + pts : '';

    // Lobby / Endstand -> keine Buttons
    if (mc.phase === 'lobby') {
      counterEl.textContent = '';
      qEl.textContent = 'Warte auf den Start …';
      ansEl.innerHTML = ''; fbEl.textContent = ''; fbEl.className = 'mc-p-feedback';
      return;
    }
    if (mc.phase === 'done') {
      counterEl.textContent = 'Quiz beendet';
      qEl.textContent = '🏁 Geschafft!';
      ansEl.innerHTML = '';
      fbEl.className = 'mc-p-feedback';
      fbEl.textContent = pts > 0 ? 'Du hast ' + pts + ' Punkte geholt.' : '';
      return;
    }

    counterEl.textContent = 'Frage ' + mc.number + ' / ' + mc.total;
    qEl.textContent = mc.question || '';

    const reveal = mc.phase === 'reveal';
    const locked = !!s.game.locked;
    ansEl.innerHTML = '';
    (mc.answers || []).forEach((text, i) => {
      const btn = document.createElement('button');
      let cls = 'mc-choice';
      const chosen = myAnswer === i;
      if (reveal) {
        if (i === mc.correct) cls += ' correct';
        else if (chosen) cls += ' wrong';
        else cls += ' dim';
      } else if (chosen) {
        cls += ' chosen';
      }
      btn.className = cls;
      btn.innerHTML = '<span class="mc-letter">' + LETTERS[i] + '</span>' +
        '<span class="mc-atext">' + escapeHtml(text) + '</span>';
      // Anklickbar nur in der Fragephase, solange nichts gewaehlt und nicht gesperrt
      btn.disabled = reveal || myAnswer !== null || locked;
      if (!btn.disabled) {
        btn.addEventListener('click', () => {
          if (s.game.mcMyAnswer != null) return;
          ctx.send({ type: 'answer', option: i });
        });
      }
      ansEl.appendChild(btn);
    });

    // Feedback
    fbEl.className = 'mc-p-feedback';
    if (reveal) {
      if (myAnswer === null) { fbEl.textContent = 'Keine Antwort'; fbEl.classList.add('miss'); }
      else if (myAnswer === mc.correct) { fbEl.textContent = '✓ Richtig! +' + mc.points; fbEl.classList.add('good'); }
      else { fbEl.textContent = '✗ Leider falsch'; fbEl.classList.add('false'); }
    } else if (myAnswer !== null) {
      fbEl.textContent = 'Antwort gesendet – warte auf die Auflösung';
    } else {
      fbEl.textContent = 'Wähle eine Antwort';
    }
  }

  return { update };
}

// --- Master: Ablaufsteuerung + aktuelle Frage (mit Loesung) + Antwortstatus --
function createMcMaster(root, ctx) {
  root.innerHTML =
    '<section class="panel">' +
      '<div class="phase-indicator" data-el="phase">–</div>' +
      '<div class="control-grid">' +
        '<button class="btn btn-primary big" data-act="mcStart">▶ Quiz starten</button>' +
        '<button class="btn btn-warn big" data-act="mcReveal">💡 Auflösen</button>' +
        '<button class="btn btn-success" data-act="mcNext">⏭ Weiter</button>' +
        '<button class="btn btn-ghost" data-act="mcReset">↺ Zurücksetzen</button>' +
      '</div>' +
      '<p class="muted small" data-el="hint"></p>' +
    '</section>' +
    '<section class="panel">' +
      '<h3>Aktuelle Frage</h3>' +
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
  const startBtn = root.querySelector('[data-act="mcStart"]');
  const revealBtn = root.querySelector('[data-act="mcReveal"]');
  const nextBtn = root.querySelector('[data-act="mcNext"]');
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
  const PHASE_LABEL = { lobby: '⚪ Bereit', question: '❓ Frage läuft', reveal: '💡 Aufgelöst', done: '🏁 Endstand' };

  root.querySelectorAll('[data-act]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (b.dataset.act === 'mcReset' && !(await confirmModal('Quiz zurücksetzen? (Punkte bleiben erhalten)', { title: 'Zurücksetzen', okText: 'Zurücksetzen' }))) return;
      // Weiter vor dem Auflösen = Frage ohne Punkte überspringen → Rückfrage
      if (b.dataset.act === 'mcNext' && (ctx.state().game.mc || {}).phase === 'question' &&
          !(await confirmModal('Die Frage ist noch nicht aufgelöst. Wirklich überspringen?', { title: 'Weiter', okText: 'Überspringen' }))) return;
      ctx.send({ type: 'master', action: b.dataset.act });
    });
  });

  function update(s) {
    const mc = s.game.mc || { phase: 'lobby', total: 0 };
    const admin = ctx.admin();
    const cfg = (admin && admin.mcCfg) || null;
    const totalQ = cfg ? cfg.questions.length : mc.total;

    phaseEl.textContent = PHASE_LABEL[mc.phase] || mc.phase;

    const phase = mc.phase;
    const masterOnly = !!(s.settings && s.settings.masterOnlyMode);
    grouphintEl.classList.toggle('hidden', !masterOnly);
    startBtn.disabled = !(phase === 'lobby') || totalQ === 0;
    revealBtn.disabled = phase !== 'question';
    nextBtn.disabled = !(phase === 'question' || phase === 'reveal');

    if (totalQ === 0) {
      hintEl.textContent = 'Keine Fragen in diesem Profil. Lege sie im Tab „🎲 Spiele" → „⚙️ Konfigurieren" an.';
    } else if (phase === 'lobby') {
      hintEl.textContent = totalQ + ' Frage' + (totalQ === 1 ? '' : 'n') + ' bereit.';
    } else if (phase === 'question') {
      hintEl.textContent = 'Spieler antworten. „Auflösen" vergibt die Punkte.';
    } else if (phase === 'reveal') {
      hintEl.textContent = mc.number >= mc.total ? 'Letzte Frage – „Weiter" zeigt den Endstand.' : '„Weiter" für die nächste Frage.';
    } else {
      hintEl.textContent = 'Quiz beendet. „Zurücksetzen" für einen neuen Durchlauf.';
    }

    // Aktuelle Frage mit markierter Loesung. Der richtige Anzeigeindex kommt
    // master-exklusiv als mcCorrect – so sieht der Master die Lösung schon in
    // der Fragephase (zum Vorlesen), Spieler/Bildschirm dagegen erst beim Auflösen.
    const players = (s.participants || []).filter((p) => p.role === 'player');
    const answers = mc.answers || [];
    const correctIdx = (typeof s.game.mcCorrect === 'number') ? s.game.mcCorrect : -1;
    if ((phase === 'question' || phase === 'reveal') && answers.length) {
      qEl.textContent = mc.question || '';
      ansEl.innerHTML = '';
      answers.forEach((text, i) => {
        const isCorrect = i === correctIdx;
        const isGroupPick = phase === 'question' && i === mc.groupPick;
        const row = document.createElement('div');
        row.className = 'mc-m-arow' + (isCorrect ? ' correct' : '') + (isGroupPick ? ' chosen' : '');
        row.innerHTML = '<span class="mc-letter">' + LETTERS[i] + '</span>' +
          '<span class="mc-atext">' + escapeHtml(text) + '</span>' +
          (isCorrect ? '<span class="mc-m-badge">richtig</span>' : '');
        if (phase === 'question' && masterOnly) {
          row.classList.add('clickable');
          row.title = 'Als Wahl der Allgemeinheit setzen';
          row.addEventListener('click', () => {
            ctx.send({ type: 'master', action: 'mcGroupPick', option: i });
          });
        }
        ansEl.appendChild(row);
      });
    } else if (phase === 'lobby') {
      qEl.innerHTML = '<span class="muted">Noch nicht gestartet.</span>';
      ansEl.innerHTML = '';
    } else {
      qEl.innerHTML = '<span class="muted">–</span>';
      ansEl.innerHTML = '';
    }

    // Antwortstatus je Spieler
    const mcAnswers = s.game.mcAnswers || {};   // clientId -> Anzeigeindex (nur Master)
    acountEl.textContent = Object.keys(mcAnswers).length + (players.length ? ' / ' + players.length : '');
    playersEl.innerHTML = '';
    players.forEach((p) => {
      const chosen = mcAnswers[p.id];
      const hasAns = chosen != null;
      const letter = hasAns ? LETTERS[chosen] : '–';
      const isCorrect = (phase === 'reveal' && hasAns && chosen === correctIdx);
      const row = document.createElement('div');
      row.className = 'mc-m-prow' + (hasAns ? ' answered' : '') +
        (phase === 'reveal' && hasAns ? (isCorrect ? ' correct' : ' wrong') : '');
      row.innerHTML =
        '<span class="dev-dot' + (p.online ? ' online' : '') + '"><span class="led"></span></span>' +
        avatarChip(p) +
        '<span class="mc-m-pname">' + escapeHtml(p.name) + '</span>' +
        '<span class="mc-m-pchoice">' + letter + '</span>';
      playersEl.appendChild(row);
    });
    if (players.length === 0) playersEl.innerHTML = '<p class="muted small">Noch keine Spieler verbunden.</p>';
  }

  return { update };
}

