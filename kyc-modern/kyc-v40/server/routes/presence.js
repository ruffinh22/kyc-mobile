// ============================================================================
// KYC V3 - Route Presence (resume en ligne / pause)
// ============================================================================
// GET /api/presence/resume - compte agents en ligne et en pause (sup/admin)
//   En ligne = statut 'online' ET heartbeat (ts) < 2 minutes.
//   En pause = statut 'pause' ET heartbeat < 2 minutes.
// ============================================================================
'use strict';
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');

const FRAICHEUR = 120; // secondes

async function routes(fastify, opts) {
  fastify.addHook('preHandler', requireAuth);

  fastify.get('/api/presence/resume', async (request, reply) => {
    const { role } = request.user;
    if (role !== 'superviseur' && role !== 'admin') {
      return reply.code(403).send({ error: 'Acces refuse' });
    }
    try {
      const limite = Math.floor(Date.now() / 1000) - FRAICHEUR;
      const enLigne = db.prepare("SELECT COUNT(*) AS n FROM presence WHERE statut = 'online' AND ts >= ?").get(limite);
      const enPause = db.prepare("SELECT COUNT(*) AS n FROM presence WHERE statut = 'pause' AND ts >= ?").get(limite);
      // Detail : matricule -> actif (online OU pause, heartbeat recent)
      const actifs = db.prepare("SELECT nom AS matricule, statut FROM presence WHERE statut IN ('online','pause') AND ts >= ?").all(limite);
      const detail = {};
      for (const a of actifs) detail[a.matricule] = a.statut;
      return reply.send({
        success: true,
        en_ligne: enLigne ? enLigne.n : 0,
        en_pause: enPause ? enPause.n : 0,
        detail: detail
      });
    } catch (err) {
      fastify.log.error('GET /api/presence/resume error: ' + err.message);
      return reply.code(500).send({ error: 'Erreur serveur' });
    }
  });
}

module.exports = routes;
