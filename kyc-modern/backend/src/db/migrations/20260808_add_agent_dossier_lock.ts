import type { Pool } from 'mysql2/promise';

// ============================================================================
// Corrige le bug "2 dossiers distribués auto au lieu de 1" :
// - crée agent_dossier_lock, une table avec `matricule` en PRIMARY KEY, qui
//   sert de verrou exclusif : un agent ne peut avoir qu'UNE seule ligne, donc
//   qu'UN seul dossier en_cours à la fois, quel que soit le chemin
//   d'attribution (push auto, pull /appeler, /prendre, transfert superviseur).
// - répare les doubles attributions déjà présentes en base (si un agent a
//   plusieurs dossiers en_cours, on garde le plus récent et on remet les
//   autres en file d'attente).
// - initialise la table à partir de l'état courant.
// ============================================================================

export const migration = {
  name: '20260808_add_agent_dossier_lock',
  up: async (pool: Pool): Promise<void> => {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS agent_dossier_lock (
        matricule   VARCHAR(50)  NOT NULL,
        dossier_id  VARCHAR(64)  NOT NULL,
        created_at  BIGINT       NOT NULL,
        PRIMARY KEY (matricule),
        UNIQUE KEY uniq_agent_dossier_lock_dossier (dossier_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Réparation ponctuelle des doubles attributions déjà en base (le bug
    // qu'on corrige) : pour chaque agent ayant plusieurs dossiers en_cours,
    // on garde le plus récemment assigné et on remet les autres en_attente.
    const [rows] = await pool.query<any[]>(`
      SELECT id, agent_saisie,
             ROW_NUMBER() OVER (
               PARTITION BY agent_saisie
               ORDER BY assigne_le DESC, id DESC
             ) AS rn
      FROM dossiers
      WHERE statut = 'en_cours' AND agent_saisie IS NOT NULL
    `);
    const aRemettre = (rows as Array<{ id: string; rn: number }>)
      .filter(r => r.rn > 1)
      .map(r => r.id);

    if (aRemettre.length) {
      await pool.query(
        `UPDATE dossiers
         SET statut='en_attente', agent_saisie=NULL, assigne_a=NULL,
             assigne_le=NULL, heure_prise=NULL, updated_at=UNIX_TIMESTAMP()
         WHERE id IN (${aRemettre.map(() => '?').join(',')})`,
        aRemettre
      );
      console.log(`[MIGRATION 20260808] ${aRemettre.length} dossier(s) en double attribution remis en file d'attente`);
    }

    // Peuple les verrous à partir de l'état actuel (1 par agent désormais).
    await pool.execute(`
      INSERT IGNORE INTO agent_dossier_lock (matricule, dossier_id, created_at)
      SELECT agent_saisie, id, UNIX_TIMESTAMP()
      FROM dossiers
      WHERE statut = 'en_cours' AND agent_saisie IS NOT NULL
    `);
  },
  down: async (pool: Pool): Promise<void> => {
    await pool.execute('DROP TABLE IF EXISTS agent_dossier_lock');
  },
};
