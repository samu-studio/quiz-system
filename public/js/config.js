'use strict';
// Master: Tab „Spiele & Konfig" – Spiel-/Profilauswahl, Konfig-Seite, Allgemein.

// ---------------------------------------------------------------------------
// MASTER – Tab "Spiele & Konfig"
// ---------------------------------------------------------------------------
function setupConfigTab() {
  $('config-back').addEventListener('click', async () => { if (await confirmLeaveConfig()) showGamesBrowse(); });
  // Sortiermodus der Spiele-Kachelliste umschalten (Server speichert den Modus).
  $('game-sort').addEventListener('change', () =>
    sendAdmin({ type: 'admin', action: 'setGameSort', sort: $('game-sort').value }));
  // Spielplan: neuen Schritt anhaengen (Default: erstes echtes Spiel, dessen aktuell
  // aktives Profil – fest eingetragen, damit jeder Schritt ein konkretes Profil hat).
  $('pl-add').addEventListener('click', () => {
    const steps = gatherPlaylistSteps();
    const firstGame = orderedGameIds().find((g) => g !== 'none') || '';
    if (firstGame) steps.push({ game: firstGame, profile: playlistDefaultProfile(firstGame) });
    sendPlaylist(steps);
  });
  // Aendert sich ein steuerndes Feld (z. B. Punkte-Modus), Sichtbarkeit neu bewerten.
  $('config-fields').addEventListener('change', applyFieldVisibility);
  // Schieberegler-Werte + Live-Vorschau bei jeder Eingabe mitziehen.
  $('config-fields').addEventListener('input', () => { refreshRangeLabels(); updateConfigPreview(); });
  $('config-fields').addEventListener('change', updateConfigPreview);
  $('profile-select').addEventListener('change', async () => {
    // Profilwechsel im Editor verwirft die aktuellen Eingaben -> nachfragen.
    if (!(await confirmLeaveConfig())) { $('profile-select').value = configProfile || ''; return; }
    loadProfileIntoFields($('profile-select').value);
  });
  $('profile-new').addEventListener('click', async () => {
    // Legt noch KEIN Profil an - leert nur den Editor auf ein Default-Preset ohne
    // Namen. Angelegt wird es erst beim „Profil speichern" (wie ein neuer Name im
    // Feld darunter). Ungespeicherte Aenderungen am bisherigen Profil gehen dabei
    // verloren -> vorher nachfragen, wie bei jedem anderen Profilwechsel.
    if (!(await confirmLeaveConfig())) return;
    $('profile-select').value = '';
    loadProfileIntoFields(null);
    $('profile-name').focus();
  });
  $('profile-activate').addEventListener('click', async () => {
    // Aktivieren laedt die Felder neu -> ungespeicherte Aenderungen wuerden verworfen.
    if (!(await confirmLeaveConfig())) return;
    const name = $('profile-select').value;
    sendAdmin({ type: 'admin', action: 'selectProfile', game: configGame, name });
  });
  $('profile-delete').addEventListener('click', async () => {
    const name = $('profile-select').value;
    if (!(await confirmModal('Profil „' + name + '" wirklich löschen?', { title: 'Profil löschen', okText: 'Löschen', danger: true }))) return;
    sendAdmin({ type: 'admin', action: 'deleteProfile', game: configGame, name });
  });
  $('profile-save').addEventListener('click', () => {
    const name = $('profile-name').value.trim();
    if (!name) { setConfigMsg('Bitte einen Profilnamen angeben.'); return; }
    // Nach dem Speichern im gerade gespeicherten Profil bleiben (auch bei „Speichern
    // unter neuem Namen"); das Aktiv-Flag bleibt unberuehrt (kein activate).
    configProfile = name;
    sendAdmin({ type: 'admin', action: 'saveProfile', game: configGame, name, settings: gatherConfigFields() });
  });
  // Browser schließen/neu laden mit ungespeicherten Konfig-Aenderungen -> Warnung.
  window.addEventListener('beforeunload', (e) => {
    if (isConfigDirty()) { e.preventDefault(); e.returnValue = ''; }
  });
  $('admin-save').addEventListener('click', () => {
    // Design/Theme leben im eigenen Design-Tab; hier nur Titel + Passwort.
    const settings = { title: $('set-title').value };
    const np = $('set-newpass').value;
    if (np) settings.newPassword = np;
    sendAdmin({ type: 'admin', action: 'settings', settings });
  });

  // Import/Export: Konfig-Fenster (ein Spiel) + Spiele-Tab (Gesamt-Backup).
  $('cfg-export-all').addEventListener('click', exportGameProfiles);
  $('cfg-export-one').addEventListener('click', exportCurrentProfile);
  $('cfg-import-file').addEventListener('change', () => importIntoConfigGame($('cfg-import-file')));
  $('backup-export').addEventListener('click', exportFullBackup);
  $('backup-import-file').addEventListener('change', () => importBackupFile($('backup-import-file')));
}

// ---------------------------------------------------------------------------
// Import/Export (JSON) – einzelnes Profil, alle Profile eines Spiels, oder ein
// Gesamt-Backup (alle Spiele + Titel/Design/Spielplan/Teams, kein Passwort).
// Export laeuft rein clientseitig (Daten liegen schon in latestAdmin/latestState);
// jeder Import geht ueber den Server, damit die vorhandenen Sanitizer greifen.
// ---------------------------------------------------------------------------
function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function todayStamp() { return new Date().toISOString().slice(0, 10); }

