'use strict';
/*
 * Baut den Snapshot (oeffentlicher + rollenabhaengiger Zustand) und verschickt
 * ihn bei jeder Aenderung an alle verbundenen Sockets. Haengt sich dafuer an
 * bus.onChange() – das entkoppelt die Spiel-Module (die nur bus.broadcast()
 * aufrufen) von diesem Zustellungsschritt.
 */
const { config, listBackgrounds, listAudios, listPauseImages } = require('./config');
const { game, participants, publicSettings, teamStandings, publicPlayer } = require('./state');
const bus = require('./bus');

const { activeReactionCfg } = require('./games/reaction');
const { activeWordlistCfg, publicWordlist } = require('./games/wordlist');
const { activeMcCfg, publicMc } = require('./games/mc');
const { activeZdCfg, publicZd } = require('./games/zd');
const { activeFwCfg, publicFw, fwCurrentWord } = require('./games/fw');
const { activeTfCfg, publicTf, tfCurrentStatement } = require('./games/tf');
const { activeZuCfg, publicZu, zuDistractorIds } = require('./games/zu');
const { activeDqCfg, publicDq, dqCurrentCase } = require('./games/dq');
const { activeSqCfg, publicSq, sqCurrentQuestion } = require('./games/sq');
const { activeAqCfg, publicAq, aqCurrentRound, aqTeile } = require('./games/aq');
const { activeRoCfg, publicRo, roCurrentQuestion } = require('./games/ro');
const { activeZmCfg, publicZm } = require('./games/zm');
const { activeBildCfg, publicBild } = require('./games/bild');
const { musicPublic, musicAdmin } = require('./music');
const { soundboardAdmin } = require('./soundboard');
const { wheelPublic, wheelAdmin } = require('./wheel');

function adminData() {
  return {
    activeGame: config.activeGame,
    gameSort: config.gameSort,            // aktiver Sortiermodus der Spiele-Kachelliste
    gameOrder: config.gameOrder,          // frei gesetzte Reihenfolge (Drag&Drop)
    gamePlayed: config.gamePlayed,        // Aktivierungs-Historie (zuletzt gespielt vorne)
    playlist: config.playlist,            // Spielplan (Schritte + aktueller Schritt-Index)
    games: config.games,                 // { reaction: { activeProfile, profiles } }
    reactionCfg: activeReactionCfg(),    // aufgeloeste aktive Reaktions-Einstellungen
    wordlistCfg: activeWordlistCfg(),    // aufgeloeste aktive Wortliste (inkl. Loesung, nur Master)
    mcCfg: activeMcCfg(),                // aufgeloeste aktive MC-Konfig (inkl. Loesungen, nur Master)
    zdCfg: activeZdCfg(),                // aufgeloeste aktive Zeitdruck-Konfig (inkl. Loesungen, nur Master)
    fwCfg: activeFwCfg(),               // aufgeloeste aktive „Falsche Woerter"-Konfig (inkl. Markierung, nur Master)
    tfCfg: activeTfCfg(),              // aufgeloeste aktive Wahr/Falsch-Konfig (inkl. Loesungen, nur Master)
    zuCfg: activeZuCfg(),              // aufgeloeste aktive Zuordnungs-Konfig (inkl. Loesung, nur Master)
    dqCfg: activeDqCfg(),             // aufgeloeste aktive Detektivquiz-Konfig (inkl. Loesungen, nur Master)
    sqCfg: activeSqCfg(),            // aufgeloeste aktive Schätzquiz-Konfig (inkl. Loesungen, nur Master)
    aqCfg: activeAqCfg(),           // aufgeloeste aktive Audioquiz-Konfig (inkl. Loesungen + Dateinamen, nur Master)
    roCfg: activeRoCfg(),          // aufgeloeste aktive Reihenfolge-Konfig (inkl. Loesungen, nur Master)
    zmCfg: activeZmCfg(),          // aufgeloeste aktive Zeichenquiz-Konfig (Begriffe etc., nur Master)
    bildCfg: activeBildCfg(),      // aufgeloeste aktive Bildanzeige-Konfig
    global: { title: config.title, theme: config.theme, design: config.design, pauseScreen: config.pauseScreen },
    backgrounds: listBackgrounds(),     // verfuegbare Hintergrundbilder (public/backgrounds/)
    audios: listAudios(),               // verfuegbare Audiodateien (public/audio/) – fuer den Audioquiz-Editor
    pauseImages: listPauseImages(),     // verfuegbare Pause-Bildschirm-Bilder (public/pause/)
    messagePresets: config.messagePresets, // die drei Nachrichten-Vorlagen (Tab „💬 Nachrichten")
    music: musicAdmin(),                // Hintergrundmusik: Playlist, Optionen, Position, Dateien (public/music/)
    soundboard: soundboardAdmin(),      // Soundboard: mitgelieferte + eigene Sounds, Lautstaerke
    fun: config.fun                     // gespeicherte Fun-Tab-Eingaben (Countdown, Umfrage, Popup-Art, Gluecksrad)
  };
}

