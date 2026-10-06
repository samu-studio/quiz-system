'use strict';
// ---------------------------------------------------------------------------
// Fun-Pannel (Master-Tab "🎉 Fun"): kleine, spielunabhaengige Show-Effekte.
// Bisher Flashbang, Kopfstand, Disco-Modus, Sabotage-Karte, Countdown, Soundboard,
// Schnellumfrage, Hype-Meter und Fake-Popups, weitere Funktionen kommen mit der Zeit dazu.
// - triggerFlashbang()/triggerKopfstand(): rein clientseitige Animationen,
//   ausgeloest per WS-Broadcast (type:'flashbang'/'kopfstand', s.
//   broadcastFlashbang/broadcastKopfstand in lib/state.js) - fluechtige Events
//   wie die Emoji-Reaktionen, kein Teil des Spielzustands.
// - applyDisco(): Disco-Modus ist dagegen ein Laufzeit-Flag (game.disco im
//   Snapshot), damit auch spaeter verbundene Geraete mitmachen und der
//   Master-Button den aktuellen Zustand zeigt.
// - Spieler-Nachrichten: Master waehlt eine von drei frei bearbeitbaren Vorlagen
//   (config.messagePresets, je mit Bild) und schickt sie wie die Fake-Popups an
//   alle oder einzelne Spieler (game.messages je Spieler, am Handy als
//   game.myMessage). Wegklicken meldet der Spieler per messageDone{token}.
//   renderPlayerMessage() zeigt das Overlay am Handy, renderFunMessages() haelt
//   den Master-Bereich (Vorlagen + Spielerliste mit Status) aktuell.
// - Sabotage-Karte: Master verflucht einzelne Spieler (master-Aktion 'curse',
//   Laufzeitzustand game.cursed). Server verwirft deren Eingaben; der Spieler
//   bekommt game.myCursed und sein Handy wird verschwommen + grau + gesperrt.
// - Countdown: Zustand liegt serverseitig in game.countdown (Snapshot-Feld
//   s.game.countdown, s. countdownPublic in lib/snapshot.js). Restzeit wird nur
//   bei Token-Wechsel uebernommen, danach zaehlt jedes Geraet mit der eigenen
//   Uhr (performance.now) weiter – wie das Reaktions-Timing. Bildschirm rendert
//   den Ring + piept (WebAudio, keine Datei noetig), Master zeigt den Status.
// - Soundboard: s. eigener Abschnitt unten (Ton nur am Bildschirm).
// - Schnellumfrage (Ja/Nein): Laufzeitzustand game.poll am Server, kommt als
//   s.game.poll (nur Summen) + s.game.myPollVote im Snapshot. renderScreenPoll/
//   renderPlayerPoll/renderMasterPoll werden aus den Render-Wrappern in core.js
//   aufgerufen.
// - Hype-Meter/Hype-Train: der Bildschirm rechnet aus den ohnehin empfangenen
//   Emoji-Reaktionen einen abklingenden Pegel; ueber einer Schwelle erscheint
//   ein kleiner Balken, voll = naechste Hype-Train-Stufe. Kein Serverzustand,
//   nur Ein/Aus + Empfindlichkeit kommen per settings.hype (config.hype).
// - setupFunTab()/renderFunTab(): verdrahten bzw. spiegeln die Master-Steuerung.
// ---------------------------------------------------------------------------

// Bildschirm/Spieler-Handy kurz weiss aufblitzen lassen, dann ueber 500ms ausblenden.
function triggerFlashbang() {
  if (role !== 'player') return; // wirkt bewusst nur auf Spieler-Handys
  const el = document.getElementById('flashbang-overlay');
  if (!el) return;
  el.style.transition = 'none';
  el.style.opacity = '1';
  void el.offsetWidth; // Reflow erzwingen, damit der Fade-out unten wirklich animiert
  setTimeout(() => {
    el.style.transition = 'opacity 500ms ease-out';
    el.style.opacity = '0';
  }, 1000);
}

// --- Hype-Meter (nur Bildschirm) --------------------------------------------
// Jede Reaktion addiert 1 Energie, die exponentiell abklingt (HYPE_TAU_MS) – im
// Gleichgewicht ist die Energie ≈ Reaktionen/Sek. · TAU. `show` = Schwelle zum
// Einblenden, `full` = Balken voll (-> naechste Stufe). Kleine Runden brauchen
// eine hoehere Empfindlichkeit, sonst kommt der Balken nie.
const HYPE_TAU_MS = 2500;
const HYPE_HIDE = 1.5;                 // darunter blendet der Balken wieder aus
const HYPE_MIN_VISIBLE_MS = 2000;      // nicht sofort wieder wegflackern
const HYPE_LEVELS = { low: { show: 8, full: 30 }, mid: { show: 5, full: 15 }, high: { show: 3, full: 8 } };
const hype = { enabled: false, sensitivity: 'mid', energy: 0, stage: 1, visible: false, shownAt: 0, last: 0, raf: 0 };

function hypeApplySettings(h) {
  hype.enabled = !!(h && h.enabled);
  hype.sensitivity = (h && HYPE_LEVELS[h.sensitivity]) ? h.sensitivity : 'mid';
  if (!hype.enabled) { hype.energy = 0; hypeSetVisible(false); }
}

function hypeOnReaction() {
  if (!hype.enabled) return;
  hypeDecay(performance.now());
  hype.energy += 1;
  hypeRender();
  if (!hype.raf) hype.raf = requestAnimationFrame(hypeTick);
}

function hypeDecay(now) {
  if (hype.last) hype.energy *= Math.exp(-(now - hype.last) / HYPE_TAU_MS);
  hype.last = now;
}

function hypeTick(now) {
  hype.raf = 0;
  hypeDecay(now);
  hypeRender();
  if (hype.energy > 0.05 || hype.visible) hype.raf = requestAnimationFrame(hypeTick);
  else { hype.energy = 0; hype.last = 0; }
}

function hypeRender() {
  const lv = HYPE_LEVELS[hype.sensitivity];
  if (!hype.visible && hype.energy >= lv.show) hypeSetVisible(true);
  else if (hype.visible && hype.energy < HYPE_HIDE && performance.now() - hype.shownAt > HYPE_MIN_VISIBLE_MS) hypeSetVisible(false);
  if (!hype.visible) return;
  // Balken voll -> eine Stufe hoeher, Energie auf halbe Fuellung zuruecksetzen
  if (hype.energy >= lv.full) {
    hype.stage++;
    hype.energy = lv.full * 0.5;
    const box = document.getElementById('screen-hype');
    if (box) { box.classList.remove('boost'); void box.offsetWidth; box.classList.add('boost'); }
  }
  const fill = document.getElementById('hype-fill');
  if (fill) fill.style.width = Math.min(100, hype.energy / lv.full * 100).toFixed(1) + '%';
  const box = document.getElementById('screen-hype');
  if (box) box.style.setProperty('--hype-stage', String(Math.min(hype.stage, 6)));
  const txt = document.getElementById('hype-text');
  if (txt) txt.textContent = 'HYPE-TRAIN · Stufe ' + hype.stage;
}

function hypeSetVisible(on) {
  if (hype.visible === on) return;
  hype.visible = on;
  if (on) hype.shownAt = performance.now();
  else hype.stage = 1;               // neue Hype-Welle beginnt wieder bei Stufe 1
  const box = document.getElementById('screen-hype');
  if (box) box.classList.toggle('hidden', !on);
}

// Spieler: ganze Seite per Klasse auf <html> um 180 Grad drehen (CSS-Transition) und nach
// `ms` zurueckdrehen. Erneutes Ausloesen waehrend des Kopfstands verlaengert ihn.
let kopfstandTimer = null;
function triggerKopfstand(ms) {
  if (role === 'master') return; // wirkt bewusst nur auf Bildschirm + Spieler
  const dauer = Math.max(1000, Math.min(60000, Number(ms) || 10000));
  document.documentElement.classList.add('fun-kopfstand');
  clearTimeout(kopfstandTimer);
  kopfstandTimer = setTimeout(() => {
    document.documentElement.classList.remove('fun-kopfstand');
  }, dauer);
}

