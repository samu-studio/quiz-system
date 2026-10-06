'use strict';
// Spiel: Falsche Wörter – Buzzer-Spiel, Bildschirm/Spieler/Master-Module.

// ===========================================================================
// SPIEL: Falsche Wörter (fw) – Buzzer-Spiel (Buzzer von der Ampel übernommen)
// ===========================================================================

// --- Bildschirm: Kategorie + einfliegendes Wort + Countdown-Balken + Ergebnis
function createFwScreen(root, ctx) {
  root.innerHTML =
    '<div class="fw-screen">' +
      '<div class="fw-cat" data-el="cat"></div>' +
      '<div class="fw-stage" data-el="stage">' +
        '<div class="fw-word" data-el="word"></div>' +
        '<div class="fw-verdict" data-el="verdict"></div>' +
      '</div>' +
      '<div class="fw-bar" data-el="bar"><span></span></div>' +
      '<div class="fw-status" data-el="status"></div>' +
      '<div class="mc-final" data-el="final">' +
        '<div class="mc-final-title">🏁 Endstand</div>' +
        '<div class="leaderboard"></div>' +
      '</div>' +
    '</div>';
  const catEl = root.querySelector('[data-el="cat"]');
  const stageEl = root.querySelector('[data-el="stage"]');
  const wordEl = root.querySelector('[data-el="word"]');
  const verdictEl = root.querySelector('[data-el="verdict"]');
  const barEl = root.querySelector('[data-el="bar"]');
  const barFill = barEl.querySelector('span');
  const statusEl = root.querySelector('[data-el="status"]');
  const finalEl = root.querySelector('[data-el="final"]');
  let lastSeq = -1;

  // Countdown-Balken (CSS-Animation) auf volle Dauer neu starten.
  function restartBar(seconds) {
    barFill.style.animation = 'none';
    void barFill.offsetWidth;          // Reflow erzwingen -> Animation startet neu
    barFill.style.animation = 'fwbar ' + seconds + 's linear forwards';
    barFill.style.animationPlayState = 'running';
  }

  function update(s) {
    const fw = s.game.fw;
    if (!fw) return;
    catEl.textContent = fw.kategorie || '';
    catEl.classList.toggle('hidden', !fw.kategorie);

    // Endstand
    if (fw.phase === 'done') {
      lastSeq = -1;
      stageEl.classList.add('hidden'); barEl.classList.add('hidden'); statusEl.classList.add('hidden');
      finalEl.classList.remove('hidden');
      renderLeaderboard(finalEl, s);
      return;
    }
    finalEl.classList.add('hidden');
    stageEl.classList.remove('hidden'); statusEl.classList.remove('hidden');

    // Lobby
    if (fw.phase === 'lobby') {
      lastSeq = -1;
      wordEl.textContent = 'Gleich geht’s los …';
      wordEl.className = 'fw-word waiting';
      verdictEl.className = 'fw-verdict hidden';
      barEl.classList.add('hidden');
      statusEl.textContent = fw.total ? (fw.total + ' Wörter · buzzern bei einem Falschwort') : 'Keine Wörter im Profil';
      return;
    }

    barEl.classList.remove('hidden');
    const paused = fw.phase === 'paused';

    // Neues Wort? -> einfliegen lassen + Balken neu starten
    if (fw.wordSeq !== lastSeq) {
      lastSeq = fw.wordSeq;
      wordEl.textContent = fw.word || '';
      wordEl.className = 'fw-word';
      void wordEl.offsetWidth;
      wordEl.classList.add('fly');
      restartBar(fw.sekundenProWort || 4);
    } else {
      wordEl.textContent = fw.word || '';
    }

    // Balken bei Pause einfrieren, sonst laufen lassen
    barFill.style.animationPlayState = paused ? 'paused' : 'running';

    // Buzz-Ergebnis / Pause-Anzeige
    if (paused && fw.verdict) {
      const v = fw.verdict;
      verdictEl.className = 'fw-verdict ' + (v.wrong ? 'wrong' : 'ok');
      const vChip = avatarChip({ avatar: v.buzzerAvatar, color: v.buzzerColor });
      verdictEl.innerHTML = v.wrong
        ? '<span class="fw-v-title">❌ Falsches Wort!</span>' +
          '<span class="fw-v-sub">🔔 ' + vChip + escapeHtml(v.buzzerName) + '  +' + v.awarded + '</span>'
        : '<span class="fw-v-title">✅ Passt doch!</span>' +
          '<span class="fw-v-sub">🔔 ' + vChip + escapeHtml(v.buzzerName) + '  · Fehlbuzz, keine Punkte</span>';
      statusEl.textContent = 'Warte auf den Master …';
    } else if (paused) {
      verdictEl.className = 'fw-verdict pause';
      verdictEl.innerHTML = '<span class="fw-v-title">⏸ Pause</span>';
      statusEl.textContent = 'Warte auf den Master …';
    } else {
      verdictEl.className = 'fw-verdict hidden';
      statusEl.textContent = 'Wort ' + fw.number + ' / ' + fw.total;
    }
  }

  return { update };
}

