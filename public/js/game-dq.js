'use strict';
// Spiel: Detektivquiz – Bildschirm/Spieler/Master-Module.

// ===========================================================================
// SPIEL: Detektivquiz (dq) – Hinweise nacheinander, je früher, desto mehr Punkte
// ===========================================================================
// Punktwert bei „level" aufgedeckten Hinweisen (1-basiert). Muss zur Server-Formel
// (dqPointsAt) passen: Startpunkte minus Abzug je Hinweis nach dem ersten, mit Boden.
function dqPts(cfg, level) {
  if (!cfg) return 0;
  let p = cfg.startPunkte - cfg.abzugProHinweis * (Math.max(1, level) - 1);
  p = Math.round(p);
  if (p < cfg.minPunkte) p = cfg.minPunkte;
  if (p > cfg.startPunkte) p = cfg.startPunkte;
  return p;
}

// --- Bildschirm: Titel + grosser Punktwert + aufgedeckte Hinweise + Auflösung -
function createDqScreen(root, ctx) {
  root.innerHTML =
    '<div class="dq-screen">' +
      '<div class="mc-topline"><span class="mc-intro" data-el="intro"></span>' +
        '<span class="mc-counter" data-el="counter"></span></div>' +
      '<div class="dq-points-wrap" data-el="pw">' +
        '<span class="dq-points" data-el="points"></span>' +
        '<span class="dq-points-cap" data-el="pcap"></span>' +
      '</div>' +
      '<div class="dq-clues" data-el="clues"></div>' +
      '<div class="dq-solution" data-el="solution"></div>' +
      '<div class="dq-status" data-el="status"></div>' +
      '<div class="mc-final" data-el="final">' +
        '<div class="mc-final-title">🏁 Endstand</div>' +
        '<div class="leaderboard"></div>' +
      '</div>' +
    '</div>';
  const introEl = root.querySelector('[data-el="intro"]');
  const counterEl = root.querySelector('[data-el="counter"]');
  const pwEl = root.querySelector('[data-el="pw"]');
  const pointsEl = root.querySelector('[data-el="points"]');
  const pcapEl = root.querySelector('[data-el="pcap"]');
  const cluesEl = root.querySelector('[data-el="clues"]');
  const solutionEl = root.querySelector('[data-el="solution"]');
  const statusEl = root.querySelector('[data-el="status"]');
  const finalEl = root.querySelector('[data-el="final"]');
  let prevNumber = -1;    // Fallwechsel erkennen (Hinweise neu aufbauen)
  let prevRevealed = 0;   // neu aufgedeckten Hinweis animieren

  function renderClues(hinweise, animateLast) {
    cluesEl.innerHTML = '';
    (hinweise || []).forEach((h, i) => {
      const row = document.createElement('div');
      row.className = 'dq-clue';
      if (animateLast && i === hinweise.length - 1) row.classList.add('pop');
      row.innerHTML = '<span class="dq-clue-num">' + (i + 1) + '</span>' +
        '<span class="dq-clue-text">' + escapeHtml(h) + '</span>';
      cluesEl.appendChild(row);
    });
  }

  function update(s) {
    const dq = s.game.dq;
    if (!dq) return;
    introEl.textContent = dq.intro || '';

    // Endstand
    if (dq.phase === 'done') {
      prevNumber = -1; prevRevealed = 0;
      pwEl.classList.add('hidden'); cluesEl.classList.add('hidden');
      solutionEl.classList.add('hidden'); statusEl.classList.add('hidden');
      counterEl.textContent = dq.total + ' Fälle';
      finalEl.classList.remove('hidden');
      renderLeaderboard(finalEl, s);
      return;
    }
    finalEl.classList.add('hidden');
    cluesEl.classList.remove('hidden'); statusEl.classList.remove('hidden');

    // Lobby
    if (dq.phase === 'lobby') {
      prevNumber = -1; prevRevealed = 0;
      counterEl.textContent = dq.total ? (dq.total + ' Fälle') : '';
      pwEl.classList.remove('hidden');
      pointsEl.className = 'dq-points dummy';
      pointsEl.textContent = dq.startPunkte;
      pcapEl.textContent = 'Startpunkte';
      cluesEl.innerHTML = '';
      solutionEl.classList.add('hidden');
      statusEl.textContent = dq.total ? 'Gleich geht’s los … buzzern oder tippen' : 'Keine Fälle im Profil';
      return;
    }

    // running / reveal
    const reveal = dq.phase === 'reveal';
    counterEl.textContent = 'Fall ' + dq.number + ' / ' + dq.total;

    // Hinweise: bei Fallwechsel komplett neu, sonst nur den neuen animieren.
    const isNewCase = dq.number !== prevNumber;
    const grew = !isNewCase && dq.revealed > prevRevealed;
    renderClues(dq.hinweise, grew);
    prevNumber = dq.number; prevRevealed = dq.revealed;

    pwEl.classList.remove('hidden');
    if (reveal) {
      // Punktefeld tritt zurueck, die Lösung uebernimmt die Buehne.
      pointsEl.className = 'dq-points dummy';
      pointsEl.textContent = '🔎';
      pcapEl.textContent = 'Aufgelöst';
      solutionEl.classList.remove('hidden');
      const winTxt = dq.winner
        ? '<span class="dq-sol-win">🏆 ' + avatarChip(dq.winner) + escapeHtml(dq.winner.name) + '  +' + dq.winner.points + '</span>'
        : '<span class="dq-sol-none">Niemand hat es erraten</span>';
      // Optionales Lösungsbild sitzt über dem Lösungstext und erscheint mit ihm.
      const imgHtml = dq.loesungBild
        ? '<img class="dq-sol-img" alt="" src="/backgrounds/' + encodeURIComponent(dq.loesungBild) + '">' : '';
      solutionEl.innerHTML = imgHtml + '<span class="dq-sol-label">Lösung</span>' +
        '<span class="dq-sol-text">' + escapeHtml(dq.loesung || '') + '</span>' + winTxt;
      statusEl.textContent = '';
    } else {
      pointsEl.className = 'dq-points';
      pointsEl.textContent = dq.pointsNow;
      pointsEl.classList.toggle('low', dq.pointsNow <= dq.minPunkte);
      pcapEl.textContent = 'Punkte bei Lösung jetzt';
      solutionEl.classList.add('hidden');
      if (dq.buzz) {
        statusEl.textContent = '🔔 ' + (dq.buzz.avatar ? dq.buzz.avatar + ' ' : '') + dq.buzz.name + ' hat gebuzzert – Master entscheidet …';
      } else {
        statusEl.textContent = 'Hinweis ' + dq.revealed + ' / ' + dq.hintCount;
      }
    }
  }

  return { update };
}