// ---------------------------------------------------------------------------
// Spieler-Nachrichten
// ---------------------------------------------------------------------------
let msgDismissedId = null;       // Spieler: zuletzt weggeklickte Nachricht (id)
let msgPickFor = -1;             // Master: Vorlage, fuer die gerade die Bildauswahl offen ist (-1 = zu)
let msgPreset = 0;               // Master: zum Senden gewaehlte Vorlage
let msgSigs = {};                // Master: Signaturen, damit nur bei Aenderung neu gebaut wird

// Overlay-Inhalt (Karte mit Bild + Text) in `el` bauen; gemeinsam fuer das
// Spieler-Overlay und die Master-Vorschau.
function buildMessageOverlay(el, m, onClose) {
  el.style.setProperty('--msg-dim', ((m.dim || 0) / 100).toFixed(2));
  el.style.setProperty('--msg-blur', (m.blur || 0) + 'px');
  let html = '<div class="msg-card">';
  if (m.image) html += '<img src="/backgrounds/' + encodeURIComponent(m.image) + '" alt="" />';
  if (m.text) html += '<div class="msg-text">' + escapeHtml(m.text) + '</div>';
  if (m.closable) html += '<button class="btn btn-primary msg-close" type="button">OK</button>';
  el.innerHTML = html + '</div>';
  const btn = el.querySelector('.msg-close');
  if (btn && onClose) btn.addEventListener('click', onClose);
}

// Spieler: Overlay zeigen, solange eine an ihn adressierte Nachricht aktiv ist
// und er sie nicht weggeklickt hat.
function renderPlayerMessage(s) {
  const el = document.getElementById('player-message');
  if (!el) return;
  const m = s.game && s.game.myMessage;
  if (!m || m.id === msgDismissedId) { el.classList.add('hidden'); el.__sig = null; return; }
  const sig = JSON.stringify(m);
  if (el.__sig !== sig) {
    el.__sig = sig;
    buildMessageOverlay(el, m, () => {
      msgDismissedId = m.id;
      el.classList.add('hidden');
      send({ type: 'messageDone', token: m.id });
    });
  }
  el.classList.remove('hidden');
}

// Gewaehlte Vorlage an einen Spieler (clientId) oder alle ('all') senden; vorher
// den Karteninhalt speichern (gleiche WS-Verbindung -> kommt am Server zuerst an).
function sendPlayerMessage(clientId) {
  const info = document.getElementById('msg-send-info');
  const p = gatherPreset(msgPreset);
  if (!String(p.text || '').trim() && !p.image) { if (info) info.textContent = 'Bitte Text oder Bild angeben.'; return; }
  saveMessagePreset(msgPreset, p);
  send({ type: 'master', action: 'messageShow', clientId, preset: msgPreset });
  if (info) { info.textContent = 'Gesendet ✓'; setTimeout(() => { info.textContent = ''; }, 1500); }
}

// Vorlage aus der Karte lesen (dim/blur haben keine eigenen Regler mehr und
// bleiben, wie sie gespeichert sind).
function gatherPreset(index) {
  const card = document.querySelectorAll('#msg-presets .msg-preset')[index];
  const stored = ((latestAdmin && latestAdmin.messagePresets) || [])[index] || {};
  return Object.assign({}, stored, {
    name: card.querySelector('.mp-name').value,
    text: card.querySelector('.mp-text').value,
    closable: card.querySelector('.mp-close').checked
  });
}

function saveMessagePreset(index, patch) {
  const presets = ((latestAdmin && latestAdmin.messagePresets) || []).map((p) => Object.assign({}, p));
  if (!presets[index]) return;
  Object.assign(presets[index], patch);
  send({ type: 'master', action: 'setMessagePresets', presets });
}

// Die drei Vorlagen-Karten einmalig anlegen; Inhalte setzt renderFunMessages.
function buildMessagePresetCards(count) {
  const wrap = document.getElementById('msg-presets');
  wrap.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const card = document.createElement('div');
    card.className = 'msg-preset';
    card.innerHTML = '<button class="mp-img" type="button" title="Bild wählen"></button>' +
      '<input type="text" class="mp-name" maxlength="24" placeholder="Name" />' +
      '<textarea class="mp-text" rows="2" maxlength="500" placeholder="Text …"></textarea>' +
      '<div class="mp-foot">' +
      '<label class="row small" title="Spieler dürfen die Nachricht wegklicken"><input type="checkbox" class="mp-close" /> wegklickbar</label>' +
      '<button class="btn small mp-pick" type="button"></button>' +
      '</div>';
    const save = () => saveMessagePreset(i, gatherPreset(i));
    card.querySelector('.mp-name').addEventListener('change', save);
    card.querySelector('.mp-text').addEventListener('change', save);
    card.querySelector('.mp-close').addEventListener('change', save);
    card.querySelector('.mp-img').addEventListener('click', () => {
      msgPickFor = msgPickFor === i ? -1 : i;
      msgSigs.thumbs = null;
      renderFunMessages(latestState);
    });
    card.querySelector('.mp-pick').addEventListener('click', () => {
      msgPreset = i;
      msgSigs.presets = null;
      renderFunMessages(latestState);
    });
    wrap.appendChild(card);
  }
}

// Master: Vorlagen, Spielerliste mit Status und Bildauswahl aktuell halten
// (je Bereich signaturbasiert, fokussierte Felder werden nie ueberschrieben).
function renderFunMessages(s) {
  if (!latestAdmin || !s) return;
  const players = (s.participants || []).filter((p) => p.role === 'player' && !p.local);

  // Vorlagen: Karten bleiben stehen, nur nicht fokussierte Felder werden nachgezogen.
  const presets = latestAdmin.messagePresets || [];
  const pWrap = document.getElementById('msg-presets');
  if (pWrap.children.length !== presets.length) buildMessagePresetCards(presets.length);
  if (msgPreset >= presets.length) msgPreset = 0;
  const pSig = JSON.stringify(presets) + '|' + msgPickFor + '|' + msgPreset;
  if (msgSigs.presets !== pSig) {
    msgSigs.presets = pSig;
    presets.forEach((p, i) => {
      const card = pWrap.children[i];
      card.classList.toggle('picking', msgPickFor === i);
      card.classList.toggle('selected', msgPreset === i);
      const pickBtn = card.querySelector('.mp-pick');
      pickBtn.textContent = msgPreset === i ? '✓ Gewählt' : 'Auswählen';
      pickBtn.classList.toggle('btn-primary', msgPreset === i);
      const img = card.querySelector('.mp-img');
      img.style.backgroundImage = p.image ? 'url("/backgrounds/' + encodeURIComponent(p.image) + '")' : '';
      img.classList.toggle('empty', !p.image);
      img.textContent = p.image ? '' : '🖼️ Bild wählen';
      const setVal = (el, v) => { if (el !== document.activeElement) el.value = v; };
      setVal(card.querySelector('.mp-name'), p.name || ('Vorlage ' + (i + 1)));
      setVal(card.querySelector('.mp-text'), p.text || '');
      card.querySelector('.mp-close').checked = !!p.closable;
    });
  }

  // Spielerliste mit Status (wie bei den Fake-Popups)
  const msgs = (s.game && s.game.messages) || {};
  const list = document.getElementById('msg-list');
  const lSig = JSON.stringify([players.map((p) => [p.id, p.name, p.avatar, p.color, p.online]), msgs]);
  if (msgSigs.players !== lSig) {
    msgSigs.players = lSig;
    if (!players.length) list.innerHTML = '<p class="muted small">Noch keine Spieler verbunden.</p>';
    else list.innerHTML = players.map((p) => {
      const m = msgs[p.id];
      const label = m ? '💬 ' + escapeHtml(m.name || 'Nachricht') : '';
      const status = !m ? '<span class="muted">—</span>'
        : m.done ? '✅ ' + label + ' weggeklickt'
        : '⏳ ' + label + (m.closable ? ' offen' : ' angezeigt');
      return '<div class="fun-popup-row' + (p.online ? '' : ' offline') + '">' +
        '<span class="fun-popup-name">' + avatarChip(p) + escapeHtml(p.name) + '</span>' +
        '<span class="fun-popup-status small">' + status + '</span>' +
        '<button class="btn small" data-send="' + escapeHtml(p.id) + '">Senden</button>' +
        '<button class="btn small btn-ghost" data-clear="' + escapeHtml(p.id) + '" title="Nachricht entfernen"' + (m ? '' : ' disabled') + '>✖</button>' +
        '</div>';
    }).join('');
  }

  // Bildauswahl fuer die Vorlage msgPickFor (Bilder aus public/backgrounds/, wie der Design-Hintergrund)
  if (msgPickFor >= presets.length) msgPickFor = -1;
  document.getElementById('msg-img-picker').classList.toggle('hidden', msgPickFor < 0);
  if (msgPickFor < 0) return;
  const imgs = latestAdmin.backgrounds || [];
  const current = presets[msgPickFor].image || '';
  const tSig = imgs.join(',') + '|' + msgPickFor + '|' + current;
  if (msgSigs.thumbs !== tSig) {
    msgSigs.thumbs = tSig;
    const wrap = document.getElementById('msg-img-thumbs');
    wrap.innerHTML = '';
    const pick = (name) => saveMessagePreset(msgPickFor, { image: name });
    const none = document.createElement('div');
    none.className = 'bg-thumb none-thumb' + (current ? '' : ' active');
    none.textContent = 'Kein Bild';
    none.addEventListener('click', () => pick(''));
    wrap.appendChild(none);
    imgs.forEach((name) => {
      const t = document.createElement('div');
      t.className = 'bg-thumb' + (name === current ? ' active' : '');
      t.style.backgroundImage = 'url("/backgrounds/' + encodeURIComponent(name) + '")';
      t.title = name;
      t.addEventListener('click', () => pick(name));
      wrap.appendChild(t);
    });
  }
}

