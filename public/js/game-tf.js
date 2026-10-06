'use strict';
// Spiel: Wahr/Falsch-Blitzrunde – Bildschirm/Spieler/Master-Module.

// ===========================================================================
// SPIEL: Wahr/Falsch-Blitzrunde (tf) – Aussagen einzeln entscheiden: wahr oder
// falsch? Zwei Antwort-Modi (nurSchnellster: Buzzer, wie Falsche Woerter; sonst:
// alle stimmen ab, Master loest per "Auflösen" auf) x zwei Punkte-Modi (fix,
// zeit: wie Zeitdruck mit der Zeit fallend).
// ===========================================================================

// Punktwert lokal berechnen (fuer den Live-Zaehler im Zeit-Modus). Muss zur
// Server-Formel (tfPointsFor) passen; die Zeit misst jedes Geraet selbst (Fairness).
function tfLivePoints(tf, elapsedMs) {
  if (tf.punkteModus !== 'zeit') return tf.punkte;
  let p = tf.startPunkte - tf.abzugProSek * (Math.max(0, elapsedMs) / 1000);
  p = Math.round(p);
  if (p < tf.minPunkte) p = tf.minPunkte;
  if (p > tf.startPunkte) p = tf.startPunkte;
  return p;
}

// --- Bildschirm: Aussage + Verdict (Buzzer) bzw. Verteilung (Abstimmung) -----
function createTfScreen(root, ctx) {
  root.innerHTML =
    '<div class="tf-screen">' +
      '<div class="tf-topline"><span class="tf-counter" data-el="counter"></span></div>' +
      '<div class="tf-stage" data-el="stage">' +
        '<div class="tf-statement" data-el="statement"></div>' +
        '<div class="tf-verdict" data-el="verdict"></div>' +
      '</div>' +
      '<div class="tf-dist" data-el="dist"></div>' +
      '<div class="tf-status" data-el="status"></div>' +
      '<div class="mc-final" data-el="final">' +
        '<div class="mc-final-title">🏁 Endstand</div>' +
        '<div class="leaderboard"></div>' +
      '</div>' +
    '</div>';
  const counterEl = root.querySelector('[data-el="counter"]');
  const stageEl = root.querySelector('[data-el="stage"]');
  const statementEl = root.querySelector('[data-el="statement"]');
  const verdictEl = root.querySelector('[data-el="verdict"]');
  const distEl = root.querySelector('[data-el="dist"]');
  const statusEl = root.querySelector('[data-el="status"]');
  const finalEl = root.querySelector('[data-el="final"]');

  function update(s) {
    const tf = s.game.tf;
    if (!tf) return;

    // Endstand
    if (tf.phase === 'done') {
      stageEl.classList.add('hidden'); distEl.classList.add('hidden'); statusEl.classList.add('hidden');
      counterEl.textContent = tf.total + ' Aussagen';
      finalEl.classList.remove('hidden');
      renderLeaderboard(finalEl, s);
      return;
    }
    finalEl.classList.add('hidden');
    stageEl.classList.remove('hidden'); statusEl.classList.remove('hidden');

    // Lobby
    if (tf.phase === 'lobby') {
      statementEl.className = 'tf-statement waiting';
      statementEl.textContent = 'Gleich geht’s los …';
      verdictEl.className = 'tf-verdict hidden';
      distEl.classList.add('hidden');
      counterEl.textContent = '';
      statusEl.textContent = tf.total ? (tf.total + ' Aussagen · wahr oder falsch?') : 'Keine Aussagen im Profil';
      return;
    }

    counterEl.textContent = 'Aussage ' + tf.number + ' / ' + tf.total;
    statementEl.className = 'tf-statement';
    statementEl.textContent = tf.statement || '';

    const paused = tf.phase === 'paused';

    if (paused && tf.nurSchnellster && tf.verdict) {
      // Schnellster-Modus: Verdict wie bei "Falsche Woerter" (wer hat gebuzzert, richtig?)
      const v = tf.verdict;
      const vChip = avatarChip({ avatar: v.buzzerAvatar, color: v.buzzerColor });
      verdictEl.className = 'tf-verdict ' + (v.correct ? 'ok' : 'wrong');
      verdictEl.innerHTML =
        (v.correct ? '<span class="tf-v-title">✅ Richtig!</span>' : '<span class="tf-v-title">❌ Falsch!</span>') +
        '<span class="tf-v-sub">🔔 ' + vChip + escapeHtml(v.buzzerName) + (v.awarded ? '  +' + v.awarded : '') + '</span>';
      distEl.classList.add('hidden');
      statusEl.textContent = 'Warte auf den Master …';
    } else if (paused) {
      // Abstimmungs-Modus: Loesung + Verteilung der Stimmen.
      verdictEl.className = 'tf-verdict';
      verdictEl.innerHTML = '<span class="tf-v-title">Lösung: ' + (tf.correct ? '✅ Wahr' : '❌ Falsch') + '</span>';
      const dist = tf.dist || { wahr: 0, falsch: 0 };
      const totalVotes = dist.wahr + dist.falsch;
      const wahrPct = totalVotes > 0 ? Math.round((dist.wahr / totalVotes) * 100) : 0;
      const falschPct = totalVotes > 0 ? Math.round((dist.falsch / totalVotes) * 100) : 0;
      distEl.classList.remove('hidden');
      distEl.innerHTML =
        '<div class="mc-cell' + (tf.correct ? ' correct' : ' dim') + '">' +
          '<span class="mc-bar" style="width:' + wahrPct + '%"></span>' +
          '<span class="mc-letter">✅</span><span class="mc-atext">Wahr</span><span class="mc-votes">' + dist.wahr + '</span>' +
        '</div>' +
        '<div class="mc-cell' + (!tf.correct ? ' correct' : ' dim') + '">' +
          '<span class="mc-bar" style="width:' + falschPct + '%"></span>' +
          '<span class="mc-letter">❌</span><span class="mc-atext">Falsch</span><span class="mc-votes">' + dist.falsch + '</span>' +
        '</div>';
      statusEl.textContent = 'Warte auf den Master …';
    } else {
      // running
      verdictEl.className = 'tf-verdict hidden';
      distEl.classList.add('hidden');
      if (tf.nurSchnellster) {
        statusEl.textContent = 'Wer zuerst antwortet, entscheidet!';
      } else {
        let txt = tf.votedCount + ' Antwort' + (tf.votedCount === 1 ? '' : 'en');
        if (tf.groupPick) txt += ' · 🗳️ Tendenz: ' + (tf.groupPick.answer ? '✅ Wahr' : '❌ Falsch');
        statusEl.textContent = txt;
      }
    }
  }

  return { update };
}

