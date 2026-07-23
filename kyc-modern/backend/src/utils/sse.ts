// ============================================================================
// KYC V4 - Bus SSE (Server-Sent Events) pour notifications temps réel
// Adapté de kyc-v40 pour TypeScript + Fastify
// Registre : matricule -> Set de connexions (reply.raw). Un agent peut avoir
// plusieurs onglets ouverts, d'où un Set.
// ============================================================================

import { FastifyReply } from 'fastify';

type ClientConnection = {
  write: (data: string) => void;
  on: (event: string, handler: () => void) => void;
};

const clients = new Map<string, Set<ClientConnection>>();

function ajouter(matricule: string, res: ClientConnection): void {
  if (!clients.has(matricule)) clients.set(matricule, new Set());
  clients.get(matricule)!.add(res);
}

function retirer(matricule: string, res: ClientConnection): void {
  const set = clients.get(matricule);
  if (set) {
    set.delete(res);
    if (set.size === 0) clients.delete(matricule);
  }
}

// Envoie un événement nommé 'event' avec données JSON à un agent précis
function notifier(matricule: string, event: string, data: unknown): void {
  const set = clients.get(matricule);
  if (!set || set.size === 0) return;
  const payload = 'event: ' + (event || 'message') + '\n' +
                  'data: ' + JSON.stringify(data || {}) + '\n\n';
  for (const res of set) {
    try { res.write(payload); } catch (e) { /* connexion morte, nettoyée au close */ }
  }
}

// Heartbeat : commentaire SSE ':ping' sur toutes les connexions (garde-vivant)
function pingTous(): void {
  for (const set of clients.values()) {
    for (const res of set) {
      try { res.write(': ping\n\n'); } catch (e) {}
    }
  }
}

function nbConnexions(): number {
  let n = 0;
  for (const set of clients.values()) n += set.size;
  return n;
}

// Heartbeat global toutes les 20s
setInterval(pingTous, 20000);

export { ajouter, retirer, notifier, nbConnexions };
