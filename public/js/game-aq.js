'use strict';
// Spiel: Audioquiz (aq) – Bildschirm/Spieler/Master-Module.

// ===========================================================================
// SPIEL: Audioquiz (aq) – immer laengere Audio-Ausschnitte, je frueher, desto mehr
// ===========================================================================
// Detektiv-artige Mechanik, aber statt Text-Hinweisen werden Stufe fuer Stufe
// laengere Audio-Ausschnitte freigegeben. Freitext + Master-Urteil oder (Profil-
// Option buzzerModus) Buzzer + muendlich wie beim Detektivquiz; mit mehrfachBuzzer
// reihen sich mehrere Buzzes ein (Master gibt einzeln oder alle wieder frei). Der Ton laeuft
// NUR auf dem Bildschirm (Beamer-Boxen); Spieler/Master hoeren nichts ueber die App.

// Punktwert bei „level" freigeschalteten Ausschnitt-Stufen (1-basiert). Muss zur
// Server-Formel (aqPointsAt) passen: Startpunkte minus Abzug je Stufe nach der
// ersten, mit Boden.
function aqPts(cfg, level) {
  if (!cfg) return 0;
  let p = cfg.startPunkte - cfg.abzugProStufe * (Math.max(1, level) - 1);
  p = Math.round(p);
  if (p < cfg.minPunkte) p = cfg.minPunkte;
  if (p > cfg.startPunkte) p = cfg.startPunkte;
  return p;
}

// Ausschnitt-Länge lesbar machen: 0 = „ganzer Clip", sonst „Xs".
function aqLenLabel(sec) {
  return (sec == null || sec <= 0) ? 'ganzer Clip' : aqSecTxt(sec);
}
function aqSecTxt(sec) { return Number.isInteger(sec) ? sec + 's' : sec.toFixed(1) + 's'; }

// Ausschnitt mit Startpunkt lesbar machen (erweiterter Modus): ab 0 wie aqLenLabel,
// sonst „10s–15s" bzw. „ab 10s" (sec 0 = bis Clip-Ende).
function aqRangeLabel(von, sec) {
  if (!von || von <= 0) return aqLenLabel(sec);
  return (sec && sec > 0) ? aqSecTxt(von) + '–' + aqSecTxt(Math.round((von + sec) * 10) / 10) : 'ab ' + aqSecTxt(von);
}

// Globale, spielübergreifende Audio-Freischaltung (Flag + Listener + Fallback-
// Button) lebt in core.js (audioUnlocked/onAudioUnlock/unlockAudio) – geteilt
// mit den Emoji-Reaktions-Sounds, ueberlebt jeden Spielwechsel.

