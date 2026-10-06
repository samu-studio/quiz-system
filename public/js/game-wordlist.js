'use strict';
// Spiel: Wortliste aufdecken – Bildschirm/Spieler/Master-Module.

// ===========================================================================
// SPIEL: Wortliste aufdecken – rollenspezifische Oberflaechen
// ===========================================================================

// --- Bildschirm: Ueberschrift + Fortschritt + Liste (verdeckt/aufgedeckt) ---
function createWordlistScreen(root, ctx) {
  root.innerHTML =
    '<div class="wl-heading" data-el="heading"></div>' +
    '<div class="wl-progress" data-el="progress"></div>' +
    '<div class="wl-list" data-el="list"></div>';
  const headingEl = root.querySelector('[data-el="heading"]');
  const progressEl = root.querySelector('[data-el="progress"]');
  const listEl = root.querySelector('[data-el="list"]');
  let prev = [];   // vorheriger Aufdeck-Zustand -> neu aufgedeckte Felder animieren

  function update(s) {
    const wl = s.game.wl;
    if (!wl) { headingEl.textContent = ''; progressEl.textContent = ''; listEl.innerHTML = ''; prev = []; return; }

    headingEl.textContent = wl.heading || '';
    headingEl.classList.toggle('hidden', !wl.heading);
    progressEl.textContent = wl.revealedCount + ' / ' + wl.total + ' aufgedeckt';

    listEl.innerHTML = '';
    wl.entries.forEach((e, i) => {
      const item = document.createElement('div');
      item.className = 'wl-item' + (e.revealed ? ' open' : '');
      if (e.revealed && !prev[i]) item.classList.add('pop');   // gerade neu aufgedeckt
      item.innerHTML =
        '<span class="wl-num">' + (i + 1) + '</span>' +
        '<span class="wl-word">' + (e.revealed ? escapeHtml(e.word) : '???') + '</span>';
      listEl.appendChild(item);
    });
    prev = wl.entries.map((e) => e.revealed);
  }

  return { update };
}

// --- Spieler: nur Eingabefeld + Sende-Button + Freigabe-Status --------------
function createWordlistPlayer(root, ctx) {
  root.innerHTML =
    '<div class="wl-player">' +
      '<div class="wl-player-status" data-el="status"></div>' +
      '<form class="wl-form" data-el="form">' +
        '<input class="wl-input" data-el="input" type="text" maxlength="60" ' +
          'placeholder="Begriff eingeben…" autocomplete="off" autocapitalize="off" autocorrect="off" />' +
        '<button class="btn btn-primary wl-send" data-el="send" type="submit">Senden</button>' +
      '</form>' +
      '<div class="wl-last" data-el="last"></div>' +
      '<div class="wl-player-progress" data-el="progress"></div>' +
      '<div class="player-score" data-el="score"></div>' +
    '</div>';
  const form = root.querySelector('[data-el="form"]');
  const input = root.querySelector('[data-el="input"]');
  const sendBtn = root.querySelector('[data-el="send"]');
  const statusEl = root.querySelector('[data-el="status"]');
  const lastEl = root.querySelector('[data-el="last"]');
  const progressEl = root.querySelector('[data-el="progress"]');
  const scoreEl = root.querySelector('[data-el="score"]');
  let lastSent = '';

  const onSubmit = (e) => {
    e.preventDefault();
    const s = ctx.state();
    if (!s || s.game.locked) return;                       // globaler Killswitch
    const wl = s.game.wl;
    if (!wl || !wl.unlocked || !wl.unlocked[ctx.clientId()]) return;  // gesperrt
    const word = input.value.trim();
    if (!word) { input.focus(); return; }
    ctx.send({ type: 'submitWord', word });
    lastSent = word;
    input.value = '';
    input.focus();
    lastEl.textContent = 'Zuletzt gesendet: ' + lastSent;
  };
  form.addEventListener('submit', onSubmit);

  function update(s) {
    const wl = s.game.wl;
    const unlocked = !!(wl && wl.unlocked && wl.unlocked[ctx.clientId()]);
    input.disabled = !unlocked;
    sendBtn.disabled = !unlocked;
    if (unlocked) {
      statusEl.className = 'wl-player-status open';
      statusEl.textContent = '✅ Du bist freigegeben – rate los!';
    } else {
      statusEl.className = 'wl-player-status locked';
      statusEl.textContent = '🔒 Warte auf die Freigabe durch den Master.';
    }
    lastEl.textContent = lastSent ? 'Zuletzt gesendet: ' + lastSent : '';
    // Fortschritt (nur Zahlen, keine Woerter) als Motivation.
    progressEl.textContent = wl ? (wl.revealedCount + ' / ' + wl.total + ' aufgedeckt') : '';
    const pts = s.game.scores[ctx.clientId()] || 0;
    scoreEl.textContent = pts > 0 ? 'Deine Punkte: ' + pts : '';
  }

  return { update, destroy() { form.removeEventListener('submit', onSubmit); } };
}

