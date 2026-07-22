// ============================================================================
// KYC V3 - Route Tableau de bord Agent
// ============================================================================
// GET /api/gsm/mon-tableau - Compteurs (total, aujourd'hui, 7 jours, mois de
//   paie) + 5 dernieres saisies, pour l'agent connecte.
//   Source : table gsm filtree sur agent_ctrl = matricule.
//   Mois de paie : du 15 d'un mois au 14 du mois suivant (libelle = mois de fin).
// ============================================================================
'use strict';
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');

async function routes(fastify, opts) {
  fastify.addHook('preHandler', requireAuth);

  fastify.get('/api/gsm/mon-tableau', async (request, reply) => {
    const { matricule } = request.user;

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

    const aujourdhui = ymd(now);

    // 7 derniers jours (aujourd'hui inclus)
    const ilYa7 = new Date(now);
    ilYa7.setDate(ilYa7.getDate() - 6);
    const debut7 = ymd(ilYa7);

    // Mois de paie : 15 -> 14 du mois suivant
    let debutPaie, finPaie;
    if (now.getDate() >= 15) {
      debutPaie = new Date(now.getFullYear(), now.getMonth(), 15);
      finPaie = new Date(now.getFullYear(), now.getMonth() + 1, 14);
    } else {
      debutPaie = new Date(now.getFullYear(), now.getMonth() - 1, 15);
      finPaie = new Date(now.getFullYear(), now.getMonth(), 14);
    }
    const debutPaieStr = ymd(debutPaie);
    const finPaieStr = ymd(finPaie);
    const moisNoms = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
    const libelleMoisPaie = moisNoms[finPaie.getMonth()] + ' ' + finPaie.getFullYear();

    try {
      const compter = (cond, params) => {
        const row = db.prepare('SELECT COUNT(*) AS n FROM gsm WHERE agent_ctrl = ?' + cond).get(matricule, ...params);
        return row ? row.n : 0;
      };

      const total = compter('', []);
      const aujourdhuiN = compter(' AND date_saisie = ?', [aujourdhui]);
      const septJours = compter(' AND date_saisie >= ? AND date_saisie <= ?', [debut7, aujourdhui]);
      const moisPaie = compter(' AND date_saisie >= ? AND date_saisie <= ?', [debutPaieStr, finPaieStr]);

      const dernieres = db.prepare(
        'SELECT id, numero, date_saisie, constat, statut_final ' +
        'FROM gsm WHERE agent_ctrl = ? ORDER BY created_at DESC LIMIT 5'
      ).all(matricule);

      return reply.send({
        success: true,
        compteurs: { total, aujourdhui: aujourdhuiN, sept_jours: septJours, mois_paie: moisPaie },
        mois_paie_libelle: libelleMoisPaie,
        mois_paie_periode: { debut: debutPaieStr, fin: finPaieStr },
        dernieres
      });
    } catch (err) {
      fastify.log.error('GET /api/gsm/mon-tableau error: ' + err.message);
      return reply.code(500).send({ error: 'Erreur serveur' });
    }
  });
}

module.exports = routes;