// Vom handleAdminResult nach uploadBg aus dem Fun-Tab aufgerufen:
// neues Bild gleich der offenen Vorlage zuweisen.
function onMessageImgUploaded(name) {
  const msg = document.getElementById('msg-img-msg');
  if (name && msgPickFor >= 0) saveMessagePreset(msgPickFor, { image: name });
  if (msg) { msg.textContent = 'Hochgeladen ✓'; setTimeout(() => { msg.textContent = 'Bilder liegen in public/backgrounds/.'; }, 1600); }
}

// Disco-Modus (aus applyState): Bildschirm/Spieler rotieren per CSS-Animation
// durch den Farbkreis; der Master bekommt nur den Button-Zustand aktualisiert.
function applyDisco(on) {
  if (role === 'master') {
    const btn = document.getElementById('fun-disco-btn');
    if (!btn) return;
    btn.classList.toggle('active', on);
    btn.textContent = on ? '🪩 Disco aus' : '🪩 Disco an';
    return;
  }
  document.documentElement.classList.toggle('disco', on);
}

// Schnellumfrage am Bildschirm: kleines Kaestchen oben links mit Frage + Ja/Nein-Balken.
function renderScreenPoll(s) {
  const el = $('screen-poll');
  if (!el) return;
  const poll = s.game && s.game.poll;
  el.classList.toggle('hidden', !poll);
  if (!poll) return;
  const pct = (n) => (poll.total ? Math.round(n / poll.total * 100) : 0);
  el.classList.toggle('closed', poll.status === 'closed');
  el.innerHTML =
    '<div class="poll-q">📊 ' + escapeHtml(poll.question) + '</div>' +
    '<div class="poll-row poll-ja"><span class="poll-lbl">Ja</span><span class="poll-bar"><span style="width:' + pct(poll.ja) + '%"></span></span><b>' + poll.ja + '</b></div>' +
    '<div class="poll-row poll-nein"><span class="poll-lbl">Nein</span><span class="poll-bar"><span style="width:' + pct(poll.nein) + '%"></span></span><b>' + poll.nein + '</b></div>' +
    '<div class="poll-foot">' + (poll.status === 'open' ? poll.total + ' Stimme(n) – Abstimmung laeuft …' : 'Ergebnis · ' + poll.total + ' Stimme(n)') + '</div>';
}

// Schnellumfrage am Spieler-Handy: nur waehrend der Abstimmung sichtbar, eigene Wahl markiert.
function renderPlayerPoll(s) {
  const el = $('player-poll');
  if (!el) return;
  const poll = s.game && s.game.poll;
  const open = !!poll && poll.status === 'open';
  el.classList.toggle('hidden', !open);
  if (!open) return;
  $('player-poll-q').textContent = poll.question;
  const mine = s.game.myPollVote || null;
  el.querySelectorAll('.poll-vote').forEach((b) => b.classList.toggle('active', b.dataset.vote === mine));
  $('player-poll-hint').textContent = mine ? 'Abgestimmt – du kannst noch umentscheiden.' : 'Tippe auf Ja oder Nein.';
}

// Status-Zeile im Fun-Tab des Masters (laufende Summen).
function renderMasterPoll(s) {
  const el = $('fun-poll-status');
  if (!el) return;
  const poll = s.game && s.game.poll;
  el.textContent = !poll ? 'Keine Umfrage aktiv.'
    : (poll.status === 'open' ? 'Laeuft: ' : 'Beendet: ') + '„' + poll.question + '“ – Ja ' + poll.ja + ' · Nein ' + poll.nein;
  $('fun-poll-close').disabled = !poll || poll.status !== 'open';
  $('fun-poll-hide').disabled = !poll;
}

// Fun-Tab-Eingaben in config.fun speichern (s. lib/handlers/master.js setFunSettings).
function sendFunSettings(patch) {
  send({ type: 'master', action: 'setFunSettings', settings: patch });
}
let funPollTimer = null;        // Master: Entprellung der Umfrage-Frage

