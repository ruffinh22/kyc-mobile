'use strict';
// ============================================================================
// video-signal.js — KYC V4  (version fusionnée + FCM, renforcée)
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
//                      { type:'refus' } / { type:'hangup' } / { type:'no-answer', callUuid }
//
// Garanties de livraison :
//   - Si le terrain a un WS actif  → livraison WS immédiate + FCM en parallèle
//     (redondance en cas de veille profonde de l'OS).
//   - Si le terrain n'a PAS de WS (app fermée) mais un token FCM déjà connu
//     → livraison FCM uniquement (voir terrainTokens, persistant).
//   - Si aucun des deux n'est disponible → 'terrain-absent' immédiat.
//   - Si l'appel n'aboutit à aucun échange webrtc/refus/hangup dans les
//     CALL_RING_TIMEOUT_MS → 'no-answer' envoyé au BO, terrain notifié.
//
// Supervision : GET /api/signaling/stats
// ============================================================================

const path  = require('path');

// ── Firebase Admin (optionnel — graceful fallback si non configuré) ─────────
let firebaseMessaging = null;

function initFirebase () {
  if (firebaseMessaging) return;
  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!keyPath) {
    logWarn('[FCM] FIREBASE_SERVICE_ACCOUNT_PATH non défini — push FCM désactivé');
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
    log('[FCM] Firebase Admin initialisé');
  } catch (e) {
    logWarn('[FCM] Init impossible:', e.message);
  }
}

// ── Envoi push FCM data-only HIGH_PRIORITY (avec 1 retry) ───────────────────
async function sendCallPush ({ fcmToken, numeroMtn, callUuid }, attempt = 1) {
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
    log(`[FCM] Push envoyé → ${numeroMtn} (tentative ${attempt})`);
    return true;
  } catch (e) {
    logWarn(`[FCM] Erreur push (tentative ${attempt}):`, e.message);
    if (attempt < 2) {
      await new Promise(r => setTimeout(r, 1200));
      return sendCallPush({ fcmToken, numeroMtn, callUuid }, attempt + 1);
    }
    return false;
  }
}

// ── Tables de sockets en mémoire ────────────────────────────────────────────
const terrainSockets    = new Map(); // numero → { socket, fcmToken }
const backofficeSockets = new Map(); // numero → socket

// ── Registre persistant des tokens FCM ──────────────────────────────────────
// Décorrélé du cycle de vie du WebSocket : un agent terrain peut fermer
// l'application (WS fermé) et rester joignable par push FCM data-only.
// Sans cette table, un appel vers un agent "app fermée" échouait immédiatement
// en 'terrain-absent' car aucune socket WS n'existait plus pour lui.
const terrainTokens = new Map(); // numero → { fcmToken, updatedAt }

// ── Appels en attente de décrochage (timeout côté serveur) ──────────────────
// numero → { callUuid, boSocket, timer, numeroMtn }
const pendingCalls = new Map();
const CALL_RING_TIMEOUT_MS = 45_000; // aligné sur CALL_TIMEOUT_MS côté mobile

// ── Log horodaté ─────────────────────────────────────────────────────────────
function log (...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}
function logWarn (...args) {
  console.warn(`[${new Date().toISOString()}]`, ...args);
}

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

// Annule le timeout de sonnerie serveur dès que l'appel progresse réellement
// (webrtc, refus explicite, ou raccroché) pour ce numero.
function clearPendingCall (numero) {
  const pending = pendingCalls.get(numero);
  if (pending) {
    clearTimeout(pending.timer);
    pendingCalls.delete(numero);
  }
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
          // Ferme une éventuelle ancienne socket fantôme du même agent
          // (ex. reconnexion après crash sans fermeture propre côté client).
          const previous = terrainSockets.get(numero);
          if (previous && previous.socket !== socket) {
            try { previous.socket.close(); } catch (_) {}
          }

          // Stocke socket + token FCM (peut être absent)
          terrainSockets.set(numero, { socket, fcmToken: msg.fcmToken || null });
          log(`[SIGNAL] REGISTER terrain: ${numero} | FCM: ${msg.fcmToken ? 'oui' : 'non'}`);

          // Persiste le token indépendamment du cycle de vie du WS — c'est ce
          // qui permet de joindre l'agent même après fermeture de l'app.
          if (msg.fcmToken) {
            terrainTokens.set(numero, { fcmToken: msg.fcmToken, updatedAt: Date.now() });
          }

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
        const terrain     = terrainSockets.get(numero);
        const tokenEntry  = terrainTokens.get(numero);
        const numeroMtn   = msg.numeroMtn || '';

        if (!terrain && !tokenEntry) {
          // Ni WS actif, ni token FCM connu pour cet agent : réellement injoignable.
          envoyer(socket, { type: 'terrain-absent', numero });
          return;
        }

        const callUuid = genCallUuid();

        // Chemin WS : l'app est ouverte au premier plan → livraison instantanée.
        if (terrain) {
          envoyer(terrain.socket, { type: 'incoming-call', numero, numeroMtn });
          log(`[SIGNAL] incoming-call (WS) → terrain ${numero}`);
        }

        // Chemin FCM : toujours tenté en parallèle si un token est connu, même
        // si le WS est déjà actif (redondance utile si l'app est en veille
        // profonde côté OS et met du temps à réagir sur le seul canal WS).
        const fcmToken = terrain?.fcmToken || tokenEntry?.fcmToken;
        if (fcmToken) {
          sendCallPush({ fcmToken, numeroMtn, callUuid }).catch(() => {});
        } else if (!terrain) {
          // Aucun token et pas de WS : on informe quand même le BO que la
          // livraison n'est pas garantie plutôt que de laisser sonner dans le vide.
          logWarn(`[SIGNAL] Appel vers ${numero} sans WS ni token FCM connu`);
        }

        // Timeout serveur : si personne ne décroche/raccroche dans le délai,
        // on informe le BO explicitement au lieu de le laisser sonner indéfiniment.
        if (pendingCalls.has(numero)) {
          clearTimeout(pendingCalls.get(numero).timer);
        }
        const timer = setTimeout(() => {
          pendingCalls.delete(numero);
          envoyer(socket, { type: 'no-answer', numero, callUuid });
          const t = terrainSockets.get(numero);
          if (t) envoyer(t.socket, { type: 'hangup' });
          log(`[SIGNAL] no-answer (timeout) → ${numero}`);
        }, CALL_RING_TIMEOUT_MS);
        pendingCalls.set(numero, { callUuid, boSocket: socket, numeroMtn, timer });
        return;
      }

      // ── webrtc (offer / answer / ice) ───────────────────────────────────
      if (msg.type === 'webrtc') {
        clearPendingCall(numero); // l'appel progresse réellement, plus de timeout à craindre
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
        clearPendingCall(numero);
        const boSocket = backofficeSockets.get(numero);
        if (boSocket) envoyer(boSocket, { type: 'refus' });
        return;
      }

      // ── hangup (l'un ou l'autre) ─────────────────────────────────────────
      if (msg.type === 'hangup') {
        clearPendingCall(numero);
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
          // NB : terrainTokens n'est volontairement PAS nettoyé ici — l'agent
          // reste joignable par push FCM tant que son token n'a pas été
          // remplacé par un register ultérieur (app rouverte).
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

  // ── Supervision minimale (monitoring / debug) ─────────────────────────────
  fastify.get('/api/signaling/stats', async () => ({
    terrainConnectes:    terrainSockets.size,
    backofficeConnectes: backofficeSockets.size,
    tokensConnus:        terrainTokens.size,
    appelsEnAttente:     pendingCalls.size,
  }));
}

module.exports = routes;
