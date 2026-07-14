'use strict';
// ============================================================================
// video-signal.js — KYC V4  (version fusionnée + FCM)
//
// Protocole WebSocket :
//   terrain  envoie  : { type:'register', role:'terrain', numero, fcmToken? }
//   BO       envoie  : { type:'register', role:'backoffice', numero }
//   BO       envoie  : { type:'call', numeroMtn }
//   les deux envoient: { type:'webrtc', payload:{ kind:'offer'|'answer'|'ice', ... } }
//   terrain  envoie  : { type:'refus' }
//   les deux envoient: { type:'hangup' }
//   les deux envoient: { type:'ping' }  → réponse { type:'pong' }
//
//   terrain reçoit   : { type:'registered' } / { type:'incoming-call', numeroMtn } /
//                      { type:'webrtc', payload } / { type:'refus' } / { type:'hangup' }
//   BO       reçoit  : { type:'registered' } / { type:'terrain-presence', enLigne } /
//                      { type:'terrain-absent' } / { type:'webrtc', payload } /
//                      { type:'refus' } / { type:'hangup' }
// ============================================================================

const path  = require('path');

// ── Firebase Admin (optionnel — graceful fallback si non configuré) ─────────
let firebaseMessaging = null;

function initFirebase () {
  if (firebaseMessaging) return;
  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!keyPath) {
    console.warn('[FCM] FIREBASE_SERVICE_ACCOUNT_PATH non défini — push FCM désactivé');
    return;
  }
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(require(path.resolve(keyPath))),
      });
    }
    firebaseMessaging = admin.messaging();
    console.log('[FCM] Firebase Admin initialisé');
  } catch (e) {
    console.error('[FCM] Init impossible:', e.message);
  }
}

// ── Envoi push FCM data-only HIGH_PRIORITY ──────────────────────────────────
async function sendCallPush ({ fcmToken, numeroMtn, callUuid }) {
  if (!firebaseMessaging || !fcmToken) return false;
  try {
    await firebaseMessaging.send({
      token: fcmToken,
      data: {
        type:      'incoming-call',
        numeroMtn: String(numeroMtn),
        callUuid:  String(callUuid),
      },
      android: {
        priority: 'high',
        ttl:      30 * 1000,   // 30 s
      },
    });
    console.log(`[FCM] Push envoyé → ${numeroMtn}`);
    return true;
  } catch (e) {
    console.error('[FCM] Erreur push:', e.message);
    return false;
  }
}

// ── Tables de sockets en mémoire ────────────────────────────────────────────
const terrainSockets    = new Map(); // numero → { socket, fcmToken }
const backofficeSockets = new Map(); // numero → socket

// ── Helpers ─────────────────────────────────────────────────────────────────
function envoyer (s, o) {
  try { s.send(JSON.stringify(o)); } catch (_) {}
}

function normNum (n) {
  return String(n || '').replace(/\D/g, '');
}

function genCallUuid () {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Plugin Fastify ───────────────────────────────────────────────────────────
async function routes (fastify) {
  initFirebase();

  fastify.get('/ws/video', { websocket: true }, (connection) => {
    const socket = connection.socket || connection;
    let role   = null;
    let numero = null;

    // ── Réception d'un message ──────────────────────────────────────────────
    socket.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (_) { return; }

      // ── ping / pong (keepalive) ─────────────────────────────────────────
      if (msg.type === 'ping') {
        envoyer(socket, { type: 'pong' });
        return;
      }
      if (msg.type === 'pong') return;

      // ── register ────────────────────────────────────────────────────────
      if (msg.type === 'register') {
        role   = msg.role;
        numero = normNum(msg.numero);
        if (!numero) return;

        if (role === 'terrain') {
          // Stocke socket + token FCM (peut être absent)
          terrainSockets.set(numero, { socket, fcmToken: msg.fcmToken || null });
          console.log(`[SIGNAL] REGISTER terrain: ${numero} | FCM: ${msg.fcmToken ? 'oui' : 'non'}`);
          envoyer(socket, { type: 'registered', role: 'terrain', numero });

          // Informer le BO si déjà connecté
          const boSocket = backofficeSockets.get(numero);
          if (boSocket) envoyer(boSocket, { type: 'terrain-presence', enLigne: true });

        } else if (role === 'backoffice') {
          backofficeSockets.set(numero, socket);
          envoyer(socket, { type: 'registered', role: 'backoffice', numero });
          envoyer(socket, { type: 'terrain-presence', enLigne: terrainSockets.has(numero) });
        }
        return;
      }

      // ── call (BO → terrain) ─────────────────────────────────────────────
      if (msg.type === 'call' && role === 'backoffice') {
        const terrain = terrainSockets.get(numero);
        if (!terrain) {
          envoyer(socket, { type: 'terrain-absent', numero });
          return;
        }

        const callUuid = genCallUuid();

        // Le terrain est joignable via WS
        envoyer(terrain.socket, {
          type:      'incoming-call',
          numero,
          numeroMtn: msg.numeroMtn || '',
        });
        console.log(`[SIGNAL] incoming-call envoyé au terrain ${numero}`);

        // Envoyer aussi le push FCM (réveille si écran verrouillé)
        if (terrain.fcmToken) {
          sendCallPush({
            fcmToken: terrain.fcmToken,
            numeroMtn: msg.numeroMtn || '',
            callUuid,
          }).catch(() => {});
        }
        return;
      }

      // ── webrtc (offer / answer / ice) ───────────────────────────────────
      if (msg.type === 'webrtc') {
        if (role === 'backoffice') {
          const t = terrainSockets.get(numero);
          if (t) envoyer(t.socket, { type: 'webrtc', payload: msg.payload });
        } else if (role === 'terrain') {
          const boSocket = backofficeSockets.get(numero);
          if (boSocket) envoyer(boSocket, { type: 'webrtc', payload: msg.payload });
        }
        return;
      }

      // ── refus (terrain) ──────────────────────────────────────────────────
      if (msg.type === 'refus' && role === 'terrain') {
        const boSocket = backofficeSockets.get(numero);
        if (boSocket) envoyer(boSocket, { type: 'refus' });
        return;
      }

      // ── hangup (l'un ou l'autre) ─────────────────────────────────────────
      if (msg.type === 'hangup') {
        if (role === 'backoffice') {
          const t = terrainSockets.get(numero);
          if (t) envoyer(t.socket, { type: 'hangup' });
        } else if (role === 'terrain') {
          const boSocket = backofficeSockets.get(numero);
          if (boSocket) envoyer(boSocket, { type: 'hangup' });
        }
        return;
      }
    });

    // ── Fermeture connexion ─────────────────────────────────────────────────
    socket.on('close', () => {
      if (role === 'terrain' && numero) {
        const entry = terrainSockets.get(numero);
        if (entry && entry.socket === socket) {
          terrainSockets.delete(numero);
          // Prévenir le BO
          const boSocket = backofficeSockets.get(numero);
          if (boSocket) envoyer(boSocket, { type: 'terrain-presence', enLigne: false });
        }
      }
      if (role === 'backoffice' && numero) {
        if (backofficeSockets.get(numero) === socket) {
          backofficeSockets.delete(numero);
        }
      }
    });
  });
}

module.exports = routes;
