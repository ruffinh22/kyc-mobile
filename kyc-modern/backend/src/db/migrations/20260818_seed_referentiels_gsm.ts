import type { Pool } from 'mysql2/promise';

// ============================================================================
// Seed initial du référentiel GSM (config.referentiels_gsm, JSON unique lu/
// écrit par db.getReferentiels() / db.setReferentiels()).
//
// - `piece` N'EST PAS une liste indépendante : elle reprend exactement les
//   types de pièce que l'agent terrain choisit déjà à l'acquisition (voir
//   OFFICIAL_DOC_TYPES dans public-dossiers.ts : CNI, CEDEAO, PASSPORT, CIP,
//   PERMIS + fallback AUTRE pour les pièces non standard).
// - `constat` / `verbatim` / `action` / `statut_final` : socle standard de
//   départ (valeurs génériques QA GSM/Gross Add), à affiner ensuite via
//   l'écran d'admin (PUT /api/gsm/referentiels/:field) — le superviseur peut
//   en ajouter/retirer autant qu'il veut.
//
// Ne touche QUE les clés absentes ou vides : si un champ a déjà des valeurs
// (saisies manuellement ou via acceptUnknownReferentielById), on ne les
// écrase jamais.
// ============================================================================

const DEFAULTS: Record<string, string[]> = {
  piece: ['CNI', 'CEDEAO', 'PASSPORT', 'CIP', 'PERMIS', 'AUTRE'],
  constat: [
    'Conforme',
    'Non conforme',
    'Pièce illisible',
    'Selfie non conforme',
    'Signature manquante',
    'Informations divergentes',
    'Numéro déjà enregistré',
    'Doublon détecté',
  ],
  verbatim: [
    'Photo floue',
    'Pièce expirée',
    'Nom ne correspond pas à la pièce',
    'Client absent lors de la vérification',
    'Informations incomplètes',
    'Pièce non valide',
    'Autre document accepté',
  ],
  action: [
    'Validé',
    'Rejeté',
    'À corriger',
    'Transmis au superviseur',
    'Réenregistrement demandé',
    'Clôturé sans suite',
  ],
  statut_final: ['Accepté', 'Rejeté', 'En cours'],
};

export const migration = {
  name: '20260818_seed_referentiels_gsm',

  async up(pool: Pool): Promise<void> {
    const [rows] = await pool.execute(
      `SELECT valeur FROM config WHERE cle = 'referentiels_gsm'`
    );
    let current: Record<string, string[]> = {};
    const existingRow = (rows as Array<{ valeur: string }>)[0];
    if (existingRow?.valeur) {
      try { current = JSON.parse(existingRow.valeur); } catch { current = {}; }
    }

    let changed = false;
    for (const [field, values] of Object.entries(DEFAULTS)) {
      if (!Array.isArray(current[field]) || current[field].length === 0) {
        current[field] = values;
        changed = true;
      }
    }

    if (changed) {
      await pool.execute(
        `INSERT INTO config (cle, valeur, updated_at) VALUES ('referentiels_gsm', ?, UNIX_TIMESTAMP())
         ON DUPLICATE KEY UPDATE valeur = VALUES(valeur), updated_at = VALUES(updated_at)`,
        [JSON.stringify(current)]
      );
    }
  },

  async down(_pool: Pool): Promise<void> {
    // Intentionnellement vide : on ne veut jamais effacer un référentiel
    // potentiellement déjà enrichi manuellement par un superviseur.
  },
};
