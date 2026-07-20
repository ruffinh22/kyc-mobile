import { FastifyInstance } from 'fastify';
import * as db from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { PlanningEntry } from '../types';

export async function planningRoutes(app: any): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // GET /api/planning/mon?debut=&fin=
  app.get('/api/planning/mon', async (req, reply) => {
    const q = req.query as Record<string, string>;
    if (!q.debut || !q.fin)
      return reply.code(400).send({ error: 'debut et fin requis (YYYY-MM-DD)' });
    const entrees = await db.getPlanningAgent(req.user.matricule, q.debut, q.fin);
    return reply.send({ success: true, count: entrees.length, entrees });
  });

  // GET /api/planning (sup/admin)
  app.get('/api/planning',
    { preHandler: requireRole(['superviseur', 'admin']) },
    async (req, reply) => {
      const q = req.query as Record<string, string>;
      const entrees = await db.getPlanningAll(q.debut || null, q.fin || null);
      return reply.send({ success: true, count: entrees.length, entrees });
    }
  );

  // POST /api/planning/import (sup/admin)
  app.post('/api/planning/import',
    { preHandler: requireRole(['superviseur', 'admin']) },
    async (req, reply) => {
      const body = req.body as { entrees?: PlanningEntry[] } | null;
      const entrees = body?.entrees;
      if (!Array.isArray(entrees) || entrees.length === 0)
        return reply.code(400).send({ error: 'entrees[] requis' });
      const count = await db.upsertPlanningEntries(entrees);
      db.audit(req.user.matricule, 'IMPORT_PLANNING', `${count} entrées`, req.ip);
      return reply.send({ success: true, count });
    }
  );

  // GET /api/planning-managers?semaine=
  app.get('/api/planning-managers',
    { preHandler: requireRole(['superviseur', 'admin']) },
    async (req, reply) => {
      const q = req.query as Record<string, string>;
      if (q.semaine) {
        const row = await db.getPlanningManager(q.semaine);
        if (!row) return reply.send({ success: true, data: null });
        const parsed = JSON.parse(row.data || '{}');
        return reply.send({ success: true, semaine: row.semaine, titre: row.titre, ...parsed });
      }
      const semaines = await db.listPlanningManagerSemaines();
      return reply.send({ success: true, semaines });
    }
  );

  // POST /api/planning-managers (sup/admin)
  app.post('/api/planning-managers',
    { preHandler: requireRole(['superviseur', 'admin']) },
    async (req, reply) => {
      const body = req.body as { semaine?: string; titre?: string; shifts?: unknown[] } | null;
      const semaine = body?.semaine ?? '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(semaine))
        return reply.code(400).send({ error: 'semaine invalide (YYYY-MM-DD)' });
      const titre = String(body?.titre ?? '');
      const shifts = Array.isArray(body?.shifts) ? body!.shifts : [];
      await db.upsertPlanningManager(semaine, titre, JSON.stringify({ titre, shifts }));
      db.audit(req.user.matricule, 'SAVE_PLANNING_MANAGER', semaine, req.ip);
      return reply.send({ success: true, semaine });
    }
  );
}
