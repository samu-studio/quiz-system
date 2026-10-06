'use strict';
// Spiel: Schätzquiz – Bildschirm/Spieler/Master-Module.

// ===========================================================================
// SPIEL: Schätzquiz (sq) – Zahlen schätzen, je näher an der Wahrheit desto mehr Punkte
// ===========================================================================

// Zahl deutsch formatieren (bis 2 Nachkommastellen, ohne unnoetige Nullen).
// Tausender-Trennung erst ab 10000, damit Jahreszahlen (2007) nicht als „2.007"
// erscheinen, grosse Zahlen (83.500.000) aber lesbar gruppiert werden.
function sqFmt(n) {
  if (!Number.isFinite(n)) return '–';
  return n.toLocaleString('de-DE', { maximumFractionDigits: 2, useGrouping: Math.abs(n) >= 10000 });
}
// Zahl + Einheit (Einheit optional).
function sqFmtU(n, unit) {
  return sqFmt(n) + (unit ? ' ' + unit : '');
}
// Abweichungs-Bruch (0 = perfekt) als Prozent-Text.
function sqPct(dev) {
  if (!Number.isFinite(dev)) return '–';
  return (dev * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' %';
}

// --- Bildschirm: Frage + (bei Auflösung) tatsächlicher Wert + Rangliste ------
function createSqScreen(root, ctx) {
  root.innerHTML =
    '<div class="mc-screen sq-screen">' +
      '<div class="mc-topline"><span class="mc-intro" data-el="intro"></span>' +
        '<span class="mc-counter" data-el="counter"></span></div>' +
      '<div class="mc-question" data-el="question"></div>' +
      '<div class="sq-true" data-el="true"></div>' +
      '<div class="mc-answered" data-el="answered"></div>' +
      '<div class="sq-results" data-el="results"></div>' +
      '<div class="mc-final" data-el="final">' +
        '<div class="mc-final-title">🏁 Endstand</div>' +
        '<div class="leaderboard"></div>' +
      '</div>' +
    '</div>';
  const introEl = root.querySelector('[data-el="intro"]');
  const counterEl = root.querySelector('[data-el="counter"]');
  const qEl = root.querySelector('[data-el="question"]');
  const trueEl = root.querySelector('[data-el="true"]');
  const answeredEl = root.querySelector('[data-el="answered"]');
  const resultsEl = root.querySelector('[data-el="results"]');
  const finalEl = root.querySelector('[data-el="final"]');

  function update(s) {
    const sq = s.game.sq;
    if (!sq) return;
    introEl.textContent = sq.intro || '';

    if (sq.phase === 'done') {
      qEl.classList.add('hidden'); trueEl.classList.add('hidden');
      answeredEl.classList.add('hidden'); resultsEl.classList.add('hidden');
      counterEl.textContent = sq.total + ' Fragen';
      finalEl.classList.remove('hidden');
      renderLeaderboard(finalEl, s);
      return;
    }
    finalEl.classList.add('hidden');
    qEl.classList.remove('hidden');

    if (sq.phase === 'lobby' || !sq.question) {
      counterEl.textContent = sq.total ? (sq.total + ' Fragen') : '';
      qEl.innerHTML = '<span class="mc-ready">das Schätzquiz startet gleich …</span>';
      trueEl.classList.add('hidden');
      answeredEl.classList.remove('hidden'); answeredEl.textContent = '';
      resultsEl.classList.add('hidden');
      return;
    }

    counterEl.textContent = 'Frage ' + sq.number + ' / ' + sq.total;
    qEl.textContent = sq.question;

    if (sq.phase === 'reveal') {
      trueEl.classList.remove('hidden');
      trueEl.innerHTML = '<span class="sq-true-cap">Tatsächlich</span>' +
        '<span class="sq-true-val">' + escapeHtml(sqFmtU(sq.loesung, sq.einheit)) + '</span>';
      answeredEl.classList.add('hidden');
      resultsEl.classList.remove('hidden');
      const rows = (sq.results || []).slice(0, 12);
      if (rows.length === 0) {
        resultsEl.innerHTML = '<p class="sq-none">Keine Schätzungen abgegeben.</p>';
      } else {
        resultsEl.innerHTML = '';
        rows.forEach((r, i) => {
          const row = document.createElement('div');
          row.className = 'sq-res-row' + (r.pts > 0 && i === 0 ? ' top' : '');
          row.innerHTML =
            '<span class="sq-res-rank">' + (i + 1) + '</span>' +
            '<span class="sq-res-name">' + avatarChip(r) + escapeHtml(r.name) + '</span>' +
            '<span class="sq-res-guess">' + escapeHtml(sqFmtU(r.value, sq.einheit)) + '</span>' +
            '<span class="sq-res-dev">Δ ' + sqPct(r.dev) + '</span>' +
            '<span class="sq-res-pts">' + (r.pts > 0 ? '+' + r.pts : '–') + '</span>';
          resultsEl.appendChild(row);
        });
      }
    } else {
      trueEl.classList.add('hidden');
      resultsEl.classList.add('hidden');
      answeredEl.classList.remove('hidden');
      answeredEl.textContent = sq.answeredCount + ' Schätzung' + (sq.answeredCount === 1 ? '' : 'en') + ' abgegeben';
    }
  }

  return { update };
}

// --- Spieler: Slider ODER Zahlenfeld (bis zum Auflösen änderbar) + Auflösung --
function createSqPlayer(root, ctx) {
  root.innerHTML =
    '<div class="mc-player sq-player">' +
      '<div class="mc-p-counter" data-el="counter"></div>' +
      '<div class="mc-p-question" data-el="question"></div>' +
      '<div class="sq-input" data-el="input"></div>' +
      '<div class="mc-p-feedback" data-el="feedback"></div>' +
      '<div class="mc-p-score" data-el="score"></div>' +
    '</div>';
  const counterEl = root.querySelector('[data-el="counter"]');
  const qEl = root.querySelector('[data-el="question"]');
  const inputEl = root.querySelector('[data-el="input"]');
  const fbEl = root.querySelector('[data-el="feedback"]');
  const scoreEl = root.querySelector('[data-el="score"]');

  let sig = null;          // Signatur des aktuellen Eingabe-DOM (Frage/Phase/Grenzen)
  let sendTimer = 0;
  let touched = false;     // hat der Spieler diese Frage schon etwas eingegeben?

  function sendNow(v) {
    if (!Number.isFinite(v)) return;
    touched = true;
    ctx.send({ type: 'estimate', value: v });
  }
  function sendDebounced(v) {
    if (!Number.isFinite(v)) return;
    touched = true;
    if (sendTimer) clearTimeout(sendTimer);
    sendTimer = setTimeout(() => { sendTimer = 0; ctx.send({ type: 'estimate', value: v }); }, 150);
  }

  // Eingabe-DOM aufbauen: Slider (wenn min/max gesetzt) sonst Zahlenfeld.
  function buildInput(sq, myAnswer) {
    inputEl.innerHTML = '';
    const unit = sq.einheit || '';
    const hasSlider = Number.isFinite(sq.min) && Number.isFinite(sq.max) && sq.max > sq.min;
    if (hasSlider) {
      const start = Number.isFinite(myAnswer) ? myAnswer : (sq.min + (sq.max - sq.min) / 2);
      const val = document.createElement('div');
      val.className = 'sq-slider-val';
      const range = document.createElement('input');
      range.type = 'range';
      range.className = 'sq-slider';
      range.min = sq.min; range.max = sq.max;
      range.step = (Number.isFinite(sq.step) && sq.step > 0) ? sq.step : 'any';
      range.value = start;
      const paint = (v) => { val.textContent = sqFmtU(Number(v), unit); };
      paint(start);
      range.addEventListener('input', () => { paint(range.value); sendDebounced(Number(range.value)); });
      range.addEventListener('change', () => { paint(range.value); sendNow(Number(range.value)); });
      const scale = document.createElement('div');
      scale.className = 'sq-slider-scale';
      scale.innerHTML = '<span>' + escapeHtml(sqFmtU(sq.min, unit)) + '</span>' +
        '<span>' + escapeHtml(sqFmtU(sq.max, unit)) + '</span>';
      inputEl.appendChild(val);
      inputEl.appendChild(range);
      inputEl.appendChild(scale);
    } else {
      const wrap = document.createElement('div');
      wrap.className = 'sq-num-wrap';
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.inputMode = 'decimal';
      inp.className = 'sq-num';
      inp.placeholder = 'Deine Zahl …';
      if (Number.isFinite(myAnswer)) inp.value = sqFmt(myAnswer);
      const parse = () => {
        const t = inp.value.trim().replace(/\s/g, '').replace(',', '.');
        if (t === '') return null;
        const n = Number(t);
        return Number.isFinite(n) ? n : null;
      };
      inp.addEventListener('input', () => { const n = parse(); if (n !== null) sendDebounced(n); });
      inp.addEventListener('change', () => { const n = parse(); if (n !== null) sendNow(n); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const n = parse(); if (n !== null) { sendNow(n); inp.blur(); } } });
      wrap.appendChild(inp);
      if (unit) { const u = document.createElement('span'); u.className = 'sq-num-unit'; u.textContent = unit; wrap.appendChild(u); }
      inputEl.appendChild(wrap);
    }
  }

  // Auflösungs-Ansicht: eigene Schätzung / tatsächlich / Abweichung + Punkte.
  function renderReveal(sq, myAnswer) {
    inputEl.innerHTML = '';
    const unit = sq.einheit || '';
    const myResult = (sq.results || []).find((r) => r.id === ctx.clientId());
    const box = document.createElement('div');
    box.className = 'sq-reveal-box';
    const rows = [];
    rows.push(['Deine Schätzung', Number.isFinite(myAnswer) ? sqFmtU(myAnswer, unit) : '—']);
    rows.push(['Tatsächlich', sqFmtU(sq.loesung, unit)]);
    if (myResult) rows.push(['Abweichung', sqPct(myResult.dev)]);
    box.innerHTML = rows.map((r) =>
      '<div class="sq-rev-row"><span>' + r[0] + '</span><b>' + escapeHtml(r[1]) + '</b></div>').join('');
    inputEl.appendChild(box);

    fbEl.className = 'mc-p-feedback';
    if (!Number.isFinite(myAnswer)) { fbEl.textContent = 'Keine Schätzung abgegeben'; fbEl.classList.add('miss'); }
    else if (myResult && myResult.pts > 0) { fbEl.textContent = '✓ +' + myResult.pts + ' Punkte'; fbEl.classList.add('good'); }
    else { fbEl.textContent = 'Diesmal keine Punkte'; fbEl.classList.add('miss'); }
  }

  function update(s) {
    const sq = s.game.sq;
    if (!sq) return;
    const myAnswer = Number.isFinite(s.game.sqMyAnswer) ? s.game.sqMyAnswer : null;
    const pts = s.game.scores[ctx.clientId()] || 0;
    scoreEl.textContent = pts > 0 ? 'Deine Punkte: ' + pts : '';

    if (sq.phase === 'lobby') {
      sig = null; touched = false;
      counterEl.textContent = '';
      qEl.textContent = 'Warte auf den Start …';
      inputEl.innerHTML = ''; fbEl.textContent = ''; fbEl.className = 'mc-p-feedback';
      return;
    }
    if (sq.phase === 'done') {
      sig = null; touched = false;
      counterEl.textContent = 'Quiz beendet';
      qEl.textContent = '🏁 Geschafft!';
      inputEl.innerHTML = '';
      fbEl.className = 'mc-p-feedback';
      fbEl.textContent = pts > 0 ? 'Du hast ' + pts + ' Punkte geholt.' : '';
      return;
    }

    counterEl.textContent = 'Frage ' + sq.number + ' / ' + sq.total;
    qEl.textContent = sq.question || '';

    const newSig = sq.phase + '|' + sq.number + '|' + sq.min + '|' + sq.max + '|' + sq.step;
    if (sq.phase === 'reveal') {
      if (sig !== newSig) { sig = newSig; }
      renderReveal(sq, myAnswer);
      return;
    }

    // Fragephase: Eingabe-DOM nur bei neuer Frage/Grenzen aufbauen (Slider nicht stoeren).
    if (sig !== newSig) { sig = newSig; touched = false; buildInput(sq, myAnswer); }

    fbEl.className = 'mc-p-feedback';
    fbEl.textContent = (touched || Number.isFinite(myAnswer))
      ? '✓ Gespeichert – du kannst deine Schätzung noch ändern.'
      : 'Gib deine Schätzung ab (jederzeit änderbar).';
  }

  return { update, destroy() { if (sendTimer) clearTimeout(sendTimer); } };
}

