import { FastifyInstance } from 'fastify';
import * as db from '../db';
import { requireAuth, requireRole } from '../middleware/auth';

export async function configRoutes(app: any): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // GET /api/config/rejection-motifs
  app.get('/api/config/rejection-motifs', async (_req, reply) => {
    const motifs = await db.getRejectionMotifs();
    return reply.send({ success: true, motifs });
  });

  // PUT /api/config/rejection-motifs (agent/superviseur/admin)
  app.put('/api/config/rejection-motifs',
    { preHandler: requireRole(['agent', 'superviseur', 'admin']) },
    async (req, reply) => {
      const body = req.body as { motifs?: string[] } | null;
      if (!Array.isArray(body?.motifs)) {
        return reply.code(400).send({ error: 'Liste de motifs attendue' });
      }
      await db.setRejectionMotifs(body.motifs);
      const motifs = await db.getRejectionMotifs();
      db.audit(req.user.matricule, 'CONFIG_REJECTION_MOTIFS', `${motifs.length} motif(s)`, req.ip);
      return reply.send({ success: true, motifs });
    }
  );

  // GET /api/config/distribution-mode
  app.get('/api/config/distribution-mode', async (_req, reply) => {
    const mode = await db.getDistributionMode();
    return reply.send({ success: true, mode });
  });

  // PUT /api/config/distribution-mode (admin)
  app.put('/api/config/distribution-mode',
    { preHandler: requireRole(['admin']) },
    async (req, reply) => {
      const body = req.body as { mode?: string } | null;
      const mode = body?.mode;
      if (mode !== 'manuel' && mode !== 'auto')
        return reply.code(400).send({ error: 'mode invalide (manuel|auto)' });
      await db.setConfig('distribution_mode', mode);
      db.audit(req.user.matricule, 'CONFIG_DISTRIBUTION', mode, req.ip);
      return reply.send({ success: true, mode });
    }
  );

  // GET /api/config/seuil-alerte
  app.get('/api/config/seuil-alerte', async (_req, reply) => {
    const v = await db.getConfig('seuil_alerte');
    const seuil = parseInt(v ?? '5', 10);
    return reply.send({ success: true, seuil: isNaN(seuil) ? 5 : seuil });
  });

  // GET /api/config/distribution-timing
  app.get('/api/config/distribution-timing', async (_req, reply) => {
    const intervalMs = parseInt((await db.getConfig('distribution_interval_ms')) ?? '2000', 10);
    const abandonSec = parseInt((await db.getConfig('distribution_abandon_sec')) ?? '120', 10);
    return reply.send({ success: true, interval_ms: Number.isNaN(intervalMs) ? 2000 : intervalMs, abandon_sec: Number.isNaN(abandonSec) ? 120 : abandonSec });
  });

  // PUT /api/config/distribution-timing (admin)
  app.put('/api/config/distribution-timing',
    { preHandler: requireRole(['admin']) },
    async (req, reply) => {
      const body = req.body as { interval_ms?: number; abandon_sec?: number } | null;
      const intervalMs = parseInt(String(body?.interval_ms ?? ''), 10);
      const abandonSec = parseInt(String(body?.abandon_sec ?? ''), 10);
      if (isNaN(intervalMs) || intervalMs < 1000 || intervalMs > 60000) {
        return reply.code(400).send({ error: 'interval_ms invalide (1000-60000 ms)' });
      }
      if (isNaN(abandonSec) || abandonSec < 30 || abandonSec > 1800) {
        return reply.code(400).send({ error: 'abandon_sec invalide (30-1800 s)' });
      }
      await db.setConfig('distribution_interval_ms', String(intervalMs));
      await db.setConfig('distribution_abandon_sec', String(abandonSec));
      db.audit(req.user.matricule, 'CONFIG_DISTRIBUTION_TIMING', `interval_ms=${intervalMs} abandon_sec=${abandonSec}`, req.ip);
      return reply.send({ success: true, interval_ms: intervalMs, abandon_sec: abandonSec });
    }
  );

  // PUT /api/config/seuil-alerte (admin)
  app.put('/api/config/seuil-alerte',
    { preHandler: requireRole(['admin']) },
    async (req, reply) => {
      const body = req.body as { seuil?: number } | null;
      const n = parseInt(String(body?.seuil ?? ''), 10);
      if (isNaN(n) || n < 1 || n > 1440)
        return reply.code(400).send({ error: 'seuil invalide (1-1440 minutes)' });
      await db.setConfig('seuil_alerte', String(n));
      db.audit(req.user.matricule, 'CONFIG_SEUIL', String(n), req.ip);
      return reply.send({ success: true, seuil: n });
    }
  );

  // GET /api/config/referentiels-gsm
  app.get('/api/config/referentiels-gsm', async (_req, reply) => {
    const refs = await db.getReferentiels();
    return reply.send({ success: true, referentiels: refs });
  });

  // PUT /api/config/referentiels-gsm (admin)
  app.put('/api/config/referentiels-gsm',
    { preHandler: requireRole(['admin']) },
    async (req, reply) => {
      const body = req.body as Record<string, string[]> | null;
      if (!body || typeof body !== 'object')
        return reply.code(400).send({ error: 'Objet JSON attendu' });
      await db.setReferentiels(body);
      db.audit(req.user.matricule, 'CONFIG_REFERENTIELS_GSM', Object.keys(body).join(','), req.ip);
      return reply.send({ success: true });
    }
  );

  // GET /api/config/habilitations (admin)
  app.get('/api/config/habilitations',
    { preHandler: requireRole(['admin']) },
    async (_req, reply) => {
      const h = await db.getHabilitations();
      return reply.send({ success: true, habilitations: h });
    }
  );

  // PUT /api/config/habilitations (admin)
  app.put('/api/config/habilitations',
    { preHandler: requireRole(['admin']) },
    async (req, reply) => {
      const body = req.body as Record<string, Record<string, string>> | null;
      if (!body || typeof body !== 'object')
        return reply.code(400).send({ error: 'Objet JSON attendu' });
      await db.setHabilitations(body);
      db.audit(req.user.matricule, 'CONFIG_HABILITATIONS', Object.keys(body).join(','), req.ip);
      return reply.send({ success: true });
    }
  );

  // PUT /api/config/purge-code (admin)
  app.put('/api/config/purge-code',
    { preHandler: requireRole(['admin']) },
    async (req, reply) => {
      const body = req.body as { code?: string } | null;
      if (!body?.code || body.code.trim().length < 4)
        return reply.code(400).send({ error: 'Code minimum 4 caractères' });
      await db.setConfig('code_purge', body.code.trim());
      db.audit(req.user.matricule, 'CONFIG_PURGE_CODE', 'mis à jour', req.ip);
      return reply.send({ success: true });
    }
  );
}
