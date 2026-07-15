import { FastifyRequest, FastifyReply } from 'fastify';
import * as authUtil from '../utils/auth';
import * as db from '../db';
import { Role } from '../types';

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization ?? '';
  let token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    token = (req.cookies as Record<string, string> | undefined)?.kyc_token ?? null;
  }
  // Fallback for media requests or dev convenience: allow token in query string
  if (!token) {
    try {
      const q = (req.query as Record<string, unknown>) || {};
      const qt = q['token'] ?? q['t'];
      if (typeof qt === 'string' && qt.trim()) token = qt.trim();
    } catch {
      /* ignore */
    }
  }
  if (!token) { reply.code(401).send({ error: 'Token manquant' }); return; }

  const decoded = authUtil.verifyToken(token);
  console.debug('[AUTH] verifyToken result', decoded ? { matricule: decoded.matricule, jti: decoded.jti } : null);
  if (!decoded)  { reply.code(401).send({ error: 'Token invalide ou expiré' }); return; }

  const valid = await db.isSessionValid(decoded.jti);
  console.debug('[AUTH] isSessionValid', decoded.jti, valid);
  if (!valid) { reply.code(401).send({ error: 'Session révoquée' }); return; }

  const compte = await db.getCompteByMatricule(decoded.matricule);
  if (!compte || !compte.actif) {
    reply.code(401).send({ error: 'Compte introuvable ou désactivé' }); return;
  }

  if (compte.must_change_password === 1 && req.url !== '/api/auth/change-password') {
    reply.code(403).send({ error: 'Changement de mot de passe obligatoire', must_change_password: true });
    return;
  }

  req.user = { matricule: compte.matricule, nom: compte.nom, prenom: compte.prenom, role: compte.role, jti: decoded.jti };
}

export function requireRole(roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!req.user || !roles.includes(req.user.role)) {
      reply.code(403).send({ error: `Accès refusé. Rôles requis: ${roles.join(', ')}` });
    }
  };
}

export function peutAgirSup(matricule: string, menu: string, habilitations: Record<string, Record<string, string>>): boolean {
  const h = habilitations[matricule];
  if (!h || h[menu] === undefined) return true;
  return h[menu] === 'complet';
}
