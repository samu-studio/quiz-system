'use strict';
// Spiel: Reaktion / Ampel – Bildschirm/Spieler/Master-Module.

// ===========================================================================
// SPIEL: Reaktion / Ampel – rollenspezifische Oberflaechen
// ===========================================================================

// --- Bildschirm: Ampel + Ergebnis-Board + Bestenliste ----------------------
function createReactionScreen(root, ctx) {
  root.innerHTML =
    '<div class="trafficlight">' +
      '<div class="lamp lamp-red"></div>' +
      '<div class="lamp lamp-amber"></div>' +
      '<div class="lamp lamp-green"></div>' +
    '</div>' +
    '<div class="screen-headline">Bereit</div>' +
    '<div class="results-board"></div>' +
    '<div class="leaderboard"></div>';

  const light = root.querySelector('.trafficlight');
  const head = root.querySelector('.screen-headline');
  const board = root.querySelector('.results-board');

  function update(s) {
    light.className = 'trafficlight';

    if (s.game.locked) {
      head.textContent = '⏸ Pause';
    } else if (s.game.phase === 'idle') { head.textContent = 'Bereit'; }
    else if (s.game.phase === 'armed') { light.classList.add('red'); head.textContent = 'Achtung…'; }
    else if (s.game.phase === 'yellow') { light.classList.add('amber'); head.textContent = 'Achtung…'; }
    else if (s.game.phase === 'go') { light.classList.add('green'); head.textContent = 'GO!'; }
    else if (s.game.phase === 'results') {
      const winner = s.game.results.find((r) => !r.falseStart);
      head.textContent = winner ? '🏆 ' + winner.name : 'Ergebnisse';
    }

    board.innerHTML = '';
    if (s.game.phase === 'go' || s.game.phase === 'results') {
      s.game.results.forEach((r, i) => {
        const row = document.createElement('div');
        row.className = 'result-row' + (r.falseStart ? ' false' : (i === 0 ? ' winner' : ''));
        row.innerHTML =
          '<span class="rank">' + (r.falseStart ? '–' : (i + 1)) + '</span>' +
          avatarChip(r) +
          '<span class="rname">' + escapeHtml(r.name) + '</span>' +
          (r.falseStart
            ? '<span class="badge-false">ZU FRÜH</span>'
            : '<span class="rtime">' + r.reactionMs + ' ms</span>' +
              (r.pts > 0 ? '<span class="rx-pts">+' + r.pts + '</span>' : ''));
        board.appendChild(row);
      });
    }

    renderLeaderboard(root, s);
  }

  return { update };
}

// --- Spieler: grosser Reaktions-Button + Feedback + Punkte ------------------
function createReactionPlayer(root, ctx) {
  const btn = document.createElement('button');
  btn.className = 'reaction-btn';
  btn.textContent = 'Warten…';
  const fb = document.createElement('div');
  fb.className = 'player-feedback';
  const score = document.createElement('div');
  score.className = 'player-score';
  root.appendChild(btn);
  root.appendChild(fb);
  root.appendChild(score);

  const onDown = (e) => { e.preventDefault(); pressReaction(ctx); };
  btn.addEventListener('pointerdown', onDown);

  function update(s) {
    const phase = s.game.phase;
    const myResult = s.game.results.find((r) => r.id === ctx.clientId());

    btn.className = 'reaction-btn';
    fb.className = 'player-feedback';
    btn.disabled = false;

    if (myResult) {
      btn.classList.add('done');
      btn.textContent = myResult.falseStart ? '✋' : '✓';
      if (myResult.falseStart) { fb.textContent = 'Zu früh!'; fb.classList.add('false'); }
      else { fb.textContent = myResult.reactionMs + ' ms'; fb.classList.add('good'); }
    } else if (phase === 'idle') {
      btn.classList.add('idle'); btn.textContent = 'Warten…'; fb.textContent = '';
    } else if (phase === 'armed') {
      btn.classList.add('armed'); btn.textContent = 'GLEICH…'; fb.textContent = 'Noch nicht drücken!';
    } else if (phase === 'yellow') {
      btn.classList.add('yellow'); btn.textContent = 'GLEICH…'; fb.textContent = 'Noch nicht drücken!';
    } else if (phase === 'go') {
      btn.classList.add('go'); btn.textContent = 'DRÜCK!'; fb.textContent = '';
    } else if (phase === 'results') {
      btn.classList.add('done'); btn.textContent = '–'; fb.textContent = 'Runde vorbei';
    }

    const pts = s.game.scores[ctx.clientId()] || 0;
    score.textContent = pts > 0 ? 'Deine Punkte: ' + pts : '';
  }

  return { update, destroy() { btn.removeEventListener('pointerdown', onDown); } };
}

function pressReaction(ctx) {
  const s = ctx.state();
  if (!s || ctx.pressed()) return;
  if (s.settings.activeGame !== 'reaction') return;
  if (s.game.locked) return;                  // Killswitch: keine Interaktion
  const phase = s.game.phase;
  if (phase === 'armed' || phase === 'yellow') {
    ctx.setPressed(true);
    ctx.send({ type: 'press' }); // zu früh
  } else if (phase === 'go') {
    ctx.setPressed(true);
    const t = ctx.goLocalTime();
    const reactionMs = t !== null ? (performance.now() - t) : 0;
    ctx.send({ type: 'press', reactionMs });
  }
}

