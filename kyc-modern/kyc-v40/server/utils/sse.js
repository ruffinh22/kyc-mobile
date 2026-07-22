// ============================================================================
// KYC V3 - Bus SSE (Server-Sent Events) pour notifications temps reel
// Registre : matricule -> Set de connexions (reply.raw). Un agent peut avoir
// plusieurs onglets ouverts, d'ou un Set.
// ============================================================================
'use strict';

const clients = new Map(); // matricule -> Set<res>

function ajouter(matricule, res) {
  if (!clients.has(matricule)) clients.set(matricule, new Set());
  clients.get(matricule).add(res);
}

function retirer(matricule, res) {
  const set = clients.get(matricule);
  if (set) {
    set.delete(res);
    if (set.size === 0) clients.delete(matricule);
  }
}

// Envoie un evenement nomme 'event' avec donnees JSON a un agent precis
function notifier(matricule, event, data) {
  const set = clients.get(matricule);
  if (!set || set.size === 0) return;
  const payload = 'event: ' + (event || 'message') + '\n' +
                  'data: ' + JSON.stringify(data || {}) + '\n\n';
  for (const res of set) {
    try { res.write(payload); } catch (e) { /* connexion morte, nettoyee au close */ }
  }
}

// Heartbeat : commentaire SSE ':ping' sur toutes les connexions (garde-vivant)
function pingTous() {
  for (const set of clients.values()) {
    for (const res of set) {
      try { res.write(': ping\n\n'); } catch (e) {}
    }
  }
}

function nbConnexions() {
  let n = 0;
  for (const set of clients.values()) n += set.size;
  return n;
}

// Heartbeat global toutes les 20s
setInterval(pingTous, 20000);

module.exports = { ajouter, retirer, notifier, nbConnexions };