function setupFunTab() {
  const btn = document.getElementById('fun-flashbang-btn');
  if (btn) btn.addEventListener('click', () => send({ type: 'master', action: 'flashbang' }));
  const q = $('fun-poll-question');
  q.addEventListener('input', () => {
    clearTimeout(funPollTimer);
    funPollTimer = setTimeout(() => { funPollTimer = null; sendFunSettings({ pollQuestion: q.value }); }, 400);
  });
  $('fun-poll-start').addEventListener('click', () => send({ type: 'master', action: 'pollStart', question: q.value }));
  $('fun-poll-close').addEventListener('click', () => send({ type: 'master', action: 'pollClose' }));
  $('fun-poll-hide').addEventListener('click', () => send({ type: 'master', action: 'pollHide' }));
  const hypeSwitch = document.getElementById('hype-switch');
  if (hypeSwitch) {
    hypeSwitch.addEventListener('change', () =>
      send({ type: 'master', action: 'setHypeEnabled', on: hypeSwitch.checked }));
  }
  document.querySelectorAll('#hype-sensitivity .seg-btn').forEach((b) => {
    b.addEventListener('click', () => send({ type: 'master', action: 'setHypeSensitivity', level: b.dataset.level }));
  });

  setupFunPopups();
  const kBtn = document.getElementById('fun-kopfstand-btn');
  if (kBtn) kBtn.addEventListener('click', () => send({ type: 'master', action: 'kopfstand' }));

  document.getElementById('msg-img-close').addEventListener('click', () => { msgPickFor = -1; msgSigs.presets = null; renderFunMessages(latestState); });
  document.getElementById('msg-list').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.send) sendPlayerMessage(b.dataset.send);
    else if (b.dataset.clear) send({ type: 'master', action: 'messageClear', clientId: b.dataset.clear });
  });
  document.getElementById('msg-send-all').addEventListener('click', () => sendPlayerMessage('all'));
  document.getElementById('msg-clear-all').addEventListener('click', () => send({ type: 'master', action: 'messageClear', clientId: 'all' }));

  const file = document.getElementById('msg-img-file');
  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    const msg = document.getElementById('msg-img-msg');
    if (!f) return;
    if (f.size > 12 * 1024 * 1024) { msg.textContent = 'Bild zu groß (max 12 MB).'; file.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => {
      msg.textContent = 'Lade hoch …';
      sendAdmin({ type: 'admin', action: 'uploadBg', name: f.name, data: String(reader.result) });
    };
    reader.onerror = () => { msg.textContent = 'Bild konnte nicht gelesen werden.'; };
    reader.readAsDataURL(f);
    file.value = '';
  });

  // Sabotage-Karte: Klick auf einen Spieler schaltet seinen Fluch um.
  const list = document.getElementById('fun-curse-list');
  if (list) list.addEventListener('click', (e) => {
    const b = e.target.closest('.curse-btn');
    if (b) send({ type: 'master', action: 'curse', clientId: b.dataset.id, on: !b.classList.contains('active') });
  });
  const all = document.getElementById('fun-uncurse-all');
  if (all) all.addEventListener('click', () => send({ type: 'master', action: 'uncurseAll' }));
  const disco = document.getElementById('fun-disco-btn');
  if (disco) disco.addEventListener('click', () => {
    const on = !!(latestState && latestState.game.disco);
    send({ type: 'master', action: 'setDisco', on: !on });
  });

  // Countdown
  document.querySelectorAll('[data-cd-sek]').forEach((b) => b.addEventListener('click', () => {
    $('fun-cd-sek').value = b.dataset.cdSek;
    sendFunSettings({ countdownSek: +b.dataset.cdSek });
  }));
  $('fun-cd-sek').addEventListener('change', () => sendFunSettings({ countdownSek: +$('fun-cd-sek').value }));
  $('fun-cd-warn').addEventListener('change', () => sendFunSettings({ countdownWarn: +$('fun-cd-warn').value }));
  $('fun-cd-start').addEventListener('click', () => {
    send({ type: 'master', action: 'countdownStart', seconds: +$('fun-cd-sek').value, warnSek: +$('fun-cd-warn').value });
  });
  $('fun-cd-pause').addEventListener('click', () => {
    const cd = latestState && latestState.game && latestState.game.countdown;
    if (!cd || !cd.aktiv) return;
    send({ type: 'master', action: cd.laeuft ? 'countdownPause' : 'countdownResume' });
  });
  $('fun-cd-stop').addEventListener('click', () => send({ type: 'master', action: 'countdownStop' }));

  setupSoundboard();
}

// Master: Spielerliste der Sabotage-Karte (Signatur-basiert, nur bei Aenderung neu bauen).
let curseListSig = '';
function renderCurseList(s) {
  const el = document.getElementById('fun-curse-list');
  if (!el) return;
  const players = (s.participants || []).filter((p) => p.role === 'player');
  const sig = JSON.stringify(players.map((p) => [p.id, p.name, p.avatar, p.color, p.online, p.cursed]));
  if (sig === curseListSig) return;
  curseListSig = sig;
  el.innerHTML = players.length ? players.map((p) =>
    '<button type="button" class="btn curse-btn' + (p.cursed ? ' active' : '') + (p.online ? '' : ' offline') +
    '" data-id="' + escapeHtml(p.id) + '">' + avatarChip(p) + escapeHtml(p.name) + (p.cursed ? ' 🃏' : '') + '</button>'
  ).join('') : '<p class="muted small">Noch keine Spieler verbunden.</p>';
  const all = document.getElementById('fun-uncurse-all');
  if (all) all.disabled = !players.some((p) => p.cursed);
}

// Spieler: eigenes Handy verfluchen – Ansicht verschwimmt/vergraut und wird per
// `inert` komplett gesperrt (auch Tastatur), Hinweis-Banner liegt ausserhalb.
function renderPlayerCurse(s) {
  const cursed = !!(s.game && s.game.myCursed);
  const view = document.getElementById('view-player');
  view.classList.toggle('cursed', cursed);
  view.inert = cursed;
  if (cursed && document.activeElement && view.contains(document.activeElement)) document.activeElement.blur();
  document.getElementById('player-cursed').classList.toggle('hidden', !cursed);
}

// ---------------------------------------------------------------------------
// Countdown – gemeinsame lokale Uhr (Bildschirm + Master)
// ---------------------------------------------------------------------------
const cdLocal = { token: -1, endAt: 0, restMs: 0, laeuft: false, raf: 0, lastBeep: -1 };

// Neue Restzeit nur bei Token-Wechsel uebernehmen (sonst wuerde jeder Snapshot
// die lokale Uhr um die Netzwerk-Latenz zurueckspringen lassen).
function syncCountdown(cd) {
  if (cd.token === cdLocal.token) return false;
  cdLocal.token = cd.token;
  cdLocal.laeuft = !!cd.laeuft;
  cdLocal.restMs = cd.restMs;
  cdLocal.endAt = performance.now() + cd.restMs;
  cdLocal.lastBeep = -1;
  return true;
}

function countdownRestMs() {
  return cdLocal.laeuft ? Math.max(0, cdLocal.endAt - performance.now()) : cdLocal.restMs;
}

// Anzeige: unter einer Minute nur Sekunden, sonst m:ss (aufgerundet, damit die
// "1" eine volle Sekunde steht und die "0" genau beim Ablauf erscheint).
function formatCountdown(ms) {
  const sek = Math.ceil(ms / 1000);
  if (sek < 60) return String(sek);
  return Math.floor(sek / 60) + ':' + String(sek % 60).padStart(2, '0');
}

// Weicher Signalton per WebAudio (kein Audio-File noetig): Sinus mit kurzem
// Anschlag und ausklingender Huelle, optional mit leiser Oktave dazu. Der
// AudioContext wird erst nach der globalen Audio-Freischaltung (core.js
// audioUnlocked) angelegt.
let cdAudioCtx = null;
function countdownBeep(freq, dauer, laut, oktave) {
  if (!audioUnlocked) return;
  try {
    if (!cdAudioCtx) cdAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (cdAudioCtx.state === 'suspended') cdAudioCtx.resume();
    const t = cdAudioCtx.currentTime;
    const gain = cdAudioCtx.createGain();
    laut = Math.max(0.0002, laut * screenMaxVolume);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(laut, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dauer);
    gain.connect(cdAudioCtx.destination);
    const toene = oktave ? [[freq, 1], [freq * 2, 0.3]] : [[freq, 1]];
    for (const [f, anteil] of toene) {
      const osc = cdAudioCtx.createOscillator();
      const g = cdAudioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      g.gain.value = anteil;
      osc.connect(g).connect(gain);
      osc.start(t);
      osc.stop(t + dauer + 0.05);
    }
  } catch (e) { /* egal, Ton ist nur Zierde */ }
}

// ---------------------------------------------------------------------------
// BILDSCHIRM – grosser Countdown-Overlay (aus renderScreen aufgerufen)
// ---------------------------------------------------------------------------
function renderScreenCountdown(s) {
  const el = $('screen-countdown');
  const cd = s.game && s.game.countdown;
  if (!el || !cd) return;
  el.classList.toggle('hidden', !cd.aktiv);
  if (!cd.aktiv) {
    cancelAnimationFrame(cdLocal.raf); cdLocal.raf = 0;
    cdLocal.token = cd.token;
    return;
  }
  if (!syncCountdown(cd)) return;
  // Beim Einblenden mitten in den Warn-Sekunden (z.B. Bildschirm-Reload) nicht
  // fuer schon vergangene Sekunden nachpiepen.
  cdLocal.lastBeep = Math.ceil(countdownRestMs() / 1000);
  cancelAnimationFrame(cdLocal.raf);
  const tick = () => {
    const ms = countdownRestMs();
    const sek = Math.ceil(ms / 1000);
    const done = ms <= 0;
    const warn = !done && cd.warnSek > 0 && sek <= cd.warnSek;
    const num = $('cd-num');
    num.textContent = done ? '⏰ ZEIT!' : formatCountdown(ms);
    num.classList.toggle('long', !done && sek >= 60);
    $('cd-arc').style.strokeDashoffset = String(1000 - 1000 * (ms / (cd.total * 1000)));
    $('cd-label').textContent = cdLocal.laeuft || done ? '' : '⏸ Pausiert';
    el.classList.toggle('warn', warn);
    el.classList.toggle('done', done);
    el.classList.toggle('paused', !cdLocal.laeuft && !done);
    // Ton: in den Warn-Sekunden ein sanfter Piep pro Sekundenwechsel, der zur 0
    // hin lauter wird (Crescendo), bei 0 ein ausklingender Gong.
    if (cdLocal.laeuft && sek !== cdLocal.lastBeep) {
      cdLocal.lastBeep = sek;
      if (done) {
        if (cd.warnSek > 0) countdownBeep(523, 1.8, 0.5, true);
      } else if (warn) {
        const anteil = cd.warnSek > 1 ? (cd.warnSek - sek) / (cd.warnSek - 1) : 1;
        countdownBeep(660, 0.25, 0.06 + 0.3 * anteil, false);
      }
    }
    cdLocal.raf = (cdLocal.laeuft && !done) ? requestAnimationFrame(tick) : 0;
  };
  tick();
}