// --- Master: Ablaufsteuerung + aktuelle Frage (mit Lösung) + Schätz-Status ---
function createSqMaster(root, ctx) {
  root.innerHTML =
    '<section class="panel">' +
      '<div class="phase-indicator" data-el="phase">–</div>' +
      '<div class="control-grid">' +
        '<button class="btn btn-primary big" data-act="sqStart">▶ Quiz starten</button>' +
        '<button class="btn btn-warn big" data-act="sqReveal">💡 Auflösen</button>' +
        '<button class="btn btn-success" data-act="sqNext">⏭ Weiter</button>' +
        '<button class="btn btn-ghost" data-act="sqReset">↺ Zurücksetzen</button>' +
      '</div>' +
      '<p class="muted small" data-el="hint"></p>' +
    '</section>' +
    '<section class="panel">' +
      '<h3>Aktuelle Frage</h3>' +
      '<div class="mc-m-question" data-el="question"></div>' +
      '<div class="sq-m-answer" data-el="answer"></div>' +
    '</section>' +
    '<section class="panel">' +
      '<h3>Schätzungen (<span data-el="acount">0</span>)</h3>' +
      '<div class="mc-m-players" data-el="players"></div>' +
    '</section>';

  const phaseEl = root.querySelector('[data-el="phase"]');
  const hintEl = root.querySelector('[data-el="hint"]');
  const qEl = root.querySelector('[data-el="question"]');
  const answerEl = root.querySelector('[data-el="answer"]');
  const playersEl = root.querySelector('[data-el="players"]');
  const acountEl = root.querySelector('[data-el="acount"]');
  const startBtn = root.querySelector('[data-act="sqStart"]');
  const revealBtn = root.querySelector('[data-act="sqReveal"]');
  const nextBtn = root.querySelector('[data-act="sqNext"]');
  const PHASE_LABEL = { lobby: '⚪ Bereit', question: '❓ Frage läuft', reveal: '💡 Aufgelöst', done: '🏁 Endstand' };

  root.querySelectorAll('[data-act]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (b.dataset.act === 'sqReset' && !(await confirmModal('Quiz zurücksetzen? (Punkte bleiben erhalten)', { title: 'Zurücksetzen', okText: 'Zurücksetzen' }))) return;
      // Weiter vor dem Auflösen = Frage ohne Punkte überspringen → Rückfrage
      if (b.dataset.act === 'sqNext' && (ctx.state().game.sq || {}).phase === 'question' &&
          !(await confirmModal('Die Frage ist noch nicht aufgelöst. Wirklich überspringen?', { title: 'Weiter', okText: 'Überspringen' }))) return;
      ctx.send({ type: 'master', action: b.dataset.act });
    });
  });

  function update(s) {
    const sq = s.game.sq || { phase: 'lobby', total: 0 };
    const admin = ctx.admin();
    const cfg = (admin && admin.sqCfg) || null;
    const totalQ = cfg ? cfg.fragen.length : sq.total;
    const phase = sq.phase;
    const masterOnly = !!(s.settings && s.settings.masterOnlyMode);

    phaseEl.textContent = PHASE_LABEL[phase] || phase;
    startBtn.disabled = !(phase === 'lobby') || totalQ === 0;
    revealBtn.disabled = phase !== 'question';
    nextBtn.disabled = !(phase === 'question' || phase === 'reveal');

    const modus = cfg ? cfg.punkteModus : (sq.punkteModus || 'formel');
    const modusText = modus === 'rang'
      ? 'Rang (' + (cfg ? cfg.rangPunkte.join(', ') : '') + ')'
      : 'Formel nach Abweichung';
    if (totalQ === 0) {
      hintEl.textContent = 'Keine Fragen in diesem Profil. Lege sie im Tab „🎲 Spiele" → „⚙️ Konfigurieren" an.';
    } else if (phase === 'lobby') {
      hintEl.textContent = totalQ + ' Frage' + (totalQ === 1 ? '' : 'n') + ' bereit.  Punkte-Modus: ' + modusText;
    } else if (phase === 'question') {
      hintEl.textContent = 'Spieler schätzen – die Zahl ist bis zum Auflösen änderbar. „Auflösen" vergibt die Punkte.';
    } else if (phase === 'reveal') {
      hintEl.textContent = sq.number >= sq.total ? 'Letzte Frage – „Weiter" zeigt den Endstand.' : '„Weiter" für die nächste Frage.';
    } else {
      hintEl.textContent = 'Quiz beendet. „Zurücksetzen" für einen neuen Durchlauf.';
    }

    // Aktuelle Frage + Lösung (master-exklusiv als sqTrue).
    const trueVal = (typeof s.game.sqTrue === 'number') ? s.game.sqTrue : null;
    const unit = sq.einheit || '';
    if (phase === 'question' || phase === 'reveal') {
      qEl.textContent = sq.question || '';
      if (trueVal !== null) {
        let rangeInfo = '';
        if (Number.isFinite(sq.min) && Number.isFinite(sq.max)) {
          rangeInfo = ' · Slider ' + sqFmt(sq.min) + '–' + sqFmt(sq.max);
        }
        answerEl.innerHTML = '<span class="sq-m-badge">Lösung</span><b>' + escapeHtml(sqFmtU(trueVal, unit)) + '</b>' +
          '<span class="muted small">' + escapeHtml(rangeInfo) + '</span>';
      } else answerEl.innerHTML = '';
    } else if (phase === 'lobby') {
      qEl.innerHTML = '<span class="muted">Noch nicht gestartet.</span>'; answerEl.innerHTML = '';
    } else {
      qEl.innerHTML = '<span class="muted">–</span>'; answerEl.innerHTML = '';
    }

    // Schätzung je Spieler (nach Abweichung sortiert), im reveal mit Punkten.
    const players = (s.participants || []).filter((p) => p.role === 'player');
    const answers = s.game.sqAnswers || {};       // clientId -> Zahl (nur Master)
    const resultsById = {};
    (sq.results || []).forEach((r) => { resultsById[r.id] = r; });
    acountEl.textContent = Object.keys(answers).length + (players.length ? ' / ' + players.length : '');

    const rowsData = players.map((p) => {
      const v = answers[p.id];
      const has = Number.isFinite(v);
      let dev = null;
      if (has && trueVal !== null) dev = Math.abs(v - trueVal) / Math.max(Math.abs(trueVal), 1e-9);
      return { p, v, has, dev };
    });
    rowsData.sort((a, b) => {
      if (a.has !== b.has) return a.has ? -1 : 1;
      if (a.dev == null || b.dev == null) return 0;
      return a.dev - b.dev;
    });

    playersEl.innerHTML = '';
    rowsData.forEach((d) => {
      const res = resultsById[d.p.id];
      const gotPts = phase === 'reveal' && res && res.pts > 0;
      const row = document.createElement('div');
      row.className = 'mc-m-prow' + (d.has ? ' answered' : '') + (gotPts ? ' correct' : '');
      row.innerHTML =
        '<span class="dev-dot' + (d.p.online ? ' online' : '') + '"><span class="led"></span></span>' +
        avatarChip(d.p) +
        '<span class="mc-m-pname">' + escapeHtml(d.p.name) + '</span>' +
        (d.dev != null ? '<span class="sq-m-dev">Δ ' + sqPct(d.dev) + '</span>' : '') +
        (gotPts ? '<span class="zd-m-pts">+' + res.pts + '</span>' : '');
      if (phase === 'question' && masterOnly) {
        // Nur-Master-Modus: Schätzung direkt fuer den Teilnehmer eintragen.
        const inp = document.createElement('input');
        inp.type = 'text'; inp.inputMode = 'decimal'; inp.className = 'sq-num proxy-est';
        inp.placeholder = 'Zahl …';
        if (d.has) inp.value = sqFmt(d.v);
        const submit = () => {
          const t = inp.value.trim().replace(/\s/g, '').replace(',', '.');
          const n = Number(t);
          if (t === '' || !Number.isFinite(n)) return;
          ctx.send({ type: 'master', action: 'masterEstimate', clientId: d.p.id, value: n });
        };
        inp.addEventListener('change', submit);
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { submit(); inp.blur(); } });
        row.appendChild(inp);
      } else {
        row.innerHTML += (d.has ? '<span class="sq-m-guess">' + escapeHtml(sqFmtU(d.v, unit)) + '</span>'
                                 : '<span class="sq-m-guess muted">–</span>');
      }
      playersEl.appendChild(row);
    });
    if (players.length === 0) playersEl.innerHTML = '<p class="muted small">Noch keine Spieler verbunden.</p>';
  }

  return { update };
}