// Dateiname-taugliches Token aus einem Profilnamen (Umlaute/Sonderzeichen raus).
function safeFileToken(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'profil';
}

function exportEnvelope(kind, extra) {
  return Object.assign({ app: 'quiz-system', kind, version: 1, exportedAt: new Date().toISOString() }, extra);
}

// Exportiert nur das gerade im Editor geoeffnete Profil (inkl. ungespeicherter Aenderungen).
function exportCurrentProfile() {
  const name = $('profile-name').value.trim() || configProfile || 'Profil';
  const data = exportEnvelope('profile', { game: configGame, profileName: name, profile: gatherConfigFields() });
  downloadJson('quiz-' + configGame + '-profil-' + safeFileToken(name) + '-' + todayStamp() + '.json', data);
}

// Exportiert ALLE Profile des gerade geoeffneten Spiels.
function exportGameProfiles() {
  const gd = latestAdmin.games[configGame] || { activeProfile: '', profiles: {} };
  const data = exportEnvelope('game', { game: configGame, activeProfile: gd.activeProfile, profiles: gd.profiles });
  downloadJson('quiz-' + configGame + '-alle-profile-' + todayStamp() + '.json', data);
}

// Exportiert das Gesamt-Backup: alle Spiel-Profile + Titel/Design/Spielplan/Teams.
// Bewusst OHNE Admin-Passwort.
function exportFullBackup() {
  const data = exportEnvelope('full', {
    title: latestAdmin.global.title,
    theme: latestAdmin.global.theme,
    design: latestAdmin.global.design,
    teamMode: (latestState && latestState.game.teamMode) || false,
    teams: (latestState && latestState.game.teamDefs) || [],
    playlist: latestAdmin.playlist,
    games: latestAdmin.games
  });
  downloadJson('quiz-backup-' + todayStamp() + '.json', data);
}

// Liest die vom Nutzer gewaehlte Datei als JSON ein; ruft cb(data, null) bei Erfolg
// bzw. cb(null, fehlermeldung) bei Problemen. Setzt den Datei-Input danach zurueck,
// damit dieselbe Datei erneut gewaehlt werden kann.
function readJsonFile(input, cb) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); } catch (e) { cb(null, 'Keine gültige JSON-Datei.'); return; }
    cb(data, null);
  };
  reader.onerror = () => cb(null, 'Datei konnte nicht gelesen werden.');
  reader.readAsText(file);
}

// Import im Konfig-Fenster: nur fuer das gerade geoeffnete Spiel (configGame),
// akzeptiert eine Einzelprofil- oder eine Alle-Profile-Datei.
function importIntoConfigGame(input) {
  readJsonFile(input, async (data, err) => {
    if (err) { setConfigMsg(err); return; }
    if (!data || (data.kind !== 'profile' && data.kind !== 'game')) {
      setConfigMsg(data && data.kind === 'full'
        ? 'Das ist ein Gesamt-Backup – bitte im Spiele-Tab importieren.'
        : 'Unbekanntes Dateiformat.');
      return;
    }
    if (data.game && data.game !== configGame) {
      setConfigMsg('Diese Datei gehört zum Spiel „' + data.game + '", nicht zu „' + configGame + '".');
      return;
    }
    if (data.kind === 'profile') {
      const name = String(data.profileName || 'Importiert').trim().slice(0, 40) || 'Importiert';
      const gd = latestAdmin.games[configGame] || { profiles: {} };
      const msg = gd.profiles[name]
        ? 'Profil „' + name + '" ist bereits vorhanden und wird überschrieben. Importieren?'
        : 'Profil „' + name + '" importieren?';
      if (!(await confirmModal(msg, { title: 'Profil importieren', okText: 'Importieren' }))) return;
      configProfile = name;   // nach dem Import gleich dieses Profil zeigen
      sendAdmin({ type: 'admin', action: 'importProfiles', game: configGame, profiles: { [name]: data.profile } });
    } else {
      const gd = latestAdmin.games[configGame] || { profiles: {} };
      const names = Object.keys(data.profiles || {});
      const overlap = names.filter((n) => gd.profiles[n]).length;
      const msg = names.length + ' Profil(e) importieren' +
        (overlap ? ' – ' + overlap + ' vorhandene(s) wird/werden überschrieben' : '') + '. Fortfahren?';
      if (!(await confirmModal(msg, { title: 'Profile importieren', okText: 'Importieren' }))) return;
      sendAdmin({ type: 'admin', action: 'importProfiles', game: configGame, profiles: data.profiles });
    }
  });
}