// ---------------------------------------------------------------------------
// MASTER – Countdown-Status + Button-Zustaende im Fun-Tab (aus renderMaster)
// ---------------------------------------------------------------------------
let cdMasterTimer = 0;
function renderFunCountdown(s) {
  const cd = s.game && s.game.countdown;
  if (!cd || !$('fun-cd-status')) return;
  syncCountdown(cd);
  const pauseBtn = $('fun-cd-pause');
  const restMs = countdownRestMs();
  pauseBtn.disabled = !cd.aktiv || (!cd.laeuft && restMs <= 0);
  pauseBtn.textContent = cd.aktiv && !cd.laeuft && restMs > 0 ? '▶ Fortsetzen' : '⏸ Pause';
  $('fun-cd-stop').disabled = !cd.aktiv;
  clearInterval(cdMasterTimer); cdMasterTimer = 0;
  const status = () => {
    const ms = countdownRestMs();
    let txt;
    if (!cd.aktiv) txt = 'Kein Countdown aktiv.';
    else if (ms <= 0) txt = '⏰ Abgelaufen – am Bildschirm sichtbar, bis du ausblendest.';
    else txt = (cdLocal.laeuft ? '⏱️ Läuft: ' : '⏸ Pausiert bei ') + formatCountdown(ms) + (Math.ceil(ms / 1000) < 60 ? ' s' : '');
    $('fun-cd-status').textContent = txt;
    if (cd.aktiv && cdLocal.laeuft && ms <= 0) {
      clearInterval(cdMasterTimer); cdMasterTimer = 0;
      pauseBtn.disabled = true;
    }
  };
  status();
  if (cd.aktiv && cdLocal.laeuft) cdMasterTimer = setInterval(status, 200);
}

// ---------------------------------------------------------------------------
// Soundboard (Server-Gegenstueck: lib/soundboard.js)
// - Bildschirm: playSoundboardSound()/stopSoundboardSounds() reagieren auf die
//   fluechtigen WS-Nachrichten 'soundboard'/'soundboardStop' (wie der Flashbang).
// - Master: Kachel-Raster aus admin.soundboard (mitgelieferte + eigene Sounds),
//   Lautstaerke, Stopp, Upload; im Bearbeiten-Modus mitgelieferte Sounds
//   aus-/einblenden und eigene loeschen.
// ---------------------------------------------------------------------------

// Anzeige der mitgelieferten Sounds (public/sounds/soundboard/) – gibt zugleich
// die Reihenfolge vor. Unbekannte Dateien im Ordner landen hinten (Name aus Datei).
const SOUNDBOARD_PRESETS = [
  ['richtig.mp3', '✅', 'Richtig'],
  ['falsch.mp3', '❌', 'Falsch'],
  ['trommelwirbel.mp3', '🥁', 'Trommelwirbel'],
  ['spannung.mp3', '⏳', 'Spannung'],
  ['ticktack.mp3', '⏰', 'Tick-Tack'],
  ['countdown.mp3', '🔢', 'Countdown'],
  ['zeit-um.mp3', '🚨', 'Zeit um!'],
  ['fanfare.mp3', '📯', 'Fanfare'],
  ['applaus.mp3', '👏', 'Applaus'],
  ['jubel.mp3', '🎉', 'Jubel'],
  ['yes.mp3', '💪', 'Yes!'],
  ['lachen.mp3', '😂', 'Gelächter'],
  ['badumtss.mp3', '😏', 'Ba-dum-tss'],
  ['sad-trombone.mp3', '😢', 'Sad Trombone'],
  ['buh.mp3', '👎', 'Buh!'],
  ['grillen.mp3', '🦗', 'Grillen (Stille)'],
  ['absturz.mp3', '📉', 'Absturz'],
  ['boing.mp3', '🤸', 'Boing'],
  ['hupe.mp3', '🤡', 'Hupe'],
  ['pups.mp3', '💨', 'Pups']
];

// --- Bildschirm ------------------------------------------------------------
const soundboardPlaying = new Set();

function playSoundboardSound(msg) {
  if (role !== 'screen' || !audioUnlocked) return;
  try {
    const audio = new Audio(msg.src);
    audio.baseVolume = Number(msg.volume) || 0;
    audio.volume = screenVol(audio.baseVolume);
    soundboardPlaying.add(audio);
    const done = () => soundboardPlaying.delete(audio);
    audio.addEventListener('ended', done);
    audio.addEventListener('error', done);
    const pr = audio.play();
    if (pr && pr.catch) pr.catch(done);
  } catch (e) { /* egal, Sound ist nur Zierde */ }
}

// Maximal-Lautstaerke des Bildschirms gilt auch fuer gerade laufende Sounds.
onScreenVolumeChange(() => soundboardPlaying.forEach((a) => { a.volume = screenVol(a.baseVolume); }));

function stopSoundboardSounds() {
  soundboardPlaying.forEach((a) => { try { a.pause(); } catch (e) {} });
  soundboardPlaying.clear();
}

// --- Master ----------------------------------------------------------------
let soundboardEdit = false;
let soundUpload = null;   // { files, i, errors } – wie musicUpload

function setupSoundboard() {
  if (!$('sb-presets')) return;
  $('sb-stop').addEventListener('click', () => send({ type: 'master', action: 'soundStop' }));
  const vol = $('sb-volume');
  vol.addEventListener('input', () => { $('sb-volume-val').textContent = vol.value + ' %'; });
  vol.addEventListener('change', () => send({ type: 'master', action: 'soundVolume', value: Number(vol.value) / 100 }));
  $('sb-edit').addEventListener('click', () => {
    soundboardEdit = !soundboardEdit;
    if (latestState) renderSoundboard(latestState);
  });
  const upFile = $('sb-upload-file');
  $('sb-upload-btn').addEventListener('click', () => upFile.click());
  upFile.addEventListener('change', () => {
    const files = Array.from(upFile.files || []);
    upFile.value = '';
    const ok = files.filter((f) => f.size <= 10 * 1024 * 1024);
    soundUpload = { files: ok, i: 0, errors: files.length - ok.length };
    soundUploadNext();
  });
}

// Mehrfach-Upload nacheinander (naechste Datei erst nach Server-Quittung,
// s. onSoundUploadResult aus handleAdminResult in core.js).
function soundUploadNext() {
  const u = soundUpload;
  const msg = $('sb-upload-msg');
  if (!u) return;
  if (u.i >= u.files.length) {
    msg.textContent = u.errors
      ? u.errors + ' Datei(en) nicht übernommen (zu groß, max 10 MB, oder ungültig).'
      : 'Hochgeladen ✓';
    soundUpload = null;
    return;
  }
  const f = u.files[u.i++];
  msg.textContent = 'Lade hoch … (' + u.i + '/' + u.files.length + ')';
  const reader = new FileReader();
  reader.onload = () => sendAdmin({ type: 'admin', action: 'uploadSound', name: f.name, data: String(reader.result) });
  reader.onerror = () => { u.errors++; soundUploadNext(); };
  reader.readAsDataURL(f);
}