// --- Spieler: grosser Buzzer (immer drückbar) + Feedback + Punkte ------------
function createFwPlayer(root, ctx) {
  const btn = document.createElement('button');
  btn.className = 'fw-buzzer';
  btn.textContent = 'BUZZ!';
  const fb = document.createElement('div');
  fb.className = 'fw-p-feedback';
  const score = document.createElement('div');
  score.className = 'mc-p-score';
  root.className = 'game-mount';
  root.appendChild(btn);
  root.appendChild(fb);
  root.appendChild(score);

  let startTime = 0;    // lokaler Wort-Beginn (performance.now) für die Zeitmessung
  let qSeq = -1;
  let sentForSeq = -1;  // verhindert Mehrfach-Buzz für dasselbe Wort

  const onDown = (e) => {
    e.preventDefault();
    const s = ctx.state();
    if (!s || s.settings.activeGame !== 'fw') return;
    if (s.game.locked) return;                 // Killswitch
    const fw = s.game.fw;
    if (!fw || fw.phase !== 'running') return;  // nur solange ein Wort läuft
    if (sentForSeq === fw.wordSeq) return;      // schon für dieses Wort gebuzzert
    sentForSeq = fw.wordSeq;
    const elapsedMs = startTime ? (performance.now() - startTime) : 0;
    ctx.send({ type: 'press', elapsedMs });
  };
  btn.addEventListener('pointerdown', onDown);

  function update(s) {
    const fw = s.game.fw;
    if (!fw) return;
    const pts = s.game.scores[ctx.clientId()] || 0;
    score.textContent = pts > 0 ? 'Deine Punkte: ' + pts : '';

    // Neues laufendes Wort? -> lokalen Zeitstempel setzen
    if (fw.phase === 'running' && fw.wordSeq !== qSeq) { qSeq = fw.wordSeq; startTime = performance.now(); }

    btn.className = 'fw-buzzer';
    fb.className = 'fw-p-feedback';
    const iBuzzed = fw.verdict && fw.verdict.buzzerId === ctx.clientId();

    if (fw.phase === 'lobby') {
      btn.classList.add('idle'); btn.disabled = true; btn.textContent = 'WARTEN';
      fb.textContent = 'Warte auf den Start …';
    } else if (fw.phase === 'done') {
      btn.classList.add('idle'); btn.disabled = true; btn.textContent = '🏁';
      fb.textContent = pts > 0 ? 'Du hast ' + pts + ' Punkte geholt.' : 'Geschafft!';
    } else if (fw.phase === 'running') {
      btn.classList.add('go'); btn.disabled = false; btn.textContent = 'BUZZ!';
      fb.textContent = 'Buzzern, wenn das Wort NICHT passt!';
    } else { // paused
      btn.classList.add('idle'); btn.disabled = true; btn.textContent = 'BUZZ!';
      if (fw.verdict && iBuzzed) {
        if (fw.verdict.wrong) { btn.classList.add('hit'); fb.textContent = '✅ Erwischt! +' + fw.verdict.awarded; fb.classList.add('good'); }
        else { fb.textContent = '❌ Fehlbuzz – das Wort passt.'; fb.classList.add('false'); }
      } else if (fw.verdict) {
        fb.textContent = '🔔 ' + (fw.verdict.buzzerAvatar ? fw.verdict.buzzerAvatar + ' ' : '') + fw.verdict.buzzerName + ' hat gebuzzert';
      } else {
        fb.textContent = '⏸ Pause';
      }
    }
  }

  return { update, destroy() { btn.removeEventListener('pointerdown', onDown); } };
}

