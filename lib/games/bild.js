'use strict';
/*
 * Bildanzeige: kein echtes Spiel, sondern eine „Folie" zwischen Spielen – zeigt ein
 * Bild (aus public/backgrounds/, gleicher Upload wie im Design-Tab) auf dem
 * Bildschirm, mit Unschaerfe/Abdunklung/Vignette/Filter/Effekten. Als Spiel verpackt,
 * damit es sich als Schritt in den Spielplan einreihen laesst. Keine Punkte.
 *
 * Laufzeitzustand (game.bild): sichtbar (Master blendet ein/aus) und scharf (Master
 * hebt die eingestellte Unschaerfe live auf – „Aufloesen").
 */
const { config, safeBgName, clampInt, SCREEN_EFFECTS } = require('../config');
const { game } = require('../state');
const bus = require('../bus');

const BILD_ANZEIGEN = ['contain', 'cover'];            // ganzes Bild | Bildschirm fuellen
const BILD_HINTERGRUENDE = ['unscharf', 'schwarz', 'design'];  // Flaeche neben dem Bild (nur bei 'contain')
const BILD_FILTER = ['none', 'grau', 'sepia', 'invert'];

// Rohes Profil -> vollstaendiges, typgeprueftes Bild-Profil (Server-Vertrauensgrenze,
// genutzt von sanitizeProfile() UND activeBildCfg()).
function normBildProfile(s) {
  s = s || {};
  return {
    titel: typeof s.titel === 'string' ? s.titel.slice(0, 80) : '',
    untertitel: typeof s.untertitel === 'string' ? s.untertitel.slice(0, 160) : '',
    bild: (typeof s.bild === 'string' && safeBgName(s.bild)) || '',
    anzeige: BILD_ANZEIGEN.includes(s.anzeige) ? s.anzeige : 'contain',
    hintergrund: BILD_HINTERGRUENDE.includes(s.hintergrund) ? s.hintergrund : 'unscharf',
    unschaerfe: clampInt(s.unschaerfe, 0, 40, 0),
    abdunkeln: clampInt(s.abdunkeln, 0, 90, 0),
    vignette: !!s.vignette,
    filter: BILD_FILTER.includes(s.filter) ? s.filter : 'none',
    zoom: !!s.zoom,
    effekt: SCREEN_EFFECTS.includes(s.effekt) ? s.effekt : 'none',
    effektTempo: clampInt(s.effektTempo, 25, 300, 100),
    startVerborgen: !!s.startVerborgen,
    aufHandy: !!s.aufHandy
  };
}

function activeBildCfg() {
  const g = config.games.bild || {};
  const prof = (g.profiles && g.profiles[g.activeProfile]) || {};
  return normBildProfile(prof);
}

// Frischer Zustand fuer das aktive Profil: sichtbar (ausser „verborgen starten"),
// eingestellte Unschaerfe aktiv.
function initBild() {
  game.bild = { sichtbar: !activeBildCfg().startVerborgen, scharf: false };
}

function bildSetSichtbar(on) {
  game.bild.sichtbar = !!on;
  bus.broadcast();
}

function bildSetScharf(on) {
  game.bild.scharf = !!on;
  bus.broadcast();
}

// Oeffentliche Sicht: hier gibt es nichts zu verbergen – alles geht an alle Rollen.
function publicBild() {
  return Object.assign(activeBildCfg(), { sichtbar: !!game.bild.sichtbar, scharf: !!game.bild.scharf });
}

module.exports = { normBildProfile, activeBildCfg, initBild, bildSetSichtbar, bildSetScharf, publicBild };