// --- Master: Live-Steuerung (Ampel-Phasen) + Rundenergebnisse ---------------
const PHASE_LABEL = {
  idle: '⚪ Bereit', armed: '🔴 Achtung (rot)', yellow: '🟡 Achtung (gelb)', go: '🟢 GRÜN!', results: '🏁 Ergebnisse'
};

function createReactionMaster(root, ctx) {
  root.innerHTML =
    '<section class="panel">' +
      '<div class="phase-indicator" data-el="phase">–</div>' +
      '<div class="control-grid">' +
        '<button class="btn btn-danger big" data-act="arm">▶ Runde starten</button>' +
        '<button class="btn btn-warn big" data-act="yellow">🟡 Gelb geben</button>' +
        '<button class="btn btn-danger big" data-act="red">🔴 Zurück zu Rot</button>' +
        '<button class="btn btn-success big" data-act="go">🟢 GRÜN geben</button>' +
        '<button class="btn btn-ghost" data-act="endRound">⏹ Runde beenden</button>' +
        '<button class="btn btn-ghost" data-act="reset">↺ Reset</button>' +
      '</div>' +
      '<p class="muted small" data-el="autogo"></p>' +
    '</section>' +
    '<section class="panel proxy-panel" data-el="proxysec">' +
      '<h3>Für Teilnehmer drücken (Nur-Master-Modus)</h3>' +
      '<div class="proxy-row" data-el="proxy"></div>' +
    '</section>' +
    '<section class="panel">' +
      '<h3>Ergebnisse (Runde <span data-el="round">1</span>)</h3>' +
      '<div class="mini-results" data-el="results"></div>' +
    '</section>';

  const phaseEl = root.querySelector('[data-el="phase"]');
  const autogoEl = root.querySelector('[data-el="autogo"]');
  const roundEl = root.querySelector('[data-el="round"]');
  const resultsEl = root.querySelector('[data-el="results"]');
  const proxyEl = root.querySelector('[data-el="proxy"]');
  const proxySecEl = root.querySelector('[data-el="proxysec"]');
  const armBtn = root.querySelector('[data-act="arm"]');
  const yellowBtn = root.querySelector('[data-act="yellow"]');
  const redBtn = root.querySelector('[data-act="red"]');
  const goBtn = root.querySelector('[data-act="go"]');
  const endBtn = root.querySelector('[data-act="endRound"]');

  root.querySelectorAll('[data-act]').forEach((b) => {
    b.addEventListener('click', () => ctx.send({ type: 'master', action: b.dataset.act }));
  });

  function proxyPress(clientId) {
    const s = ctx.state();
    const phase = s.game.phase;
    if (phase === 'armed' || phase === 'yellow') { ctx.send({ type: 'master', action: 'masterPress', clientId }); }
    else if (phase === 'go') {
      const t = ctx.goLocalTime();
      const reactionMs = t !== null ? (performance.now() - t) : 0;
      ctx.send({ type: 'master', action: 'masterPress', clientId, reactionMs });
    }
  }

  function update(s) {
    phaseEl.textContent = PHASE_LABEL[s.game.phase] || s.game.phase;
    roundEl.textContent = s.game.round;

    const phase = s.game.phase;
    armBtn.disabled = (phase === 'armed' || phase === 'yellow' || phase === 'go');
    yellowBtn.disabled = (phase !== 'armed');
    redBtn.disabled = (phase !== 'yellow');
    goBtn.disabled = (phase !== 'armed' && phase !== 'yellow');
    endBtn.disabled = (phase === 'idle' || phase === 'results');

    const masterOnly = !!(s.settings && s.settings.masterOnlyMode);
    proxySecEl.classList.toggle('hidden', !masterOnly);
    const done = new Set(s.game.results.map((r) => r.id));
    const canPress = masterOnly && (phase === 'armed' || phase === 'yellow' || phase === 'go');
    proxyEl.classList.toggle('hidden', !canPress);
    if (canPress) renderProxyBuzzRow(proxyEl, proxyPlayers(s), proxyPress, done);

    const admin = ctx.admin();
    const rc = (admin && admin.reactionCfg) || null;
    const autoTxt = !rc ? '' : rc.autoGo
      ? 'Auto-GRÜN aktiv: zufällig ' + rc.autoDelayMin + '–' + rc.autoDelayMax + ' ms nach Start.'
      : 'Auto-GRÜN aus – du gibst GRÜN manuell.';
    const ptsTxt = (rc && rc.rangPunkte.length)
      ? ' Punkte je Platz: ' + rc.rangPunkte.join(' / ') + '.' : '';
    autogoEl.textContent = autoTxt + ptsTxt;

    resultsEl.innerHTML = '';
    s.game.results.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'mini-row';
      row.innerHTML = avatarChip(r) + '<span class="mname">' + escapeHtml(r.name) + '</span>' +
        (r.falseStart ? '<span class="badge-false">ZU FRÜH</span>'
                      : '<span class="mtime">' + r.reactionMs + ' ms</span>' +
                        (r.pts > 0 ? '<span class="rx-pts">+' + r.pts + '</span>' : ''));
      resultsEl.appendChild(row);
    });
    if (s.game.results.length === 0) resultsEl.innerHTML = '<p class="muted small">Noch keine Ergebnisse.</p>';
  }

  return { update };
}

