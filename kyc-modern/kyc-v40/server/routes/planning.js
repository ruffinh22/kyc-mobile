// ============================================================================
// KYC V3 - Routes Planning
// ============================================================================
// POST /api/planning/import - enregistre un lot d'entrées planning (sup/admin)
//   body: { entrees: [ {...}, ... ] }  (déjà parsées côté client)
// GET  /api/planning        - liste (sup/admin ; filtres ?debut=&fin=)
// GET  /api/planning/mon    - planning de l'agent connecté (?debut=&fin=)
// ============================================================================
'use strict';
const { db, audit } = require('../db');
const { requireAuth } = require('../middleware/auth');

async function routes(fastify, opts) {
  fastify.addHook('preHandler', requireAuth);

  // Import d'un lot (upsert par id)
  fastify.post('/api/planning/import', async (request, reply) => {
    const { matricule, role } = request.user;
    const ip = request.ip;
    const ua = request.headers['user-agent'] || '';
    if (role !== 'superviseur' && role !== 'admin') {
      return reply.code(403).send({ error: 'Acces refuse' });
    }
    const body = request.body || {};
    const entrees = Array.isArray(body.entrees) ? body.entrees : null;
    if (!entrees || entrees.length === 0) {
      return reply.code(400).send({ error: 'Aucune entree a importer' });
    }
    const stmt = db.prepare(
      "INSERT INTO planning (id, matricule, nom, statut, quartier, date, type, horaire, " +
      "heure_debut, heure_fin, activite, lieu, updated_at) " +
      "VALUES (@id,@matricule,@nom,@statut,@quartier,@date,@type,@horaire," +
      "@heure_debut,@heure_fin,@activite,@lieu,strftime('%s','now')) " +
      "ON CONFLICT(id) DO UPDATE SET " +
      "matricule=excluded.matricule, nom=excluded.nom, statut=excluded.statut, quartier=excluded.quartier, " +
      "date=excluded.date, type=excluded.type, horaire=excluded.horaire, " +
      "heure_debut=excluded.heure_debut, heure_fin=excluded.heure_fin, " +
      "activite=excluded.activite, lieu=excluded.lieu, updated_at=strftime('%s','now')"
    );
    const norm = e => ({
      id: String(e.id || ''),
      matricule: String(e.matricule || ''),
      nom: String(e.nom || ''),
      statut: String(e.statut || ''),
      quartier: String(e.quartier || ''),
      date: String(e.date || ''),
      type: String(e.type || ''),
      horaire: String(e.horaire || ''),
      heure_debut: String(e.heure_debut || ''),
      heure_fin: String(e.heure_fin || ''),
      activite: String(e.activite || ''),
      lieu: String(e.lieu || '')
    });
    try {
      let ok = 0;
      const tx = db.transaction((arr) => {
        for (const e of arr) {
          if (!e.id || !e.date) continue;
          stmt.run(norm(e));
          ok++;
        }
      });
      tx(entrees);
      audit(matricule, 'IMPORT_PLANNING', ok + ' entrees', ip, ua);
      return reply.send({ success: true, count: ok });
    } catch (err) {
      fastify.log.error('POST planning/import error: ' + err.message);
      return reply.code(500).send({ error: 'Erreur serveur', details: err.message });
    }
  });

  // Liste (sup/admin)
  fastify.get('/api/planning', async (request, reply) => {
    const { role } = request.user;
    if (role !== 'superviseur' && role !== 'admin') {
      return reply.code(403).send({ error: 'Acces refuse' });
    }
    const { debut, fin } = request.query || {};
    let sql = 'SELECT * FROM planning WHERE 1=1';
    const params = [];
    if (debut && /^\d{4}-\d{2}-\d{2}$/.test(debut)) { sql += ' AND date >= ?'; params.push(debut); }
    if (fin && /^\d{4}-\d{2}-\d{2}$/.test(fin)) { sql += ' AND date <= ?'; params.push(fin); }
    sql += ' ORDER BY date DESC, nom ASC LIMIT 5000';
    try {
      const rows = db.prepare(sql).all(...params);
      return reply.send({ success: true, count: rows.length, entrees: rows });
    } catch (err) {
      fastify.log.error('GET planning error: ' + err.message);
      return reply.code(500).send({ error: 'Erreur serveur' });
    }
  });

  // Mon planning (agent connecté, matching souple : >=1 mot nom ET >=1 mot prénom)
  fastify.get('/api/planning/mon', async (request, reply) => {
    const u = request.user;
    const { debut, fin } = request.query || {};
    try {
      const compte = db.prepare('SELECT nom, prenom FROM comptes WHERE matricule = ?').get(u.matricule);
      if (!compte) return reply.send({ success: true, count: 0, entrees: [] });
      const motsDe = s => String(s || '')
        .toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
      const motsNomC = motsDe(compte.nom);
      const motsPrenomC = motsDe(compte.prenom);
      if (motsNomC.length === 0 && motsPrenomC.length === 0) {
        return reply.send({ success: true, count: 0, entrees: [] });
      }
      const matche = (nomFichier) => {
        const motsF = motsDe(nomFichier);
        const setF = new Set(motsF);
        const prenomsCommuns = motsPrenomC.filter(w => setF.has(w));
        const prenomCompletIdentique = motsPrenomC.length > 0 && motsPrenomC.every(w => setF.has(w));
        if (prenomCompletIdentique) return true;
        const nomProche = motsNomC.some(wc => motsF.some(wf => wc === wf || wc.includes(wf) || wf.includes(wc)));
        if (prenomsCommuns.length >= 2) return true;
        if (nomProche && prenomsCommuns.length >= 1) return true;
        return false;
      };
      let sql = 'SELECT * FROM planning WHERE 1=1';
      const params = [];
      if (debut && /^\d{4}-\d{2}-\d{2}$/.test(debut)) { sql += ' AND date >= ?'; params.push(debut); }
      if (fin && /^\d{4}-\d{2}-\d{2}$/.test(fin)) { sql += ' AND date <= ?'; params.push(fin); }
      sql += ' ORDER BY date ASC LIMIT 3000';
      const rows = db.prepare(sql).all(...params);
      const mes = rows.filter(r => matche(r.nom));
      return reply.send({ success: true, count: mes.length, entrees: mes });
    } catch (err) {
      fastify.log.error('GET planning/mon error: ' + err.message);
      return reply.code(500).send({ error: 'Erreur serveur' });
    }
  });
}

module.exports = routes;
