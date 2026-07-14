#!/usr/bin/env node
/**
 * local-server.js
 * ──────────────────────────────────────────────────────
 * Serveur local KYC pour tests - pas de dépendances externes
 * Simule l'enregistrement du terrain et les WebSockets
 * 
 * Usage:
 *   node local-server.js [PORT]
 *   Exemple: node local-server.js 3000
 */

const http = require('http');
const url = require('url');
const WebSocket = require('ws');
const path = require('path');

const PORT = process.env.PORT || process.argv[2] || 3000;

// ── Stockage en mémoire ──────────────────────────────────────────────────
const terrains = new Map();      // numero → { socket, fcmToken, enLigne }
const backoffices = new Map();  // numero → socket

// ── Colors pour les logs ──────────────────────────────────────────────────
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(color, ...args) {
  console.log(`${colors[color]}${new Date().toLocaleTimeString()}${colors.reset}`, ...args);
}

// ── Helpers ──────────────────────────────────────────────────────────────
function send(socket, obj) {
  try {
    socket.send(JSON.stringify(obj));
  } catch (e) {
    // Socket fermé
  }
}

function normNum(n) {
  return String(n || '').replace(/\D/g, '');
}

function genCallUuid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── HTTP Server ──────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const pathname = url.parse(req.url).pathname;

  // Route /health
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    log('green', '✓ GET /health');
    return;
  }

  // Route /status (infos serveur)
  if (pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      terrains: Array.from(terrains.keys()),
      backoffices: Array.from(backoffices.keys()),
      timestamp: new Date().toISOString(),
    }));
    log('green', '✓ GET /status');
    return;
  }

  // Route /terrains (voir tous les terrains connectés)
  if (pathname === '/terrains') {
    const list = Array.from(terrains.entries()).map(([numero, data]) => ({
      numero,
      enLigne: data.enLigne,
      timestamp: data.timestamp,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ terrains: list }));
    log('green', '✓ GET /terrains');
    return;
  }

  // Route /call/:numero (déclencher un appel manuellement)
  if (pathname.startsWith('/call/')) {
    const numero = pathname.replace('/call/', '');
    if (!terrains.has(numero)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Terrain non trouvé' }));
      log('red', '✗ /call - Terrain non trouvé:', numero);
      return;
    }

    const terrain = terrains.get(numero);
    const callUuid = genCallUuid();
    const numeroMtn = '0700000000'; // Faux numéro MTN

    // Envoyer incoming-call
    send(terrain.socket, {
      type: 'incoming-call',
      numeroMtn,
      callUuid,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      message: 'Appel déclenché',
      numeroMtn,
      callUuid,
    }));

    log('cyan', `→ Appel déclenché pour ${numero}`);
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

