import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as db from '../db';
import * as authUtil from '../utils/auth';
import { requireAuth, requireRole } from '../middleware/auth';
import { Role } from '../types';

const CreateCompteSchema = z.object({
  matricule: z.string().min(2).max(30),
  nom: z.string().min(1),
  prenom: z.string().default(''),
  role: z.enum(['agent', 'superviseur', 'admin']),
  password: z.string().min(6).optional(),
});

const UpdateCompteSchema = z.object({
  nom: z.string().min(1).optional(),
  prenom: z.string().optional(),
  role: z.enum(['agent', 'superviseur', 'admin']).optional(),
  actif: z.boolean().optional(),
  must_change_password: z.boolean().optional(),
});

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', requireRole(['admin']));

  // ── Comptes ──────────────────────────────────────────────────────────────

  app.get('/api/admin/comptes', async (_req, reply) => {
    const comptes = await db.getAllComptes();
    return reply.send({
      success: true, count: comptes.length,
      comptes: comptes.map(c => ({
        matricule: c.matricule, nom: c.nom, prenom: c.prenom,
        role: c.role, actif: !!c.actif, must_change_password: !!c.must_change_password,
        failed_login_count: c.failed_login_count,
        locked_until: c.locked_until,
        last_login_at: c.last_login_at,
        created_at: c.created_at,
      })),
    });
  });

  app.post('/api/admin/comptes', async (req, reply) => {
    const p = CreateCompteSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'Données invalides', details: p.error.issues.map(i => i.message) });
    const { matricule, nom, prenom, role, password } = p.data;
    const existing = await db.getCompteByMatricule(matricule.toUpperCase());
    if (existing) return reply.code(409).send({ error: 'Matricule déjà existant' });
    const plain = password || `KYC${matricule.toUpperCase()}#Init`;
    const hash  = await authUtil.hashPassword(plain);
    const id    = await db.createCompte({ matricule: matricule.toUpperCase(), nom, prenom, role: role as Role, password_hash: hash });
    db.audit(req.user.matricule, 'COMPTE_CREE', `id=${id} matricule=${matricule}`, req.ip);
    return reply.code(201).send({ success: true, id, matricule: matricule.toUpperCase(), password_initial: password ? undefined : plain });
  });

  app.put<{ Params: { matricule: string } }>('/api/admin/comptes/:matricule', async (req, reply) => {
    const p = UpdateCompteSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'Données invalides' });
    const target = req.params.matricule.toUpperCase();
    if (!await db.getCompteByMatricule(target)) return reply.code(404).send({ error: 'Compte introuvable' });
    await db.updateCompte(target, {
      nom: p.data.nom, prenom: p.data.prenom,
      role: p.data.role as Role | undefined,
      actif: p.data.actif !== undefined ? (p.data.actif ? 1 : 0) : undefined,
      must_change_password: p.data.must_change_password !== undefined ? (p.data.must_change_password ? 1 : 0) : undefined,
    });
    db.audit(req.user.matricule, 'COMPTE_MODIFIE', `matricule=${target}`, req.ip);
    return reply.send({ success: true });
  });

  app.post<{ Params: { matricule: string } }>('/api/admin/comptes/:matricule/reset-password', async (req, reply) => {
    const target = req.params.matricule.toUpperCase();
    if (!await db.getCompteByMatricule(target)) return reply.code(404).send({ error: 'Compte introuvable' });
    const body  = req.body as { new_password?: string } | null;
    const plain = body?.new_password || `KYC${target}#Reset`;
    const str   = authUtil.validatePassword(plain);
    if (!str.valid) return reply.code(400).send({ error: 'Mot de passe faible', details: str.errors });
    await db.updatePasswordHash(target, await authUtil.hashPassword(plain));
    await db.revokeAllSessions(target);
    db.audit(req.user.matricule, 'PASSWORD_RESET', `matricule=${target}`, req.ip);
    return reply.send({ success: true, password_initial: body?.new_password ? undefined : plain });
  });

  // ── Sessions ──────────────────────────────────────────────────────────────

  app.get('/api/admin/sessions', async (_req, reply) => {
    const sessions = await db.getAllActiveSessions();
    return reply.send({ success: true, count: sessions.length, sessions });
  });

  app.post<{ Params: { jti: string } }>('/api/admin/sessions/:jti/revoquer', async (req, reply) => {
    await db.revokeSession(req.params.jti);
    db.audit(req.user.matricule, 'SESSION_REVOQUEE', `jti=${req.params.jti}`, req.ip);
    return reply.send({ success: true });
  });

  // ── Audit ─────────────────────────────────────────────────────────────────

  app.get('/api/admin/audit', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const { rows, total } = await db.getAuditLogs({
      matricule: q.matricule || undefined,
      action: q.action || undefined,
      debut: q.debut ? Math.floor(new Date(q.debut).getTime() / 1000) : undefined,
      fin: q.fin ? Math.floor(new Date(q.fin + 'T23:59:59').getTime() / 1000) : undefined,
      limit: Math.min(parseInt(q.limit || '200', 10), 1000),
      offset: parseInt(q.offset || '0', 10),
    });
    return reply.send({ success: true, total, count: rows.length, logs: rows });
  });

  // ── Stats globales ────────────────────────────────────────────────────────

  app.get('/api/admin/stats', async (_req, reply) => {
    const today = new Date().toISOString().slice(0, 10);
    const [dossiers, presence, comptes, storage] = await Promise.all([
      db.getDossierStats(today),
      db.getPresenceResume(),
      db.getAllComptes(),
      db.getStorageStats(),
    ]);
    return reply.send({
      success: true,
      dossiers_today: dossiers,
      presence,
      comptes: {
        total: comptes.length,
        actifs: comptes.filter(c => c.actif).length,
        agents: comptes.filter(c => c.role === 'agent').length,
        superviseurs: comptes.filter(c => c.role === 'superviseur').length,
        admins: comptes.filter(c => c.role === 'admin').length,
      },
      storage,
    });
  });

  // ── Stockage ──────────────────────────────────────────────────────────────

  app.get('/api/admin/stockage', async (_req, reply) => {
    const stats = await db.getStorageStats();
    return reply.send({ success: true, ...stats });
  });

  // ── Purge ─────────────────────────────────────────────────────────────────

  app.post('/api/admin/purge/apercu', async (req, reply) => {
    const body = req.body as { action?: string; mode?: string; du?: string; au?: string } | null;
    if (!body?.action) return reply.code(400).send({ error: 'action requise' });
    const du = body.mode === 'periode' ? body.du : undefined;
    const au = body.mode === 'periode' ? body.au : undefined;
    const count = await db.purgeCount(body.action, du, au);
    return reply.send({ success: true, count });
  });

  app.post('/api/admin/purge/executer', async (req, reply) => {
    const body = req.body as { action?: string; code?: string; mode?: string; du?: string; au?: string } | null;
    if (!body?.action || !body.code) return reply.code(400).send({ error: 'action et code requis' });
    try {
      const du = body.mode === 'periode' ? body.du : undefined;
      const au = body.mode === 'periode' ? body.au : undefined;
      const result = await db.purgeExecute(body.action, body.code, du, au);
      db.audit(req.user.matricule, 'PURGE_EXEC', `action=${body.action} count=${result.count}`, req.ip);
      return reply.send({ success: true, ...result });
    } catch (err) {
      return reply.code(403).send({ error: err instanceof Error ? err.message : 'Erreur' });
    }
  });
}