function onSoundUploadResult(msg) {
  if (!soundUpload) return;
  if (!msg.ok) soundUpload.errors++;
  soundUploadNext();
}

function soundTitle(file) {
  return String(file || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
}

function soundTile(kind, file, emoji, label, opts) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sb-tile' + (opts.hidden ? ' sb-hidden' : '');
  b.title = file;
  const ic = document.createElement('span');
  ic.className = 'sb-emoji';
  ic.textContent = emoji;
  const tx = document.createElement('span');
  tx.className = 'sb-label';
  tx.textContent = label;
  b.appendChild(ic);
  b.appendChild(tx);
  if (opts.badge) {
    const bd = document.createElement('span');
    bd.className = 'sb-badge';
    bd.textContent = opts.badge;
    b.appendChild(bd);
  }
  b.addEventListener('click', () => {
    if (opts.onEdit && soundboardEdit) { opts.onEdit(); return; }
    send({ type: 'master', action: 'soundPlay', kind, file });
    // Kurzes Aufleuchten als Rueckmeldung (Ton laeuft ja nur am Bildschirm)
    b.classList.remove('sb-fired');
    void b.offsetWidth;
    b.classList.add('sb-fired');
  });
  return b;
}

function renderSoundboard(s) {
  const sb = s.admin && s.admin.soundboard;
  if (!sb || !$('sb-presets')) return;
  const vol = $('sb-volume');
  if (document.activeElement !== vol) {
    const pct = Math.round(Math.min(1, Math.max(0, sb.volume)) * 100);
    vol.value = String(pct);
    $('sb-volume-val').textContent = pct + ' %';
  }
  $('sb-edit').classList.toggle('active', soundboardEdit);
  $('sb-edit').textContent = soundboardEdit ? '✓ Fertig' : '✎ Bearbeiten';

  // Raster nur bei Aenderung neu aufbauen (Snapshots kommen oft).
  const pres = $('sb-presets');
  const sig = JSON.stringify([sb.presets, sb.own, sb.hidden, soundboardEdit]);
  if (pres._sbSig === sig) return;
  pres._sbSig = sig;

  const known = SOUNDBOARD_PRESETS.filter((p) => sb.presets.includes(p[0]));
  const extra = sb.presets.filter((f) => !SOUNDBOARD_PRESETS.some((p) => p[0] === f))
    .map((f) => [f, '🔊', soundTitle(f)]);
  pres.innerHTML = '';
  known.concat(extra).forEach(([file, emoji, label]) => {
    const hidden = sb.hidden.includes(file);
    if (hidden && !soundboardEdit) return;
    pres.appendChild(soundTile('preset', file, emoji, label, {
      hidden,
      badge: soundboardEdit ? (hidden ? '🙈' : '👁') : '',
      onEdit: () => send({
        type: 'master', action: 'soundHidden',
        hidden: hidden ? sb.hidden.filter((f) => f !== file) : sb.hidden.concat(file)
      })
    }));
  });
  if (!pres.children.length) {
    pres.innerHTML = '<p class="muted small">Alle mitgelieferten Sounds ausgeblendet – über „✎ Bearbeiten" wieder einblenden.</p>';
  }

  const own = $('sb-own');
  own.innerHTML = '';
  sb.own.forEach((file) => {
    own.appendChild(soundTile('own', file, '⭐', soundTitle(file), {
      badge: soundboardEdit ? '🗑' : '',
      onEdit: async () => {
        const ok = await confirmModal('„' + file + '" endgültig löschen?', { title: 'Sound löschen', okText: 'Löschen', danger: true });
        if (ok) sendAdmin({ type: 'admin', action: 'deleteSound', name: file });
      }
    }));
  });
  if (!sb.own.length) own.innerHTML = '<p class="muted small">Noch keine eigenen Sounds – lade kurze Audiodateien hoch (mp3, ogg, wav, …).</p>';
}

// Spieler-Stimmabgabe (Ja/Nein-Karte), einmalig aus startApp() in core.js verdrahtet.
function setupPlayerPoll() {
  document.querySelectorAll('#player-poll .poll-vote').forEach((b) =>
    b.addEventListener('click', () => send({ type: 'pollVote', vote: b.dataset.vote })));
}