// --- Bildschirm: Titel + grosser Punktwert + Audio-Player + Auflösung ---------
function createAqScreen(root, ctx) {
  root.innerHTML =
    '<div class="aq-screen">' +
      '<div class="mc-topline"><span class="mc-intro" data-el="intro"></span>' +
        '<span class="mc-counter" data-el="counter"></span></div>' +
      '<div class="dq-points-wrap" data-el="pw">' +
        '<span class="dq-points" data-el="points"></span>' +
        '<span class="dq-points-cap" data-el="pcap"></span>' +
      '</div>' +
      '<div class="aq-stage" data-el="stage">' +
        '<div class="aq-bars" data-el="bars">' +
          '<span></span><span></span><span></span><span></span><span></span>' +
          '<span></span><span></span><span></span><span></span>' +
        '</div>' +
        '<div class="aq-snippet" data-el="snippet"></div>' +
        '<div class="aq-progress" data-el="prog"><span data-el="progbar"></span></div>' +
      '</div>' +
      '<div class="dq-solution" data-el="solution"></div>' +
      '<div class="dq-status" data-el="status"></div>' +
      '<div class="mc-final" data-el="final">' +
        '<div class="mc-final-title">🏁 Endstand</div>' +
        '<div class="leaderboard"></div>' +
      '</div>' +
      '<button class="aq-activate" data-el="activate" type="button">🔊 Ton aktivieren</button>' +
    '</div>';
  const introEl = root.querySelector('[data-el="intro"]');
  const counterEl = root.querySelector('[data-el="counter"]');
  const pwEl = root.querySelector('[data-el="pw"]');
  const pointsEl = root.querySelector('[data-el="points"]');
  const pcapEl = root.querySelector('[data-el="pcap"]');
  const stageEl = root.querySelector('[data-el="stage"]');
  const barsEl = root.querySelector('[data-el="bars"]');
  const snippetEl = root.querySelector('[data-el="snippet"]');
  const progEl = root.querySelector('[data-el="prog"]');
  const progbarEl = root.querySelector('[data-el="progbar"]');
  const solutionEl = root.querySelector('[data-el="solution"]');
  const statusEl = root.querySelector('[data-el="status"]');
  const finalEl = root.querySelector('[data-el="final"]');
  const activateBtn = root.querySelector('[data-el="activate"]');

  // Persistentes Audio-Element (bleibt ueber Runden erhalten, damit die einmalige
  // Autoplay-Freischaltung nicht verloren geht).
  const audio = new Audio();
  audio.preload = 'auto';
  let curFile = null;     // aktuell geladener Dateiname
  let prevToken = -1;     // Wiedergabe-Token: bei Aenderung (neu) abspielen
  let prevNumber = -1;    // Rundenwechsel erkennen
  let stopTimer = null;   // Timer, der den Ausschnitt nach seiner Länge stoppt
  let rafId = 0;          // Fortschrittsbalken
  let lastSnippetSec = 0; // zuletzt geforderte Ausschnitt-Länge (für Auto-Freischaltung)
  let lastSnippetVon = 0; // … und deren Startpunkt
  let prevBuzzId = null;  // Buzzer-Modus: neuen Buzz erkennen (-> Ton stoppen)

  function clearStop() { if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; } }
  function stopRaf() { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } }

  // Fortschrittsbalken waehrend der Wiedergabe (relativ zur Ausschnitt-Länge ab von).
  function runProgress(sec, von) {
    stopRaf();
    const dur = () => (sec && sec > 0) ? sec : (isFinite(audio.duration) ? Math.max(0, audio.duration - von) : 0);
    const start = performance.now();
    const tick = () => {
      const total = dur();
      const el = (performance.now() - start) / 1000;
      const pct = total > 0 ? Math.min(100, (el / total) * 100) : 0;
      progbarEl.style.width = pct + '%';
      if (!audio.paused && pct < 100) rafId = requestAnimationFrame(tick);
      else rafId = 0;
    };
    rafId = requestAnimationFrame(tick);
  }

  // Ausschnitt von..von+sec abspielen (sec 0/null = bis Clip-Ende). Nur wenn
  // freigeschaltet und eine Datei geladen ist.
  function playSnippet(sec, von) {
    von = von > 0 ? von : 0;
    lastSnippetSec = sec;
    lastSnippetVon = von;
    if (!audioUnlocked || !curFile) return;
    clearStop();
    try {
      audio.currentTime = von;
      const pr = audio.play();
      if (pr && pr.catch) pr.catch(() => { /* Autoplay evtl. noch blockiert */ });
      barsEl.classList.add('playing');
      runProgress(sec, von);
      if (sec && sec > 0) {
        stopTimer = setTimeout(() => {
          try { audio.pause(); } catch (e) {}
          barsEl.classList.remove('playing');
        }, Math.round(sec * 1000));
      }
    } catch (e) { /* egal */ }
  }
  audio.addEventListener('ended', () => { barsEl.classList.remove('playing'); stopRaf(); progbarEl.style.width = '100%'; });
  audio.addEventListener('pause', () => { barsEl.classList.remove('playing'); });

  // Freischaltung passiert GLOBAL bei der ersten Interaktion irgendwo auf der
  // Seite (s. unlockAudio in core.js) und überlebt Spielwechsel. Reagiert die
  // Freischaltung, während dieses Modul mitten in einer Runde steht, den
  // aktuellen Ausschnitt sofort hörbar machen; sonst das Element still
  // „anwerfen", damit späteres play() erlaubt ist.
  function onUnlocked() {
    activateBtn.classList.add('hidden');
    try {
      const pr = audio.play();
      if (pr && pr.then) {
        pr.then(() => {
          if (curFile && prevNumber >= 0) { try { audio.currentTime = 0; } catch (e) {} playSnippet(lastSnippetSec, lastSnippetVon); }
          else { try { audio.pause(); audio.currentTime = 0; } catch (e) {} }
        }).catch(() => {});
      } else { try { audio.pause(); } catch (e) {} }
    } catch (e) { /* egal */ }
  }
  const offUnlock = onAudioUnlock(onUnlocked);
  // Lautstärke = Master-Wert × Maximal-Lautstärke des Bildschirms (core.js).
  let baseVolume = 1;
  const offVolume = onScreenVolumeChange(() => { audio.volume = screenVol(baseVolume); });
  // Der Fallback-Button löst dieselbe globale Freischaltung aus.
  activateBtn.addEventListener('click', unlockAudio);

  function update(s) {
    const aq = s.game.aq;
    if (!aq) return;
    introEl.textContent = aq.intro || '';

    // Lautstärke (vom Master gesteuert) live anwenden – wirkt sofort, auch auf
    // gerade laufende Wiedergabe.
    baseVolume = (typeof aq.volume === 'number') ? aq.volume : 1;
    audio.volume = screenVol(baseVolume);

    // Aktuelle Audiodatei laden (nur der Bildschirm bekommt den Dateinamen).
    const file = s.game.aqAudioFile || '';
    if (file !== curFile) {
      curFile = file || null;
      clearStop(); stopRaf();
      barsEl.classList.remove('playing');
      progbarEl.style.width = '0%';
      audio.src = curFile ? ('/audio/' + encodeURIComponent(curFile)) : '';
    }

    // Ton-Aktivieren-Button nur zeigen, solange nicht freigeschaltet.
    activateBtn.classList.toggle('hidden', audioUnlocked);

    // Endstand
    if (aq.phase === 'done') {
      prevNumber = -1; prevToken = aq.playToken;
      clearStop(); stopRaf();
      try { audio.pause(); } catch (e) {}
      pwEl.classList.add('hidden'); stageEl.classList.add('hidden');
      solutionEl.classList.add('hidden'); statusEl.classList.add('hidden');
      counterEl.textContent = aq.total + ' Runden';
      finalEl.classList.remove('hidden');
      renderLeaderboard(finalEl, s);
      return;
    }
    finalEl.classList.add('hidden');
    stageEl.classList.remove('hidden'); statusEl.classList.remove('hidden');

    // Lobby
    if (aq.phase === 'lobby') {
      prevNumber = -1; prevToken = aq.playToken;
      counterEl.textContent = aq.total ? (aq.total + ' Runden') : '';
      pwEl.classList.remove('hidden');
      pointsEl.className = 'dq-points dummy';
      pointsEl.textContent = aq.startPunkte;
      pcapEl.textContent = 'Startpunkte';
      snippetEl.textContent = '🔊 Was hörst du?';
      progbarEl.style.width = '0%';
      solutionEl.classList.add('hidden');
      statusEl.textContent = aq.total ? 'Gleich geht’s los … gut zuhören!' : 'Keine Runden im Profil';
      prevBuzzId = null;
      return;
    }

    // running / reveal
    const reveal = aq.phase === 'reveal';
    counterEl.textContent = 'Runde ' + aq.number + ' / ' + aq.total;

    // Neue Wiedergabe ausloesen, sobald sich das Token aendert (Start / laengerer
    // Ausschnitt / Nochmal / Auflösen). Rundenwechsel merken wir separat.
    const tokenChanged = aq.playToken !== prevToken;
    prevNumber = aq.number;
    if (tokenChanged) {
      prevToken = aq.playToken;
      playSnippet(aq.snippetSec, aq.snippetVon);
    }

    // Buzzer-Modus: sobald jemand buzzert, den Ton sofort anhalten.
    const buzzId = aq.buzz ? aq.buzz.id : null;
    if (buzzId && buzzId !== prevBuzzId) {
      clearStop(); stopRaf();
      try { audio.pause(); } catch (e) {}
    }
    prevBuzzId = buzzId;

    pwEl.classList.remove('hidden');
    if (reveal) {
      pointsEl.className = 'dq-points dummy';
      pointsEl.textContent = '🔊';
      pcapEl.textContent = 'Aufgelöst';
      snippetEl.textContent = curFile ? 'Ganzer Clip' : '—';
      solutionEl.classList.remove('hidden');
      const winTxt = aq.winner
        ? '<span class="dq-sol-win">🏆 ' + avatarChip(aq.winner) + escapeHtml(aq.winner.name) + '  +' + aq.winner.points + '</span>'
        : '<span class="dq-sol-none">Niemand hat es erraten</span>';
      solutionEl.innerHTML = '<span class="dq-sol-label">Lösung</span>' +
        '<span class="dq-sol-text">' + escapeHtml(aq.loesung || '') + '</span>' + winTxt;
      statusEl.textContent = '';
    } else {
      pointsEl.className = 'dq-points';
      pointsEl.textContent = aq.pointsNow;
      pointsEl.classList.toggle('low', aq.pointsNow <= aq.minPunkte);
      pcapEl.textContent = 'Punkte bei Lösung jetzt';
      snippetEl.textContent = 'Ausschnitt ' + aq.revealed + ' / ' + aq.stufenCount + ' · ' + aqRangeLabel(aq.snippetVon, aq.snippetSec);
      solutionEl.classList.add('hidden');
      if (!curFile) statusEl.textContent = '⚠ Keine Audiodatei für diese Runde';
      else if (aq.buzzes && aq.buzzes.length > 1) statusEl.textContent = '🔔 ' + aq.buzzes.map((b, i) => (i + 1) + '. ' + (b.avatar ? b.avatar + ' ' : '') + b.name).join('  ·  ') + ' – Master entscheidet …';
      else if (aq.buzz) statusEl.textContent = '🔔 ' + (aq.buzz.avatar ? aq.buzz.avatar + ' ' : '') + aq.buzz.name + ' hat gebuzzert – Master entscheidet …';
      else statusEl.textContent = aq.buzzerModus ? 'Was hörst du? Buzzern!' : 'Was hörst du? Tippe deine Lösung!';
    }
  }

  return {
    update,
    destroy() {
      offUnlock();
      offVolume();
      clearStop(); stopRaf();
      try { audio.pause(); audio.src = ''; } catch (e) {}
    }
  };
}

