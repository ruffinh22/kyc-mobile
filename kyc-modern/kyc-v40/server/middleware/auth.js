// ============================================================================
// KYC V3 - Middleware d'authentification
// Verifie JWT + session valide, attache request.user
// ============================================================================

'use strict';

const auth = require('../utils/auth');
const db = require('../db');

/**
 * Middleware : exige un utilisateur authentifie
 * Utilisation : { preHandler: requireAuth } dans la route
 */
async function requireAuth(request, reply) {
  const authHeader = request.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

  if (!token) {
    return reply.code(401).send({ error: 'Token manquant' });
  }

  const decoded = auth.verifyToken(token);
  if (!decoded) {
    return reply.code(401).send({ error: 'Token invalide ou expire' });
  }

  if (!db.isSessionValid(decoded.jti)) {
    return reply.code(401).send({ error: 'Session revoquee' });
  }

  // Charger le compte
  const compte = db.getCompteByMatricule(decoded.matricule);
  if (!compte || !compte.actif) {
    return reply.code(401).send({ error: 'Compte introuvable ou desactive' });
  }

  // Si doit changer mot de passe, bloque tout sauf change-password
  if (compte.must_change_password === 1 && request.url !== '/api/auth/change-password') {
    return reply.code(403).send({
      error: 'Changement de mot de passe obligatoire',
      must_change_password: true
    });
  }

  // Attacher l'utilisateur au request pour les routes suivantes
  request.user = {
    matricule: compte.matricule,
    nom: compte.nom,
    prenom: compte.prenom,
    role: compte.role,
    jti: decoded.jti
  };
}

/**
 * Middleware : exige un role specifique
 * Utilisation : { preHandler: [requireAuth, requireRole(['admin'])] }
 */
function requireRole(roles) {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];
  return async function (request, reply) {
    if (!request.user) {
      return reply.code(401).send({ error: 'Non authentifie' });
    }
    if (!allowedRoles.includes(request.user.role)) {
      return reply.code(403).send({
        error: 'Acces refuse pour le role ' + request.user.role,
        roles_requis: allowedRoles
      });
    }
  };
}

module.exports = {
  requireAuth,
  requireRole
};
