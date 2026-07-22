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
}