// --- Spieler: zwei grosse Wahr/Falsch-Buttons + Live-Punkte + Feedback ------
function createTfPlayer(root, ctx) {
  root.innerHTML =
    '<div class="tf-player">' +
      '<div class="tf-p-counter" data-el="counter"></div>' +
      '<div class="tf-p-points" data-el="points"></div>' +
      '<div class="tf-p-statement" data-el="statement"></div>' +
      '<div class="tf-p-choices">' +
        '<button class="tf-choice wahr" data-el="wahr">✅ Wahr</button>' +
        '<button class="tf-choice falsch" data-el="falsch">❌ Falsch</button>' +
      '</div>' +
      '<div class="mc-p-feedback" data-el="feedback"></div>' +
      '<div class="mc-p-score" data-el="score"></div>' +
    '</div>';
  const counterEl = root.querySelector('[data-el="counter"]');
  const pointsEl = root.querySelector('[data-el="points"]');
  const stEl = root.querySelector('[data-el="statement"]');
  const wahrBtn = root.querySelector('[data-el="wahr"]');
  const falschBtn = root.querySelector('[data-el="falsch"]');
  const fbEl = root.querySelector('[data-el="feedback"]');
  const scoreEl = root.querySelector('[data-el="score"]');
  let lastState = null;
  let qKey = null;        // aktuelle Aussagen-Kennung (Nummer) fuer Timer-Reset
  let startTime = 0;      // lokaler Aussagen-Beginn (performance.now)
  let raf = 0;

  function tick() {
    raf = 0;
    const s = lastState; if (!s) return;
    const tf = s.game.tf; if (!tf || tf.phase !== 'running') return;
    if (s.game.tfMyAnswer != null) return;   // schon geantwortet -> eingefroren
    const val = tfLivePoints(tf, performance.now() - startTime);
    pointsEl.textContent = val;
    pointsEl.classList.toggle('low', val <= tf.minPunkte);
    raf = requestAnimationFrame(tick);
  }

  function send(answer) {
    const s = lastState;
    if (!s || !s.game.tf || s.game.tf.phase !== 'running') return;
    if (s.game.tfMyAnswer != null) return;
    const elapsedMs = performance.now() - startTime;
    ctx.send({ type: 'tfAnswer', answer, elapsedMs });
  }
  wahrBtn.addEventListener('click', () => send(true));
  falschBtn.addEventListener('click', () => send(false));

  function update(s) {
    lastState = s;
    const tf = s.game.tf;
    if (!tf) return;
    const myAnswer = s.game.tfMyAnswer || null;
    const pts = s.game.scores[ctx.clientId()] || 0;
    scoreEl.textContent = pts > 0 ? 'Deine Punkte: ' + pts : '';

    if (tf.phase === 'lobby') {
      qKey = null;
      counterEl.textContent = '';
      pointsEl.textContent = ''; pointsEl.className = 'tf-p-points';
      stEl.textContent = 'Warte auf den Start …';
      wahrBtn.disabled = true; falschBtn.disabled = true;
      wahrBtn.className = 'tf-choice wahr'; falschBtn.className = 'tf-choice falsch';
      fbEl.textContent = ''; fbEl.className = 'mc-p-feedback';
      return;
    }
    if (tf.phase === 'done') {
      qKey = null;
      counterEl.textContent = 'Runde beendet';
      pointsEl.textContent = ''; pointsEl.className = 'tf-p-points';
      stEl.textContent = '🏁 Geschafft!';
      wahrBtn.disabled = true; falschBtn.disabled = true;
      fbEl.className = 'mc-p-feedback';
      fbEl.textContent = pts > 0 ? 'Du hast ' + pts + ' Punkte geholt.' : '';
      return;
    }

    counterEl.textContent = 'Aussage ' + tf.number + ' / ' + tf.total;
    stEl.textContent = tf.statement || '';

    // Neue Aussage? -> lokalen Zeitpunkt merken (Zaehler startet bei Startpunkten)
    if (qKey !== tf.number) { qKey = tf.number; startTime = performance.now(); }

    const revealed = tf.phase === 'paused';
    const locked = !!s.game.locked;

    // Punkteanzeige: eingefroren (nach Antwort) oder live (waehrend Aussage laeuft)
    pointsEl.className = 'tf-p-points';
    if (myAnswer) {
      pointsEl.classList.add('locked');
      pointsEl.textContent = myAnswer.points != null ? myAnswer.points : '🔒';
    } else if (revealed) {
      pointsEl.textContent = '–';
    }

    wahrBtn.className = 'tf-choice wahr'; falschBtn.className = 'tf-choice falsch';
    const chosenWahr = myAnswer && myAnswer.answer === true;
    const chosenFalsch = myAnswer && myAnswer.answer === false;
    if (revealed) {
      if (tf.correct === true) wahrBtn.classList.add('correct'); else if (tf.correct === false) falschBtn.classList.add('correct');
      if (chosenWahr && tf.correct !== true) wahrBtn.classList.add('wrong');
      if (chosenFalsch && tf.correct !== false) falschBtn.classList.add('wrong');
    } else {
      if (chosenWahr) wahrBtn.classList.add('chosen');
      if (chosenFalsch) falschBtn.classList.add('chosen');
    }
    const disabled = revealed || myAnswer != null || locked;
    wahrBtn.disabled = disabled; falschBtn.disabled = disabled;

    // Feedback
    fbEl.className = 'mc-p-feedback';
    if (revealed) {
      if (!myAnswer) { fbEl.textContent = 'Keine Antwort'; fbEl.classList.add('miss'); }
      else if (myAnswer.correct) { fbEl.textContent = '✓ Richtig! +' + myAnswer.points; fbEl.classList.add('good'); }
      else { fbEl.textContent = '✗ Leider falsch'; fbEl.classList.add('false'); }
    } else if (myAnswer) {
      fbEl.textContent = '🔒 Antwort gespeichert';
    } else {
      fbEl.textContent = 'Wahr oder falsch?';
    }

    // Live-Countdown starten (nur solange die Aussage laeuft, noch nicht geantwortet)
    if (tf.phase === 'running' && !myAnswer && !raf) raf = requestAnimationFrame(tick);
  }

  return { update, destroy() { if (raf) cancelAnimationFrame(raf); } };
}

