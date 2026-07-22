// ============================================================================
// KYC V3 - Routes Planning Manager (grille shift × jours, équipe restreinte)
// ============================================================================
// POST /api/planning-managers       - enregistre/écrase la grille d'une semaine
//   body: { semaine:'YYYY-MM-DD'(lundi), titre, shifts:[{vacation,horaire,cells:[7]}] }
// GET  /api/planning-managers?semaine=YYYY-MM-DD - grille d'une semaine
// GET  /api/planning-managers/semaines           - liste des semaines enregistrées
// ============================================================================
'use strict';
const { db, audit } = require('../db');
const { requireAuth } = require('../middleware/auth');

async function routes(fastify, opts) {
  fastify.addHook('preHandler', requireAuth);

  // Enregistrer (upsert par semaine)
  fastify.post('/api/planning-managers', async (request, reply) => {
    const { matricule, role } = request.user;
    const ip = request.ip;
    const ua = request.headers['user-agent'] || '';
    if (role !== 'superviseur' && role !== 'admin') {
      return reply.code(403).send({ error: 'Acces refuse' });
    }
    const body = request.body || {};
    const semaine = String(body.semaine || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(semaine)) {
      return reply.code(400).send({ error: 'Semaine invalide (format YYYY-MM-DD attendu)' });
    }
    const shifts = Array.isArray(body.shifts) ? body.shifts : [];
    const titre = String(body.titre || '');
    // Normalisation : chaque shift = {vacation, horaire, cells:[7 chaînes]}
    const clean = shifts.map(s => ({
      vacation: String(s.vacation || ''),
      horaire: String(s.horaire || ''),
      cells: Array.isArray(s.cells) ? s.cells.slice(0, 7).map(c => String(c || '')) : ['', '', '', '', '', '', '']
    }));
    while (clean.length === 0) clean.push({ vacation: '', horaire: '', cells: ['', '', '', '', '', '', ''] });
    const dataStr = JSON.stringify({ titre, shifts: clean });
    try {
      db.prepare(
        "INSERT INTO planning_managers (semaine, titre, data, updated_at) " +
        "VALUES (?, ?, ?, strftime('%s','now')) " +
        "ON CONFLICT(semaine) DO UPDATE SET titre=excluded.titre, data=excluded.data, updated_at=strftime('%s','now')"
      ).run(semaine, titre, dataStr);
      audit(matricule, 'SAVE_PLANNING_MANAGER', semaine + ' (' + clean.length + ' shifts)', ip, ua);
      return reply.send({ success: true, semaine: semaine, shifts: clean.length });
    } catch (err) {
      fastify.log.error('POST planning-managers error: ' + err.message);
      return reply.code(500).send({ error: 'Erreur serveur', details: err.message });
    }
  });

  // Grille d'une semaine
  fastify.get('/api/planning-managers', async (request, reply) => {
    const { semaine } = request.query || {};
    if (!semaine || !/^\d{4}-\d{2}-\d{2}$/.test(semaine)) {
      return reply.code(400).send({ error: 'Parametre semaine requis (YYYY-MM-DD)' });
    }
    try {
      const row = db.prepare('SELECT semaine, titre, data, updated_at FROM planning_managers WHERE semaine = ?').get(semaine);
      if (!row) return reply.send({ success: true, semaine: semaine, titre: '', shifts: null });
      let parsed = {};
      try { parsed = JSON.parse(row.data || '{}'); } catch (e) { parsed = {}; }
      return reply.send({
        success: true,
        semaine: row.semaine,
        titre: row.titre || (parsed.titre || ''),
        shifts: Array.isArray(parsed.shifts) ? parsed.shifts : null,
        updated_at: row.updated_at
      });
    } catch (err) {
      fastify.log.error('GET planning-managers error: ' + err.message);
      return reply.code(500).send({ error: 'Erreur serveur' });
    }
  });

  // Liste des semaines enregistrées
  fastify.get('/api/planning-managers/semaines', async (request, reply) => {
    try {
      const rows = db.prepare('SELECT semaine, titre, updated_at FROM planning_managers ORDER BY semaine DESC LIMIT 200').all();
      return reply.send({ success: true, count: rows.length, semaines: rows });
    } catch (err) {
      fastify.log.error('GET planning-managers/semaines error: ' + err.message);
      return reply.code(500).send({ error: 'Erreur serveur' });
    }
  });
}

module.exports = routes;