// Master: Hype-Meter-Schalter + Empfindlichkeit sowie die gespeicherten
// Fun-Eingaben (admin.fun) aus dem Snapshot spiegeln – nie in ein Feld, das gerade bearbeitet wird.
function renderFunTab(s) {
  const fun = s.admin && s.admin.fun;
  if (fun) {
    const setVal = (id, v) => { const el = $(id); if (el && document.activeElement !== el && el.value !== String(v)) el.value = v; };
    setVal('fun-cd-sek', fun.countdownSek);
    setVal('fun-cd-warn', fun.countdownWarn);
    if (!funPollTimer) setVal('fun-poll-question', fun.pollQuestion);
    if (funPopupType !== fun.popupType) {
      funPopupType = fun.popupType;
      document.querySelectorAll('#fun-popup-types .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.type === funPopupType));
    }
  }
  const h = (s.settings && s.settings.hype) || { enabled: false, sensitivity: 'mid' };
  const hypeSwitch = document.getElementById('hype-switch');
  if (hypeSwitch) hypeSwitch.checked = !!h.enabled;
  document.querySelectorAll('#hype-sensitivity .seg-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.level === h.sensitivity));
  const warn = document.getElementById('hype-reactions-off');
  if (warn) warn.classList.toggle('hidden', !(h.enabled && !(s.settings.reactions && s.settings.reactions.enabled)));
}

// ---------------------------------------------------------------------------
// Fake-Popups: der Master schaltet einzelnen Spielern (oder allen) ein Spass-
// Popup aufs Handy – Cookie-Banner, AGB, Captcha, ... Server haelt nur Typ +
// token + erledigt-Status (game.popups, Whitelist POPUP_TYPES in lib/state.js);
// Inhalt und kleine Mini-Ablaeufe leben komplett hier. Bewusst im neutralen
// "echte Webseite"-Look (weiss, Systemschrift) statt im Quiz-Theme.
// - renderPlayerPopup(s): Spieler, aus renderPlayer; baut nur bei neuem token neu auf.
// - renderFunPopups(s): Master, Spielerliste mit Status im Fun-Tab.
// ---------------------------------------------------------------------------
const POPUP_DEFS = {
  cookies:    { emoji: '🍪', label: 'Cookie-Banner' },
  agb:        { emoji: '📜', label: 'AGB zustimmen' },
  captcha:    { emoji: '🤖', label: 'Roboter-Captcha' },
  update:     { emoji: '⬇️', label: 'Software-Update' },
  virus:      { emoji: '🦠', label: 'Virus-Warnung' },
  newsletter: { emoji: '📬', label: 'Newsletter' }
};
let funPopupType = 'cookies';     // im Master gewaehlter Popup-Typ
let fakePopupToken = null;        // Spieler: token des aktuell aufgebauten Popups
let fakePopupDone = null;         // Spieler: lokal schon erledigter token (bis der Server es bestaetigt)
let fakePopupTimers = [];

function renderPlayerPopup(s) {
  const el = document.getElementById('fake-popup');
  if (!el) return;
  const pop = s.game && s.game.myPopup;
  if (!pop || pop.token === fakePopupDone) {
    if (fakePopupToken !== null) closeFakePopup(el);
    return;
  }
  if (pop.token === fakePopupToken) return;   // laeuft schon – lokalen Ablauf nicht stoeren
  closeFakePopup(el);
  fakePopupToken = pop.token;
  el.className = 'fp-backdrop fp-' + pop.type;
  el.innerHTML = '';
  const finish = () => {
    fakePopupDone = pop.token;
    send({ type: 'popupDone', token: pop.token });
    closeFakePopup(el);
  };
  const later = (fn, ms) => fakePopupTimers.push(setTimeout(fn, ms));
  const build = FAKE_POPUP_BUILDERS[pop.type];
  if (build) build(el, finish, later);
}

function closeFakePopup(el) {
  fakePopupTimers.forEach(clearTimeout);
  fakePopupTimers = [];
  fakePopupToken = null;
  el.className = 'hidden';
  el.innerHTML = '';
}

// Kleiner DOM-Helfer fuer die Popup-Bausteine.
function fpEl(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
function fpShake(box) {
  box.classList.remove('fp-shake');
  void box.offsetWidth;
  box.classList.add('fp-shake');
}

const FAKE_POPUP_BUILDERS = {
  // Cookie-Banner: "Nur notwendige" fuehrt zu Einstellungen, in denen alles notwendig ist.
  cookies(root, finish) {
    const box = fpEl('div', 'fp-box fp-banner');
    box.innerHTML =
      '<div class="fp-title">🍪 Wir respektieren deine Privatsphäre</div>' +
      '<p>Wir und unsere 847 Partner verwenden Cookies, um dein Quizverhalten zu analysieren, ' +
      'deine falschen Antworten zu speichern und sie später gegen dich zu verwenden.</p>' +
      '<div class="fp-actions"><button class="fp-btn fp-secondary" data-a="settings">Nur notwendige</button>' +
      '<button class="fp-btn fp-primary" data-a="ok">Alle akzeptieren</button></div>';
    root.appendChild(box);
    box.addEventListener('click', (e) => {
      const a = e.target.dataset && e.target.dataset.a;
      if (a === 'ok' || a === 'save') finish();
      else if (a === 'settings') {
        const items = ['Unbedingt notwendig', 'Auch notwendig', 'Ganz besonders notwendig', 'Für den Quizmaster notwendig', 'Notwendig für Werbung'];
        box.innerHTML = '<div class="fp-title">Cookie-Einstellungen</div>' +
          items.map((t) => '<label class="fp-toggle"><span>' + t + '</span><input type="checkbox" checked disabled></label>').join('') +
          '<div class="fp-actions"><button class="fp-btn fp-primary" data-a="save">Auswahl speichern</button></div>';
      }
    });
  },

  // AGB: Haken erst nach Runterscrollen moeglich, Ablehnen ist keine Option.
  agb(root, finish) {
    const box = fpEl('div', 'fp-box');
    const paras = [
      '§1 Mit dem Betreten dieses WLANs erkennst du an, dass der Quizmaster immer recht hat.',
      '§2 Falsche Antworten gelten als Ausdruck persönlicher Schwäche und werden entsprechend belächelt.',
      '§3 Das Nachschlagen von Antworten auf dem Handy ist verboten. Ja, auch auf dem Klo.',
      '§4 Punkte sind nicht übertragbar, nicht verzinst und nicht in Bargeld umtauschbar.',
      '§5 Wer gewinnt, gibt die nächste Runde aus.',
      '§6 Beschwerden über die Wertung sind schriftlich, in dreifacher Ausfertigung und auf Latein einzureichen.',
      '§7 Der Quizmaster behält sich das Recht vor, diese Bedingungen jederzeit und ohne Vorwarnung zu ändern.',
      '§8 Sollte eine Bestimmung unwirksam sein, gilt stattdessen das, was der Quizmaster gerade lustig findet.',
      '§9 Du bestätigst, diese AGB vollständig gelesen zu haben. (Hast du nicht. Wissen wir.)'
    ];
    box.innerHTML =
      '<div class="fp-title">📜 Aktualisierte Nutzungsbedingungen</div>' +
      '<p class="fp-muted">Bitte lies die neuen AGB vollständig durch, um weiterspielen zu können.</p>' +
      '<div class="fp-scroll">' + paras.map((p) => '<p>' + p + '</p>').join('') + '</div>' +
      '<label class="fp-check fp-disabled"><input type="checkbox" disabled> Ich habe die AGB gelesen und akzeptiere sie</label>' +
      '<p class="fp-error hidden"></p>' +
      '<div class="fp-actions"><button class="fp-btn fp-secondary" data-a="no">Ablehnen</button>' +
      '<button class="fp-btn fp-primary" data-a="ok" disabled>Zustimmen</button></div>';
    root.appendChild(box);
    const scroll = box.querySelector('.fp-scroll');
    const check = box.querySelector('.fp-check input');
    const okBtn = box.querySelector('[data-a="ok"]');
    const err = box.querySelector('.fp-error');
    const unlockAtEnd = () => {
      if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 8) {
        check.disabled = false;
        box.querySelector('.fp-check').classList.remove('fp-disabled');
      }
    };
    scroll.addEventListener('scroll', unlockAtEnd);
    unlockAtEnd();   // grosser Bildschirm: Text passt komplett rein, nichts zu scrollen
    check.addEventListener('change', () => { okBtn.disabled = !check.checked; });
    box.addEventListener('click', (e) => {
      const a = e.target.dataset && e.target.dataset.a;
      if (a === 'ok' && check.checked) finish();
      else if (a === 'no') {
        err.textContent = 'Ablehnen ist in deinem Tarif leider nicht enthalten.';
        err.classList.remove('hidden');
        fpShake(box);
      }
    });
  },

  // Captcha: Checkbox -> Bilderraetsel; der erste richtige Versuch "scheitert" trotzdem.
  captcha(root, finish, later) {
    const SETS = [
      { label: 'Ampeln', yes: '🚦', no: ['🚗', '🌳', '🏠', '🚲', '🐕', '⛽', '🚌'] },
      { label: 'Fahrräder', yes: '🚲', no: ['🚗', '🚦', '🌳', '🏠', '🛴', '🚌', '🏍️'] },
      { label: 'Katzen', yes: '🐈', no: ['🐕', '🐇', '🦊', '🐄', '🐁', '🐖', '🦝'] },
      { label: 'Pizzen', yes: '🍕', no: ['🍔', '🌮', '🥨', '🍩', '🧀', '🥐', '🍪'] }
    ];
    let attempts = 0;
    const box = fpEl('div', 'fp-box fp-captcha');
    root.appendChild(box);
    function step1() {
      box.innerHTML =
        '<div class="fp-captcha-row"><button class="fp-cbox" data-a="check"></button>' +
        '<span>Ich bin kein Roboter</span><span class="fp-captcha-logo">🔄<br><small>reKAPTSCHA</small></span></div>';
    }
    function grid() {
      const set = SETS[Math.floor(Math.random() * SETS.length)];
      const n = 3 + Math.floor(Math.random() * 2);
      const tiles = [];
      for (let i = 0; i < 9; i++) tiles.push(i < n ? set.yes : set.no[Math.floor(Math.random() * set.no.length)]);
      tiles.sort(() => Math.random() - 0.5);
      box.innerHTML =
        '<div class="fp-captcha-head">Wähle alle Bilder mit <b>' + set.label + '</b> aus.' +
        (attempts ? '<br><small>Bitte erneut versuchen.</small>' : '') + '</div>' +
        '<div class="fp-grid">' + tiles.map((t, i) => '<button class="fp-tile" data-i="' + i + '">' + t + '</button>').join('') + '</div>' +
        '<p class="fp-error hidden"></p>' +
        '<div class="fp-actions"><button class="fp-btn fp-primary" data-a="verify">Bestätigen</button></div>';
      box.dataset.yes = set.yes;
      box._tiles = tiles;
    }
    step1();
    box.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.a === 'check' && !t.classList.contains('fp-spin')) {
        t.classList.add('fp-spin');
        later(grid, 1200);
      } else if (t.classList.contains('fp-tile')) {
        t.classList.toggle('fp-sel');
      } else if (t.dataset.a === 'verify') {
        const sel = [...box.querySelectorAll('.fp-tile')].map((b) => b.classList.contains('fp-sel'));
        const ok = box._tiles.every((v, i) => (v === box.dataset.yes) === sel[i]);
        const err = box.querySelector('.fp-error');
        if (ok && attempts > 0) {
          box.innerHTML = '<div class="fp-captcha-row"><span class="fp-cbox fp-ok">✔</span><span>Du bist (wahrscheinlich) kein Roboter.</span></div>';
          later(finish, 1300);
          return;
        }
        attempts++;
        err.textContent = ok ? 'Verdächtig schnell geklickt. Das machen nur Roboter.' : 'Das war leider falsch. Bist du sicher, dass du kein Roboter bist?';
        err.classList.remove('hidden');
        fpShake(box);
        later(grid, 1600);
      }
    });
  },

  // Update: Fortschrittsbalken, der bei 99 % ewig haengt; "Spaeter" gibt es nicht.
  update(root, finish, later) {
    const box = fpEl('div', 'fp-box');
    box.innerHTML =
      '<div class="fp-title">⬇️ Update erforderlich</div>' +
      '<p>Für <b>QuizOS 13.37</b> ist ein wichtiges Sicherheitsupdate verfügbar. ' +
      'Neu: 12 % mehr Wissen, verbesserte Ausreden für falsche Antworten.</p>' +
      '<div class="fp-actions"><button class="fp-btn fp-secondary" data-a="later">Später erinnern</button>' +
      '<button class="fp-btn fp-primary" data-a="go">Jetzt installieren</button></div>';
    root.appendChild(box);
    function install(note) {
      box.innerHTML =
        '<div class="fp-title">Update wird installiert …</div>' + (note ? '<p class="fp-muted">' + note + '</p>' : '') +
        '<div class="fp-progress"><div class="fp-bar"></div></div><p class="fp-status fp-muted">Wissen wird heruntergeladen …</p>';
      const bar = box.querySelector('.fp-bar');
      const status = box.querySelector('.fp-status');
      const steps = [
        [300, 23, 'Antworten werden vorbereitet …'], [1300, 58, 'Gehirnzellen werden defragmentiert …'],
        [2400, 99, 'Fast fertig …'], [6000, 99, 'Wirklich fast fertig …'], [8500, 100, 'Neustart …']
      ];
      steps.forEach(([ms, pct, txt]) => later(() => { bar.style.width = pct + '%'; status.textContent = txt; }, ms));
      later(finish, 9800);
    }
    box.addEventListener('click', (e) => {
      const a = e.target.dataset && e.target.dataset.a;
      if (a === 'go') install();
      else if (a === 'later') install('„Später" ist jetzt.');
    });
  },

  // Virus-Warnung: Scan + Entwarnung.
  virus(root, finish, later) {
    const box = fpEl('div', 'fp-box fp-alarm');
    box.innerHTML =
      '<div class="fp-title">⚠️ WARNUNG! 3 Viren gefunden!</div>' +
      '<p>Dein Handy ist <b>stark gefährdet</b>. Folgende Bedrohungen wurden erkannt:</p>' +
      '<ul class="fp-list"><li>🐴 Trojaner.Schummeln.exe</li><li>🪱 Wurm.FalscheAntwort.dll</li><li>👀 Spyware.NachbarHandy.js</li></ul>' +
      '<div class="fp-actions"><button class="fp-btn fp-danger" data-a="go">Jetzt entfernen</button></div>';
    root.appendChild(box);
    box.addEventListener('click', (e) => {
      if (!(e.target.dataset && e.target.dataset.a === 'go')) return;
      box.classList.remove('fp-alarm');
      box.innerHTML = '<div class="fp-title">🛡️ Bedrohungen werden entfernt …</div>' +
        '<div class="fp-progress"><div class="fp-bar"></div></div>';
      const bar = box.querySelector('.fp-bar');
      bar.style.transition = 'width 3s linear';
      later(() => { bar.style.width = '100%'; }, 50);
      later(() => {
        box.innerHTML = '<div class="fp-title">✅ Dein Gerät ist sauber</div>' +
          '<p>Leider ändert das nichts an deinem Punktestand.</p>' +
          '<div class="fp-actions"><button class="fp-btn fp-primary" data-a="ok">OK</button></div>';
        box.querySelector('[data-a="ok"]').addEventListener('click', finish);
      }, 3200);
    });
  },

  // Newsletter: Abo oder Confirmshaming-Link – beides schliesst.
  newsletter(root, finish) {
    const box = fpEl('div', 'fp-box');
    box.innerHTML =
      '<button class="fp-x" data-a="x">×</button>' +
      '<div class="fp-title">📬 Verpasse keine Frage mehr!</div>' +
      '<p>Melde dich für unseren Newsletter an und erhalte jeden Morgen um 4:30 Uhr die Lösungen von gestern.</p>' +
      '<input class="fp-input" type="email" placeholder="deine@email.de">' +
      '<p class="fp-error hidden"></p>' +
      '<div class="fp-actions"><button class="fp-btn fp-primary" data-a="ok">Jetzt abonnieren</button></div>' +
      '<button class="fp-link" data-a="no">Nein danke, ich weiß eh schon alles.</button>';
    root.appendChild(box);
    const input = box.querySelector('.fp-input');
    const err = box.querySelector('.fp-error');
    box.addEventListener('click', (e) => {
      const a = e.target.dataset && e.target.dataset.a;
      if (a === 'no') finish();
      else if (a === 'x') {
        // Das X weicht aus – wie im echten Internet.
        e.target.style.left = (10 + Math.random() * 70) + '%';
        e.target.style.right = 'auto';
      } else if (a === 'ok') {
        if (/.+@.+/.test(input.value)) finish();
        else { err.textContent = 'Bitte gib eine gültige E-Mail-Adresse ein.'; err.classList.remove('hidden'); fpShake(box); }
      }
    });
  }
};