// --- Master: Ablaufsteuerung + aktuelle Aussage (mit Loesung) + Antwortstatus
function createTfMaster(root, ctx) {
  root.innerHTML =
    '<section class="panel">' +
      '<div class="phase-indicator" data-el="phase">–</div>' +
      '<div class="control-grid">' +
        '<button class="btn btn-primary big" data-act="tfStart">▶ Starten</button>' +
        '<button class="btn btn-warn big" data-act="tfReveal">💡 Auflösen</button>' +
        '<button class="btn btn-success" data-act="tfNext">⏭ Weiter</button>' +
        '<button class="btn btn-ghost" data-act="tfReset">↺ Zurücksetzen</button>' +
      '</div>' +
      '<p class="muted small" data-el="hint"></p>' +
    '</section>' +
    '<section class="panel">' +
      '<h3>Aktuelle Aussage (<span data-el="prog">0/0</span>)</h3>' +
      '<div class="tf-m-statement" data-el="statement"></div>' +
      '<div class="mc-m-answers" data-el="answers"></div>' +
      '<p class="muted small" data-el="grouphint">Wahr/Falsch anklicken: „Die Allgemeinheit einigt sich auf …" – bis zur Auflösung änderbar.</p>' +
      '<div class="tf-m-verdict hidden" data-el="verdict"></div>' +
    '</section>' +
    '<section class="panel">' +
      '<h3>Antworten (<span data-el="acount">0</span>)</h3>' +
      '<div class="mc-m-players" data-el="players"></div>' +
    '</section>' +
    '<section class="panel proxy-panel" data-el="proxysec">' +
      '<h3>Für Teilnehmer antworten (Nur-Master-Modus)</h3>' +
      '<p class="muted small">✅ Wahr</p><div class="proxy-row" data-el="proxywahr"></div>' +
      '<p class="muted small">❌ Falsch</p><div class="proxy-row" data-el="proxyfalsch"></div>' +
    '</section>';

  const phaseEl = root.querySelector('[data-el="phase"]');
  const hintEl = root.querySelector('[data-el="hint"]');
  const progEl = root.querySelector('[data-el="prog"]');
  const stEl = root.querySelector('[data-el="statement"]');
  const ansEl = root.querySelector('[data-el="answers"]');
  const grouphintEl = root.querySelector('[data-el="grouphint"]');
  const verdictEl = root.querySelector('[data-el="verdict"]');
  const playersEl = root.querySelector('[data-el="players"]');
  const acountEl = root.querySelector('[data-el="acount"]');
  const proxySecEl = root.querySelector('[data-el="proxysec"]');
  const proxyWahrEl = root.querySelector('[data-el="proxywahr"]');
  const proxyFalschEl = root.querySelector('[data-el="proxyfalsch"]');
  const startBtn = root.querySelector('[data-act="tfStart"]');
  const revealBtn = root.querySelector('[data-act="tfReveal"]');
  const nextBtn = root.querySelector('[data-act="tfNext"]');
  const PHASE_LABEL = { lobby: '⚪ Bereit', running: '▶ Läuft', paused: '⏸ Pausiert', done: '🏁 Endstand' };
  let qSeq = -1;
  let startTime = 0;

  root.querySelectorAll('[data-act]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (b.dataset.act === 'tfReset' && !(await confirmModal('Runde zurücksetzen? (Punkte bleiben erhalten)', { title: 'Zurücksetzen', okText: 'Zurücksetzen' }))) return;
      // Weiter vor dem Auflösen = Aussage ohne Punkte überspringen → Rückfrage
      if (b.dataset.act === 'tfNext' && (ctx.state().game.tf || {}).phase === 'running' &&
          !(await confirmModal('Die Aussage ist noch nicht aufgelöst. Wirklich überspringen?', { title: 'Weiter', okText: 'Überspringen' }))) return;
      ctx.send({ type: 'master', action: b.dataset.act });
    });
  });

  function update(s) {
    const tf = s.game.tf || { phase: 'lobby', total: 0 };
    const admin = ctx.admin();
    const cfg = (admin && admin.tfCfg) || null;
    const totalA = cfg ? cfg.aussagen.length : tf.total;
    const phase = tf.phase;
    const nurSchnellster = cfg ? cfg.nurSchnellster : tf.nurSchnellster;
    const masterOnly = !!(s.settings && s.settings.masterOnlyMode);

    phaseEl.textContent = PHASE_LABEL[phase] || phase;
    progEl.textContent = (phase === 'lobby' || phase === 'done') ? (totalA + ' Aussagen') : (tf.number + '/' + tf.total);

    startBtn.disabled = !(phase === 'lobby') || totalA === 0;
    revealBtn.disabled = !(phase === 'running' && !nurSchnellster);
    nextBtn.disabled = !(phase === 'running' || phase === 'paused');

    if (totalA === 0) {
      hintEl.textContent = 'Keine Aussagen in diesem Profil. Lege sie im Tab „🎲 Spiele" → „⚙️ Konfigurieren" an.';
    } else if (phase === 'lobby') {
      hintEl.textContent = totalA + ' Aussage' + (totalA === 1 ? '' : 'n') + ' bereit. ' +
        (nurSchnellster ? 'Der erste Buzz entscheidet.' : '„Auflösen" vergibt die Punkte.');
    } else if (phase === 'running') {
      hintEl.textContent = nurSchnellster
        ? 'Wer zuerst antwortet, entscheidet die Runde sofort.'
        : 'Spieler stimmen ab. „Auflösen" vergibt die Punkte.';
    } else if (phase === 'paused') {
      hintEl.textContent = tf.number >= tf.total ? 'Letzte Aussage – „Weiter" zeigt den Endstand.' : '„Weiter" für die nächste Aussage.';
    } else {
      hintEl.textContent = 'Runde beendet. „Zurücksetzen" für einen neuen Durchlauf.';
    }

    // Aktuelle Aussage + Loesung (master-exklusiv ueber tfCurrentWahr).
    const cw = s.game.tfCurrentWahr;
    if ((phase === 'running' || phase === 'paused') && tf.statement != null) {
      stEl.innerHTML = '<span class="tf-m-stext">' + escapeHtml(tf.statement) + '</span>' +
        (cw === true ? '<span class="tf-m-badge wahr">✅ wahr</span>'
          : cw === false ? '<span class="tf-m-badge falsch">❌ falsch</span>' : '');
    } else if (phase === 'lobby') {
      stEl.innerHTML = '<span class="muted">Noch nicht gestartet.</span>';
    } else {
      stEl.innerHTML = '<span class="muted">–</span>';
    }

    // Wahr/Falsch-Zeilen; im Abstimmungs-Modus im Nur-Master-Modus per Klick als
    // Gruppen-Tendenz setzbar (analog MC/Zeitdruck-GroupPick, keine Einzelpunkte).
    grouphintEl.classList.toggle('hidden', nurSchnellster || !masterOnly || phase !== 'running');
    ansEl.innerHTML = '';
    if (phase === 'running' || phase === 'paused') {
      if (qSeq !== tf.number) { qSeq = tf.number; startTime = performance.now(); }
      [true, false].forEach((val) => {
        const isCorrect = phase === 'paused' && cw === val;
        const isGroupPick = phase === 'running' && tf.groupPick && tf.groupPick.answer === val;
        const row = document.createElement('div');
        row.className = 'mc-m-arow' + (isCorrect ? ' correct' : '') + (isGroupPick ? ' chosen' : '');
        row.innerHTML = '<span class="mc-letter">' + (val ? '✅' : '❌') + '</span>' +
          '<span class="mc-atext">' + (val ? 'Wahr' : 'Falsch') + '</span>' +
          (isCorrect ? '<span class="mc-m-badge">richtig</span>' : '');
        if (phase === 'running' && !nurSchnellster && masterOnly) {
          row.classList.add('clickable');
          row.title = 'Als Wahl der Allgemeinheit setzen';
          row.addEventListener('click', () => {
            const elapsedMs = performance.now() - startTime;
            ctx.send({ type: 'master', action: 'tfGroupPick', answer: val, elapsedMs });
          });
        }
        ansEl.appendChild(row);
      });
    }

    // Verdict (nur im Schnellster-Modus)
    if (phase === 'paused' && nurSchnellster && tf.verdict) {
      const v = tf.verdict;
      verdictEl.className = 'tf-m-verdict ' + (v.correct ? 'ok' : 'wrong');
      const vAvatar = v.buzzerAvatar ? v.buzzerAvatar + ' ' : '';
      verdictEl.textContent = v.correct
        ? '🔔 ' + vAvatar + v.buzzerName + ' hat richtig geantwortet — +' + v.awarded + ' Punkte'
        : '🔔 ' + vAvatar + v.buzzerName + ' — leider falsch (keine Punkte)';
    } else {
      verdictEl.className = 'tf-m-verdict hidden';
      verdictEl.textContent = '';
    }

    // Antwortstatus je Spieler (mit eingefrorenen Punkten nach Aufloesung)
    const players = (s.participants || []).filter((p) => p.role === 'player');
    const tfAnswers = s.game.tfAnswers || {};   // clientId -> { answer, correct, points, elapsedMs } (nur Master)
    acountEl.textContent = Object.keys(tfAnswers).length + (players.length ? ' / ' + players.length : '');
    const revealed = phase === 'paused' || phase === 'done';
    playersEl.innerHTML = '';
    players.forEach((p) => {
      const a = tfAnswers[p.id];
      const hasAns = a != null;
      const icon = hasAns ? (a.answer ? '✅' : '❌') : '–';
      const row = document.createElement('div');
      row.className = 'mc-m-prow' + (hasAns ? ' answered' : '') +
        (revealed && hasAns ? (a.correct ? ' correct' : ' wrong') : '');
      row.innerHTML =
        '<span class="dev-dot' + (p.online ? ' online' : '') + '"><span class="led"></span></span>' +
        avatarChip(p) +
        '<span class="mc-m-pname">' + escapeHtml(p.name) + '</span>' +
        (revealed && hasAns ? '<span class="zd-m-pts">' + a.points + '</span>' : '') +
        '<span class="mc-m-pchoice">' + icon + '</span>';
      playersEl.appendChild(row);
    });
    if (players.length === 0) playersEl.innerHTML = '<p class="muted small">Noch keine Spieler verbunden.</p>';

    // Stellvertreter (Nur-Master-Modus): nur im Schnellster-Modus noetig (dort
    // haengt die Punktvergabe an einem konkreten Teilnehmer) – im Abstimmungs-
    // Modus setzt der Master die Gruppen-Tendenz direkt oben in den Wahr/Falsch-Zeilen.
    const canProxy = masterOnly && nurSchnellster && phase === 'running';
    proxySecEl.classList.toggle('hidden', !canProxy);
    if (canProxy) {
      renderProxyBuzzRow(proxyWahrEl, proxyPlayers(s), (clientId) => {
        const elapsedMs = startTime ? (performance.now() - startTime) : 0;
        ctx.send({ type: 'master', action: 'masterTfAnswer', clientId, answer: true, elapsedMs });
      });
      renderProxyBuzzRow(proxyFalschEl, proxyPlayers(s), (clientId) => {
        const elapsedMs = startTime ? (performance.now() - startTime) : 0;
        ctx.send({ type: 'master', action: 'masterTfAnswer', clientId, answer: false, elapsedMs });
      });
    }
  }

  return { update };
}