// Import im Spiele-Tab: universell (Einzelprofil, Alle-Profile ODER Gesamt-Backup),
// Spiel wird aus der Datei selbst bestimmt (nicht an eine geoeffnete Konfig-Seite gebunden).
function importBackupFile(input) {
  readJsonFile(input, async (data, err) => {
    if (err) { setBackupMsg(err); return; }
    if (!data || !data.kind) { setBackupMsg('Unbekanntes Dateiformat.'); return; }
    if (data.kind === 'full') {
      const ok = await confirmModal(
        'Gesamt-Backup importieren? Titel, Design, Spielplan, Teams und alle Spiel-Profile werden zusammengeführt ' +
        '(gleicher Name überschreibt, alles andere bleibt erhalten). Das Admin-Passwort bleibt unverändert.',
        { title: 'Backup importieren', okText: 'Importieren' });
      if (!ok) return;
      sendAdmin({ type: 'admin', action: 'importFull', data });
    } else if (data.kind === 'game') {
      if (!GAMES[data.game]) { setBackupMsg('Unbekanntes Spiel „' + data.game + '".'); return; }
      const names = Object.keys(data.profiles || {});
      const ok = await confirmModal(
        'Profile für „' + GAMES[data.game].name + '" importieren (' + names.length + ' Stück, gleicher Name überschreibt)?',
        { title: 'Profile importieren', okText: 'Importieren' });
      if (!ok) return;
      sendAdmin({ type: 'admin', action: 'importProfiles', game: data.game, profiles: data.profiles });
    } else if (data.kind === 'profile') {
      if (!GAMES[data.game]) { setBackupMsg('Unbekanntes Spiel „' + data.game + '".'); return; }
      const name = String(data.profileName || 'Importiert').trim().slice(0, 40) || 'Importiert';
      const ok = await confirmModal(
        'Profil „' + name + '" für „' + GAMES[data.game].name + '" importieren?',
        { title: 'Profil importieren', okText: 'Importieren' });
      if (!ok) return;
      sendAdmin({ type: 'admin', action: 'importProfiles', game: data.game, profiles: { [name]: data.profile } });
    } else {
      setBackupMsg('Unbekanntes Dateiformat.');
    }
  });
}

function setBackupMsg(text) {
  const el = $('backup-msg'); if (el) el.textContent = text;
}

// --- Ansicht A: Spiel- & Profilauswahl -------------------------------------
// Zeigt die Spielauswahl (statt der Konfig-Seite) und baut die Kartenliste neu.
function showGamesBrowse() {
  configOpen = false;
  $('config-page').classList.add('hidden');
  $('games-browse').classList.remove('hidden');
  renderGamesTab();
}

// Sortierte Spiele-ID-Liste je nach gewaehltem Modus. „Kein Spiel" (none) steht
// bewusst immer ganz oben (nicht mitsortierbar).
function orderedGameIds() {
  const reals = Object.keys(GAMES).filter((g) => g !== 'none');
  const mode = (latestAdmin && latestAdmin.gameSort) || 'custom';
  let ordered;
  if (mode === 'alphaAsc' || mode === 'alphaDesc') {
    ordered = reals.slice().sort((a, b) => GAMES[a].name.localeCompare(GAMES[b].name, 'de'));
    if (mode === 'alphaDesc') ordered.reverse();
  } else if (mode === 'recent') {
    // Aktivierungs-Historie zuerst (zuletzt gespielt oben), dann noch nie gewaehlte.
    const hist = (latestAdmin.gamePlayed || []).filter((g) => reals.includes(g));
    ordered = hist.concat(reals.filter((g) => !hist.includes(g)));
  } else { // custom
    // Gespeicherte Reihenfolge; neue/unbekannte Spiele hinten anhaengen.
    const saved = (latestAdmin.gameOrder || []).filter((g) => reals.includes(g));
    ordered = saved.concat(reals.filter((g) => !saved.includes(g)));
  }
  return ['none'].concat(ordered);
}

