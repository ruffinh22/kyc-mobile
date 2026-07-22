// ============================================================================
// KYC V3 - Routes Superviseur : liste agents + transfert de dossier
// ============================================================================
// GET  /api/comptes/agents         - Liste des agents actifs (sup/admin)
// POST /api/dossiers/:id/transferer - Transfere un dossier a un agent (sup/admin)
// ============================================================================
'use strict';
const { db, audit } = require('../db');
const { requireAuth } = require('../middleware/auth');

// Verifie si un superviseur a le droit d'AGIR sur un menu (sinon lecture seule).
// Defaut : autorise (si aucune habilitation definie). Admin : toujours autorise (gere par l'appelant).
function peutAgir(matricule, menu) {
  try {
    const row = db.prepare("SELECT valeur FROM config WHERE cle='habilitations_sup'").get();
    if (!row) return true;
    const data = JSON.parse(row.valeur);
    const h = data[matricule];
    if (!h || h[menu] === undefined) return true;
    return h[menu] === 'complet';
  } catch (e) { return true; }
}

async function routes(fastify, opts) {
  fastify.addHook('preHandler', requireAuth);

  // Compilation GSM : toutes les saisies de l'equipe sur une plage (sup/admin)
  fastify.get('/api/gsm/compilation', async (request, reply) => {
    const { role } = request.user;
    if (role !== 'superviseur' && role !== 'admin') {
      return reply.code(403).send({ error: 'Acces refuse' });
    }
    const { debut, fin } = request.query || {};
    let sql = 'SELECT id, numero, agent_ctrl, date_saisie, heure_saisie, coach, type_id, ' +
      'constat, piece, verbatim, action, statut_final, traitement, raison, nom_client, ' +
      'capture_a, capture_p, capture_aa, dossier_id ' +
      'FROM gsm WHERE 1=1';
    const params = [];
    if (debut && /^\d{4}-\d{2}-\d{2}$/.test(debut)) { sql += ' AND date_saisie >= ?'; params.push(debut); }
    if (fin && /^\d{4}-\d{2}-\d{2}$/.test(fin)) { sql += ' AND date_saisie <= ?'; params.push(fin); }
    sql += ' ORDER BY date_saisie DESC, created_at DESC LIMIT 5000';
    try {
      const rows = db.prepare(sql).all(...params);
      return reply.send({ success: true, count: rows.length, saisies: rows });
    } catch (err) {
      fastify.log.error('GET /api/gsm/compilation error: ' + err.message);
      return reply.code(500).send({ error: 'Erreur serveur' });
    }
  });

  // Liste des agents actifs (pour le menu de transfert)
  fastify.get('/api/comptes/agents', async (request, reply) => {
    const { role } = request.user;
    if (role !== 'superviseur' && role !== 'admin') {
      return reply.code(403).send({ error: 'Acces refuse' });
    }
    try {
      const rows = db.prepare(
        "SELECT matricule, nom, prenom FROM comptes WHERE role = 'agent' AND actif = 1 ORDER BY prenom, nom"
      ).all();
      return reply.send({ success: true, count: rows.length, agents: rows });
    } catch (err) {
      fastify.log.error('GET /api/comptes/agents error: ' + err.message);
      return reply.code(500).send({ error: 'Erreur serveur' });
    }
  });

  // Transferer un dossier a un agent
  fastify.post('/api/dossiers/:id/transferer', async (request, reply) => {
    const { id } = request.params;
    const { matricule, role } = request.user;
    const ip = request.ip;
    const ua = request.headers['user-agent'] || '';
    const { agent, message } = request.body || {};

    if (role !== 'superviseur' && role !== 'admin') {
      return reply.code(403).send({ error: 'Reserve au superviseur' });
    }
    if (role === 'superviseur' && !peutAgir(matricule, 'file-attente')) {
      return reply.code(403).send({ error: 'Action non autorisee : acces en lecture seule sur File d\'attente' });
    }
    if (!agent) {
      return reply.code(400).send({ error: 'Agent destinataire obligatoire' });
    }

    try {
      // Verifier que l'agent existe et est actif
      const cible = db.prepare("SELECT matricule FROM comptes WHERE matricule = ? AND role = 'agent' AND actif = 1").get(agent);
      if (!cible) {
        return reply.code(404).send({ error: 'Agent introuvable ou inactif' });
      }

      const dossier = db.prepare('SELECT id, statut, numero_mtn FROM dossiers WHERE id = ?').get(id);
      if (!dossier) return reply.code(404).send({ error: 'Dossier introuvable' });
      if (dossier.statut !== 'en_attente') {
        return reply.code(409).send({ error: 'Seul un dossier en attente peut etre transfere (statut=' + dossier.statut + ')' });
      }

      const result = db.prepare(`
        UPDATE dossiers
        SET statut = 'en_cours',
            agent_saisie = ?,
            transfert_par = ?,
            transfert_message = ?,
            heure_prise = strftime('%H:%M','now','localtime'),
            updated_at = strftime('%s','now')
        WHERE id = ? AND statut = 'en_attente'
      `).run(agent, matricule, message || null, id);

      if (result.changes === 0) {
        return reply.code(409).send({ error: 'Dossier non disponible (deja pris/transfere)' });
      }

      audit(matricule, 'DOSSIER_TRANSFERT', 'id=' + id + ' vers=' + agent + ' numero=' + dossier.numero_mtn, ip, ua);
      return reply.send({ success: true, message: 'Dossier transfere a ' + agent });
    } catch (err) {
      fastify.log.error('POST transferer error: ' + err.message);
      return reply.code(500).send({ error: 'Erreur serveur', details: err.message });
    }
  });
}

module.exports = routes;