function participantList() {
  const list = [];
  for (const p of participants.values()) {
    list.push({
      id: p.id, role: p.role, name: p.name, avatar: p.avatar || null, color: p.color || null,
      online: p.online, local: !!p.local, teamId: game.playerTeam[p.id] || null,
      cursed: !!game.cursed[p.id]
    });
  }
  return list;
}

// Fun-Countdown: Restzeit relativ zum Snapshot-Zeitpunkt statt absoluter Server-
// Uhr (Geraeteuhren muessen nicht synchron sein). Die Clients uebernehmen sie nur
// bei Token-Wechsel und zaehlen danach mit ihrer eigenen Uhr weiter.
function countdownPublic() {
  const cd = game.countdown;
  const restMs = cd.laeuft ? Math.max(0, cd.endsAt - Date.now()) : cd.restMs;
  return { aktiv: cd.aktiv, total: cd.total, laeuft: cd.laeuft, restMs, warnSek: cd.warnSek, token: cd.token };
}

// Fun-Fact-Kacheln fuer den Session-Endscreen aus game.session aufloesen (Namen/
// Avatar/Farbe via publicPlayer, wie ueberall sonst). null je Kategorie, solange
// noch keine passende Punktvergabe stattfand.
function buildSessionSummary() {
  const s = game.session;
  const bestCorrect = Object.entries(s.correct).sort((a, b) => b[1] - a[1])[0];
  return {
    fastest: s.fastest ? Object.assign(publicPlayer(s.fastest.id), { ms: s.fastest.ms, game: s.fastest.game }) : null,
    biggestJump: s.biggestJump ? Object.assign(publicPlayer(s.biggestJump.id), { pts: s.biggestJump.pts, game: s.biggestJump.game }) : null,
    closestGuess: s.closestGuess ? Object.assign(publicPlayer(s.closestGuess.id), { dev: s.closestGuess.dev, game: s.closestGuess.game }) : null,
    mostCorrect: bestCorrect ? Object.assign(publicPlayer(bestCorrect[0]), { count: bestCorrect[1] }) : null
  };
}

