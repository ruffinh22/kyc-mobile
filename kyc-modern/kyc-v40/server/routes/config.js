// ============================================================================
// KYC V3 - Route Config (parametres globaux)
// ============================================================================
// GET /api/config/seuil-alerte - lit le seuil d'alerte file d'attente (minutes)
//   Accessible a tout utilisateur connecte (agent/sup/admin).
// PUT /api/config/seuil-alerte - modifie le seuil (admin uniquement)
//   Stocke dans la table config sous la cle 'seuil_alerte_minutes'.
// ============================================================================
'use strict';
const { db, audit } = require('../db');
const { requireAuth } = require('../middleware/auth');

const CLE = 'seuil_alerte_minutes';
const DEFAUT = 5;

function lireSeuil() {
  try {
    const row = db.prepare('SELECT valeur FROM config WHERE cle = ?').get(CLE);
    if (row && row.valeur != null) {
      const n = parseInt(row.valeur, 10);
      if (!isNaN(n) && n > 0) return n;
    }
  } catch (e) {}
  return DEFAUT;
}

async function routes(fastify, opts) {
  fastify.addHook('preHandler', requireAuth);

  fastify.get('/api/config/seuil-alerte', async (request, reply) => {
    return reply.send({ success: true, seuil: lireSeuil() });
  });

  fastify.put('/api/config/seuil-alerte', async (request, reply) => {
    const { matricule, role } = request.user;
    const ip = request.ip;
    const ua = request.headers['user-agent'] || '';
    if (role !== 'admin') {
      return reply.code(403).send({ error: 'Reserve a l\'administrateur' });
    }
    const { seuil } = request.body || {};
    const n = parseInt(seuil, 10);
    if (isNaN(n) || n < 1 || n > 1440) {
      return reply.code(400).send({ error: 'Seuil invalide (1 a 1440 minutes)' });
    }
    try {
      db.prepare(
        "INSERT INTO config (cle, valeur, updated_at) VALUES (?, ?, strftime('%s','now')) " +
        "ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur, updated_at = strftime('%s','now')"
      ).run(CLE, String(n));
      audit(matricule, 'CONFIG_SEUIL_ALERTE', 'seuil=' + n, ip, ua);
      return reply.send({ success: true, seuil: n });
    } catch (err) {
      fastify.log.error('PUT seuil-alerte error: ' + err.message);
      return reply.code(500).send({ error: 'Erreur serveur' });
    }
  });

  // --------------------------------------------------------------------------
  // Distribution des dossiers : 'manuel' ou 'auto'
  // --------------------------------------------------------------------------
  fastify.get('/api/config/distribution-mode', async (request, reply) => {
    let mode = 'manuel';
    try {
      const row = db.prepare("SELECT valeur FROM config WHERE cle = 'distribution_mode'").get();
      if (row && (row.valeur === 'auto' || row.valeur === 'manuel')) mode = row.valeur;
    } catch (e) {}
    return reply.send({ success: true, mode: mode });
  });

  fastify.put('/api/config/distribution-mode', async (request, reply) => {
    const { matricule, role } = request.user;
    const ip = request.ip;
    const ua = request.headers['user-agent'] || '';
    if (role !== 'admin') {
      return reply.code(403).send({ error: 'Reserve a l\'administrateur' });
    }
    const { mode } = request.body || {};
    if (mode !== 'manuel' && mode !== 'auto') {
      return reply.code(400).send({ error: 'Mode invalide (manuel ou auto)' });
    }
    try {
      db.prepare(
        "INSERT INTO config (cle, valeur, updated_at) VALUES ('distribution_mode', ?, strftime('%s','now')) " +
        "ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur, updated_at = strftime('%s','now')"
      ).run(mode);
      audit(matricule, 'CONFIG_DISTRIBUTION_MODE', 'mode=' + mode, ip, ua);
      return reply.send({ success: true, mode: mode });
    } catch (err) {
      fastify.log.error('PUT distribution-mode error: ' + err.message);
      return reply.code(500).send({ error: 'Erreur serveur' });
    }
  });

}

module.exports = routes;
