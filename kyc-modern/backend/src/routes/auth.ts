import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as db from '../db';
import * as authUtil from '../utils/auth';
import { requireAuth } from '../middleware/auth';

const LOCK_FAILS = parseInt(process.env.ACCOUNT_LOCK_AFTER_FAILS || '5', 10);
const LOCK_DUR   = parseInt(process.env.ACCOUNT_LOCK_DURATION    || '900', 10);

export async function authRoutes(app: FastifyInstance): Promise<void> {

  // POST /api/auth/login
  app.post('/api/auth/login', {
    config: { rateLimit: { max: parseInt(process.env.RATE_LIMIT_LOGIN_MAX||'5',10), timeWindow: parseInt(process.env.RATE_LIMIT_LOGIN_WINDOW||'60000',10) } }
  }, async (req, reply) => {
    const ip = req.ip ?? 'unknown';
    const ua = req.headers['user-agent'] ?? '';
    const b = z.object({ matricule: z.string().min(2).max(30), password: z.string().min(1) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Matricule et mot de passe obligatoires' });
    const { matricule, password } = b.data;
    const compte = await db.getCompteByMatricule(matricule.toUpperCase());
    if (!compte) { db.audit(matricule,'LOGIN_FAIL','matricule inconnu',ip,ua); return reply.code(401).send({ error: 'Identifiants invalides' }); }
    if (!compte.actif) return reply.code(403).send({ error: 'Compte désactivé' });
    const now = Math.floor(Date.now()/1000);
    if (compte.locked_until && compte.locked_until > now) {
      return reply.code(423).send({ error: `Compte verrouillé. Réessayez dans ${Math.ceil((compte.locked_until-now)/60)} min.` });
    }
    const ok = await authUtil.verifyPassword(password, compte.password_hash);
    if (!ok) {
      await db.incrementFailedLogin(compte.matricule);
      const fails = (compte.failed_login_count||0)+1;
      if (fails >= LOCK_FAILS) {
        await db.lockAccount(compte.matricule, LOCK_DUR);
        db.audit(matricule,'ACCOUNT_LOCKED',`${fails} échecs`,ip,ua);
        return reply.code(423).send({ error: `Compte verrouillé ${Math.ceil(LOCK_DUR/60)} min.` });
      }
      return reply.code(401).send({ error: 'Identifiants invalides', tentatives_restantes: LOCK_FAILS - fails });
    }
    await db.resetFailedLogin(compte.matricule);
    const jti = authUtil.generateJti();
    const token = authUtil.signToken({ matricule: compte.matricule, role: compte.role, jti });
    await db.revokeAllSessions(compte.matricule);
    await db.insertSession(jti, compte.matricule, ip, ua, authUtil.getExpiresAt());
    db.audit(compte.matricule,'LOGIN_SUCCESS',`role=${compte.role}`,ip,ua);
    return reply.send({ success: true, token, must_change_password: compte.must_change_password===1,
      user: { matricule: compte.matricule, nom: compte.nom, prenom: compte.prenom, role: compte.role } });
  });

  // POST /api/auth/logout
  app.post('/api/auth/logout', async (req, reply) => {
    const token = (req.headers.authorization??'').replace('Bearer ','');
    if (token) { const d = authUtil.verifyToken(token); if (d?.jti) { await db.revokeSession(d.jti); db.audit(d.matricule,'LOGOUT','',req.ip); } }
    return reply.send({ success: true });
  });

  // POST /api/auth/change-password
  app.post('/api/auth/change-password', { preHandler: requireAuth }, async (req, reply) => {
    const b = z.object({ current_password: z.string().min(1), new_password: z.string().min(6) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Données invalides' });
    const { current_password, new_password } = b.data;
    const compte = await db.getCompteByMatricule(req.user.matricule);
    if (!compte) return reply.code(404).send({ error: 'Compte introuvable' });
    if (!(await authUtil.verifyPassword(current_password, compte.password_hash)))
      return reply.code(401).send({ error: 'Mot de passe actuel incorrect' });
    const str = authUtil.validatePassword(new_password);
    if (!str.valid) return reply.code(400).send({ error: 'Mot de passe faible', details: str.errors });
    if (await authUtil.verifyPassword(new_password, compte.password_hash))
      return reply.code(400).send({ error: "Le nouveau mot de passe doit être différent de l'ancien" });
    await db.updatePasswordHash(compte.matricule, await authUtil.hashPassword(new_password));
    db.audit(compte.matricule,'PASSWORD_CHANGED','',req.ip);
    return reply.send({ success: true });
  });

  // GET /api/auth/me
  app.get('/api/auth/me', { preHandler: requireAuth }, async (req, reply) => {
    const compte = await db.getCompteByMatricule(req.user.matricule);
    if (!compte || !compte.actif) return reply.code(404).send({ error: 'Compte introuvable' });
    return reply.send({ success: true, user: { matricule: compte.matricule, nom: compte.nom, prenom: compte.prenom, role: compte.role, must_change_password: compte.must_change_password===1 } });
  });
}