// Oeffentlicher Spielzustand (fuer alle) inkl. sortierter Ergebnisse + Bestenliste
function gamePublic() {
  const results = Object.entries(game.results).map(([id, r]) => {
    return Object.assign(publicPlayer(id), { reactionMs: r.reactionMs, falseStart: !!r.falseStart, pts: r.pts || 0 });
  });
  results.sort((a, b) => {
    if (a.falseStart && !b.falseStart) return 1;
    if (!a.falseStart && b.falseStart) return -1;
    if (a.falseStart && b.falseStart) return 0;
    return a.reactionMs - b.reactionMs;
  });
  // Bestenliste mit aufgeloesten Namen (+ Avatar/Farbe), damit Bildschirm keine
  // Teilnehmerliste braucht
  const leaderboard = Object.entries(game.scores)
    .map(([id, pts]) => Object.assign(publicPlayer(id), { pts }))
    .filter((e) => e.pts > 0)
    .sort((a, b) => b.pts - a.pts);
  // Vollstaendiges Scoreboard fuer den Bildschirm: ALLE Spieler (auch mit 0 oder
  // negativen Punkten), mit aufgeloesten Namen + Avatar/Farbe, absteigend sortiert.
  // Namen auf dem Beamer zu zeigen ist gewollt (wie leaderboard), daher server-
  // seitig aufgeloest.
  const scoreboardList = [];
  for (const p of participants.values()) {
    if (p.role !== 'player') continue;
    scoreboardList.push({
      id: p.id, name: p.name, avatar: p.avatar || null, color: p.color || null,
      pts: game.scores[p.id] || 0, online: !!p.online
    });
  }
  scoreboardList.sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));
  const pub = {
    mode: game.mode,
    phase: game.phase,
    roundId: game.roundId,
    round: game.round,
    locked: game.locked,
    disco: game.disco,           // Fun-Pannel: Disco-Modus an/aus
    scoreboardMode: game.scoreboard,   // 'off' | 'side' | 'full' – vom Master gesteuert
    scoreboardScale: game.scoreboardScale, // Textgroesse des Bildschirm-Scoreboards in % (50..200)
    podiumSpeed: game.podiumSpeed,     // Podium-Enthuellung: ms pro Platz (300..3000)
    podiumToken: game.podiumToken,     // steigt bei jeder Podium-Aktivierung/Wiederholung (Bildschirm-Trigger)
    scoreboardList,                    // [{ id, name, pts, online }] – fuer Bildschirm + Master
    results,
    leaderboard,
    scores: game.scores,
    teamMode: game.teamMode,           // Einzel- vs. Teamwertung (fuer alle Rollen)
    sessionEndActive: !!game.sessionEnd.active,  // Session-Endscreen aktiv? (nur Bildschirm rendert ihn)
    sessionEndToken: game.sessionEnd.token || 0, // steigt bei jeder (Wieder-)Anzeige -> Bildschirm spielt Reveal neu ab
    sessionSummary: buildSessionSummary(),       // Fun Facts ueber die ganze Session
    countdown: countdownPublic()                 // Fun-Countdown (Bildschirm zeigt ihn, Master den Status)
  };
  // Team-Modus: die Team-Wertung (Summen + Mitglieder) ist – wie die Namen im
  // Scoreboard/leaderboard – bewusst oeffentlich. Nur im Team-Modus gesendet, damit
  // der Einzelmodus sich exakt wie bisher verhaelt.
  if (game.teamMode) {
    const standings = teamStandings();
    pub.teams = standings;                                            // [{ id, name, color, pts, members[] }]
    pub.teamLeaderboard = standings.filter((t) => t.pts > 0)
      .map((t) => ({ id: t.id, name: t.name, color: t.color, pts: t.pts }));
  }
  // Wortlisten-Spiel: maskierte Liste (verdeckte Woerter werden NICHT gesendet).
  if (config.activeGame === 'wordlist') pub.wl = publicWordlist();
  // Multiple-Choice: waehrend der Fragephase wird die richtige Antwort NICHT
  // mitgesendet (s. publicMc); Loesung/Antworten je Spieler nur an Master.
  if (config.activeGame === 'mc') pub.mc = publicMc();
  // Zeitdruck: analog zu MC (Loesung erst beim Auflösen), plus Punkte-Parameter.
  if (config.activeGame === 'zd') pub.zd = publicZd();
  // „Falsche Woerter": aktuelles Wort ist oeffentlich (Spieler muessen es lesen),
  // aber die falsch/richtig-Markierung NICHT – die kommt erst bei einer Buzz-Pause.
  if (config.activeGame === 'fw') pub.fw = publicFw();
  // Wahr/Falsch-Blitzrunde: die aktuelle Aussage ist oeffentlich, ob sie wahr
  // ist NICHT – das kommt erst bei der Aufloesung (Verdict/dist).
  if (config.activeGame === 'tf') pub.tf = publicTf();
  // Zuordnung: Board (nur Texte) ist oeffentlich; die richtige Zuordnung NICHT –
  // die kommt erst beim Aufloesen (solution/distractors). Loesung + volle
  // Antwort-Maps nur an Master (s. snapshotFor).
  if (config.activeGame === 'zu') pub.zu = publicZu();
  // Detektivquiz: nur die bereits aufgedeckten Hinweise sind oeffentlich, die Loesung
  // erst beim Auflösen. Loesung + alle Hinweise + volle Antwort-Map nur an Master.
  if (config.activeGame === 'dq') pub.dq = publicDq();
  // Schätzquiz: Frage + Einheit + Slider-Grenzen sind oeffentlich, die Loesung NICHT –
  // die kommt erst beim Aufloesen (mit der Ergebnisliste). Volle Schätzungen je Spieler
  // + die richtige Zahl gehen (in der Fragephase) nur an Master (s. snapshotFor).
  if (config.activeGame === 'sq') pub.sq = publicSq();
  // Audioquiz: nur die aktuell freigegebene Ausschnitt-Länge + das Wiedergabe-Token
  // sind oeffentlich (der Bildschirm spielt danach), die Loesung erst beim Auflösen.
  // Der Dateiname geht NUR an Bildschirm + Master (koennte die Loesung verraten).
  if (config.activeGame === 'aq') pub.aq = publicAq();
  // Reihenfolge-Quiz: Kärtchen (nur Texte, in Anzeigereihenfolge) sind
  // oeffentlich; die richtige Reihenfolge NICHT – die kommt erst beim
  // Aufloesen (solution + Ergebnisliste). Volle Antworten je Spieler nur an
  // Master (s. snapshotFor).
  if (config.activeGame === 'ro') pub.ro = publicRo();
  // Zeichenquiz: Begriff + Abgabestand sind waehrend des Zeichnens oeffentlich;
  // in der Abstimmung nur {slotIdx, image} OHNE Autor (der bleibt bis zur
  // Auswertung serverseitig verborgen).
  if (config.activeGame === 'zm') pub.zm = publicZm();
  // Schnellumfrage (Fun-Pannel): nur die Summen sind oeffentlich, nicht wer wie
  // gestimmt hat – die eigene Stimme bekommt jeder Spieler einzeln (myPollVote).
  if (game.poll.status !== 'off') {
    let ja = 0, nein = 0;
    for (const v of Object.values(game.poll.votes)) { if (v === 'ja') ja++; else nein++; }
    pub.poll = { status: game.poll.status, question: game.poll.question, ja, nein, total: ja + nein };
  }
  // Bildanzeige: nichts Geheimes – Bild + Darstellung + Ein-/Ausblend-Zustand an alle.
  if (config.activeGame === 'bild') pub.bild = publicBild();
  return pub;
}


