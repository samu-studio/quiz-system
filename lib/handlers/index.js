'use strict';
/*
 * Dispatcher: leitet jede eingehende WS-Nachricht anhand ihres `type` an den
 * zustaendigen Handler weiter (der einzige Ort, der ALLE Handler-Module braucht).
 */
const { onHello, onSetName, onSetAvatar, onSetColor, onPopupDone, onMessageDone, onDisconnect } = require('./connection');
const { onAdmin } = require('./admin');
const { onMaster } = require('./master');
const {
  onPress, onSubmitWord, onAnswer, onTfAnswer, onAssign, onGuess, onEstimate, onOrder, onReaction, onPollVote,
  onZmSubmit, onZmVote
} = require('./player');
const { onMusicEnded } = require('../music');
const { game } = require('../state');

// Sabotage-Karte (Fun-Pannel): alle Eingaben, die ein verfluchter Spieler NICHT
// mehr machen darf – Spiel-Eingaben, Emoji-Reaktionen und Name/Avatar/Farbe.
const CURSE_BLOCKED = new Set([
  'setName', 'setAvatar', 'setColor', 'press', 'submitWord', 'answer', 'tfAnswer', 'assign',
  'guess', 'estimate', 'order', 'reaction', 'zmSubmit', 'zmVote'
]);

function handleMessage(conn, msg) {
  if (conn.clientId && game.cursed[conn.clientId] && CURSE_BLOCKED.has(msg.type)) return;
  switch (msg.type) {
    case 'hello': return onHello(conn, msg);
    case 'setName': return onSetName(conn, msg);
    case 'setAvatar': return onSetAvatar(conn, msg);
    case 'setColor': return onSetColor(conn, msg);
    case 'popupDone': return onPopupDone(conn, msg);   // Fake-Popup (Fun-Pannel) weggeklickt
    case 'messageDone': return onMessageDone(conn, msg);   // Spieler-Nachricht (Fun-Pannel) weggeklickt
    case 'admin': return onAdmin(conn, msg);
    case 'master': return onMaster(conn, msg);
    case 'press': return onPress(conn, msg);
    case 'submitWord': return onSubmitWord(conn, msg);
    case 'answer': return onAnswer(conn, msg);
    case 'tfAnswer': return onTfAnswer(conn, msg);
    case 'assign': return onAssign(conn, msg);
    case 'guess': return onGuess(conn, msg);
    case 'estimate': return onEstimate(conn, msg);
    case 'order': return onOrder(conn, msg);
    case 'reaction': return onReaction(conn, msg);
    case 'pollVote': return onPollVote(conn, msg);
    case 'zmSubmit': return onZmSubmit(conn, msg);
    case 'zmVote': return onZmVote(conn, msg);
    case 'musicEnded': return onMusicEnded(conn, msg);   // vom Bildschirm: Titel zu Ende
    default: break;
  }
}

module.exports = { handleMessage, onDisconnect };