// --- Spieler: Ausschnitt-Info + Punktwert + (Freitext) Eingabe ODER (Buzzer) Buzzer
function createAqPlayer(root, ctx) {
  root.className = 'game-mount';
  root.innerHTML =
    '<div class="aq-player">' +
      '<div class="mc-p-counter" data-el="counter"></div>' +
      '<div class="dq-p-points" data-el="points"></div>' +
      '<div class="aq-p-snippet" data-el="snippet"></div>' +
      '<form class="dq-p-form hidden" data-el="form">' +
        '<input class="dq-p-input" data-el="input" type="text" maxlength="80" ' +
          'placeholder="Was hörst du? …" autocomplete="off" autocapitalize="off" autocorrect="off" />' +
        '<button class="btn btn-primary" data-el="send" type="submit">Tippen</button>' +
      '</form>' +
      '<button class="fw-buzzer dq-buzzer hidden" data-el="buzzer" type="button">BUZZ!</button>' +
      '<div class="mc-p-feedback dq-p-feedback" data-el="feedback"></div>' +
      '<div class="mc-p-score" data-el="score"></div>' +
    '</div>';
  const counterEl = root.querySelector('[data-el="counter"]');
  const pointsEl = root.querySelector('[data-el="points"]');
  const snippetEl = root.querySelector('[data-el="snippet"]');
  const form = root.querySelector('[data-el="form"]');
  const input = root.querySelector('[data-el="input"]');
  const buzzer = root.querySelector('[data-el="buzzer"]');
  const fbEl = root.querySelector('[data-el="feedback"]');
  const scoreEl = root.querySelector('[data-el="score"]');
  let startTime = 0;      // lokaler Rundenbeginn (performance.now) fuer Buzzer-Zeitmessung
  let qNum = -1;

  const onSubmit = (e) => {
    e.preventDefault();
    const s = ctx.state();
    if (!s || s.game.locked) return;
    const aq = s.game.aq;
    if (!aq || aq.phase !== 'running' || aq.buzzerModus) return;
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
    const aq = s.game.aq;
    if (!aq || !aq.buzzerModus || aq.phase !== 'running') return;
    const queue = aq.buzzes || [];
    if (queue.length && !aq.mehrfachBuzzer) return;               // es wartet schon ein Buzz
    if (queue.some((b) => b.id === ctx.clientId())) return;       // schon in der Reihe
    const elapsedMs = startTime ? (performance.now() - startTime) : 0;
    ctx.send({ type: 'press', elapsedMs });
  };
  buzzer.addEventListener('pointerdown', onBuzz);

  function update(s) {
    const aq = s.game.aq;
    if (!aq) return;
    const pts = s.game.scores[ctx.clientId()] || 0;
    scoreEl.textContent = pts > 0 ? 'Deine Punkte: ' + pts : '';
    const buzzMode = !!aq.buzzerModus;

    // Rundenwechsel -> lokalen Zeitstempel setzen
    if (aq.number !== qNum) { qNum = aq.number; startTime = performance.now(); }

    // Lobby / Endstand
    if (aq.phase === 'lobby' || aq.phase === 'done') {
      counterEl.textContent = aq.phase === 'done' ? 'Quiz beendet' : '';
      pointsEl.textContent = ''; pointsEl.className = 'dq-p-points';
      snippetEl.textContent = '';
      form.classList.add('hidden'); buzzer.classList.add('hidden');
      fbEl.className = 'mc-p-feedback dq-p-feedback';
      if (aq.phase === 'done') fbEl.textContent = pts > 0 ? 'Du hast ' + pts + ' Punkte geholt.' : 'Geschafft!';
      else fbEl.textContent = 'Warte auf den Start …';
      return;
    }

    const reveal = aq.phase === 'reveal';
    const locked = !!s.game.locked;
    counterEl.textContent = 'Runde ' + aq.number + ' / ' + aq.total;

    // Ausschnitt-Info (der Ton laeuft auf dem Bildschirm – hier nur die Länge).
    snippetEl.textContent = reveal
      ? '🔊 Ganzer Clip'
      : ('🔊 Ausschnitt ' + aq.revealed + ' / ' + aq.stufenCount + ' · ' + aqRangeLabel(aq.snippetVon, aq.snippetSec));

    // Punktwert (aktuell erreichbar bzw. bei Auflösung die Lösung)
    pointsEl.className = 'dq-p-points';
    if (reveal) {
      pointsEl.textContent = aq.loesung || '–';
      pointsEl.classList.add('solution');
    } else {
      pointsEl.textContent = aq.pointsNow;
      pointsEl.classList.toggle('low', aq.pointsNow <= aq.minPunkte);
    }

    // Eingabe- bzw. Buzzer-Bereich je nach Modus
    fbEl.className = 'mc-p-feedback dq-p-feedback';
    if (buzzMode) {
      form.classList.add('hidden');
      buzzer.classList.remove('hidden');
      const queue = aq.buzzes || [];
      const myPos = queue.findIndex((b) => b.id === ctx.clientId());   // -1 = nicht in der Reihe
      const iBuzzed = myPos === 0;
      buzzer.className = 'fw-buzzer dq-buzzer';
      if (reveal) {
        buzzer.classList.add('idle'); buzzer.disabled = true;
        if (aq.winner && aq.winner.id === ctx.clientId()) { buzzer.classList.remove('idle'); buzzer.classList.add('hit'); fbEl.textContent = '✓ Erwischt! +' + aq.winner.points; }
        else if (aq.winner && aq.winner.name) fbEl.textContent = '🏆 ' + (aq.winner.avatar ? aq.winner.avatar + ' ' : '') + aq.winner.name + ' hatte es!';
        else fbEl.textContent = 'Aufgelöst.';
      } else if (myPos > 0) {
        buzzer.classList.add('idle'); buzzer.disabled = true;
        fbEl.textContent = '🔔 Du bist Nr. ' + (myPos + 1) + ' in der Reihe – warte auf den Master.';
      } else if (aq.buzz && aq.mehrfachBuzzer && !iBuzzed) {
        buzzer.classList.add('go'); buzzer.disabled = locked;
        fbEl.textContent = locked ? '🔒 Gesperrt'
          : '🔔 ' + (aq.buzz.avatar ? aq.buzz.avatar + ' ' : '') + aq.buzz.name + ' ist dran – du kannst dich auch anstellen!';
      } else if (aq.buzz) {
        buzzer.classList.add('idle'); buzzer.disabled = true;
        fbEl.textContent = iBuzzed ? '🔔 Du hast gebuzzert – sag die Lösung!' : '🔔 ' + (aq.buzz.avatar ? aq.buzz.avatar + ' ' : '') + aq.buzz.name + ' hat gebuzzert';
      } else {
        buzzer.classList.add('go'); buzzer.disabled = locked;
        fbEl.textContent = locked ? '🔒 Gesperrt' : 'Buzzern, sobald du es erkennst!';
      }
    } else {
      buzzer.classList.add('hidden');
      const myGuess = s.game.aqMyGuess || null;
      if (reveal) {
        form.classList.add('hidden');
        if (aq.winner && aq.winner.id === ctx.clientId()) fbEl.textContent = '✓ Richtig! +' + aq.winner.points;
        else if (aq.winner && aq.winner.name) fbEl.textContent = '🏆 ' + (aq.winner.avatar ? aq.winner.avatar + ' ' : '') + aq.winner.name + ' war schneller.';
        else fbEl.textContent = 'Aufgelöst.';
      } else {
        form.classList.remove('hidden');
        input.disabled = locked;
        root.querySelector('[data-el="send"]').disabled = locked;
        fbEl.textContent = myGuess
          ? 'Zuletzt getippt: „' + myGuess.text + '" – der Master prüft.'
          : (locked ? '🔒 Gesperrt' : 'Je früher, desto mehr Punkte!');
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

// --- Master: Ablaufsteuerung + aktuelle Runde (mit Lösung) + Werten -----------
function createAqMaster(root, ctx) {
  root.innerHTML =
    '<section class="panel">' +
      '<div class="phase-indicator" data-el="phase">–</div>' +
      '<div class="control-grid">' +
        '<button class="btn btn-primary big" data-act="aqStart">▶ Starten</button>' +
        '<button class="btn btn-warn big" data-act="aqClue">🔊 Längerer Ausschnitt</button>' +
        '<button class="btn btn-ghost" data-act="aqReplay">🔁 Nochmal abspielen</button>' +
        '<button class="btn btn-ghost" data-act="aqReveal">💡 Lösung zeigen</button>' +
        '<button class="btn btn-success" data-act="aqNext">⏭ Nächste Runde</button>' +
        '<button class="btn btn-ghost" data-act="aqReset">↺ Zurücksetzen</button>' +
      '</div>' +
      '<div class="aq-vol-row">' +
        '<span class="aq-vol-label">🔊 Lautstärke Bildschirm</span>' +
        '<input class="aq-vol-slider" data-el="vol" type="range" min="0" max="100" step="1" value="100" />' +
        '<span class="aq-vol-val" data-el="volval">100 %</span>' +
      '</div>' +
      '<p class="muted small" data-el="hint"></p>' +
    '</section>' +
    '<section class="panel">' +
      '<h3>Aktuelle Runde (<span data-el="prog">0/0</span>)</h3>' +
      '<div class="dq-m-solution" data-el="solution"></div>' +
      '<div class="dq-m-clues" data-el="stufen"></div>' +
    '</section>' +
    '<section class="panel">' +
      '<h3 data-el="btitle">Spieler</h3>' +
      '<div class="dq-m-body" data-el="body"></div>' +
    '</section>';

  const phaseEl = root.querySelector('[data-el="phase"]');
  const hintEl = root.querySelector('[data-el="hint"]');
  const progEl = root.querySelector('[data-el="prog"]');
  const solutionEl = root.querySelector('[data-el="solution"]');
  const stufenEl = root.querySelector('[data-el="stufen"]');
  const btitleEl = root.querySelector('[data-el="btitle"]');
  const bodyEl = root.querySelector('[data-el="body"]');
  const startBtn = root.querySelector('[data-act="aqStart"]');
  const clueBtn = root.querySelector('[data-act="aqClue"]');
  const replayBtn = root.querySelector('[data-act="aqReplay"]');
  const revealBtn = root.querySelector('[data-act="aqReveal"]');
  const nextBtn = root.querySelector('[data-act="aqNext"]');
  const volEl = root.querySelector('[data-el="vol"]');
  const volValEl = root.querySelector('[data-el="volval"]');
  const PHASE_LABEL = { lobby: '⚪ Bereit', running: '🔊 Runde läuft', reveal: '💡 Aufgelöst', done: '🏁 Endstand' };

  // Lautstärke-Regler: sendet den Wert (0..1) an den Server, der ihn an den
  // Bildschirm broadcastet. Label live mitziehen.
  volEl.addEventListener('input', () => {
    volValEl.textContent = volEl.value + ' %';
    ctx.send({ type: 'master', action: 'aqVolume', value: Number(volEl.value) / 100 });
  });

  root.querySelectorAll('[data-act]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (b.dataset.act === 'aqReset' && !(await confirmModal('Quiz zurücksetzen? (Punkte bleiben erhalten)', { title: 'Zurücksetzen', okText: 'Zurücksetzen' }))) return;
      ctx.send({ type: 'master', action: b.dataset.act });
    });
  });

  function update(s) {
    const aq = s.game.aq || { phase: 'lobby', total: 0 };
    const admin = ctx.admin();
    const cfg = (admin && admin.aqCfg) || null;
    const totalC = cfg ? cfg.runden.length : aq.total;
    const buzzMode = cfg ? cfg.buzzerModus : !!aq.buzzerModus;
    const multiBuzz = buzzMode && (cfg ? !!cfg.mehrfachBuzzer : !!aq.mehrfachBuzzer);
    const phase = aq.phase;
    const masterOnly = !!(s.settings && s.settings.masterOnlyMode);

    // Regler-Stand aus dem Server-State übernehmen – aber nicht, während der
    // Master gerade zieht (sonst würde der Broadcast den Daumen zurückspringen).
    if (document.activeElement !== volEl && typeof aq.volume === 'number') {
      const pct = Math.round(Math.min(1, Math.max(0, aq.volume)) * 100);
      volEl.value = String(pct);
      volValEl.textContent = pct + ' %';
    }

    phaseEl.textContent = PHASE_LABEL[phase] || phase;
    progEl.textContent = (phase === 'lobby' || phase === 'done')
      ? (totalC + ' Runden') : (aq.number + '/' + aq.total);

    const isLast = aq.number >= aq.total;
    nextBtn.textContent = (phase === 'reveal' && isLast) ? '🏁 Endstand' : '⏭ Nächste Runde';

    startBtn.disabled = !(phase === 'lobby') || totalC === 0;
    clueBtn.disabled = !(phase === 'running') || !!aq.buzz || (aq.revealed >= aq.stufenCount);
    replayBtn.disabled = !(phase === 'running' || phase === 'reveal') || !!aq.buzz;
    revealBtn.disabled = phase !== 'running';
    nextBtn.disabled = phase !== 'reveal';

    if (totalC === 0) {
      hintEl.textContent = 'Keine Runden in diesem Profil. Lege sie im Tab „🎲 Spiele" → „⚙️ Konfigurieren" an (mit Audio-Upload).';
    } else if (phase === 'lobby') {
      const rate = cfg ? (cfg.startPunkte + ' → ' + cfg.minPunkte + ', −' + cfg.abzugProStufe + '/Ausschnitt') : '';
      hintEl.textContent = totalC + ' Runde' + (totalC === 1 ? '' : 'n') + ' bereit · Ton läuft auf dem Bildschirm · ' +
        (buzzMode ? (multiBuzz ? 'Buzzer-Modus (mehrere)' : 'Buzzer-Modus') : 'Freitext-Modus') + (rate ? ' · ' + rate : '');
    } else if (phase === 'running') {
      hintEl.textContent = aq.buzz
        ? (multiBuzz
          ? '🔔 ' + aq.buzzes.length + ' in der Buzz-Reihe – „Richtig" beendet die Runde, „Freigeben" lässt einzelne oder alle wieder buzzern.'
          : '🔔 ' + (aq.buzz.avatar ? aq.buzz.avatar + ' ' : '') + aq.buzz.name + ' hat gebuzzert – „Richtig" oder „Falsch" wählen.')
        : (buzzMode
          ? 'Spieler buzzern. „Längerer Ausschnitt" senkt die Punkte.'
          : 'Spieler tippen. „Längerer Ausschnitt" senkt die Punkte. „Richtig" bei einem Spieler beendet die Runde.');
    } else if (phase === 'reveal') {
      hintEl.textContent = isLast ? 'Letzte Runde – „Endstand" zeigt die Gesamtwertung.' : '„Nächste Runde" geht weiter.';
    } else {
      hintEl.textContent = 'Quiz beendet. „Zurücksetzen" für einen neuen Durchlauf.';
    }

    // Aktuelle Runde: Lösung + Dateiname (master-exklusiv) + Stufen (freigegebene markiert)
    const aqCase = s.game.aqCase || null;
    if (aqCase && (phase === 'running' || phase === 'reveal')) {
      const fileTxt = aqCase.audio ? escapeHtml(aqCase.audio) : '⚠ keine Datei';
      solutionEl.innerHTML = '<span class="dq-m-sol-cap">Lösung</span><span class="dq-m-sol-text">' +
        escapeHtml(aqCase.loesung) + '</span>' +
        '<span class="dq-m-sol-pts">' + (phase === 'running' ? ('Jetzt: ' + aqPts(cfg, aq.revealed) + ' Pkt') : '') + '</span>' +
        '<span class="aq-m-file">🎵 ' + fileTxt + '</span>';
      stufenEl.innerHTML = '';
      (aqCase.teile || []).forEach((t, i) => {
        const open = i < aq.revealed;
        const row = document.createElement('div');
        row.className = 'dq-m-clue' + (open ? ' open' : '') + (i === aq.revealed && phase === 'running' ? ' next' : '');
        row.innerHTML = '<span class="dq-clue-num">' + (i + 1) + '</span>' +
          '<span class="dq-clue-text">' + aqRangeLabel(t.von, t.sec) + '</span>' +
          '<span class="dq-m-clue-pts">' + aqPts(cfg, i + 1) + '</span>';
        stufenEl.appendChild(row);
      });
    } else if (phase === 'lobby') {
      solutionEl.innerHTML = '<span class="muted">Noch nicht gestartet.</span>';
      stufenEl.innerHTML = '';
    } else {
      solutionEl.innerHTML = '<span class="muted">–</span>';
      stufenEl.innerHTML = '';
    }

    const players = (s.participants || []).filter((p) => p.role === 'player');
    bodyEl.innerHTML = '';
    if (buzzMode) {
      btitleEl.textContent = 'Buzzer';
      if (phase === 'running' && aq.buzz) {
        // Buzz-Reihe in Eintreffens-Reihenfolge, je Eintrag Richtig + Falsch/Freigeben
        // (Punkte = eingefrorener Wert beim Stufen-Stand dieses Buzz).
        (aq.buzzes || [aq.buzz]).forEach((b, i) => {
          const box = document.createElement('div');
          box.className = 'dq-m-buzz' + (i > 0 ? ' queued' : '');
          box.innerHTML = '<div class="dq-m-buzz-name">' + (multiBuzz ? (i + 1) + '. ' : '🔔 ') + avatarChip(b) + escapeHtml(b.name) +
            ' <span class="dq-m-buzz-pts">+' + aqPts(cfg, b.level || aq.revealed) + '</span></div>';
          const btns = document.createElement('div');
          btns.className = 'row-buttons';
          const ok = document.createElement('button');
          ok.className = 'btn btn-success'; ok.textContent = '✓ Richtig';
          ok.addEventListener('click', () => ctx.send({ type: 'master', action: 'aqOk', clientId: b.id }));
          const no = document.createElement('button');
          no.className = 'btn btn-danger'; no.textContent = multiBuzz ? '↺ Freigeben' : '✗ Falsch';
          no.title = 'Falsch – darf wieder buzzern';
          no.addEventListener('click', () => ctx.send({ type: 'master', action: 'aqWrong', clientId: b.id }));
          btns.appendChild(ok); btns.appendChild(no);
          box.appendChild(btns);
          bodyEl.appendChild(box);
        });
        if (multiBuzz) {
          const all = document.createElement('button');
          all.className = 'btn btn-warn'; all.textContent = '↺ Alle freigeben';
          all.addEventListener('click', () => ctx.send({ type: 'master', action: 'aqReleaseAll' }));
          bodyEl.appendChild(all);
          // Nur-Master-Modus: weitere Teilnehmer in die Reihe stellen.
          if (masterOnly) {
            const proxy = document.createElement('div');
            proxy.className = 'proxy-panel';
            proxy.innerHTML = '<p class="muted small">Nur-Master-Modus: für Teilnehmer buzzern</p><div class="proxy-row"></div>';
            bodyEl.appendChild(proxy);
            const inQueue = new Set(aq.buzzes.map((b) => b.id));
            renderProxyBuzzRow(proxy.querySelector('.proxy-row'), players.filter((p) => !inQueue.has(p.id)), (clientId) => {
              ctx.send({ type: 'master', action: 'masterPress', clientId });
            });
          }
        }
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
      return;
    }

    // Freitext: Tipp je Spieler (Text sichtbar, damit der Master werten kann) + „Richtig"-Button (vergibt eingefrorene Punkte)
    btitleEl.textContent = 'Spieler';
    const guesses = s.game.aqGuesses || {};
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
        award.textContent = '✓ +' + aqPts(cfg, g.level);
        award.title = 'Als richtig werten (' + aqPts(cfg, g.level) + ' Punkte)';
        award.addEventListener('click', () => ctx.send({ type: 'master', action: 'aqAward', clientId: p.id }));
        row.appendChild(award);
      }
      bodyEl.appendChild(row);
    });
    if (players.length === 0) bodyEl.innerHTML = '<p class="muted small">Noch keine Spieler verbunden.</p>';
  }

  return { update };
}
