// ============================================================================
// KYC V3 - Module d'acces a la base de donnees
// ============================================================================
// Centralise la connexion SQLite et fournit les helpers de base
// ============================================================================

'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'mccb-v3.db');

// Connexion unique (singleton)
const db = new Database(DB_PATH);

// Configuration optimale
db.pragma('journal_mode = WAL');       // Write-Ahead Logging (concurrence)
db.pragma('foreign_keys = ON');        // Active les FK
db.pragma('synchronous = NORMAL');     // Bon compromis perfs/securite
db.pragma('cache_size = -64000');      // 64 MB de cache (en KB negatif)

// ============================================================================
// Migration : ajout des colonnes reconnaissance faciale (idempotent)
// ============================================================================
(function migrerColonnesFaceVerify() {
  const colonnes = [
    // Valeur retournee par AWS Rekognition (0-100, 1 decimale, NULL = non analyse)
    { col: 'score_visage',     def: 'REAL    DEFAULT NULL' },
    // 1 = match (score >= seuil), 0 = pas de match, NULL = pas encore analyse
    { col: 'visage_match',     def: 'INTEGER DEFAULT NULL' },
    // Code explicatif : ok | score_faible | aucun_visage_selfie | aucun_visage_cni | erreur_aws
    { col: 'visage_motif',     def: 'TEXT    DEFAULT NULL' },
    // Timestamp Unix de la derniere verification (pour savoir si elle a ete faite)
    { col: 'visage_verifie_le', def: 'INTEGER DEFAULT NULL' }
  ];

  for (const { col, def } of colonnes) {
    try {
      db.prepare('ALTER TABLE dossiers ADD COLUMN ' + col + ' ' + def).run();
      console.log('[DB] Colonne ajoutee : dossiers.' + col);
    } catch (e) {
      // "duplicate column name" = deja presente, c'est normal
      if (!e.message.includes('duplicate column name')) {
        console.error('[DB] Erreur migration colonne ' + col + ':', e.message);
      }
    }
  }
})();

// ============================================================================
// Helpers
// ============================================================================

// ----------------------------------------------------------------------------
// Helper: audit_log
// ----------------------------------------------------------------------------
const _insertAudit = db.prepare(`
  INSERT INTO audit_log (user_matricule, action, details, ip, user_agent)
  VALUES (?, ?, ?, ?, ?)
`);

function audit(matricule, action, details, ip, userAgent) {
  try {
    _insertAudit.run(
      matricule || null,
      action,
      details || null,
      ip || null,
      userAgent || null
    );
  } catch (err) {
    console.error('[AUDIT] Erreur:', err.message);
  }
}

// ----------------------------------------------------------------------------
// Helper: lecture compte
// ----------------------------------------------------------------------------
const _selectCompteByMatricule = db.prepare(`
  SELECT id, matricule, nom, prenom, role, password_hash, actif,
         must_change_password, last_login_at, failed_login_count, locked_until
  FROM comptes
  WHERE matricule = ?
`);

function getCompteByMatricule(matricule) {
  return _selectCompteByMatricule.get(matricule);
}

// ----------------------------------------------------------------------------
// Helper: maj compteur d'echecs
// ----------------------------------------------------------------------------
const _incrementFailedLogin = db.prepare(`
  UPDATE comptes
  SET failed_login_count = failed_login_count + 1,
      updated_at = strftime('%s','now')
  WHERE matricule = ?
`);

const _resetFailedLogin = db.prepare(`
  UPDATE comptes
  SET failed_login_count = 0,
      last_login_at = strftime('%s','now'),
      locked_until = NULL,
      updated_at = strftime('%s','now')
  WHERE matricule = ?
`);

const _lockAccount = db.prepare(`
  UPDATE comptes
  SET locked_until = strftime('%s','now') + ?,
      updated_at = strftime('%s','now')
  WHERE matricule = ?
`);

function incrementFailedLogin(matricule) {
  _incrementFailedLogin.run(matricule);
}

function resetFailedLogin(matricule) {
  _resetFailedLogin.run(matricule);
}

function lockAccount(matricule, durationSeconds) {
  _lockAccount.run(durationSeconds, matricule);
}

// ----------------------------------------------------------------------------
// Helper: maj mot de passe
// ----------------------------------------------------------------------------
const _updatePasswordHash = db.prepare(`
  UPDATE comptes
  SET password_hash = ?,
      must_change_password = 0,
      updated_at = strftime('%s','now')
  WHERE matricule = ?
`);

function updatePasswordHash(matricule, newHash) {
  _updatePasswordHash.run(newHash, matricule);
}

// ----------------------------------------------------------------------------
// Helper: sessions JWT
// ----------------------------------------------------------------------------
const _insertSession = db.prepare(`
  INSERT INTO sessions_v3 (jti, matricule, ip, user_agent, expires_at)
  VALUES (?, ?, ?, ?, ?)
`);

const _revokeSession = db.prepare(`
  UPDATE sessions_v3
  SET revoked = 1
  WHERE jti = ?
`);

const _revokeAllSessions = db.prepare(`
  UPDATE sessions_v3
  SET revoked = 1
  WHERE matricule = ? AND revoked = 0
`);
const _isSessionValid = db.prepare(`
  SELECT 1 FROM sessions_v3
  WHERE jti = ? AND revoked = 0 AND expires_at > strftime('%s','now')
`);

function insertSession(jti, matricule, ip, userAgent, expiresAt) {
  _insertSession.run(jti, matricule, ip, userAgent, expiresAt);
}

function revokeSession(jti) {
  _revokeSession.run(jti);
}
function revokeAllSessions(matricule) {
  _revokeAllSessions.run(matricule);
}

function isSessionValid(jti) {
  return !!_isSessionValid.get(jti);
}

// ----------------------------------------------------------------------------
// Export
// ----------------------------------------------------------------------------
module.exports = {
  db,
  audit,
  getCompteByMatricule,
  incrementFailedLogin,
  resetFailedLogin,
  lockAccount,
  updatePasswordHash,
  insertSession,
  revokeSession,
  revokeAllSessions,
  isSessionValid
};