// Kartenliste: aktives Spiel + Profil waehlen. Konfig-Details nur ueber „Konfigurieren".
function renderGamesTab() {
  if (!latestAdmin) return;
  if (gameDragActive) return;           // laufendes Umsortieren nicht durch Rebuild stoeren
  const list = $('game-list');
  list.innerHTML = '';
  const activeGame = latestAdmin.activeGame;

  const mode = (latestAdmin.gameSort) || 'custom';
  const sortSel = $('game-sort');
  if (sortSel && sortSel.value !== mode) sortSel.value = mode;
  const draggable = mode === 'custom';
  $('game-sort-hint').classList.toggle('hidden', !draggable);

  const order = orderedGameIds();
  order.forEach((gid) => {
    const g = GAMES[gid];
    const isActive = activeGame === gid;
    const card = document.createElement('div');
    card.className = 'game-card' + (isActive ? ' active' : '');
    card.dataset.gid = gid;

    // Zieh-Griff nur im „Eigene Reihenfolge"-Modus und nur fuer echte Spiele
    // (nicht fuer „Kein Spiel", das fix oben bleibt).
    if (draggable && gid !== 'none') {
      const handle = document.createElement('span');
      handle.className = 'game-drag-handle';
      handle.textContent = '⠿';
      handle.title = 'Ziehen zum Umsortieren';
      handle.addEventListener('pointerdown', (e) => startGameDrag(e, card, list));
      card.appendChild(handle);
    }

    const info = document.createElement('div');
    info.className = 'game-card-head';
    info.innerHTML =
      '<span class="game-emoji">' + g.emoji + '</span>' +
      '<span class="game-info"><span class="game-name">' + escapeHtml(g.name) +
      (isActive ? ' <span class="active-badge">aktiv</span>' : '') + '</span>' +
      '<span class="game-desc muted small">' + escapeHtml(g.desc) + '</span></span>';
    card.appendChild(info);

    const btns = document.createElement('div');
    btns.className = 'game-card-btns';

    if (!isActive) {
      const actBtn = document.createElement('button');
      actBtn.className = 'btn btn-primary small';
      actBtn.textContent = 'Aktiv setzen';
      actBtn.addEventListener('click', () => sendAdmin({ type: 'admin', action: 'selectGame', game: gid }));
      btns.appendChild(actBtn);
    }

    if (!g.noConfig) {
      // Profil-Schnellauswahl (aktiviert Profil sofort)
      const gd = latestAdmin.games[gid] || { activeProfile: '', profiles: {} };
      const profWrap = document.createElement('label');
      profWrap.className = 'game-prof';
      profWrap.appendChild(document.createTextNode('Profil'));
      const sel = document.createElement('select');
      Object.keys(gd.profiles).forEach((n) => {
        const opt = document.createElement('option');
        opt.value = n; opt.textContent = n;
        if (n === gd.activeProfile) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', () =>
        sendAdmin({ type: 'admin', action: 'selectProfile', game: gid, name: sel.value }));
      profWrap.appendChild(sel);
      btns.appendChild(profWrap);

      const cfgBtn = document.createElement('button');
      cfgBtn.className = 'btn btn-ghost small';
      cfgBtn.textContent = '⚙️ Konfigurieren';
      cfgBtn.addEventListener('click', () => openConfigPage(gid));
      btns.appendChild(cfgBtn);
    }

    card.appendChild(btns);
    list.appendChild(card);
  });

  renderPlaylistEditor();
}

// Umsortieren der Spiele-Kacheln per Pointer (Touch + Maus), Live-Reorder im DOM.
// „Kein Spiel" bleibt fix als erstes Element und ist kein Ziel. Beim Loslassen
// wird die neue Reihenfolge an den Server geschickt (action 'setGameOrder').
function startGameDrag(e, card, list) {
  e.preventDefault();
  gameDragActive = true;
  card.classList.add('dragging');
  const handle = e.currentTarget;
  try { handle.setPointerCapture(e.pointerId); } catch (err) {}

  function onMove(ev) {
    ev.preventDefault();
    const y = ev.clientY;
    // Nur echte Spiele sind Ziel; „Kein Spiel" bleibt oben und wird nie ueberholt.
    const others = Array.from(list.querySelectorAll('.game-card'))
      .filter((c) => c !== card && c.dataset.gid !== 'none');
    let before = null;   // Karte, VOR die wir einsortieren
    for (const c of others) {
      const r = c.getBoundingClientRect();
      if (y < r.top + r.height / 2) { before = c; break; }
    }
    // before == erste echte Karte -> landet direkt hinter „Kein Spiel" (oben bleibt fix);
    // kein Treffer -> ans Ende. So kann keine Karte ueber „Kein Spiel" rutschen.
    if (before) list.insertBefore(card, before);
    else list.appendChild(card);
  }

  function onUp() {
    // Auf document lauschen, nicht am Griff: ohne Pointer-Capture landet das
    // pointerup sonst irgendwo (Karte ist unter dem Finger weggewandert).
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    card.classList.remove('dragging');
    gameDragActive = false;
    const order = Array.from(list.querySelectorAll('.game-card'))
      .map((c) => c.dataset.gid).filter((g) => g && g !== 'none');
    sendAdmin({ type: 'admin', action: 'setGameOrder', order });
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

// --- Ansicht B: Konfig-Seite (nur ueber „Konfigurieren" erreichbar) --------
function openConfigPage(gid) {
  if (!GAMES[gid] || GAMES[gid].noConfig) return;
  configGame = gid;
  configOpen = true;
  configProfile = null;    // frisch geoeffnet -> aktives Profil des Spiels zeigen
  $('games-browse').classList.add('hidden');
  $('config-page').classList.remove('hidden');
  renderConfigPanel();     // Profil-Auswahl + Felder aufbauen
  window.scrollTo(0, 0);
}

// Allgemein-Formular aus dem gespeicherten Stand fuellen. Wird beim Betreten des
// Allgemein-Tabs aufgerufen (nicht bei jedem Broadcast), damit laufende Eingaben
// nicht ueberschrieben werden.
function populateGeneralForm() {
  if (!latestAdmin) return;
  $('set-title').value = latestAdmin.global.title;
  $('set-newpass').value = '';
}

function renderConfigPanel() {
  const g = GAMES[configGame];
  const gd = latestAdmin.games[configGame] || { activeProfile: '', profiles: {} };
  $('config-game-emoji').textContent = g.emoji;
  $('config-game-name').textContent = g.name + ' – Konfiguration';

  // Profil-Auswahl fuellen
  const sel = $('profile-select');
  const names = Object.keys(gd.profiles);
  sel.innerHTML = '';
  names.forEach((n) => {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n + (n === gd.activeProfile ? '  ★ (aktiv)' : '');
    sel.appendChild(opt);
  });
  // Bevorzugt das gerade bearbeitete Profil (bleibt nach dem Speichern erhalten),
  // sonst das aktive, sonst das erste. So faellt man nach dem Speichern NICHT auf
  // das aktive Profil zurueck.
  const chosen = names.includes(configProfile) ? configProfile
    : (names.includes(gd.activeProfile) ? gd.activeProfile : names[0]);
  sel.value = chosen;

  // Felder-Container aufbauen
  const fc = $('config-fields');
  fc.innerHTML = '';
  // Optionale Live-Vorschau des Spiels (GAMES.<id>.preview), klebt beim Scrollen oben.
  if (g.preview) {
    const pv = document.createElement('div');
    pv.className = 'cfg-preview';
    pv.innerHTML = '<div class="muted small">Live-Vorschau (Bildschirm)</div><div id="config-preview"></div>';
    fc.appendChild(pv);
  }
  g.fields.forEach((f) => {
    // Multiple-Choice-Fragen: eigener strukturierter Editor (kein <label>/<input>).
    if (f.type === 'mcq') {
      const wrap = document.createElement('div');
      wrap.className = 'cfg-field';
      const cap = document.createElement('div');
      cap.className = 'muted small';
      cap.textContent = f.label;
      wrap.appendChild(cap);
      const editor = document.createElement('div');
      editor.id = 'cfg-' + f.key;
      buildMcqEditor(editor);
      wrap.appendChild(editor);
      fc.appendChild(wrap);
      return;
    }
    // Zuordnungs-Paare: eigener Editor (links + rechts, leere Seite = Falle).
    if (f.type === 'pairs') {
      const wrap = document.createElement('div');
      wrap.className = 'cfg-field';
      const cap = document.createElement('div');
      cap.className = 'muted small';
      cap.textContent = f.label;
      wrap.appendChild(cap);
      const editor = document.createElement('div');
      editor.id = 'cfg-' + f.key;
      buildPairsEditor(editor);
      wrap.appendChild(editor);
      fc.appendChild(wrap);
      return;
    }
    // Falsche-Wörter-Liste: eigener Editor (Wort + Haken „passt nicht").
    if (f.type === 'wordflags') {
      const wrap = document.createElement('div');
      wrap.className = 'cfg-field';
      const cap = document.createElement('div');
      cap.className = 'muted small';
      cap.textContent = f.label;
      wrap.appendChild(cap);
      const editor = document.createElement('div');
      editor.id = 'cfg-' + f.key;
      buildWfEditor(editor);
      wrap.appendChild(editor);
      fc.appendChild(wrap);
      return;
    }
    // Wahr/Falsch-Aussagen: eigener Editor (Aussage + Haken „ist wahr").
    if (f.type === 'truefalse') {
      const wrap = document.createElement('div');
      wrap.className = 'cfg-field';
      const cap = document.createElement('div');
      cap.className = 'muted small';
      cap.textContent = f.label;
      wrap.appendChild(cap);
      const editor = document.createElement('div');
      editor.id = 'cfg-' + f.key;
      buildTfEditor(editor);
      wrap.appendChild(editor);
      fc.appendChild(wrap);
      return;
    }
    // Detektivquiz-Fälle: eigener Editor (Lösung + Hinweise je Fall).
    if (f.type === 'cases') {
      const wrap = document.createElement('div');
      wrap.className = 'cfg-field';
      const cap = document.createElement('div');
      cap.className = 'muted small';
      cap.textContent = f.label;
      wrap.appendChild(cap);
      const editor = document.createElement('div');
      editor.id = 'cfg-' + f.key;
      buildCasesEditor(editor);
      wrap.appendChild(editor);
      fc.appendChild(wrap);
      return;
    }
    // Reihenfolge-Quiz-Fragen: eigener Editor (Frage + Elemente in richtiger Reihenfolge).
    if (f.type === 'roq') {
      const wrap = document.createElement('div');
      wrap.className = 'cfg-field';
      const cap = document.createElement('div');
      cap.className = 'muted small';
      cap.textContent = f.label;
      wrap.appendChild(cap);
      const editor = document.createElement('div');
      editor.id = 'cfg-' + f.key;
      buildRoqEditor(editor);
      wrap.appendChild(editor);
      fc.appendChild(wrap);
      return;
    }
    // Schätzfragen: eigener Editor (Frage + Lösung + Einheit + optional Min/Max/Schritt).
    if (f.type === 'estq') {
      const wrap = document.createElement('div');
      wrap.className = 'cfg-field';
      const cap = document.createElement('div');
      cap.className = 'muted small';
      cap.textContent = f.label;
      wrap.appendChild(cap);
      const editor = document.createElement('div');
      editor.id = 'cfg-' + f.key;
      buildEstqEditor(editor);
      wrap.appendChild(editor);
      fc.appendChild(wrap);
      return;
    }
    // Audioquiz-Runden: eigener Editor (Lösung + Audiodatei/Upload + Ausschnitt-Längen).
    if (f.type === 'audioq') {
      const wrap = document.createElement('div');
      wrap.className = 'cfg-field';
      const cap = document.createElement('div');
      cap.className = 'muted small';
      cap.textContent = f.label;
      wrap.appendChild(cap);
      const editor = document.createElement('div');
      editor.id = 'cfg-' + f.key;
      buildAudioqEditor(editor);
      wrap.appendChild(editor);
      fc.appendChild(wrap);
      return;
    }
    // Bildwahl: Kacheln der hochgeladenen Bilder + Upload (ein Dateiname).
    if (f.type === 'bildwahl') {
      const wrap = document.createElement('div');
      wrap.className = 'cfg-field';
      const cap = document.createElement('div');
      cap.className = 'muted small';
      cap.textContent = f.label;
      wrap.appendChild(cap);
      const editor = document.createElement('div');
      editor.id = 'cfg-' + f.key;
      buildBildwahlEditor(editor);
      wrap.appendChild(editor);
      fc.appendChild(wrap);
      return;
    }
    // Schieberegler: Beschriftung + Regler + aktueller Wert (wie .slider-row im Design-Tab).
    if (f.type === 'range') {
      const row = document.createElement('div');
      row.className = 'slider-row cfg-slider';
      const lab = document.createElement('label');
      lab.textContent = f.label;
      lab.htmlFor = 'cfg-' + f.key;
      const inp = document.createElement('input');
      inp.type = 'range'; inp.id = 'cfg-' + f.key;
      if (f.min != null) inp.min = f.min;
      if (f.max != null) inp.max = f.max;
      if (f.step != null) inp.step = f.step;
      const sv = document.createElement('span');
      sv.className = 'sv';
      sv.dataset.rangeFor = f.key;
      sv.dataset.unit = f.unit || '';
      row.appendChild(lab); row.appendChild(inp); row.appendChild(sv);
      fc.appendChild(row);
      return;
    }
    const label = document.createElement('label');
    label.className = f.type === 'bool' ? 'cfg-row' : 'cfg-field';
    if (f.type === 'bool') {
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.id = 'cfg-' + f.key;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + f.label));
    } else {
      label.appendChild(document.createTextNode(f.label));
      let inp;
      if (f.type === 'list') {
        inp = document.createElement('textarea');
        inp.rows = f.rows || 8;
        if (f.placeholder) inp.placeholder = f.placeholder;
      } else if (f.type === 'text') {
        inp = document.createElement('input');
        inp.type = 'text';
        if (f.maxlength != null) inp.maxLength = f.maxlength;
        if (f.placeholder) inp.placeholder = f.placeholder;
      } else if (f.type === 'select') {
        inp = document.createElement('select');
        (f.options || []).forEach((o) => {
          const opt = document.createElement('option');
          opt.value = o.value;
          opt.textContent = o.label;
          inp.appendChild(opt);
        });
      } else {
        inp = document.createElement('input');
        inp.type = 'number';
        if (f.min != null) inp.min = f.min;
        if (f.max != null) inp.max = f.max;
        if (f.step != null) inp.step = f.step;
      }
      inp.id = 'cfg-' + f.key;
      label.appendChild(inp);
    }
    fc.appendChild(label);
  });

  loadProfileIntoFields(chosen);
  setConfigMsg('');
}

function loadProfileIntoFields(name) {
  const g = GAMES[configGame];
  const gd = latestAdmin.games[configGame] || { profiles: {} };
  const data = Object.assign({}, g.defaults, gd.profiles[name] || {});
  g.fields.forEach((f) => {
    const el = $('cfg-' + f.key);
    if (!el) return;
    if (f.type === 'bool') el.checked = !!data[f.key];
    else if (f.type === 'list') el.value = Array.isArray(data[f.key]) ? data[f.key].join('\n') : (data[f.key] || '');
    else if (f.type === 'mcq') setMcqData(el, Array.isArray(data[f.key]) ? data[f.key] : []);
    else if (f.type === 'wordflags') setWfData(el, Array.isArray(data[f.key]) ? data[f.key] : []);
    else if (f.type === 'truefalse') setTfData(el, Array.isArray(data[f.key]) ? data[f.key] : []);
    else if (f.type === 'pairs') setPairsData(el, Array.isArray(data[f.key]) ? data[f.key] : []);
    else if (f.type === 'cases') setCasesData(el, Array.isArray(data[f.key]) ? data[f.key] : []);
    else if (f.type === 'roq') setRoqData(el, Array.isArray(data[f.key]) ? data[f.key] : []);
    else if (f.type === 'estq') setEstqData(el, Array.isArray(data[f.key]) ? data[f.key] : []);
    else if (f.type === 'audioq') setAudioqData(el, Array.isArray(data[f.key]) ? data[f.key] : []);
    else if (f.type === 'bildwahl') setBildwahlData(el, typeof data[f.key] === 'string' ? data[f.key] : '');
    else el.value = data[f.key] != null ? data[f.key] : '';
  });
  $('profile-name').value = name || '';
  applyFieldVisibility();   // Felder mit showIf gleich passend ein-/ausblenden
  refreshRangeLabels();
  updateConfigPreview();
  configProfile = name || null;   // gerade bearbeitetes Profil merken
  configBaseline = configSnapshot();   // Ausgangsstand fuer die „ungespeichert"-Pruefung
}

// Generische Feld-Sichtbarkeit: Ein Feld mit `showIf: { key, value }` (oder
// `values: [...]`) wird nur gezeigt, wenn das steuernde Feld gerade den passenden
// Wert hat. Der steuernde Wert wird direkt aus dem DOM gelesen, umgeschaltet wird
// der aeusserste Feld-Container (direktes Kind von #config-fields). Versteckte
// Felder bleiben im DOM, ihre Werte werden also weiter mitgespeichert.
function applyFieldVisibility() {
  const g = GAMES[configGame];
  if (!g) return;
  const fc = $('config-fields');
  if (!fc) return;
  g.fields.forEach((f) => {
    if (!f.showIf) return;
    const ctrl = $('cfg-' + f.showIf.key);
    if (!ctrl) return;
    const cur = ctrl.type === 'checkbox' ? ctrl.checked : ctrl.value;
    const want = f.showIf.values ? f.showIf.values.includes(cur) : cur === f.showIf.value;
    let node = $('cfg-' + f.key);
    while (node && node.parentElement !== fc) node = node.parentElement;
    if (node) node.classList.toggle('hidden', !want);
  });
}

// Schnappschuss des Editors (Profilname + alle Felder) als Vergleichsbasis.
function configSnapshot() {
  try {
    return JSON.stringify({ name: $('profile-name').value, fields: gatherConfigFields() });
  } catch (e) { return null; }
}

// true, wenn die Konfig-Seite offen ist und sich die Felder seit dem Laden geaendert haben.
function isConfigDirty() {
  return configOpen && configBaseline != null && configSnapshot() !== configBaseline;
}

// Rueckfrage vor dem Verlassen/Wechseln, falls ungespeicherte Aenderungen bestehen.
// Gibt IMMER ein Promise<boolean> zurueck (true = fortfahren erlaubt).
function confirmLeaveConfig() {
  if (!isConfigDirty()) return Promise.resolve(true);
  return confirmModal('Es gibt ungespeicherte Änderungen. Wirklich verwerfen?', {
    title: 'Seite verlassen?', okText: 'Verwerfen', cancelText: 'Weiter bearbeiten', danger: true
  });
}

function gatherConfigFields() {
  const g = GAMES[configGame];
  const out = {};
  g.fields.forEach((f) => {
    const el = $('cfg-' + f.key);
    if (!el) return;
    if (f.type === 'bool') out[f.key] = el.checked;
    else if (f.type === 'list') out[f.key] = el.value.split('\n').map((w) => w.trim()).filter(Boolean);
    else if (f.type === 'text' || f.type === 'select') out[f.key] = el.value;
    else if (f.type === 'mcq') out[f.key] = getMcqData(el);
    else if (f.type === 'wordflags') out[f.key] = getWfData(el);
    else if (f.type === 'truefalse') out[f.key] = getTfData(el);
    else if (f.type === 'pairs') out[f.key] = getPairsData(el);
    else if (f.type === 'cases') out[f.key] = getCasesData(el);
    else if (f.type === 'roq') out[f.key] = getRoqData(el);
    else if (f.type === 'estq') out[f.key] = getEstqData(el);
    else if (f.type === 'audioq') out[f.key] = getAudioqData(el);
    else if (f.type === 'bildwahl') out[f.key] = getBildwahlData(el);
    else out[f.key] = parseInt(el.value, 10);
  });
  return out;
}

function setConfigMsg(text) {
  const el = $('config-msg'); if (el) el.textContent = text;
}

// Nach einem Audio-Upload/-Löschen (handleAdminResult): die Audio-Dropdowns im offenen
// Audioquiz-Editor auffrischen. Bei Upload wird die neue Datei der wartenden Zeile
// zugewiesen; bei Löschen nur die Auswahl neu aufgebaut. Ohne offenen Editor egal.
function onAudioListChanged(name) {
  const fc = $('config-fields');
  if (!fc) return;
  const editor = fc.querySelector('.audioq-editor');
  if (!editor) return;
  if (name) audioqApplyNewFile(editor, name);
  else { syncAudioqFromDom(editor); renderAudioqEditor(editor); }
}

// ---------------------------------------------------------------------------
// Spielplan (Playlist) – Editor im Spiele-Tab + gemeinsame Anzeige-Helfer
// ---------------------------------------------------------------------------

// Anzeige-Infos eines Schritts (Emoji, Spielname, Profil-Text). Genutzt von
// Editor + Run-Leiste.
function playlistStepLabel(step) {
  const g = GAMES[step.game];
  const emoji = g ? g.emoji : '❓';
  const name = g ? g.name : step.game;
  const profile = step.profile || '';
  const profileText = profile || '–';
  return { emoji, name, profile, profileText };
}

// Vorgabe-Profil fuer einen neuen/umgestellten Schritt: das aktive Profil des
// Spiels, sonst dessen erstes Profil (jeder Schritt braucht ein konkretes Profil).
function playlistDefaultProfile(gameId) {
  const gd = latestAdmin && latestAdmin.games[gameId];
  if (!gd) return '';
  if (gd.activeProfile && gd.profiles[gd.activeProfile]) return gd.activeProfile;
  return Object.keys(gd.profiles)[0] || '';
}

// Aktuelle Schritt-Liste aus dem Editor-DOM lesen.
function gatherPlaylistSteps() {
  const cont = $('pl-steps');
  if (!cont) return [];
  return Array.from(cont.querySelectorAll('.pl-step-row')).map((row) => ({
    game: row.querySelector('.pl-game').value,
    profile: row.querySelector('.pl-profile').value
  }));
}

// Ganzen Spielplan an den Server schicken (Server sanitisiert + broadcastet zurueck).
function sendPlaylist(steps) {
  sendAdmin({ type: 'admin', action: 'playlistSet', steps });
}

// Editor neu aufbauen – signaturbasiert, damit ein offener Broadcast (z. B. ein
// Buzz) den gerade geoeffneten Dropdown nicht schliesst/zuruecksetzt.
function renderPlaylistEditor() {
  const cont = $('pl-steps');
  if (!cont || !latestAdmin) return;
  const pl = latestAdmin.playlist || { steps: [], pos: -1 };
  const sig = JSON.stringify(pl.steps);
  if (cont._plSig === sig) return;   // nichts geaendert -> DOM stehen lassen
  cont._plSig = sig;
  cont.innerHTML = '';

  if (pl.steps.length === 0) {
    cont.innerHTML = '<p class="muted small pl-empty">Noch keine Schritte. Mit „＋ Schritt hinzufügen" den ersten anlegen.</p>';
    return;
  }

  const realGames = orderedGameIds().filter((g) => g !== 'none');
  pl.steps.forEach((step, i) => {
    const row = document.createElement('div');
    row.className = 'pl-step-row';

    const num = document.createElement('span');
    num.className = 'pl-step-num';
    num.textContent = (i + 1);
    row.appendChild(num);

    // Spiel-Auswahl
    const gameSel = document.createElement('select');
    gameSel.className = 'pl-game';
    realGames.forEach((gid) => {
      const opt = document.createElement('option');
      opt.value = gid;
      opt.textContent = GAMES[gid].emoji + ' ' + GAMES[gid].name;
      if (gid === step.game) opt.selected = true;
      gameSel.appendChild(opt);
    });
    // Spielwechsel: Profil auf das Vorgabe-Profil des neuen Spiels setzen.
    gameSel.addEventListener('change', () => {
      const steps = gatherPlaylistSteps();
      if (steps[i]) steps[i].profile = playlistDefaultProfile(steps[i].game);
      sendPlaylist(steps);
    });
    row.appendChild(gameSel);

    // Profil-Auswahl (Pflicht – kein „aktives Profil"-Platzhalter)
    const profSel = document.createElement('select');
    profSel.className = 'pl-profile';
    const gd = latestAdmin.games[step.game] || { profiles: {} };
    Object.keys(gd.profiles).forEach((n) => {
      const opt = document.createElement('option');
      opt.value = n; opt.textContent = n;
      if (n === step.profile) opt.selected = true;
      profSel.appendChild(opt);
    });
    profSel.addEventListener('change', () => sendPlaylist(gatherPlaylistSteps()));
    row.appendChild(profSel);

    // Umsortieren + Loeschen
    const ctrls = document.createElement('div');
    ctrls.className = 'pl-step-ctrls';
    const up = document.createElement('button');
    up.className = 'btn btn-ghost small'; up.textContent = '▲'; up.title = 'Nach oben';
    up.disabled = i === 0;
    up.addEventListener('click', () => movePlaylistStep(i, i - 1));
    const down = document.createElement('button');
    down.className = 'btn btn-ghost small'; down.textContent = '▼'; down.title = 'Nach unten';
    down.disabled = i === pl.steps.length - 1;
    down.addEventListener('click', () => movePlaylistStep(i, i + 1));
    const del = document.createElement('button');
    del.className = 'btn btn-ghost small danger-text'; del.textContent = '✕'; del.title = 'Schritt entfernen';
    del.addEventListener('click', () => {
      const steps = gatherPlaylistSteps();
      steps.splice(i, 1);
      sendPlaylist(steps);
    });
    ctrls.appendChild(up); ctrls.appendChild(down); ctrls.appendChild(del);
    row.appendChild(ctrls);

    cont.appendChild(row);
  });
}

// Zwei Schritte tauschen (Umsortieren) und an den Server schicken.
function movePlaylistStep(from, to) {
  const steps = gatherPlaylistSteps();
  if (to < 0 || to >= steps.length) return;
  const tmp = steps[from]; steps[from] = steps[to]; steps[to] = tmp;
  sendPlaylist(steps);
}

// Nach einem Bild-Upload/-Löschen (handleAdminResult, uploadBg/deleteBg): die Kacheln
// in den offenen Bildwahl-Editoren auffrischen (neue Datei ggf. direkt auswählen).
function onBildwahlListChanged(name) {
  const fc = $('config-fields');
  if (!fc) return;
  // Mehrere möglich (Detektivquiz: je Fall eins) – nur der hochladende übernimmt die Datei.
  fc.querySelectorAll('.bildwahl-editor').forEach((editor) => bildwahlApplyNewFile(editor, name));
}

// Wert-Anzeige neben jedem Schieberegler (type 'range') aktualisieren.
function refreshRangeLabels() {
  const fc = $('config-fields');
  if (!fc) return;
  fc.querySelectorAll('.sv[data-range-for]').forEach((sv) => {
    const inp = $('cfg-' + sv.dataset.rangeFor);
    if (inp) sv.textContent = inp.value + (sv.dataset.unit ? ' ' + sv.dataset.unit : '');
  });
}

// Live-Vorschau des gerade bearbeiteten Profils (nur Spiele mit GAMES.<id>.preview).
function updateConfigPreview() {
  const g = GAMES[configGame];
  const box = $('config-preview');
  if (!g || !g.preview || !box) return;
  g.preview(box, Object.assign({}, g.defaults, gatherConfigFields()));
}