// ── WebSocket Server ─────────────────────────────────────────────────────
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  // Route les WebSockets sur /ws/video
  if (request.url === '/ws/video') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (socket, req) => {
  log('blue', '👤 Nouvelle connexion WebSocket');

  let role = null;
  let numero = null;

  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      log('red', '✗ JSON invalide:', raw.toString());
      return;
    }

    // ── Register ─────────────────────────────────────────────────────────
    if (msg.type === 'register') {
      role = msg.role;
      numero = normNum(msg.numero);

      if (role === 'terrain') {
        terrains.set(numero, {
          socket,
          fcmToken: msg.fcmToken || null,
          enLigne: true,
          timestamp: new Date().toISOString(),
        });
        send(socket, { type: 'registered' });
        log('green', `✓ Terrain enregistré: ${numero}`);

        // Notifier les backoffices
        backoffices.forEach((bo) => {
          send(bo, {
            type: 'terrain-presence',
            numero,
            enLigne: true,
          });
        });
      } else if (role === 'backoffice') {
        backoffices.set(numero, socket);
        send(socket, { type: 'registered' });
        log('green', `✓ Backoffice enregistré: ${numero}`);

        // Envoyer l'état actuel des terrains
        terrains.forEach((terrain, num) => {
          send(socket, {
            type: 'terrain-presence',
            numero: num,
            enLigne: true,
          });
        });
      }
      return;
    }

    // ── Ping/Pong ────────────────────────────────────────────────────────
    if (msg.type === 'ping') {
      send(socket, { type: 'pong' });
      return;
    }

    // ── WebRTC (relayer) ─────────────────────────────────────────────────
    if (msg.type === 'webrtc') {
      if (!numero) return;
      
      // Si c'est un terrain, envoyer aux backoffices
      if (role === 'terrain') {
        backoffices.forEach((bo) => {
          send(bo, {
            type: 'webrtc',
            from: numero,
            payload: msg.payload,
          });
        });
      }
      // Si c'est un backoffice, envoyer au terrain
      else if (role === 'backoffice') {
        const terrain = terrains.get(numero);
        if (terrain) {
          send(terrain.socket, {
            type: 'webrtc',
            payload: msg.payload,
          });
        }
      }
      return;
    }

    // ── Refus ────────────────────────────────────────────────────────────
    if (msg.type === 'refus') {
      if (role === 'terrain' && numero) {
        backoffices.forEach((bo) => {
          send(bo, {
            type: 'refus',
            numero,
          });
        });
      }
      return;
    }

    // ── Hangup ───────────────────────────────────────────────────────────
    if (msg.type === 'hangup') {
      if (role === 'terrain' && numero) {
        backoffices.forEach((bo) => {
          send(bo, {
            type: 'hangup',
            numero,
          });
        });
      }
      return;
    }

    log('yellow', `⚠ Message inconnu (${role}):`, msg.type);
  });

  socket.on('close', () => {
    if (role === 'terrain' && numero) {
      terrains.delete(numero);
      log('yellow', `✗ Terrain déconnecté: ${numero}`);

      // Notifier les backoffices
      backoffices.forEach((bo) => {
        send(bo, {
          type: 'terrain-presence',
          numero,
          enLigne: false,
        });
      });
    } else if (role === 'backoffice' && numero) {
      backoffices.delete(numero);
      log('yellow', `✗ Backoffice déconnecté: ${numero}`);
    }
  });

  socket.on('error', (err) => {
    log('red', '✗ Erreur WebSocket:', err.message);
  });
});

// ── Start Server ─────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  log('green', `\n╔════════════════════════════════════════════════╗`);
  log('green', `║  🚀 Serveur KYC Local Démarré                  ║`);
  log('green', `╚════════════════════════════════════════════════╝\n`);

  log('cyan', `📍 Serveur écoute sur: http://0.0.0.0:${PORT}`);
  log('cyan', `📍 URL pour l'app:      http://192.168.X.X:${PORT}`);
  log('cyan', `📍 WebSocket:           ws://192.168.X.X:${PORT}\n`);

  log('blue', `Routes disponibles:`);
  log('blue', `  GET  /health              → Vérifier la connexion`);
  log('blue', `  GET  /status              → État du serveur`);
  log('blue', `  GET  /terrains            → Lister les terrains connectés`);
  log('blue', `  POST /call/:numero        → Déclencher un appel`);
  log('blue', `  WS   /                    → WebSocket pour signalisation\n`);

  log('yellow', `💡 Pour utiliser dans l'app:`);
  log('yellow', `  1. Trouvez votre IP: ifconfig | grep "inet "`);
  log('yellow', `  2. URL dans l'app: http://192.168.X.X:${PORT}`);
  log('yellow', `  3. Enregistrez un terrain`);
  log('yellow', `  4. Déclenchez un appel: curl http://192.168.X.X:${PORT}/call/065151234\n`);

  log('green', `✓ Serveur prêt! Appuyez sur Ctrl+C pour arrêter.\n`);
});

// ── Graceful Shutdown ────────────────────────────────────────────────────
process.on('SIGINT', () => {
  log('yellow', '\n⏹ Arrêt du serveur...');
  wss.clients.forEach((client) => client.close());
  server.close(() => {
    log('green', '✓ Serveur arrêté');
    process.exit(0);
  });
  setTimeout(() => {
    log('red', '✗ Force arrêt');
    process.exit(1);
  }, 5000);
});

// ── Info pratique ────────────────────────────────────────────────────────
log('cyan', `💻 Commande pour tester depuis le terminal:`);
log('cyan', `  curl http://localhost:${PORT}/health`);
log('cyan', `  curl http://localhost:${PORT}/status\n`);
