// ============================================================================
// KYC V3 - Utilitaires d'authentification
// Hash/compare bcrypt, generation/verification JWT, validation mots de passe
// ============================================================================

'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
const BCRYPT_COST = parseInt(process.env.BCRYPT_COST || '12', 10);
const PASSWORD_MIN_LENGTH = parseInt(process.env.PASSWORD_MIN_LENGTH || '8', 10);

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('[AUTH] ERREUR FATALE : JWT_SECRET manquant ou trop court');
  process.exit(1);
}

async function hashPassword(plain) {
  if (!plain || typeof plain !== 'string') {
    throw new Error('Mot de passe invalide');
  }
  return bcrypt.hash(plain, BCRYPT_COST);
}

async function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch (err) {
    return false;
  }
}

function generateJti() {
  return crypto.randomBytes(16).toString('hex');
}

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
    algorithm: 'HS256'
  });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    return null;
  }
}

function validatePasswordStrength(password) {
  const errors = [];

  if (!password || typeof password !== 'string') {
    return { valid: false, errors: ['Mot de passe obligatoire'] };
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    errors.push('Au moins ' + PASSWORD_MIN_LENGTH + ' caracteres');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Au moins une lettre minuscule');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Au moins une lettre majuscule');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Au moins un chiffre');
  }

  const commonPasswords = [
    'password', 'motdepasse', 'azerty', 'qwerty', '12345678',
    'password1', 'admin', 'admin123', 'media-2017', 'media2017'
  ];
  if (commonPasswords.includes(password.toLowerCase())) {
    errors.push('Mot de passe trop commun');
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

function validateMatricule(matricule) {
  if (!matricule || typeof matricule !== 'string') return false;
  return /^[A-Z0-9]{2,30}$/.test(matricule.toUpperCase());
}

function getExpiresAtTimestamp() {
  const unit = JWT_EXPIRES_IN.slice(-1);
  const val = parseInt(JWT_EXPIRES_IN.slice(0, -1), 10);
  let seconds = 8 * 3600;
  if (unit === 'h') seconds = val * 3600;
  else if (unit === 'm') seconds = val * 60;
  else if (unit === 'd') seconds = val * 86400;
  else if (unit === 's') seconds = val;
  return Math.floor(Date.now() / 1000) + seconds;
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateJti,
  signToken,
  verifyToken,
  validatePasswordStrength,
  validateMatricule,
  getExpiresAtTimestamp,
  BCRYPT_COST,
  JWT_EXPIRES_IN,
  PASSWORD_MIN_LENGTH
};