// --- Spieler: Hinweise + Punktwert + (Freitext) Eingabe ODER (Buzzer) Buzzer --
function createDqPlayer(root, ctx) {
  root.className = 'game-mount';
  root.innerHTML =
    '<div class="dq-player">' +
      '<div class="mc-p-counter" data-el="counter"></div>' +
      '<div class="dq-p-points" data-el="points"></div>' +
      '<div class="dq-p-clues" data-el="clues"></div>' +
      '<form class="dq-p-form hidden" data-el="form">' +
        '<input class="dq-p-input" data-el="input" type="text" maxlength="80" ' +
          'placeholder="Deine Lösung …" autocomplete="off" autocapitalize="off" autocorrect="off" />' +
        '<button class="btn btn-primary" data-el="send" type="submit">Tippen</button>' +
      '</form>' +
      '<button class="fw-buzzer dq-buzzer hidden" data-el="buzzer" type="button">BUZZ!</button>' +
      '<div class="mc-p-feedback dq-p-feedback" data-el="feedback"></div>' +
      '<div class="mc-p-score" data-el="score"></div>' +
    '</div>';
  const counterEl = root.querySelector('[data-el="counter"]');
  const pointsEl = root.querySelector('[data-el="points"]');
  const cluesEl = root.querySelector('[data-el="clues"]');
  const form = root.querySelector('[data-el="form"]');
  const input = root.querySelector('[data-el="input"]');
  const buzzer = root.querySelector('[data-el="buzzer"]');
  const fbEl = root.querySelector('[data-el="feedback"]');
  const scoreEl = root.querySelector('[data-el="score"]');
  let startTime = 0;      // lokaler Fallbeginn (performance.now) fuer Buzzer-Zeitmessung
  let qNum = -1;

  const onSubmit = (e) => {
    e.preventDefault();
    const s = ctx.state();
    if (!s || s.game.locked) return;
    const dq = s.game.dq;
    if (!dq || dq.phase !== 'running' || dq.buzzerModus) return;
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    ctx.send({ type: 'guess', text });
    input.value = '';
    input.focus();
  };
  form.addEventListener('submit', onSubmit);

  const onBuzz = (e) => {
    e.preventDefault();
    const s = ctx.state();
    if (!s || s.game.locked) return;
    const dq = s.game.dq;
    if (!dq || !dq.buzzerModus || dq.phase !== 'running') return;
    if (dq.buzz) return;                        // es wartet schon ein Buzz
    const elapsedMs = startTime ? (performance.now() - startTime) : 0;
    ctx.send({ type: 'press', elapsedMs });
  };
  buzzer.addEventListener('pointerdown', onBuzz);

  function renderClues(hinweise) {
    cluesEl.innerHTML = '';
    (hinweise || []).forEach((h, i) => {
      const row = document.createElement('div');
      row.className = 'dq-clue';
      row.innerHTML = '<span class="dq-clue-num">' + (i + 1) + '</span>' +
        '<span class="dq-clue-text">' + escapeHtml(h) + '</span>';
      cluesEl.appendChild(row);
    });
  }

  function update(s) {
    const dq = s.game.dq;
    if (!dq) return;
    const pts = s.game.scores[ctx.clientId()] || 0;
    scoreEl.textContent = pts > 0 ? 'Deine Punkte: ' + pts : '';
    const buzzMode = !!dq.buzzerModus;

    // Fallwechsel -> lokalen Zeitstempel setzen
    if (dq.number !== qNum) { qNum = dq.number; startTime = performance.now(); }

    // Lobby / Endstand
    if (dq.phase === 'lobby' || dq.phase === 'done') {
      counterEl.textContent = dq.phase === 'done' ? 'Quiz beendet' : '';
      pointsEl.textContent = ''; pointsEl.className = 'dq-p-points';
      cluesEl.innerHTML = '';
      form.classList.add('hidden'); buzzer.classList.add('hidden');
      fbEl.className = 'mc-p-feedback dq-p-feedback';
      if (dq.phase === 'done') fbEl.textContent = pts > 0 ? 'Du hast ' + pts + ' Punkte geholt.' : 'Geschafft!';
      else fbEl.textContent = 'Warte auf den Start …';
      return;
    }

    const reveal = dq.phase === 'reveal';
    const locked = !!s.game.locked;
    counterEl.textContent = 'Fall ' + dq.number + ' / ' + dq.total;
    renderClues(dq.hinweise);

    // Punktwert (aktuell erreichbar bzw. bei Auflösung die Lösung)
    pointsEl.className = 'dq-p-points';
    if (reveal) {
      pointsEl.textContent = dq.loesung || '–';
      pointsEl.classList.add('solution');
    } else {
      pointsEl.textContent = dq.pointsNow;
      pointsEl.classList.toggle('low', dq.pointsNow <= dq.minPunkte);
    }

    // Eingabe- bzw. Buzzer-Bereich je nach Modus
    fbEl.className = 'mc-p-feedback dq-p-feedback';
    if (buzzMode) {
      form.classList.add('hidden');
      buzzer.classList.remove('hidden');
      const iBuzzed = dq.buzz && dq.buzz.id === ctx.clientId();
      buzzer.className = 'fw-buzzer dq-buzzer';
      if (reveal) {
        buzzer.classList.add('idle'); buzzer.disabled = true; buzzer.textContent = 'BUZZ!';
        if (dq.winner && dq.winner.id === ctx.clientId()) { buzzer.classList.remove('idle'); buzzer.classList.add('hit'); fbEl.textContent = '✓ Erwischt! +' + dq.winner.points; }
        else if (dq.winner && dq.winner.name) fbEl.textContent = '🏆 ' + (dq.winner.avatar ? dq.winner.avatar + ' ' : '') + dq.winner.name + ' hatte es!';
        else fbEl.textContent = 'Aufgelöst.';
      } else if (dq.buzz) {
        buzzer.classList.add('idle'); buzzer.disabled = true; buzzer.textContent = 'BUZZ!';
        fbEl.textContent = iBuzzed ? '🔔 Du hast gebuzzert – sag die Lösung!' : '🔔 ' + (dq.buzz.avatar ? dq.buzz.avatar + ' ' : '') + dq.buzz.name + ' hat gebuzzert';
      } else {
        buzzer.classList.add('go'); buzzer.disabled = locked; buzzer.textContent = 'BUZZ!';
        fbEl.textContent = locked ? '🔒 Gesperrt' : 'Buzzern, sobald du die Lösung kennst!';
      }
    } else {
      buzzer.classList.add('hidden');
      const myGuess = s.game.dqMyGuess || null;
      if (reveal) {
        form.classList.add('hidden');
        if (dq.winner && dq.winner.id === ctx.clientId()) fbEl.textContent = '✓ Richtig! +' + dq.winner.points;
        else if (dq.winner && dq.winner.name) fbEl.textContent = '🏆 ' + (dq.winner.avatar ? dq.winner.avatar + ' ' : '') + dq.winner.name + ' war schneller.';
        else fbEl.textContent = 'Aufgelöst.';
      } else {
        form.classList.remove('hidden');
        input.disabled = locked;
        root.querySelector('[data-el="send"]').disabled = locked;
        fbEl.textContent = myGuess
          ? 'Zuletzt getippt: „' + myGuess.text + '" – der Master prüft.'
          : (locked ? '🔒 Gesperrt' : 'Tippe deine Lösung – je früher, desto mehr Punkte!');
      }
    }
  }

  return {
    update,
    destroy() {
      form.removeEventListener('submit', onSubmit);
      buzzer.removeEventListener('pointerdown', onBuzz);
    }
  };
}

