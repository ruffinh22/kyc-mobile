import { FastifyInstance } from 'fastify';
import * as db from '../db';
import { requireAuth, requireRole } from '../middleware/auth';

export async function presenceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // POST /api/presence/heartbeat
  app.post('/api/presence/heartbeat', async (req, reply) => {
    await db.upsertPresence(req.user.matricule, 'online');
    return reply.send({ success: true, ts: Math.floor(Date.now() / 1000) });
  });

  // POST /api/presence/statut
  app.post('/api/presence/statut', async (req, reply) => {
    const body = req.body as { statut?: string } | null;
    const statut = body?.statut;
    if (!['online', 'pause', 'offline'].includes(statut ?? ''))
      return reply.code(400).send({ error: 'statut invalide (online|pause|offline)' });
    await db.upsertPresence(req.user.matricule, statut as 'online' | 'pause' | 'offline');
    return reply.send({ success: true, statut });
  });

  // GET /api/presence/resume (sup/admin)
  app.get('/api/presence/resume',
    { preHandler: requireRole(['superviseur', 'admin']) },
    async (_req, reply) => {
      const resume = await db.getPresenceResume();
      return reply.send({ success: true, ...resume });
    }
  );

  // GET /api/presence/detail (sup/admin)
  app.get('/api/presence/detail',
    { preHandler: requireRole(['superviseur', 'admin']) },
    async (_req, reply) => {
      const rows = await db.getPresenceAll();
      return reply.send({ success: true, agents: rows });
    }
  );
}
