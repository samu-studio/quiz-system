'use strict';
/*
 * Staffel-Modus (gemeinsam fuer Reihenfolge-Quiz `ro` und Zuordnungsquiz `zu`):
 * Teams bzw. Einzelspieler kommen reihum dran und setzen je Zug GENAU EIN Wort
 * ein. Das aktive Team zieht live gemeinsam an einem Entwurf (`draft`) und
 * schickt ihn ab; der Master bewertet (Server liefert nur einen Hinweis).
 * Richtig -> Zug bleibt, Punkte (bei Teams auf die Mitglieder geteilt), naechste
 * Einheit. Falsch -> Entwurf verfaellt, das Wort liegt wieder im Pool, naechste
 * Einheit startet vom vorherigen Stand.
 *
 * Zustand je Spiel: `game.<id>.staffel = { active, status, draft, ... }`
 *   active: { kind:'team'|'player', id } | null    (wer ist dran)
 *   status: 'working' (Entwurf frei aenderbar) | 'judging' (abgeschickt, Master urteilt)
 *   draft:  spielspezifischer Vorschlag | null
 * Spielspezifisches (Board, Pruefung, Uebernahme) liefert je Spiel ein Adapter:
 *   { id, st(), punkte(), commit(draft), isComplete(), finish() }
 */
const { game, participants, recordScore } = require('./state');
const bus = require('./bus');

// Teilnehmende Einheiten: im Team-Modus die Teams (mit mind. einem Mitglied),
// sonst jeder einzelne Spieler.
function staffelUnits() {
  const players = [...participants.values()].filter((p) => p.role === 'player');
  if (game.teamMode && game.teams.length) {
    return game.teams
      .map((t) => ({
        kind: 'team', id: t.id, name: t.name, color: t.color, avatar: null,
        members: players.filter((p) => game.playerTeam[p.id] === t.id).map((p) => p.id)
      }))
      .filter((u) => u.members.length);
  }
  return players.map((p) => ({
    kind: 'player', id: p.id, name: p.name, color: p.color || null, avatar: p.avatar || null, members: [p.id]
  }));
}

function unitOnline(u) {
  return u.members.some((id) => { const p = participants.get(id); return p && p.online; });
}

function findUnit(active) {
  if (!active) return null;
  return staffelUnits().find((u) => u.kind === active.kind && u.id === active.id) || null;
}

// Frischer Staffel-Zustand; `prevActive` = zuletzt aktive Einheit (Reihum laeuft
// ueber Fragen hinweg weiter, damit nicht immer dieselbe Einheit beginnt).
function staffelNew(prevActive, extra) {
  const st = Object.assign({ active: prevActive || null, status: 'working', draft: null }, extra || {});
  staffelAdvance(st);
  return st;
}

// Naechste (verbundene) Einheit nach der aktuell aktiven; niemand -> active:null.
function staffelAdvance(st) {
  const all = staffelUnits();
  const from = st.active ? all.findIndex((u) => u.kind === st.active.kind && u.id === st.active.id) : -1;
  st.active = null;
  for (let k = 1; k <= all.length; k++) {
    const u = all[(from + k + all.length) % all.length];
    if (unitOnline(u)) { st.active = { kind: u.kind, id: u.id }; return; }
  }
}

// Gehoert dieser Spieler zur gerade aktiven Einheit (auch waehrend der Bewertung)?
function staffelIsActive(st, clientId) {
  if (!st || !st.active || !clientId) return false;
  if (st.active.kind === 'player') return st.active.id === clientId;
  return game.playerTeam[clientId] === st.active.id;
}

// Darf dieser Spieler gerade den Entwurf aendern?
function staffelCanAct(st, clientId) {
  return !!st && st.status === 'working' && staffelIsActive(st, clientId);
}

// Punkte auf die Mitglieder der aktiven Einheit verteilen (Team: geteilt, gerundet).
function staffelAward(st, pts, gameId) {
  const u = findUnit(st.active);
  if (!u || !u.members.length) return;
  const share = Math.round(pts / u.members.length);
  u.members.forEach((id) => recordScore(id, share, { game: gameId }));
}

// Spieler schickt den Entwurf zur Bewertung ab (nur ein Entwurf mit neuem Wort).
function staffelSubmit(ad, clientId) {
  const st = ad.st();
  if (!staffelCanAct(st, clientId) || !st.draft) return;
  st.status = 'judging';
  bus.broadcast();
}

// Master: Richtig/Falsch. Richtig -> uebernehmen + Punkte; immer danach weiter.
function staffelJudge(ad, ok) {
  const st = ad.st();
  if (!st || st.status !== 'judging' || !st.draft) return;
  if (ok) {
    ad.commit(st.draft);
    staffelAward(st, ad.punkte(), ad.id);
  }
  st.draft = null;
  st.status = 'working';
  if (ok && ad.isComplete()) ad.finish();   // alles gesetzt -> Aufloesung
  else staffelAdvance(st);
  bus.broadcast();
}

// Master: bestimmte Einheit ist dran (verwirft einen offenen Entwurf).
function staffelSetActive(ad, kind, id) {
  const st = ad.st();
  if (!st) return;
  const u = staffelUnits().find((x) => x.kind === kind && x.id === id);
  if (!u) return;
  st.active = { kind: u.kind, id: u.id };
  st.draft = null;
  st.status = 'working';
  bus.broadcast();
}

// Oeffentliche Angaben zur aktiven Einheit (Name/Farbe fuer Anzeige) oder null.
function staffelActivePublic(st) {
  const u = findUnit(st.active);
  return u ? { kind: u.kind, id: u.id, name: u.name, color: u.color, avatar: u.avatar } : null;
}

// Nur fuer Master: waehlbare Einheiten (zum Uebersteuern der Reihum-Wahl).
function staffelUnitsForMaster() {
  return staffelUnits().map((u) => ({ kind: u.kind, id: u.id, name: u.name, color: u.color, avatar: u.avatar, online: unitOnline(u) }));
}

module.exports = {
  staffelNew, staffelAdvance, staffelIsActive, staffelCanAct, staffelSubmit, staffelJudge, staffelSetActive,
  staffelActivePublic, staffelUnitsForMaster
};
