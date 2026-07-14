import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { JwtPayload } from '../types';

const JWT_SECRET    = process.env.JWT_SECRET ?? '';
const JWT_EXPIRES   = process.env.JWT_EXPIRES_IN || '8h';
export const BCRYPT_COST         = parseInt(process.env.BCRYPT_COST         || '12', 10);
export const PASSWORD_MIN_LENGTH = parseInt(process.env.PASSWORD_MIN_LENGTH || '8', 10);

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('[AUTH] FATAL: JWT_SECRET manquant ou trop court (≥32 chars)');
  process.exit(1);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try { return await bcrypt.compare(plain, hash); } catch { return false; }
}

export function generateJti(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES as jwt.SignOptions['expiresIn'],
    algorithm: 'HS256',
  });
}

export function verifyToken(token: string): JwtPayload | null {
  try { return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload; }
  catch { return null; }
}

export function getExpiresAt(): number {
  const unit = JWT_EXPIRES.slice(-1);
  const val  = parseInt(JWT_EXPIRES.slice(0, -1), 10);
  const secs = unit === 'h' ? val * 3600 : unit === 'd' ? val * 86400 : unit === 'm' ? val * 60 : 8 * 3600;
  return Math.floor(Date.now() / 1000) + secs;
}

const COMMON = new Set(['password','motdepasse','azerty','qwerty','12345678','admin123','pass1234']);

export function validatePassword(pass: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!pass || pass.length < PASSWORD_MIN_LENGTH) errors.push(`Minimum ${PASSWORD_MIN_LENGTH} caractères`);
  if (!/[a-z]/.test(pass)) errors.push('Au moins une minuscule');
  if (!/[A-Z]/.test(pass)) errors.push('Au moins une majuscule');
  if (!/[0-9]/.test(pass)) errors.push('Au moins un chiffre');
  if (COMMON.has(pass.toLowerCase())) errors.push('Mot de passe trop courant');
  return { valid: errors.length === 0, errors };
}

export function validateMatricule(m: string): boolean {
  return /^[A-Z0-9]{2,30}$/i.test(m);
}
