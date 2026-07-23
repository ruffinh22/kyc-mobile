import { FastifyInstance } from 'fastify';
import * as db from '../db';
import { RowDataPacket } from 'mysql2';
import { requireAuth, requireRole } from '../middleware/auth';

export async function presenceRoutes(app: any): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // POST /api/presence/heartbeat - Simple: mark agent online
  app.post('/api/presence/heartbeat', async (req, reply) => {
    const now = db.nowSec();
    const matricule = req.user.matricule;
    await db.exec(
      'INSERT INTO `presence` (`matricule`, `statut`, `ts`, `updated_at`) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE `statut`=?, `ts`=?, `updated_at`=?',
      [matricule, 'online', now, now, 'online', now, now]
    );
    return reply.send({ success: true, ts: now });
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

  // POST /api/presence/pause - Toggle pause/resume
  app.post('/api/presence/pause', async (req, reply) => {
    const body = req.body as { action?: string } | null;
    const { action } = body || {};
    const matricule = req.user.matricule;
    const now = db.nowSec();

    if (action === 'pause') {
      // Return in-progress dossiers to queue
      await db.exec(
        `UPDATE dossiers SET statut='en_attente', agent_saisie=NULL, assigne_a=NULL,
         assigne_le=NULL, heure_prise=NULL, updated_at=?
         WHERE agent_saisie=? AND statut='en_cours'`,
        [now, matricule]
      );
      // Mark as pause
      await db.exec(
        `INSERT INTO presence (matricule, statut, ts, pause_debut, updated_at)
         VALUES (?, 'pause', ?, ?, ?)
         ON DUPLICATE KEY UPDATE
         statut='pause', ts=VALUES(ts), pause_debut=VALUES(pause_debut), updated_at=VALUES(updated_at)`,
        [matricule, now, now, now]
      );
      db.audit(matricule, 'AGENT_PAUSE', 'mise en pause', req.ip);
      // Redistribute immediately
      try {
        const { distribuerMaintenant } = await import('../utils/distribution.js');
        await distribuerMaintenant();
      } catch (e) {}
      return reply.send({ success: true, statut: 'pause' });
    } else if (action === 'reprendre') {
      // Resume: mark as online
      await db.exec(
        `INSERT INTO presence (matricule, statut, ts, pause_debut, updated_at)
         VALUES (?, 'online', ?, NULL, ?)
         ON DUPLICATE KEY UPDATE
         statut='online', ts=VALUES(ts), pause_debut=NULL, updated_at=VALUES(updated_at)`,
        [matricule, now, now]
      );
      db.audit(matricule, 'AGENT_REPRENDRE', 'reprise apres pause', req.ip);
      return reply.send({ success: true, statut: 'online' });
    } else {
      return reply.code(400).send({ error: 'Action invalide (pause|reprendre)' });
    }
  });

  // GET /api/presence/my-status
  app.get('/api/presence/my-status', async (req, reply) => {
    const rows = await db.query<{ statut: string; ts: number } & RowDataPacket>(
      'SELECT statut, ts FROM presence WHERE matricule=?',
      [req.user.matricule]
    );
    const row = rows.length ? rows[0] : null;
    const statut = row?.statut ?? 'offline';
    return reply.send({
      success: true,
      statut,
      ts: row?.ts ?? 0,
    });
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
