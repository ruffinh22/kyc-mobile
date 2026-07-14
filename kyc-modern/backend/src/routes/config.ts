import { FastifyInstance } from 'fastify';
import * as db from '../db';
import { requireAuth, requireRole } from '../middleware/auth';

export async function configRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

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