// Master: Typ-Auswahl + Spielerliste mit Status (signaturbasiert neu aufgebaut).
function renderFunPopups(s) {
  const list = document.getElementById('fun-popup-list');
  if (!list) return;
  const pops = (s.game && s.game.popups) || {};
  const players = (s.participants || []).filter((p) => p.role === 'player' && !p.local);
  const sig = JSON.stringify([players.map((p) => [p.id, p.name, p.avatar, p.color, p.online]), pops]);
  if (list.dataset.sig === sig) return;
  list.dataset.sig = sig;
  if (!players.length) { list.innerHTML = '<p class="muted small">Noch keine Spieler verbunden.</p>'; return; }
  list.innerHTML = players.map((p) => {
    const pop = pops[p.id];
    const def = pop && POPUP_DEFS[pop.type];
    const status = !pop ? '<span class="muted">—</span>'
      : (pop.done ? '✅ ' : '⏳ ') + escapeHtml(def ? def.emoji + ' ' + def.label : pop.type) + (pop.done ? ' erledigt' : ' offen');
    return '<div class="fun-popup-row' + (p.online ? '' : ' offline') + '">' +
      '<span class="fun-popup-name">' + avatarChip(p) + escapeHtml(p.name) + '</span>' +
      '<span class="fun-popup-status small">' + status + '</span>' +
      '<button class="btn small" data-send="' + escapeHtml(p.id) + '">Senden</button>' +
      '<button class="btn small btn-ghost" data-clear="' + escapeHtml(p.id) + '" title="Popup entfernen"' + (pop ? '' : ' disabled') + '>✖</button>' +
      '</div>';
  }).join('');
}

function setupFunPopups() {
  const types = document.getElementById('fun-popup-types');
  if (!types) return;
  types.innerHTML = Object.entries(POPUP_DEFS).map(([id, d]) =>
    '<button class="seg-btn' + (id === funPopupType ? ' active' : '') + '" data-type="' + id + '">' + d.emoji + ' ' + d.label + '</button>').join('');
  types.addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]');
    if (!b) return;
    funPopupType = b.dataset.type;
    types.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    sendFunSettings({ popupType: funPopupType });
  });
  document.getElementById('fun-popup-list').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.send) send({ type: 'master', action: 'popupShow', clientId: b.dataset.send, popup: funPopupType });
    else if (b.dataset.clear) send({ type: 'master', action: 'popupClear', clientId: b.dataset.clear });
  });
  document.getElementById('fun-popup-all').addEventListener('click', () =>
    send({ type: 'master', action: 'popupShow', clientId: 'all', popup: funPopupType }));
  document.getElementById('fun-popup-clear').addEventListener('click', () =>
    send({ type: 'master', action: 'popupClear', clientId: 'all' }));
}
