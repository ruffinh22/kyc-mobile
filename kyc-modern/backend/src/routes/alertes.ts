import { FastifyRequest, FastifyReply } from 'fastify';
import * as db from '../db';
import { requireRole } from '../middleware/auth';

export async function alertesRoutes(app: any): Promise<void> {
  // GET /api/alertes-traitement — non vues, les plus récentes en premier.
  // Sert au superviseur qui vient d'ouvrir la page (rattrape ce que le SSE
  // aurait manqué en son absence).
  app.get('/api/alertes-traitement',
    { preHandler: requireRole(['superviseur', 'admin']) },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const rows = await db.query(
        `SELECT * FROM alertes_traitement_long WHERE vue_le IS NULL ORDER BY cree_le DESC LIMIT 50`
      );
      return reply.send({ success: true, alertes: rows });
    }
  );

  // POST /api/alertes-traitement/:id/vue
  app.post('/api/alertes-traitement/:id/vue',
    { preHandler: requireRole(['superviseur', 'admin']) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      await db.exec(
        `UPDATE alertes_traitement_long SET vue_le=?, vue_par=? WHERE id=? AND vue_le IS NULL`,
        [db.nowSec(), req.user.matricule, id]
      );
      return reply.send({ success: true });
    }
  );
}