// --- Master: Spieler-Freigaben (+ letztes Wort) + Felder auf-/zudecken ------
function createWordlistMaster(root, ctx) {
  root.innerHTML =
    '<section class="panel">' +
      '<div class="wl-master-head">' +
        '<h3>Spieler-Freigaben</h3>' +
        '<div class="row-buttons">' +
          '<button class="btn btn-ghost small" data-act="wlUnlockAll">Alle freigeben</button>' +
          '<button class="btn btn-ghost small" data-act="wlLockAll">Alle sperren</button>' +
        '</div>' +
      '</div>' +
      '<div class="wl-players" data-el="players"></div>' +
    '</section>' +
    '<section class="panel">' +
      '<div class="wl-master-head">' +
        '<h3>Wortliste (<span data-el="count">0/0</span>)</h3>' +
        '<button class="btn btn-ghost small danger-text" data-act="wlReset">Alles verdecken</button>' +
      '</div>' +
      '<p class="muted small" data-el="ptsinfo"></p>' +
      '<div class="wl-words" data-el="words"></div>' +
    '</section>';

  const playersEl = root.querySelector('[data-el="players"]');
  const wordsEl = root.querySelector('[data-el="words"]');
  const countEl = root.querySelector('[data-el="count"]');
  const ptsInfoEl = root.querySelector('[data-el="ptsinfo"]');

  root.querySelectorAll('[data-act]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (b.dataset.act === 'wlReset' && !(await confirmModal('Alle Felder wieder verdecken?', { title: 'Zurücksetzen', okText: 'Zurücksetzen' }))) return;
      ctx.send({ type: 'master', action: b.dataset.act });
    });
  });

  function update(s) {
    const wl = s.game.wl || { entries: [], unlocked: {}, revealedCount: 0, total: 0 };
    const lastWords = s.game.wlLastWords || {};   // nur im Master-Snapshot
    const solution = s.game.wlSolution || [];     // volle Loesung (nur Master)
    const players = (s.participants || []).filter((p) => p.role === 'player');

    // Spieler-Freigaben (+ zuletzt gesendetes Wort)
    playersEl.innerHTML = '';
    players.forEach((p) => {
      const unlocked = !!(wl.unlocked && wl.unlocked[p.id]);
      const last = lastWords[p.id];
      const row = document.createElement('div');
      row.className = 'wl-prow' + (unlocked ? ' open' : '');
      row.innerHTML =
        '<span class="dev-dot' + (p.online ? ' online' : '') + '"><span class="led"></span></span>' +
        avatarChip(p) +
        '<span class="wl-pname">' + escapeHtml(p.name) + '</span>' +
        '<span class="wl-pword">' + (last ? escapeHtml(last) : '—') + '</span>';
      const btn = document.createElement('button');
      btn.className = 'btn small ' + (unlocked ? 'btn-danger' : 'btn-success');
      btn.textContent = unlocked ? 'Sperren' : 'Freigeben';
      btn.addEventListener('click', () =>
        ctx.send({ type: 'master', action: 'wlSetLock', clientId: p.id, locked: unlocked }));
      row.appendChild(btn);
      playersEl.appendChild(row);
    });
    if (players.length === 0) playersEl.innerHTML = '<p class="muted small">Noch keine Spieler verbunden.</p>';

    // Wortliste: volle Loesung + einzelne Auf-/Zudeck-Buttons
    countEl.textContent = wl.revealedCount + '/' + wl.total;
    const wc = ctx.admin() && ctx.admin().wordlistCfg;
    ptsInfoEl.textContent = (wc && wc.punkteAktiv)
      ? 'Punkte aktiv: +' + wc.punkte + ' für jeden selbst aufgedeckten Begriff.'
      : 'Punktevergabe deaktiviert (im Tab „🎲 Spiele" einschaltbar).';
    wordsEl.innerHTML = '';
    solution.forEach((word, i) => {
      const isOpen = wl.entries[i] ? wl.entries[i].revealed : false;
      const row = document.createElement('div');
      row.className = 'wl-wrow' + (isOpen ? ' open' : '');
      row.innerHTML =
        '<span class="wl-num">' + (i + 1) + '</span>' +
        '<span class="wl-word">' + escapeHtml(word) + '</span>';
      const btn = document.createElement('button');
      btn.className = 'btn small ' + (isOpen ? 'btn-ghost' : 'btn-primary');
      btn.textContent = isOpen ? 'Verdecken' : 'Aufdecken';
      btn.addEventListener('click', () =>
        ctx.send({ type: 'master', action: 'wlToggleReveal', index: i }));
      row.appendChild(btn);
      wordsEl.appendChild(row);
    });
    if (solution.length === 0) {
      wordsEl.innerHTML = '<p class="muted small">Keine Begriffe in diesem Profil. Lege sie im Tab „🎲 Spiele" → „⚙️ Konfigurieren" an.</p>';
    }
  }

  return { update };
}