// --- Master: Ablaufsteuerung + aktuelles Wort (mit Falle-Markierung) ----------
function createFwMaster(root, ctx) {
  root.innerHTML =
    '<section class="panel">' +
      '<div class="phase-indicator" data-el="phase">–</div>' +
      '<div class="control-grid">' +
        '<button class="btn btn-primary big" data-act="fwStart">▶ Starten</button>' +
        '<button class="btn btn-warn" data-act="fwPause">⏸ Pause</button>' +
        '<button class="btn btn-success big" data-act="fwResume">▶ Weiter</button>' +
        '<button class="btn btn-ghost" data-act="fwReset">↺ Zurücksetzen</button>' +
      '</div>' +
      '<p class="muted small" data-el="hint"></p>' +
    '</section>' +
    '<section class="panel">' +
      '<h3>Aktuelles Wort (<span data-el="prog">0/0</span>)</h3>' +
      '<div class="fw-m-word" data-el="word"></div>' +
      '<div class="fw-m-verdict" data-el="verdict"></div>' +
    '</section>' +
    '<section class="panel proxy-panel" data-el="proxysec">' +
      '<h3>Für Teilnehmer buzzern (Nur-Master-Modus)</h3>' +
      '<div class="proxy-row" data-el="proxy"></div>' +
    '</section>';

  const phaseEl = root.querySelector('[data-el="phase"]');
  const hintEl = root.querySelector('[data-el="hint"]');
  const progEl = root.querySelector('[data-el="prog"]');
  const wordEl = root.querySelector('[data-el="word"]');
  const verdictEl = root.querySelector('[data-el="verdict"]');
  const proxyEl = root.querySelector('[data-el="proxy"]');
  const proxySecEl = root.querySelector('[data-el="proxysec"]');
  const startBtn = root.querySelector('[data-act="fwStart"]');
  const pauseBtn = root.querySelector('[data-act="fwPause"]');
  const resumeBtn = root.querySelector('[data-act="fwResume"]');
  const PHASE_LABEL = { lobby: '⚪ Bereit', running: '▶ Läuft', paused: '⏸ Pausiert', done: '🏁 Endstand' };
  let qSeq = -1;
  let startTime = 0;

  root.querySelectorAll('[data-act]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (b.dataset.act === 'fwReset' && !(await confirmModal('Spiel zurücksetzen? (Punkte bleiben erhalten)', { title: 'Zurücksetzen', okText: 'Zurücksetzen' }))) return;
      ctx.send({ type: 'master', action: b.dataset.act });
    });
  });

  function update(s) {
    const fw = s.game.fw || { phase: 'lobby', total: 0, number: 0 };
    const admin = ctx.admin();
    const cfg = (admin && admin.fwCfg) || null;
    const totalW = cfg ? cfg.woerter.length : fw.total;
    const phase = fw.phase;

    phaseEl.textContent = PHASE_LABEL[phase] || phase;
    progEl.textContent = (phase === 'lobby' || phase === 'done') ? (totalW + ' Wörter') : (fw.number + '/' + fw.total);

    startBtn.disabled = !(phase === 'lobby') || totalW === 0;
    pauseBtn.disabled = phase !== 'running';
    resumeBtn.disabled = phase !== 'paused';

    if (totalW === 0) {
      hintEl.textContent = 'Keine Wörter in diesem Profil. Lege sie im Tab „🎲 Spiele" → „⚙️ Konfigurieren" an.';
    } else if (phase === 'lobby') {
      hintEl.textContent = totalW + ' Wörter bereit. Buzz auf ein Falschwort gibt ' + (cfg ? cfg.punkte : '?') + ' Punkte.';
    } else if (phase === 'running') {
      hintEl.textContent = 'Wörter laufen automatisch (' + (cfg ? cfg.sekundenProWort : '?') + 's). Ein Buzz pausiert.';
    } else if (phase === 'paused') {
      hintEl.textContent = fw.pausedByBuzz === false && !fw.verdict
        ? 'Manuell pausiert – „Weiter" setzt dasselbe Wort fort.'
        : '„Weiter" zeigt das nächste Wort.';
    } else {
      hintEl.textContent = 'Durchlauf beendet. „Zurücksetzen" für eine neue Runde.';
    }

    // Aktuelles Wort mit Falle-Markierung (master-exklusiv über fwCurrentWrong).
    const cw = s.game.fwCurrentWrong;   // true = Falle, false = passt, null = keins
    if ((phase === 'running' || phase === 'paused') && fw.word != null) {
      wordEl.innerHTML = '<span class="fw-m-wtext">' + escapeHtml(fw.word) + '</span>' +
        (cw === true ? '<span class="fw-m-badge wrong">❌ Falle</span>'
          : cw === false ? '<span class="fw-m-badge ok">✅ passt</span>' : '');
    } else if (phase === 'lobby') {
      wordEl.innerHTML = '<span class="muted">Noch nicht gestartet.</span>';
    } else {
      wordEl.innerHTML = '<span class="muted">–</span>';
    }

    // Buzz-Ergebnis
    if (phase === 'paused' && fw.verdict) {
      const v = fw.verdict;
      verdictEl.className = 'fw-m-verdict ' + (v.wrong ? 'wrong' : 'ok');
      const vAvatar = v.buzzerAvatar ? v.buzzerAvatar + ' ' : '';
      verdictEl.textContent = v.wrong
        ? '🔔 ' + vAvatar + v.buzzerName + ' hat erwischt — +' + v.awarded + ' Punkte'
        : '🔔 ' + vAvatar + v.buzzerName + ' — Fehlbuzz (keine Punkte)';
    } else if (phase === 'paused') {
      verdictEl.className = 'fw-m-verdict pause';
      verdictEl.textContent = '⏸ Manuell pausiert';
    } else {
      verdictEl.className = 'fw-m-verdict hidden';
      verdictEl.textContent = '';
    }

    // Stellvertreter-Buzzer (Nur-Master-Modus)
    const masterOnly = !!(s.settings && s.settings.masterOnlyMode);
    proxySecEl.classList.toggle('hidden', !masterOnly);
    if (phase === 'running' && fw.wordSeq !== qSeq) { qSeq = fw.wordSeq; startTime = performance.now(); }
    const canBuzz = masterOnly && phase === 'running';
    proxyEl.classList.toggle('hidden', !canBuzz);
    if (canBuzz) {
      renderProxyBuzzRow(proxyEl, proxyPlayers(s), (clientId) => {
        const elapsedMs = startTime ? (performance.now() - startTime) : 0;
        ctx.send({ type: 'master', action: 'masterPress', clientId, elapsedMs });
      });
    }
  }

  return { update };
}