// --- Master: Ablaufsteuerung + aktueller Fall (mit Lösung) + Werten -----------
function createDqMaster(root, ctx) {
  root.innerHTML =
    '<section class="panel">' +
      '<div class="phase-indicator" data-el="phase">–</div>' +
      '<div class="control-grid">' +
        '<button class="btn btn-primary big" data-act="dqStart">▶ Starten</button>' +
        '<button class="btn btn-warn big" data-act="dqClue">🔎 Nächster Hinweis</button>' +
        '<button class="btn btn-ghost" data-act="dqReveal">💡 Lösung zeigen</button>' +
        '<button class="btn btn-success" data-act="dqNext">⏭ Nächster Fall</button>' +
        '<button class="btn btn-ghost" data-act="dqReset">↺ Zurücksetzen</button>' +
      '</div>' +
      '<p class="muted small" data-el="hint"></p>' +
    '</section>' +
    '<section class="panel">' +
      '<h3>Aktueller Fall (<span data-el="prog">0/0</span>)</h3>' +
      '<div class="dq-m-solution" data-el="solution"></div>' +
      '<div class="dq-m-clues" data-el="clues"></div>' +
    '</section>' +
    '<section class="panel" data-el="buzzpanel">' +
      '<h3 data-el="btitle">Antworten</h3>' +
      '<div class="dq-m-body" data-el="body"></div>' +
    '</section>';

  const phaseEl = root.querySelector('[data-el="phase"]');
  const hintEl = root.querySelector('[data-el="hint"]');
  const progEl = root.querySelector('[data-el="prog"]');
  const solutionEl = root.querySelector('[data-el="solution"]');
  const cluesEl = root.querySelector('[data-el="clues"]');
  const btitleEl = root.querySelector('[data-el="btitle"]');
  const bodyEl = root.querySelector('[data-el="body"]');
  const startBtn = root.querySelector('[data-act="dqStart"]');
  const clueBtn = root.querySelector('[data-act="dqClue"]');
  const revealBtn = root.querySelector('[data-act="dqReveal"]');
  const nextBtn = root.querySelector('[data-act="dqNext"]');
  const PHASE_LABEL = { lobby: '⚪ Bereit', running: '🔎 Fall läuft', reveal: '💡 Aufgelöst', done: '🏁 Endstand' };

  root.querySelectorAll('[data-act]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (b.dataset.act === 'dqReset' && !(await confirmModal('Quiz zurücksetzen? (Punkte bleiben erhalten)', { title: 'Zurücksetzen', okText: 'Zurücksetzen' }))) return;
      ctx.send({ type: 'master', action: b.dataset.act });
    });
  });

  function update(s) {
    const dq = s.game.dq || { phase: 'lobby', total: 0 };
    const admin = ctx.admin();
    const cfg = (admin && admin.dqCfg) || null;
    const totalC = cfg ? cfg.faelle.length : dq.total;
    const buzzMode = cfg ? cfg.buzzerModus : !!dq.buzzerModus;
    const phase = dq.phase;
    const masterOnly = !!(s.settings && s.settings.masterOnlyMode);

    phaseEl.textContent = PHASE_LABEL[phase] || phase;
    progEl.textContent = (phase === 'lobby' || phase === 'done')
      ? (totalC + ' Fälle') : (dq.number + '/' + dq.total);

    const isLast = dq.number >= dq.total;
    nextBtn.textContent = (phase === 'reveal' && isLast) ? '🏁 Endstand' : '⏭ Nächster Fall';

    startBtn.disabled = !(phase === 'lobby') || totalC === 0;
    clueBtn.disabled = !(phase === 'running') || !!dq.buzz || (dq.revealed >= dq.hintCount);
    revealBtn.disabled = phase !== 'running';
    nextBtn.disabled = phase !== 'reveal';

    if (totalC === 0) {
      hintEl.textContent = 'Keine Fälle in diesem Profil. Lege sie im Tab „🎲 Spiele" → „⚙️ Konfigurieren" an.';
    } else if (phase === 'lobby') {
      const rate = cfg ? (cfg.startPunkte + ' → ' + cfg.minPunkte + ', −' + cfg.abzugProHinweis + '/Hinweis') : '';
      hintEl.textContent = totalC + ' Fall' + (totalC === 1 ? '' : 'e') + ' bereit · ' +
        (buzzMode ? 'Buzzer-Modus' : 'Freitext-Modus') + (rate ? ' · ' + rate : '');
    } else if (phase === 'running') {
      hintEl.textContent = dq.buzz
        ? '🔔 ' + (dq.buzz.avatar ? dq.buzz.avatar + ' ' : '') + dq.buzz.name + ' hat gebuzzert – „Richtig" oder „Falsch" wählen.'
        : (buzzMode ? 'Spieler buzzern. Bei jedem Hinweis sinken die Punkte.' : 'Spieler tippen. „Richtig" bei einem Spieler beendet den Fall.');
    } else if (phase === 'reveal') {
      hintEl.textContent = isLast ? 'Letzter Fall – „Endstand" zeigt die Gesamtwertung.' : '„Nächster Fall" geht weiter.';
    } else {
      hintEl.textContent = 'Quiz beendet. „Zurücksetzen" für einen neuen Durchlauf.';
    }

    // Aktueller Fall: Lösung (master-exklusiv) + alle Hinweise (aufgedeckt markiert)
    const dqCase = s.game.dqCase || null;
    if (dqCase && (phase === 'running' || phase === 'reveal')) {
      solutionEl.innerHTML = '<span class="dq-m-sol-cap">Lösung</span><span class="dq-m-sol-text">' +
        escapeHtml(dqCase.loesung) + '</span>' +
        '<span class="dq-m-sol-pts">' + (phase === 'running' ? ('Jetzt: ' + dqPts(cfg, dq.revealed) + ' Pkt') : '') + '</span>';
      cluesEl.innerHTML = '';
      dqCase.hinweise.forEach((h, i) => {
        const open = i < dq.revealed;
        const row = document.createElement('div');
        row.className = 'dq-m-clue' + (open ? ' open' : '') + (i === dq.revealed && phase === 'running' ? ' next' : '');
        row.innerHTML = '<span class="dq-clue-num">' + (i + 1) + '</span>' +
          '<span class="dq-clue-text">' + escapeHtml(h) + '</span>' +
          '<span class="dq-m-clue-pts">' + dqPts(cfg, i + 1) + '</span>';
        cluesEl.appendChild(row);
      });
    } else if (phase === 'lobby') {
      solutionEl.innerHTML = '<span class="muted">Noch nicht gestartet.</span>';
      cluesEl.innerHTML = '';
    } else {
      solutionEl.innerHTML = '<span class="muted">–</span>';
      cluesEl.innerHTML = '';
    }

    // Antwort-/Buzzer-Bereich je nach Modus
    const players = (s.participants || []).filter((p) => p.role === 'player');
    bodyEl.innerHTML = '';
    if (buzzMode) {
      btitleEl.textContent = 'Buzzer';
      if (phase === 'running' && dq.buzz) {
        const box = document.createElement('div');
        box.className = 'dq-m-buzz';
        box.innerHTML = '<div class="dq-m-buzz-name">🔔 ' + avatarChip(dq.buzz) + escapeHtml(dq.buzz.name) +
          ' <span class="dq-m-buzz-pts">+' + dqPts(cfg, dq.revealed) + '</span></div>';
        const btns = document.createElement('div');
        btns.className = 'row-buttons';
        const ok = document.createElement('button');
        ok.className = 'btn btn-success'; ok.textContent = '✓ Richtig';
        ok.addEventListener('click', () => ctx.send({ type: 'master', action: 'dqOk' }));
        const no = document.createElement('button');
        no.className = 'btn btn-danger'; no.textContent = '✗ Falsch';
        no.addEventListener('click', () => ctx.send({ type: 'master', action: 'dqWrong' }));
        btns.appendChild(ok); btns.appendChild(no);
        box.appendChild(btns);
        bodyEl.appendChild(box);
      } else if (phase === 'running') {
        bodyEl.innerHTML = '<p class="muted small">Warte auf einen Buzz … die Spieler sagen die Lösung laut.</p>';
        if (masterOnly) {
          const proxy = document.createElement('div');
          proxy.className = 'proxy-panel';
          proxy.innerHTML = '<p class="muted small">Nur-Master-Modus: für Teilnehmer buzzern</p><div class="proxy-row"></div>';
          bodyEl.appendChild(proxy);
          renderProxyBuzzRow(proxy.querySelector('.proxy-row'), players, (clientId) => {
            ctx.send({ type: 'master', action: 'masterPress', clientId });
          });
        }
      } else {
        bodyEl.innerHTML = '<p class="muted small">Im Buzzer-Modus buzzern die Spieler und sagen die Lösung laut.</p>';
      }
    } else {
      // Freitext: letzte Tipps je Spieler + „Richtig"-Button (vergibt eingefrorene Punkte)
      btitleEl.textContent = 'Tipps der Spieler';
      if (phase === 'running' && masterOnly) {
        const proxy = document.createElement('div');
        proxy.className = 'proxy-pick';
        proxy.innerHTML =
          '<span class="muted small">Nur-Master-Modus: Tipp eintragen für</span>' +
          '<select data-el="proxysel"></select>' +
          '<input type="text" maxlength="80" placeholder="Genannte Lösung …" data-el="proxytext" />' +
          '<button class="btn btn-ghost small" data-el="proxybtn">Eintragen</button>';
        bodyEl.appendChild(proxy);
        const sel = proxy.querySelector('[data-el="proxysel"]');
        const txt = proxy.querySelector('[data-el="proxytext"]');
        fillProxySelect(sel, players, false);
        proxy.querySelector('[data-el="proxybtn"]').addEventListener('click', () => {
          const text = txt.value.trim();
          if (!sel.value || !text) return;
          ctx.send({ type: 'master', action: 'masterGuess', clientId: sel.value, text });
          txt.value = '';
        });
      }
      const guesses = s.game.dqGuesses || {};
      players.forEach((p) => {
        const g = guesses[p.id];
        const row = document.createElement('div');
        row.className = 'dq-m-prow' + (g ? ' has' : '');
        row.innerHTML =
          '<span class="dev-dot' + (p.online ? ' online' : '') + '"><span class="led"></span></span>' +
          avatarChip(p) +
          '<span class="dq-m-pname">' + escapeHtml(p.name) + '</span>' +
          '<span class="dq-m-pguess">' + (g ? '„' + escapeHtml(g.text) + '"' : '—') + '</span>';
        if (g && phase === 'running') {
          const award = document.createElement('button');
          award.className = 'btn btn-success small';
          award.textContent = '✓ +' + dqPts(cfg, g.level);
          award.title = 'Als richtig werten (' + dqPts(cfg, g.level) + ' Punkte)';
          award.addEventListener('click', () => ctx.send({ type: 'master', action: 'dqAward', clientId: p.id }));
          row.appendChild(award);
        }
        bodyEl.appendChild(row);
      });
      if (players.length === 0) bodyEl.innerHTML = '<p class="muted small">Noch keine Spieler verbunden.</p>';
    }
  }

  return { update };
}

