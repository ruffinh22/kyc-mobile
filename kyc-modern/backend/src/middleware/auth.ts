import { FastifyRequest, FastifyReply } from 'fastify';
import * as authUtil from '../utils/auth';
import * as db from '../db';
import { Role } from '../types';

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization ?? '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) { reply.code(401).send({ error: 'Token manquant' }); return; }

  const decoded = authUtil.verifyToken(token);
  if (!decoded)  { reply.code(401).send({ error: 'Token invalide ou expiré' }); return; }

  const valid = await db.isSessionValid(decoded.jti);
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
