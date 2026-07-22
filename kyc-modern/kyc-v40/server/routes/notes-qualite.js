// ============================================================================
// KYC V3 - Routes Notes Qualité
// ============================================================================
// POST /api/notes-qualite/import  - enregistre un lot de notes (sup/admin)
//   body: { notes: [ {...}, ... ] }  (notes déjà parsées côté client)
// GET  /api/notes-qualite          - liste les notes (sup/admin : toutes ;
//   filtres optionnels ?mois=&annee=&campagne=)
// GET  /api/notes-qualite/mes      - notes de l'agent connecté (par nom)
// ============================================================================
'use strict';
const { db, audit } = require('../db');
const { requireAuth } = require('../middleware/auth');

async function routes(fastify, opts) {
  fastify.addHook('preHandler', requireAuth);

  // Import d'un lot de notes (upsert par id)
  fastify.post('/api/notes-qualite/import', async (request, reply) => {
    const { matricule, role } = request.user;
    const ip = request.ip;
    const ua = request.headers['user-agent'] || '';
    if (role !== 'superviseur' && role !== 'admin') {
      return reply.code(403).send({ error: 'Acces refuse' });
    }
    const body = request.body || {};
    const notes = Array.isArray(body.notes) ? body.notes : null;
    if (!notes || notes.length === 0) {
      return reply.code(400).send({ error: 'Aucune note a importer' });
    }
    const stmt = db.prepare(
      "INSERT INTO notes_qualite (id, matricule, nom, statut, campagne, equipe, mois, annee, " +
      "note_w1, note_w2, note_w3, note_w4, statut_w1, statut_w2, statut_w3, statut_w4, " +
      "commentaire_w4, moyenne, tl, backup, updated_at) " +
      "VALUES (@id,@matricule,@nom,@statut,@campagne,@equipe,@mois,@annee," +
      "@note_w1,@note_w2,@note_w3,@note_w4,@statut_w1,@statut_w2,@statut_w3,@statut_w4," +
      "@commentaire_w4,@moyenne,@tl,@backup,strftime('%s','now')) " +
      "ON CONFLICT(id) DO UPDATE SET " +
      "matricule=excluded.matricule, nom=excluded.nom, statut=excluded.statut, campagne=excluded.campagne, " +
      "equipe=excluded.equipe, mois=excluded.mois, annee=excluded.annee, " +
      "note_w1=excluded.note_w1, note_w2=excluded.note_w2, note_w3=excluded.note_w3, note_w4=excluded.note_w4, " +
      "statut_w1=excluded.statut_w1, statut_w2=excluded.statut_w2, statut_w3=excluded.statut_w3, statut_w4=excluded.statut_w4, " +
      "commentaire_w4=excluded.commentaire_w4, moyenne=excluded.moyenne, tl=excluded.tl, backup=excluded.backup, " +
      "updated_at=strftime('%s','now')"
    );
    const norm = n => ({
      id: String(n.id || ''),
      matricule: String(n.matricule || ''),
      nom: String(n.nom || ''),
      statut: String(n.statut || ''),
      campagne: String(n.campagne || ''),
      equipe: String(n.equipe || ''),
      mois: parseInt(n.mois, 10) || 0,
      annee: parseInt(n.annee, 10) || 0,
      note_w1: (n.note_w1 === null || n.note_w1 === undefined) ? null : Number(n.note_w1),
      note_w2: (n.note_w2 === null || n.note_w2 === undefined) ? null : Number(n.note_w2),
      note_w3: (n.note_w3 === null || n.note_w3 === undefined) ? null : Number(n.note_w3),
      note_w4: (n.note_w4 === null || n.note_w4 === undefined) ? null : Number(n.note_w4),
      statut_w1: n.statut_w1 || null,
      statut_w2: n.statut_w2 || null,
      statut_w3: n.statut_w3 || null,
      statut_w4: n.statut_w4 || null,
      commentaire_w4: n.commentaire_w4 || null,
      moyenne: (n.moyenne === null || n.moyenne === undefined) ? null : Number(n.moyenne),
      tl: n.tl || null,
      backup: n.backup || null
    });
    try {
      let ok = 0;
      const tx = db.transaction((arr) => {
        for (const n of arr) {
          if (!n.id) continue;
          stmt.run(norm(n));
          ok++;
        }
      });
      tx(notes);
      audit(matricule, 'IMPORT_NOTES_QUALITE', ok + ' notes', ip, ua);
      return reply.send({ success: true, count: ok });
    } catch (err) {
      fastify.log.error('POST notes-qualite/import error: ' + err.message);
      return reply.code(500).send({ error: 'Erreur serveur', details: err.message });
    }
  });

  // Liste (sup/admin)
  fastify.get('/api/notes-qualite', async (request, reply) => {
    const { role } = request.user;
    if (role !== 'superviseur' && role !== 'admin') {
      return reply.code(403).send({ error: 'Acces refuse' });
    }
    const { mois, annee, campagne } = request.query || {};
    let sql = 'SELECT * FROM notes_qualite WHERE 1=1';
    const params = [];
    if (mois) { sql += ' AND mois = ?'; params.push(parseInt(mois, 10)); }
    if (annee) { sql += ' AND annee = ?'; params.push(parseInt(annee, 10)); }
    if (campagne) { sql += ' AND campagne = ?'; params.push(campagne); }
    sql += ' ORDER BY annee DESC, mois DESC, nom ASC LIMIT 2000';
    try {
      const rows = db.prepare(sql).all(...params);
      return reply.send({ success: true, count: rows.length, notes: rows });
    } catch (err) {
      fastify.log.error('GET notes-qualite error: ' + err.message);
      return reply.code(500).send({ error: 'Erreur serveur' });
    }
  });

  // Notes de l'agent connecté (matching souple : >=1 mot nom ET >=1 mot prénom)
  fastify.get('/api/notes-qualite/mes', async (request, reply) => {
    const u = request.user;
    try {
      const compte = db.prepare('SELECT nom, prenom FROM comptes WHERE matricule = ?').get(u.matricule);
      if (!compte) return reply.send({ success: true, count: 0, notes: [] });
      const motsDe = s => String(s || '')
        .toUpperCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // retire accents
        .replace(/[^A-Z0-9 ]/g, ' ')
        .split(/\s+/).filter(w => w.length >= 2);
      const motsNomC = motsDe(compte.nom);
      const motsPrenomC = motsDe(compte.prenom);
      if (motsNomC.length === 0 && motsPrenomC.length === 0) {
        return reply.send({ success: true, count: 0, notes: [] });
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
      const rows = db.prepare('SELECT * FROM notes_qualite ORDER BY annee DESC, mois DESC LIMIT 3000').all();
      const mes = rows.filter(r => matche(r.nom));
      return reply.send({ success: true, count: mes.length, notes: mes });
    } catch (err) {
      fastify.log.error('GET notes-qualite/mes error: ' + err.message);
      return reply.code(500).send({ error: 'Erreur serveur' });
    }
  });
}

module.exports = routes;
