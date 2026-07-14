import { FastifyInstance } from 'fastify';
import * as db from '../db';
import { requireAuth, requireRole } from '../middleware/auth';

export async function supFileRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', requireRole(['superviseur', 'admin']));

  // GET /api/comptes/agents
  app.get('/api/comptes/agents', async (_req, reply) => {
    const agents = await db.getComptesByRole('agent');
    return reply.send({
      success: true,
      count: agents.length,
      agents: agents.map(a => ({ matricule: a.matricule, nom: a.nom, prenom: a.prenom })),
    });
  });

  // GET /api/comptes/superviseurs
  app.get('/api/comptes/superviseurs', async (_req, reply) => {
    const sups = await db.getComptesByRole('superviseur');
    return reply.send({
      success: true,
      count: sups.length,
      superviseurs: sups.map(s => ({ matricule: s.matricule, nom: s.nom, prenom: s.prenom })),
    });
  });

  // GET /api/sup/file-attente — vue complète pour superviseur (inclut en_cours avec agents)
  app.get('/api/sup/file-attente', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const { rows, total } = await db.getDossiers({
      date: q.date || new Date().toISOString().slice(0, 10),
      statut: q.statut || null,
      limit: 500,
    });
    return reply.send({ success: true, total, dossiers: rows });
  });

  // GET /api/sup/donnees-heures — stats par heure du jour
  app.get('/api/sup/donnees-heures', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const date = q.date || new Date().toISOString().slice(0, 10);
    const { rows } = await db.getDossiers({ date, limit: 2000 });

    // Agréger par heure de réception
    const parHeure: Record<string, { total: number; accepte: number; rejete: number; en_cours: number }> = {};
    for (const d of rows) {
      const h = d.heure_reception?.slice(0, 2) ?? '??';
      if (!parHeure[h]) parHeure[h] = { total: 0, accepte: 0, rejete: 0, en_cours: 0 };
      parHeure[h].total++;
      if (d.statut === 'accepte') parHeure[h].accepte++;
      else if (d.statut === 'rejete') parHeure[h].rejete++;
      else if (d.statut === 'en_cours') parHeure[h].en_cours++;
    }

    const heures = Object.entries(parHeure)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([heure, stats]) => ({ heure, ...stats }));

    return reply.send({ success: true, date, heures });
  });

  // GET /api/sup/performance — stats de performance par agent sur une plage
  app.get('/api/sup/performance', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const debut = q.debut || new Date().toISOString().slice(0, 10);
    const fin   = q.fin   || debut;

    const { rows } = await db.getDossiers({ debut, fin, limit: 5000 });
    const parAgent: Record<string, { total: number; accepte: number; rejete: number; en_cours: number }> = {};
    for (const d of rows) {
      const a = d.agent_saisie ?? 'non-attribué';
      if (!parAgent[a]) parAgent[a] = { total: 0, accepte: 0, rejete: 0, en_cours: 0 };
      parAgent[a].total++;
      if (d.statut === 'accepte') parAgent[a].accepte++;
      else if (d.statut === 'rejete') parAgent[a].rejete++;
      else if (d.statut === 'en_cours') parAgent[a].en_cours++;
    }

    const agents = Object.entries(parAgent).map(([matricule, stats]) => ({ matricule, ...stats }));
    return reply.send({ success: true, debut, fin, agents });
  });
}