function snapshotFor(conn) {
  const snap = {
    type: 'state',
    settings: publicSettings(),
    game: gamePublic(),
    serverTime: Date.now()
  };
  if (conn && conn.authed && conn.role === 'master') {
    snap.participants = participantList();
    snap.admin = adminData();
    // Nur fuer Master: Team-Definitionen + Team-Summen (auch im Einzelmodus, damit
    // Teams schon vor dem Umschalten eingerichtet/zugeteilt werden koennen).
    snap.game.teamDefs = game.teams.map((t) => ({ id: t.id, name: t.name, color: t.color }));
    snap.game.teamStandings = teamStandings();
    // Nur fuer Master: Status der Fake-Popups je Spieler (Fun-Pannel).
    snap.game.popups = game.popups;
    // Nur fuer Master: Status der Spieler-Nachrichten je Spieler (Fun-Pannel).
    snap.game.messages = game.messages;
    // Nur fuer Master: volle Loesung + zuletzt gesendetes Wort je Spieler.
    if (config.activeGame === 'wordlist') {
      snap.game.wlSolution = activeWordlistCfg().words;
      snap.game.wlLastWords = Object.assign({}, game.wl.lastWords);
    }
    // Nur fuer Master: welcher Spieler welchen Anzeigeindex gewaehlt hat, plus
    // der richtige Anzeigeindex – schon in der Fragephase (zum Vorlesen).
    if (config.activeGame === 'mc') {
      snap.game.mcAnswers = Object.assign({}, game.mc.answers);  // clientId -> Anzeigeindex
      const mcCfg = activeMcCfg();
      const cq = mcCfg.questions[game.mc.qOrder[game.mc.pos]];
      snap.game.mcCorrect = cq ? game.mc.answerPerm.indexOf(cq.correct) : -1;
    }
    // Nur fuer Master: Antwort (+ eingefrorene Punkte) je Spieler und der richtige
    // Anzeigeindex – schon in der Fragephase (zum Vorlesen).
    if (config.activeGame === 'zd') {
      snap.game.zdAnswers = Object.assign({}, game.zd.answers);  // clientId -> { option, points }
      const zdCfg = activeZdCfg();
      const cq = zdCfg.questions[game.zd.qOrder[game.zd.pos]];
      snap.game.zdCorrect = cq ? game.zd.answerPerm.indexOf(cq.correct) : -1;
    }
    // Nur fuer Master: ob das aktuelle Wort falsch (eine Falle) ist – damit der
    // Host es schon in der Running-Phase erkennt. Spieler/Bildschirm erfahren das
    // erst bei einer Buzz-Pause (verdict).
    if (config.activeGame === 'fw') {
      const w = (game.fw.phase === 'running' || game.fw.phase === 'paused') ? fwCurrentWord() : null;
      snap.game.fwCurrentWrong = w ? !!w.wrong : null;
    }
    // Nur fuer Master: ob die aktuelle Aussage wahr ist (schon in der laufenden
    // Phase, zum Vorlesen/Kontrollieren) sowie die Antworten je Spieler.
    if (config.activeGame === 'tf') {
      const st = (game.tf.phase === 'running' || game.tf.phase === 'paused') ? tfCurrentStatement() : null;
      snap.game.tfCurrentWahr = st ? !!st.wahr : null;
      snap.game.tfAnswers = Object.assign({}, game.tf.votes);   // clientId -> { answer, correct, points, elapsedMs }
    }
    // Nur fuer Master: die richtige Zuordnung (schon in der Matching-Phase, zum
    // Vorlesen/Kontrollieren) und die volle Zuordnungskarte je Spieler.
    if (config.activeGame === 'zu') {
      const solution = {};
      game.zu.lefts.forEach((l) => { solution[l.id] = l.partner; });
      snap.game.zuSolution = solution;                 // leftId -> rightId | null
      snap.game.zuDistractors = zuDistractorIds();     // rechte Kaertchen ohne Partner
      snap.game.zuAnswers = game.zu.answers;           // clientId -> { leftId -> rightId }
    }
    // Nur fuer Master: die volle Loesung + ALLE Hinweise des aktuellen Falls (zum
    // Vorlesen/Kontrollieren) und die letzten Antworten je Spieler (Freitext-Modus).
    if (config.activeGame === 'dq') {
      const cur = dqCurrentCase();
      snap.game.dqCase = cur ? { loesung: cur.loesung, hinweise: cur.hinweise } : null;
      snap.game.dqGuesses = Object.assign({}, game.dq.answers);   // clientId -> { text, level }
    }
    // Nur fuer Master: die richtige Zahl (schon in der Fragephase, zum Vorlesen) und
    // die Schätzung je Spieler.
    if (config.activeGame === 'sq') {
      const q = sqCurrentQuestion();
      snap.game.sqTrue = q ? q.loesung : null;
      snap.game.sqAnswers = Object.assign({}, game.sq.answers);   // clientId -> Zahl
    }
    // Nur fuer Master: die volle Loesung + Dateiname + alle Stufen der aktuellen Runde
    // (zum Vorlesen/Kontrollieren) und die letzten Antworten je Spieler (Freitext).
    if (config.activeGame === 'aq') {
      const cur = aqCurrentRound();
      snap.game.aqCase = cur ? { loesung: cur.loesung, audio: cur.audio, teile: aqTeile(cur) } : null;
      snap.game.aqGuesses = Object.assign({}, game.aq.answers);   // clientId -> { text, level }
    }
    // Nur fuer Master: die richtige Reihenfolge (schon in der Fragephase, zum
    // Vorlesen/Kontrollieren) und die eingereichte Reihenfolge je Spieler.
    if (config.activeGame === 'ro') {
      const q = roCurrentQuestion();
      snap.game.roSolution = q ? game.ro.correctOrder : null;   // ids in der richtigen Reihenfolge
      snap.game.roAnswers = Object.assign({}, game.ro.answers);   // clientId -> [ids in eingereichter Reihenfolge]
    }
    // Nur fuer Master: Live-Vorschau der Zeichnungen (wer hat schon abgegeben,
    // inkl. Mini-Bild) – waehrend der Abstimmung bleibt der Autor fuer alle
    // ANDEREN weiterhin verborgen (s. publicZm), der Master sieht hier bewusst
    // mehr (wie bei dq/sq die vollen Antworten je Spieler).
    if (config.activeGame === 'zm') {
      snap.game.zmDrawings = Object.assign({}, game.zm.drawings);   // clientId -> Data-URL
    }
  }
  // Bildschirm (nicht authentifiziert, aber Ton laeuft dort): der aktuelle Dateiname,
  // damit er den Ausschnitt abspielen kann. Der Dateiname ist NICHT oeffentlich
  // (koennte die Loesung verraten), Spieler bekommen ihn NIE.
  if (config.activeGame === 'aq' && conn && conn.role === 'screen') {
    const cur = aqCurrentRound();
    snap.game.aqAudioFile = (cur && (game.aq.phase === 'running' || game.aq.phase === 'reveal')) ? cur.audio : '';
  }
  // Hintergrundmusik: nur der Bildschirm spielt sie ab – Spieler brauchen den
  // Wiedergabezustand nicht (Master bekommt ihn ausfuehrlich in admin.music).
  if (conn && conn.role === 'screen') snap.music = musicPublic();
  // Gluecksrad (Fun-Pannel): nur Bildschirm (Anzeige) und Master (Steuerung + Editor).
  if (conn && (conn.role === 'screen' || (conn.authed && conn.role === 'master'))) snap.wheel = wheelPublic();
  if (conn && conn.authed && conn.role === 'master') snap.wheelAdmin = wheelAdmin();
  // Spieler bekommen ihre eigene Auswahl zurueckgespiegelt (Wiederherstellung
  // nach Reconnect, Anzeige der gesperrten Auswahl) – aber NIE die Loesung.
  if (config.activeGame === 'mc' && conn && conn.role === 'player' && conn.clientId) {
    const a = game.mc.answers[conn.clientId];
    snap.game.mcMyAnswer = (a === undefined ? null : a);
  }
  // Zeitdruck: eigene Auswahl + eingefrorener Punktwert zurueckspiegeln.
  if (config.activeGame === 'zd' && conn && conn.role === 'player' && conn.clientId) {
    const a = game.zd.answers[conn.clientId];
    snap.game.zdMyAnswer = a ? { option: a.option, points: a.points } : null;
  }
  // Wahr/Falsch-Blitzrunde: eigene Antwort zurueckspiegeln (Reconnect/Anzeige der
  // gesperrten Auswahl), aber ob sie richtig war/wie viele Punkte NIE vor der
  // Aufloesung (paused-Phase) – sonst wuerde die Loesung durchsickern.
  if (config.activeGame === 'tf' && conn && conn.role === 'player' && conn.clientId) {
    const v = game.tf.votes[conn.clientId];
    const revealed = game.tf.phase === 'paused' || game.tf.phase === 'done';
    snap.game.tfMyAnswer = v ? { answer: v.answer, correct: revealed ? v.correct : null, points: revealed ? v.points : null } : null;
  }
  // Zuordnung: eigene Zuordnungskarte zurueckspiegeln (Reconnect/Anzeige), NIE die Loesung.
  if (config.activeGame === 'zu' && conn && conn.role === 'player' && conn.clientId) {
    const m = game.zu.answers[conn.clientId];
    snap.game.zuMyAnswer = m ? Object.assign({}, m) : null;
  }
  // Detektivquiz (Freitext): eigene letzte Antwort zurueckspiegeln, NIE die Loesung.
  if (config.activeGame === 'dq' && conn && conn.role === 'player' && conn.clientId) {
    const a = game.dq.answers[conn.clientId];
    snap.game.dqMyGuess = a ? { text: a.text, level: a.level } : null;
  }
  // Schätzquiz: eigene Schätzung zurueckspiegeln (Reconnect/Anzeige), NIE die Loesung
  // (die kommt erst in der Reveal-Phase oeffentlich).
  if (config.activeGame === 'sq' && conn && conn.role === 'player' && conn.clientId) {
    const v = game.sq.answers[conn.clientId];
    snap.game.sqMyAnswer = (v === undefined ? null : v);
  }
  // Audioquiz (Freitext): eigene letzte Antwort zurueckspiegeln, NIE die Loesung.
  if (config.activeGame === 'aq' && conn && conn.role === 'player' && conn.clientId) {
    const a = game.aq.answers[conn.clientId];
    snap.game.aqMyGuess = a ? { text: a.text, level: a.level } : null;
  }
  // Reihenfolge-Quiz: eigene eingereichte Reihenfolge zurueckspiegeln
  // (Reconnect/Anzeige), NIE die Loesung (die kommt erst in der Reveal-Phase
  // oeffentlich).
  if (config.activeGame === 'ro' && conn && conn.role === 'player' && conn.clientId) {
    const a = game.ro.answers[conn.clientId];
    snap.game.roMyAnswer = a || null;
  }
  // Zeichenquiz: Spieler bekommen NUR den eigenen Abgabe-/Stimm-Status
  // zurueckgespiegelt (fuer Reconnect/Anzeige) – niemals das eigene Bild
  // zurueck (hat der Client schon lokal) und niemals fremde Zuordnungen.
  // zmMyVote ist der Slot-Index der aktuell gewaehlten Zeichnung (Stimme ist
  // bis zur Auswertung aenderbar), oder null, wenn noch nicht gewaehlt.
  if (config.activeGame === 'zm' && conn && conn.role === 'player' && conn.clientId) {
    snap.game.zmMySubmitted = !!game.zm.submitted[conn.clientId];
    const votedAuthor = game.zm.votes[conn.clientId];
    const slot = votedAuthor != null ? game.zm.voteOrder.indexOf(votedAuthor) : -1;
    snap.game.zmMyVote = slot >= 0 ? slot : null;
  }
  // Team-Modus: jeder Spieler bekommt seine eigene Team-Zuordnung (fuer das
  // Team-Abzeichen in seiner Kopfzeile) zurueckgespiegelt. Ebenso Avatar/Farbe
  // (server-autoritativ vergeben/gewaehlt) fuer den Avatar-Chip + das Ausklapp-
  // menue in der Kopfzeile.
  if (conn && conn.role === 'player' && conn.clientId) {
    snap.game.myTeamId = game.playerTeam[conn.clientId] || null;
    const me = participants.get(conn.clientId);
    snap.game.myAvatar = (me && me.avatar) || null;
    snap.game.myColor = (me && me.color) || null;
    // Fake-Popup (Fun-Pannel): nur das eigene, und nur solange nicht erledigt.
    const pop = game.popups[conn.clientId];
    snap.game.myPopup = (pop && !pop.done) ? { type: pop.type, token: pop.token } : null;
    // Spieler-Nachricht (Fun-Pannel): nur die eigene, und nur solange nicht weggeklickt.
    const m = game.messages[conn.clientId];
    snap.game.myMessage = (m && !m.done)
      ? { id: m.token, text: m.text, image: m.image, dim: m.dim, blur: m.blur, closable: m.closable } : null;
    snap.game.myCursed = !!game.cursed[conn.clientId];   // Sabotage-Karte: eigenes Handy verfluchen
    snap.game.myPollVote = game.poll.votes[conn.clientId] || null;
  }
  return snap;
}


function pushToAll() {
  for (const p of participants.values()) {
    if (p.online && p.conn) p.conn.send(snapshotFor(p.conn));
  }
}
bus.onChange(pushToAll);

module.exports = { adminData, participantList, gamePublic, snapshotFor };
