// ============================================================================
// Signalisation WebRTC - KYC V4 (TypeScript)
// Back-office <-> agent terrain, identifié par son numéro (wa_agent)
// ============================================================================
import { FastifyInstance } from 'fastify';

// Types de messages WebSocket
type WebSocketMessage =
  | { type: 'register'; role: 'terrain' | 'backoffice'; numero: string }
  | { type: 'call'; numeroMtn?: string }
  | { type: 'webrtc'; payload: unknown }
  | { type: 'refus' }
  | { type: 'hangup' }
  | { type: 'registered'; role: string; numero: string }
  | { type: 'terrain-presence'; enLigne: boolean }
  | { type: 'incoming-call'; numero: string; numeroMtn?: string }
  | { type: 'terrain-absent'; numero: string };

// Stockage des connexions WebSocket
const terrainSockets = new Map<string, any>();     // numero -> socket (agent terrain)
const backofficeSockets = new Map<string, any>();  // numero -> socket (back-office)

// Helpers
function envoyer(socket: any, obj: Record<string, unknown>): void {
  try {
    socket.send(JSON.stringify(obj));
  } catch (e) {
    // Erreur silencieuse - la socket peut être fermée
  }
}

function normaliserNumero(numero: string | number | undefined | null): string {
  return String(numero || '').replace(/\D/g, '');
}

export async function videoSignalRoutes(app: any): Promise<void> {
  app.register(async function (fastify) {
    fastify.get('/ws/video', { websocket: true }, (connection, req) => {
      const socket = connection.socket as any;
      let role: 'terrain' | 'backoffice' | null = null;
      let numero: string | null = null;

      socket.on('message', (raw) => {
        let msg: WebSocketMessage;
        try {
          msg = JSON.parse(raw.toString()) as WebSocketMessage;
        } catch (e) {
          fastify.log.warn('[VIDEO-SIGNAL] Message JSON invalide reçu');
          return;
        }

        // Enregistrement d'un client
        if (msg.type === 'register') {
          const registerMsg = msg as { type: 'register'; role: 'terrain' | 'backoffice'; numero: string };
          role = registerMsg.role;
          numero = normaliserNumero(registerMsg.numero);

          if (!numero) {
            fastify.log.warn('[VIDEO-SIGNAL] Tentative register sans numéro valide');
            return;
          }

          if (role === 'terrain') {
            terrainSockets.set(numero, socket);
            fastify.log.info(`[VIDEO-SIGNAL] REGISTER terrain: ${numero} | total terrains: ${terrainSockets.size}`);
            envoyer(socket, { type: 'registered', role: 'terrain', numero });
          } else if (role === 'backoffice') {
            backofficeSockets.set(numero, socket);
            fastify.log.info(`[VIDEO-SIGNAL] REGISTER backoffice: ${numero} | total backoffice: ${backofficeSockets.size}`);
            envoyer(socket, { type: 'registered', role: 'backoffice', numero });
            envoyer(socket, { type: 'terrain-presence', enLigne: terrainSockets.has(numero) });
          }
          return;
        }

        // Appel entrant depuis le back-office
        if (msg.type === 'call' && role === 'backoffice' && numero) {
          const callMsg = msg as { type: 'call'; numeroMtn?: string };
          fastify.log.info(`[VIDEO-SIGNAL] CALL reçu pour numéro: ${numero} | terrains en ligne: ${terrainSockets.size} | trouvé: ${terrainSockets.has(numero)}`);
          
          const cible = terrainSockets.get(numero);
          if (cible) {
            fastify.log.info(`[VIDEO-SIGNAL] >>> incoming-call ENVOYÉ au terrain ${numero}`);
            envoyer(cible, { type: 'incoming-call', numero, numeroMtn: callMsg.numeroMtn || '' });
          } else {
            envoyer(socket, { type: 'terrain-absent', numero });
          }
          return;
        }

        // Relais WebRTC (SDP, ICE candidates)
        if (msg.type === 'webrtc' && numero) {
          const webrtcMsg = msg as { type: 'webrtc'; payload: unknown };
          const dest = role === 'backoffice' ? terrainSockets.get(numero) : backofficeSockets.get(numero);
          if (dest) {
            envoyer(dest, { type: 'webrtc', payload: webrtcMsg.payload });
          }
          return;
        }

        // Refus d'appel depuis le terrain
        if (msg.type === 'refus' && role === 'terrain' && numero) {
          const dest = backofficeSockets.get(numero);
          if (dest) {
            envoyer(dest, { type: 'refus' });
          }
          return;
        }

        // Raccrochage
        if (msg.type === 'hangup' && numero) {
          const dest = role === 'backoffice' ? terrainSockets.get(numero) : backofficeSockets.get(numero);
          if (dest) {
            envoyer(dest, { type: 'hangup' });
          }
          return;
        }
      });

      // Nettoyage à la déconnexion
      socket.on('close', () => {
        if (role === 'terrain' && numero && terrainSockets.get(numero) === socket) {
          terrainSockets.delete(numero);
          fastify.log.info(`[VIDEO-SIGNAL] DISCONNECT terrain: ${numero} | restants: ${terrainSockets.size}`);
        }
        if (role === 'backoffice' && numero && backofficeSockets.get(numero) === socket) {
          backofficeSockets.delete(numero);
          fastify.log.info(`[VIDEO-SIGNAL] DISCONNECT backoffice: ${numero} | restants: ${backofficeSockets.size}`);
        }
      });

      // Gestion des erreurs de socket
      socket.on('error', (err) => {
        fastify.log.error(`[VIDEO-SIGNAL] Socket error: ${err.message}`);
      });
    });
  });
}
