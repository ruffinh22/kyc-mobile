import type { Pool } from 'mysql2/promise';

// ============================================================================
// Champs dynamiques du dossier (admin) + réattribution GSM (agent)
// ----------------------------------------------------------------------------
// `dossier_champs` : catalogue des champs qui composent un dossier.
//   - standard=1 : correspond à une colonne SQL fixe de `dossiers` déjà
//     existante (nom_titulaire, numero_cni, ...). L'admin peut la renommer
//     (label), la rendre obligatoire/facultative, l'activer/désactiver —
//     mais jamais la supprimer (la colonne SQL sous-jacente reste).
//   - standard=0 : champ créé par l'admin. `cle` porte alors le nom de la
//     VRAIE colonne SQL ajoutée dans `dossiers` (ALTER TABLE ADD COLUMN),
//     et la suppression du champ déclenche un ALTER TABLE DROP COLUMN réel.
//
// `dossier_reattributions` : historique d'audit à chaque réattribution d'un
// dossier GSM à une nouvelle personne (ancien titulaire figé en JSON).
// ============================================================================

const STANDARD_FIELDS: Array<{ cle: string; label: string; type: string; obligatoire: 0 | 1; ordre: number }> = [
  { cle: 'nom_titulaire',     label: 'Nom du titulaire',        type: 'texte', obligatoire: 1, ordre: 10 },
  { cle: 'prenom_titulaire',  label: 'Prénom du titulaire',     type: 'texte', obligatoire: 1, ordre: 20 },
  { cle: 'type_piece',        label: 'Type de pièce',           type: 'liste', obligatoire: 1, ordre: 30 },
  { cle: 'numero_cni',        label: 'Numéro de la pièce',      type: 'texte', obligatoire: 0, ordre: 40 },
  { cle: 'date_naissance',    label: 'Date de naissance',       type: 'date',  obligatoire: 0, ordre: 50 },
  { cle: 'lieu_naissance',    label: 'Lieu de naissance',       type: 'texte', obligatoire: 0, ordre: 60 },
  { cle: 'date_expiration',   label: 'Date d’expiration',       type: 'date',  obligatoire: 0, ordre: 70 },
  { cle: 'sexe',              label: 'Sexe',                    type: 'liste', obligatoire: 0, ordre: 80 },
  { cle: 'nationalite',       label: 'Nationalité',             type: 'texte', obligatoire: 0, ordre: 90 },
  { cle: 'profession',        label: 'Profession',              type: 'texte', obligatoire: 0, ordre: 100 },
  { cle: 'nom_pere',          label: 'Nom du père',             type: 'texte', obligatoire: 1, ordre: 110 },
  { cle: 'nom_mere',          label: 'Nom de la mère',          type: 'texte', obligatoire: 1, ordre: 120 },
  { cle: 'adresse_complete',  label: 'Adresse complète',        type: 'texte', obligatoire: 0, ordre: 130 },
  { cle: 'autre_numero',      label: 'Autre numéro de contact', type: 'texte', obligatoire: 0, ordre: 140 },
];

export const migration = {
  name: '20260901_add_champs_dynamiques_reattribution',

  async up(pool: Pool) {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS dossier_champs (
        id INT NOT NULL AUTO_INCREMENT,
        cle VARCHAR(64) NOT NULL,
        label VARCHAR(255) NOT NULL,
        type VARCHAR(20) NOT NULL DEFAULT 'texte',
        options LONGTEXT DEFAULT NULL,
        obligatoire TINYINT(1) NOT NULL DEFAULT 0,
        actif TINYINT(1) NOT NULL DEFAULT 1,
        standard TINYINT(1) NOT NULL DEFAULT 0,
        ordre INT NOT NULL DEFAULT 0,
        cree_par VARCHAR(64) DEFAULT NULL,
        created_at BIGINT NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_dossier_champs_cle (cle)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS dossier_reattributions (
        id INT NOT NULL AUTO_INCREMENT,
        dossier_id VARCHAR(64) NOT NULL,
        ancien_snapshot LONGTEXT DEFAULT NULL,
        motif VARCHAR(255) DEFAULT NULL,
        agent_matricule VARCHAR(50) DEFAULT NULL,
        created_at BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        INDEX idx_dossier_reattributions_dossier (dossier_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const dossierColumns = [
      "ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS reattribue TINYINT(1) NOT NULL DEFAULT 0",
      "ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS reattribue_le BIGINT DEFAULT NULL",
      "ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS reattribue_par VARCHAR(50) DEFAULT NULL",
      "ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS nb_reattributions INT NOT NULL DEFAULT 0",
    ];
    for (const statement of dossierColumns) {
      try {
        await pool.execute(statement);
      } catch (err: any) {
        if (err?.code !== 'ER_DUP_FIELDNAME' && err?.code !== 'ER_PARSE_ERROR') throw err;
      }
    }

    const now = Math.floor(Date.now() / 1000);
    for (const f of STANDARD_FIELDS) {
      await pool.execute(
        `INSERT IGNORE INTO dossier_champs (cle, label, type, obligatoire, actif, standard, ordre, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?)`,
        [f.cle, f.label, f.type, f.obligatoire, f.ordre, now, now]
      );
    }
  },

  async down(pool: Pool) {
    await pool.execute('DROP TABLE IF EXISTS dossier_reattributions');
    await pool.execute('DROP TABLE IF EXISTS dossier_champs');
    const statements = [
      'ALTER TABLE dossiers DROP COLUMN IF EXISTS nb_reattributions',
      'ALTER TABLE dossiers DROP COLUMN IF EXISTS reattribue_par',
      'ALTER TABLE dossiers DROP COLUMN IF EXISTS reattribue_le',
      'ALTER TABLE dossiers DROP COLUMN IF EXISTS reattribue',
    ];
    for (const statement of statements) {
      try { await pool.execute(statement); } catch { /* ignore rollback failures */ }
    }
  },
};
